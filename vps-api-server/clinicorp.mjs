/**
 * Clinicorp integration module
 * - REST API client (https://api.clinicorp.com/rest/v1)
 * - Sync helpers (clinics, professionals, patients, appointments, estimates...)
 * - Webhook receiver (validated by ?user_api=<webhook_secret>)
 *
 * Mounted by server.mjs via registerClinicorp(app, pool).
 */

const DEFAULT_BASE_URL = 'https://api.clinicorp.com/rest/v1';

function normalizeApiToken(token) {
  return String(token || '').trim().replace(/^Bearer\s+/i, '');
}

// A API da Clinicorp aceita SOMENTE HTTP Basic (usuário = "Usuário API",
// senha = "Token API"). O token nunca vai na URL para não aparecer em logs.
function clinicorpAuthHeaders(settings) {
  const apiToken = normalizeApiToken(settings?.api_token);
  const apiUser = String(settings?.subscriber_id || '').trim();
  return {
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${apiUser}:${apiToken}`).toString('base64')}`,
  };
}

// ─── Settings por tenant ──────────────────────────────────────
// Não existe mais configuração global: as credenciais ficam em
// clinicorp_user_settings (uma linha por usuário). Para operações disparadas
// pelo sistema (push, webhook) usamos a credencial ativa mais recente de um
// usuário daquele tenant.
async function loadSettingsForTenant(pool, tenantId) {
  if (!tenantId) return null;
  const { rows } = await pool.query(
    `SELECT s.user_id, s.enabled, s.api_token, s.subscriber_id, s.base_url, p.tenant_id
       FROM clinicorp_user_settings s
       JOIN profiles p ON p.id = s.user_id
      WHERE p.tenant_id = $1
        AND s.enabled = TRUE
        AND s.api_token IS NOT NULL AND s.api_token <> ''
        AND s.subscriber_id IS NOT NULL AND s.subscriber_id <> ''
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 1`,
    [tenantId]
  );
  const s = rows[0];
  if (!s) return null;
  return { ...s, base_url: s.base_url || DEFAULT_BASE_URL };
}

// ─── Tenant ───────────────────────────────────────────────────
// Toda escrita da integração exige o tenant explícito (do usuário logado, do
// webhook_secret ou do registro local). Não há mais fallback para o tenant do
// primeiro admin — isso gravava dados de uma clínica em outra.
async function resolveTenantId(_pool, tenantId = null) {
  if (tenantId) return tenantId;
  throw new Error('Clinicorp: tenant_id obrigatório');
}

// Converte valores que devem ir para colunas BIGINT: trata "", undefined, null,
// e strings com whitespace como NULL. Evita "invalid input syntax for bigint: \"\"".
function toBigIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || !/^-?\d+$/.test(s)) return null;
  return s;
}

function pickFirst(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  const entries = Object.entries(obj);
  for (const key of keys) {
    const wanted = String(key).toLowerCase();
    const hit = entries.find(([k, v]) => k.toLowerCase() === wanted && v !== undefined && v !== null && v !== '');
    if (hit) return hit[1];
  }
  return null;
}

function extractClinicorpList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const direct = pickFirst(
    data,
    'Results', 'Result', 'Data', 'data', 'Items', 'items', 'Rows', 'rows', 'Records', 'records',
    'Appointments', 'appointments', 'AppointmentList', 'appointmentList', 'List', 'list'
  );
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') {
    const nested = extractClinicorpList(direct);
    if (nested.length) return nested;
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = extractClinicorpList(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function getAppointmentId(a) {
  return pickFirst(a, 'id', 'Id', 'ID', 'AppointmentId', 'AppointmentID', 'Appointment_Id', 'appointment_id', 'appointmentId', 'ScheduleId', 'Schedule_ID');
}

// ─── HTTP client ──────────────────────────────────────────────
// Throttle SERIALIZADO por subscriber_id para evitar 429: as chamadas são enfileiradas
// e disparadas com espaçamento mínimo. O modelo anterior (apenas _lastCallAt + await)
// permitia que N callers concorrentes lessem o mesmo timestamp e disparassem em rajada.
const THROTTLE_MS = 200; // Aumentando velocidade para o teste inicial
const GLOBAL_PAUSE_AFTER_429_MS = 120_000; // se levarmos 429, pausa toda a fila por 120s
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fila por subscriber + pausa global compartilhada
const _queues = new Map(); // subscriber_id -> Promise chain
let _globalPauseUntil = 0;
const _activeSyncs = new Map(); // subscriber_id:tenant_id -> timestamp


function isClinicorpRateLimitError(err) {
  return err?.status === 429 || /HTTP 429|rate limited/i.test(String(err?.message || ''));
}

function _enqueue(subscriberKey, task) {
  const prev = _queues.get(subscriberKey) || Promise.resolve();
  const next = prev.then(async () => {
    // Respeita pausa global após 429
    const wait = _globalPauseUntil - Date.now();
    if (wait > 0) await sleep(wait);
    const result = await task();
    await sleep(THROTTLE_MS);
    return result;
  }).catch(async (err) => {
    await sleep(THROTTLE_MS);
    throw err;
  });
  _queues.set(subscriberKey, next.catch(() => {}));
  return next;
}

async function clinicorpFetch(settings, pathName, { method = 'GET', query = {}, body } = {}) {
  const subscriberKey = settings?.subscriber_id || 'default';
  return _enqueue(subscriberKey, () => _clinicorpFetchRaw(settings, pathName, { method, query, body }));
}

async function _clinicorpFetchRaw(settings, pathName, { method = 'GET', query = {}, body } = {}) {
  if (!settings?.api_token || !settings?.subscriber_id) {
    throw new Error('Clinicorp: Usuário API (subscriber_id) e Token API são obrigatórios');
  }
  const base = (settings.base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = new URL(base + pathName);

  // subscriber_id vai em todas as chamadas (a spec exige na maioria). Valores
  // vazios são descartados para não gerar 400 na Clinicorp.
  const allQuery = { ...query };
  if (allQuery.subscriber_id === undefined || allQuery.subscriber_id === null || allQuery.subscriber_id === '') {
    allQuery.subscriber_id = String(settings.subscriber_id).trim();
  }
  for (const [k, v] of Object.entries(allQuery)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const maxRetries = 3;
  let retryCount = 0;

  const requestOnce = async () => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const headers = clinicorpAuthHeaders(settings);
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const res = await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });

      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const raSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
        // Pausa GLOBAL pelo tempo informado pela Clinicorp (cap em 1h).
        const pauseMs = Math.min(raSec * 1000, 3600_000);
        _globalPauseUntil = Math.max(_globalPauseUntil, Date.now() + pauseMs);
        console.warn(`[clinicorp] HTTP 429 em ${pathName}. Retry-After=${raSec}s → pausando fila global por ${Math.round(pauseMs / 1000)}s.`);
        const err = new Error(`Clinicorp ${method} ${pathName} → HTTP 429: rate limited (retry-after ${raSec}s)`);
        err.status = 429;
        err.retry_after_seconds = raSec;
        err.retryAfter = raSec;
        throw err;
      }

      // Credencial inválida: não adianta tentar outro esquema de auth (a
      // Clinicorp só aceita Basic) nem seguir com as demais chamadas.
      if (res.status === 401 || res.status === 403) {
        const err = new Error(`Credenciais Clinicorp inválidas (HTTP ${res.status}). Confira o Usuário API e o Token API em Gerenciar Assinatura → Acesso Externo e Integrações.`);
        err.status = res.status;
        err.invalidCredentials = true;
        err.body = data;
        throw err;
      }

      if ((res.status === 502 || res.status === 503 || res.status === 504) && retryCount < maxRetries) {
        retryCount++;
        const delay = Math.min(Math.pow(2, retryCount) * 2500, 30_000);
        console.warn(`[clinicorp] HTTP ${res.status} em ${pathName}. Backoff ${delay}ms (tentativa ${retryCount}/${maxRetries})`);
        await sleep(delay);
        return requestOnce();
      }

      if (!res.ok) {
        const detail = typeof data === 'string' ? data : JSON.stringify(data);
        const err = new Error(`Clinicorp ${method} ${pathName} → HTTP ${res.status}: ${String(detail || '').slice(0, 300)}`);
        err.status = res.status;
        err.body = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };

  return requestOnce();
}

function isClinicorpFatalError(err) {
  return isClinicorpRateLimitError(err) || err?.invalidCredentials === true;
}


// ─── High-level API helpers ───────────────────────────────────
// Somente endpoints da spec oficial (https://api.clinicorp.com/rest/v1).
// Endpoints que não existem (patient/update, appointment/update|delete,
// professional/get, dentist/*, treatment/*, budget/*, financial/list_revenues)
// foram removidos — chamá-los só gerava 404 e consumia o rate limit.
export const clinicorpApi = {
  listUsers: async (s) => {
    const r = await clinicorpFetch(s, '/professional/list_all_professionals');
    return extractClinicorpList(r);
  },
  listClinics: async (s) => extractClinicorpList(await clinicorpFetch(s, '/business/list')),
  listSubscribersClinics: (s) => clinicorpFetch(s, '/group/list_subscribers_clinics'),
  listChairs: async (s, businessId) => extractClinicorpList(await clinicorpFetch(s, '/business/list_chairs', { query: { Clinic_BusinessId: businessId } })),
  listAvailableTimes: (s, professionalId, clinicId, fromDate, toDate) =>
    clinicorpFetch(s, '/business/list_available_times', {
      query: { professionalId, clinicId, fromDate, toDate },
    }),
  listAppointmentCategories: async (s) => extractClinicorpList(await clinicorpFetch(s, '/appointment/list_categories')),
  listSpecialties: async (s) => extractClinicorpList(await clinicorpFetch(s, '/procedures/list_specialties')),
  // GET /appointment/list (from, to obrigatórios; businessId filtra a clínica).
  // Erros sobem para o chamador registrar — não são mais engolidos.
  listAppointments: async (s, from, to, businessId) => {
    const data = await clinicorpFetch(s, '/appointment/list', {
      query: { from, to, ...(businessId ? { businessId } : {}) },
    });
    const seen = new Set();
    const out = [];
    for (const a of extractClinicorpList(data)) {
      const id = getAppointmentId(a);
      if (!id || seen.has(String(id))) continue;
      seen.add(String(id));
      out.push(a);
    }
    return out;
  },

  appointmentStatusList: async (s) => extractClinicorpList(await clinicorpFetch(s, '/appointment/status_list')),
  changeAppointmentStatus: (s, { id, status_id }) => clinicorpFetch(s, '/appointment/change_status', { query: { id, status_id } }),
  confirmAppointment: (s, body) => clinicorpFetch(s, '/appointment/confirm_appointment', { method: 'POST', body }),
  cancelAppointment: (s, id) => clinicorpFetch(s, '/appointment/cancel_appointment', {
    method: 'POST', body: { subscriber_id: String(s.subscriber_id).trim(), id: String(id) },
  }),
  createAppointment: (s, body) => clinicorpFetch(s, '/appointment/create_appointment_by_api', { method: 'POST', body }),
  createOnlineScheduling: (s, body) => clinicorpFetch(s, '/appointment/create_online_scheduling', { method: 'POST', body }),
  getPatient: (s, patientId) => clinicorpFetch(s, '/patient/get', { query: { PatientId: patientId } }),
  // A Clinicorp não expõe listagem em massa de pacientes: eles são derivados
  // dos agendamentos (ver runFullSync).
  patientBirthdays: (s, date) => clinicorpFetch(s, '/patient/birthdays', { query: date ? { date } : {} }),
  createPatient: (s, body) => clinicorpFetch(s, '/patient/create', {
    method: 'POST', body: { subscriber_id: String(s.subscriber_id).trim(), ...body },
  }),
  patientAppointments: (s, patientId) => clinicorpFetch(s, '/patient/list_appointments', { query: { PatientId: patientId } }),
  listPatientEstimates: (s, { from, to, business_id } = {}) => clinicorpFetch(s, '/patient/list_estimates', { query: { from, to, business_id } }),
  listEstimates: async (s, from, to, clinicId) => extractClinicorpList(await clinicorpFetch(s, '/estimates/list', { query: { from, to, clinic_id: clinicId } })),
  getEstimate: (s, treatmentId) => clinicorpFetch(s, '/estimates/get', { query: { treatment_id: treatmentId } }),
  analytics: (s, from, to) => clinicorpFetch(s, '/analytics/list_results', { query: { from, to } }),
  // business_id é opcional só em list_invoices; payments e cash_flow exigem.
  listInvoices: async (s, { from, to, clinic_id } = {}) =>
    extractClinicorpList(await clinicorpFetch(s, '/financial/list_invoices', { query: { from, to, business_id: clinic_id } })),
  listCashFlow: async (s, { from, to, clinic_id } = {}) => {
    if (!clinic_id) throw new Error('Clinicorp /financial/list_cash_flow exige business_id');
    return extractClinicorpList(await clinicorpFetch(s, '/financial/list_cash_flow', { query: { from, to, business_id: clinic_id } }));
  },
  listPayments: async (s, { from, to, clinic_id } = {}) => {
    if (!clinic_id) throw new Error('Clinicorp /financial/list_payments exige business_id');
    return extractClinicorpList(await clinicorpFetch(s, '/financial/list_payments', { query: { from, to, business_id: clinic_id } }));
  },
  listFinancialSummary: (s, { from, to, clinic_id } = {}) => clinicorpFetch(s, '/financial/list_summary', { query: { from, to, business_id: clinic_id } }),
  listFinancialReceipts: (s, { from, to, clinic_id } = {}) => clinicorpFetch(s, '/financial/list_receipt', { query: { from, to, business_id: clinic_id } }),
  scheduleOccupation: (s, query) => clinicorpFetch(s, '/appointment/schedule_occupation', { query }),
  appointmentListInfo: (s, query) => clinicorpFetch(s, '/appointment/list_info', { query }),
  salesEstimatesAndConversion: (s, query) => clinicorpFetch(s, '/sales/estimates_and_conversion', { query }),
  salesExpertiseRevenue: (s, query) => clinicorpFetch(s, '/sales/expertise_revenue', { query }),
  addLead: (s, body) => clinicorpFetch(s, '/crm/add_leads', { method: 'POST', body }),
};

// ─── Upserts ──────────────────────────────────────────────────
async function upsertClinic(pool, c, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  const clinicId = c.id ?? c.Id ?? c.BusinessId ?? c.Clinic_BusinessId ?? c.ClinicBusinessId ?? c.CompanyId ?? c.Business?.Id;
  console.log(`[clinicorp] upsertClinic clinicId=${clinicId} tenantId=${tId}`);
  if (!clinicId) return;
  try {
    await pool.query(
    `INSERT INTO clinicorp_clinics
       (id, tenant_id, company_id, business_name, name, email, address, active,
        landline, other_landline, slot_time, no_limit_apt_same_time,
        subscriber_business_uid, working_days_hours, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       business_name = EXCLUDED.business_name,
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       address = EXCLUDED.address,
       active = EXCLUDED.active,
       landline = EXCLUDED.landline,
       other_landline = EXCLUDED.other_landline,
       slot_time = EXCLUDED.slot_time,
       no_limit_apt_same_time = EXCLUDED.no_limit_apt_same_time,
       subscriber_business_uid = EXCLUDED.subscriber_business_uid,
       working_days_hours = EXCLUDED.working_days_hours,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      clinicId, tId, c.CompanyId ?? c.BusinessId ?? null, c.BusinessName ?? c.Name ?? null,
      c.Name ?? null, c.Email ?? null, c.Address ?? null, c.Active ?? null,
      c.Landline ?? null, c.OtherLandline ?? null, c.SlotTime ?? null,
      c.NoLimitAptSameTime ?? null, c.SubscriberBussinessUID ?? null,
      c.WorkingDaysHours ? JSON.stringify(c.WorkingDaysHours) : null,
      JSON.stringify(c),
    ]
    );
    console.log(`[clinicorp] upsertClinic success clinicId=${clinicId}`);
  } catch (err) {
    console.error(`[clinicorp] upsertClinic FAILED clinicId=${clinicId}:`, err.message);
    throw err;
  }
}

async function upsertProfessional(pool, p, tenantId = null) {
  const id = p.id ?? p.Id ?? p.UserId ?? p.PersonId ?? p.Professional_PersonId ?? p.ProfessionalPersonId ?? p.ProfessionalId ?? p.Dentist_PersonId ?? p.DentistId ?? null;
  if (!id) return;
  const tId = await resolveTenantId(pool, tenantId);
  // A API Clinicorp retorna o nome em diversos campos dependendo da versão/endpoint
  const fullName = (p.FullName ?? p.Full_Name ?? p.full_name ?? p.Name ?? p.name ?? p.PersonName ?? p.Professional_FullName ?? p.ProfessionalName ?? p.Dentist_FullName ?? p.DentistName ?? p.UserName ?? p.username ?? `Profissional ${id}`).toString().trim();
  const userName = p.UserName ?? p.Username ?? p.username ?? p.Email ?? p.email ?? p.Login ?? null;
  await pool.query(
    `INSERT INTO clinicorp_professionals (id, tenant_id, full_name, user_name, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       user_name = EXCLUDED.user_name,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [String(id), tId, fullName, userName, JSON.stringify(p)]
  );
  try { 
    await ensureLocalProfessional(pool, String(id), fullName, tId); 
    // /professional/list_all_professionals (spec) devolve só {id, name, cpf}:
    // só mexe em "ativo" se a Clinicorp mandou o campo.
    const rawActive = p.Active ?? p.active ?? p.status;
    if (rawActive !== undefined && rawActive !== null) {
      const isActive = rawActive === true || rawActive === 'X' || String(rawActive).toLowerCase() === 'active';
      await pool.query(`UPDATE dentistas SET ativo = $1, updated_at = NOW() WHERE clinicorp_professional_id = $2 AND tenant_id = $3`, [isActive, String(id), tId]);
    }
  }
  catch (e) { console.error('[clinicorp] ensureLocalProfessional:', e.message); }
}

async function upsertChair(pool, c, tenantId = null, businessId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  const id = pickFirst(c, 'id', 'Id', 'ChairId');
  if (!id) return;
  await pool.query(
    `INSERT INTO clinicorp_chairs (id, tenant_id, business_id, name, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       business_id = EXCLUDED.business_id,
       name = EXCLUDED.name,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [String(id), tId, toBigIntOrNull(pickFirst(c, 'BusinessId', 'Clinic_BusinessId') ?? businessId), pickFirst(c, 'Name', 'name', 'Description') ?? null, JSON.stringify(c)]
  );
}

async function upsertCategory(pool, c, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  const id = pickFirst(c, 'id', 'Id', 'CategoryId');
  if (!id) return;
  await pool.query(
    `INSERT INTO clinicorp_appointment_categories (id, tenant_id, description, color, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       description = EXCLUDED.description,
       color = EXCLUDED.color,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [String(id), tId, pickFirst(c, 'Description', 'description', 'Name') ?? null, pickFirst(c, 'Color', 'color') ?? null, JSON.stringify(c)]
  );
}

async function upsertSpecialty(pool, s, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  const id = pickFirst(s, 'id', 'Id', 'SpecialtyId');
  if (!id) return;
  await pool.query(
    `INSERT INTO clinicorp_specialties (id, tenant_id, description, raw, synced_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       description = EXCLUDED.description,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [String(id), tId, pickFirst(s, 'Description', 'description', 'Name', 'name') ?? null, JSON.stringify(s)]
  );
}

async function upsertPatient(pool, p, tenantId = null, { project = true } = {}) {
  const tId = await resolveTenantId(pool, tenantId);
  const cpId = pickFirst(p, 'id', 'Id', 'PatientId', 'Patient_PersonId', 'PersonId');
  if (!cpId) return;
  await pool.query(
    `INSERT INTO clinicorp_patients
       (id, tenant_id, name, email, mobile_phone, birth_date, sex, document_id, notes, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       mobile_phone = EXCLUDED.mobile_phone,
       birth_date = EXCLUDED.birth_date,
       sex = EXCLUDED.sex,
       document_id = EXCLUDED.document_id,
       notes = EXCLUDED.notes,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      String(cpId), tId, p.Name ?? null, p.Email ?? null,
      String(p.MobilePhone ?? '') || null,
      p.BirthDate || null, p.Sex ?? null,
      String(p.DocumentId ?? '') || null, p.Notes ?? null,
      JSON.stringify(p),
    ]
  );
  if (!project) return;
  try { await projectPatientToLocal(pool, { ...p, id: cpId }, tId); }
  catch (e) { console.error('[clinicorp] projectPatientToLocal:', e.message); }
}

async function upsertAppointment(pool, a, tenantId = null) {
  const id = getAppointmentId(a);
  if (!id) return;
  const tId = await resolveTenantId(pool, tenantId);
  const businessId = pickFirst(a, 'BusinessId', 'Clinic_BusinessId', 'ClinicBusinessId', 'ClinicId', 'clinic_id', 'business_id') ?? a.Business?.Id ?? null;
  const patientId = pickFirst(a, 'PatientId', 'Patient_PersonId', 'PatientPersonId', 'Patient_Id', 'patient_id', 'patientId') ?? a.Patient?.Id ?? a.Patient?.PersonId ?? null;
  const professionalId = pickFirst(a, 'ProfessionalId', 'Dentist_PersonId', 'DentistPersonId', 'Professional_PersonId', 'ScheduleToId', 'ScheduleTo_PersonId', 'DentistId', 'Dentist_Id', 'professional_id', 'dentist_id') ?? a.Dentist?.Id ?? a.Professional?.Id ?? null;
  const appointmentDate = normalizeClinicorpDate(pickFirst(a, 'AtomicDate', 'Date', 'AppointmentDate', 'SK_DateFirstTime', 'DateFirstTime', 'StartDate', 'StartDateTime', 'StartTime', 'fromTime', 'FromTime', 'date', 'appointment_date'));
  const fromTime = normalizeClinicorpTime(pickFirst(a, 'FromTime', 'Time', 'StartTime', 'StartDateTime', 'ScheduleTime', 'Hour', 'fromTime', 'from_time', 'hora'));
  const toTime = normalizeClinicorpTime(pickFirst(a, 'ToTime', 'FinalTime', 'EndTime', 'EndDateTime', 'toTime', 'to_time'));
  await pool.query(
    `INSERT INTO clinicorp_appointments
       (id, tenant_id, business_id, patient_id, patient_name, professional_id, professional_name,
        category_id, category_description, category_color, chair_id,
        status, date, from_time, to_time, notes, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       business_id = EXCLUDED.business_id,
       patient_id = EXCLUDED.patient_id,
       patient_name = EXCLUDED.patient_name,
       professional_id = EXCLUDED.professional_id,
       professional_name = EXCLUDED.professional_name,
       category_id = EXCLUDED.category_id,
       category_description = EXCLUDED.category_description,
       category_color = EXCLUDED.category_color,
       chair_id = EXCLUDED.chair_id,
       status = EXCLUDED.status,
       date = EXCLUDED.date,
       from_time = EXCLUDED.from_time,
       to_time = EXCLUDED.to_time,
       notes = EXCLUDED.notes,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      String(id), tId,
      toBigIntOrNull(businessId),
      toBigIntOrNull(patientId),
      pickFirst(a, 'PatientName', 'Patient_FullName', 'Patient_Name', 'PatientFullName', 'patient_name', 'patientName', 'Name') ?? a.Patient?.Name ?? a.Patient?.FullName ?? null,
      toBigIntOrNull(professionalId),
      pickFirst(a, 'ProfessionalName', 'Dentist_FullName', 'Dentist_Name', 'DentistName', 'ScheduleToName', 'Professional_Name', 'professional_name', 'dentist_name') ?? a.Dentist?.Name ?? a.Dentist?.FullName ?? a.Professional?.Name ?? a.Professional?.FullName ?? null,
      toBigIntOrNull(pickFirst(a, 'CategoryId', 'Category_id', 'Category_Id', 'AppointmentCategoryId', 'appointment_category_id')),
      pickFirst(a, 'CategoryDescription', 'Category_Description', 'Category', 'category_description', 'ProcedureName', 'Procedure') ?? null,
      pickFirst(a, 'CategoryColor', 'Category_Color', 'Color', 'category_color') ?? null,
      toBigIntOrNull(pickFirst(a, 'ChairId', 'Chair_Id', 'chair_id')),
      pickFirst(a, 'Status', 'StatusId', 'status') ?? null,
      appointmentDate,
      fromTime,
      toTime,
      a.Notes ?? a.Observation ?? a.notes ?? null,
      JSON.stringify(a),
    ]
  );
  // Backfill stub no clinicorp_patients a partir do agendamento (a Clinicorp não expõe /patient/list)
  try {
    const pid = pickFirst(a, 'PatientId', 'Patient_PersonId', 'PatientPersonId', 'Patient_Id', 'patient_id', 'patientId') ?? a.Patient?.Id ?? a.Patient?.PersonId ?? null;
    const pname = pickFirst(a, 'PatientName', 'Patient_FullName', 'Patient_Name', 'PatientFullName', 'patient_name', 'patientName', 'Name') ?? a.Patient?.Name ?? a.Patient?.FullName ?? null;
    if (pid) {
      await pool.query(
        `INSERT INTO clinicorp_patients (id, tenant_id, name, mobile_phone, raw, synced_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id, tenant_id) DO UPDATE SET
           name = COALESCE(NULLIF(EXCLUDED.name,''), clinicorp_patients.name),
           mobile_phone = COALESCE(NULLIF(EXCLUDED.mobile_phone,''), clinicorp_patients.mobile_phone),
           synced_at = NOW()`,
        [
          String(pid), tId,
          pname,
          String(pickFirst(a, 'PatientPhone', 'MobilePhone', 'PatientMobilePhone', 'Phone', 'phone') ?? '') || null,
          JSON.stringify({ derived_from: 'appointment', appointment_id: id, id: pid, name: pname }),
        ]
      );
    }
  } catch (e) { console.error('[clinicorp] patient stub from appt:', e.message); }

  try { await projectAppointmentToLocal(pool, a, String(id), tId); }
  catch (e) { console.error('[clinicorp] projectAppointmentToLocal:', e.message); }
}

async function upsertEvolution(pool, e, tenantId = null) {
  const id = e.id ?? e.EvolutionId;
  if (!id) return;
  const tId = await resolveTenantId(pool, tenantId);
  await pool.query(
    `INSERT INTO clinicorp_evolutions (id, tenant_id, patient_id, professional_id, treatment_id, description, date, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       patient_id = EXCLUDED.patient_id,
       professional_id = EXCLUDED.professional_id,
       treatment_id = EXCLUDED.treatment_id,
       description = EXCLUDED.description,
       date = EXCLUDED.date,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [String(id), tId, e.PatientId, e.ProfessionalId, e.TreatmentId, e.Description, e.Date, JSON.stringify(e)]
  );
}

async function upsertDocument(pool, d, tenantId = null) {
  const id = d.id ?? d.DocumentId;
  if (!id) return;
  const tId = await resolveTenantId(pool, tenantId);
  await pool.query(
    `INSERT INTO clinicorp_documents (id, tenant_id, patient_id, title, file_url, category, date, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       patient_id = EXCLUDED.patient_id,
       title = EXCLUDED.title,
       file_url = EXCLUDED.file_url,
       category = EXCLUDED.category,
       date = EXCLUDED.date,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [String(id), tId, d.PatientId, d.Title, d.FileUrl, d.Category, d.Date, JSON.stringify(d)]
  );
}

// ─── Projection layer (Clinicorp → schema local) ───
function mapAppointmentStatus(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return 'agendado';
  if (s.includes('confirm')) return 'confirmado';
  if (s.includes('cancel') || s.includes('desmarc')) return 'cancelado';
  if (s.includes('falt') || s.includes('no_show') || s.includes('noshow')) return 'faltou';
  if (s.includes('atend') || s.includes('progress')) return 'em_atendimento';
  if (s.includes('final') || s.includes('conclu') || s.includes('done') || s.includes('complete')) return 'finalizado';
  return 'agendado';
}
function onlyDigits(v) { return String(v ?? '').replace(/\D+/g, '') || null; }
function normalizeClinicorpDate(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const raw = value instanceof Date ? value.toISOString() : String(value).trim();
    if (/^\d{8}(\d{4,6})?$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const msDate = raw.match(/\/Date\((\d+)/);
    if (msDate) return new Date(Number(msDate[1])).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  }
  return null;
}
function normalizeClinicorpTime(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const raw = String(value).trim();
    if (/^\d{1,2}:\d{2}/.test(raw)) return raw.slice(0, 5).padStart(5, '0');
    if (/^\d{12,14}$/.test(raw)) return `${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
    if (/^\d{3,4}$/.test(raw)) return `${raw.slice(0, -2).padStart(2, '0')}:${raw.slice(-2)}`;
    const isoTime = raw.match(/T(\d{2}:\d{2})/);
    if (isoTime) return isoTime[1];
  }
  return null;
}

// Projeção local: sempre restrita ao tenant da sincronização. Nunca move um
// registro de outro tenant para este (isso fazia pacientes/dentistas/agendas
// "pularem" de clínica quando duas contas apontavam para o mesmo Clinicorp).
async function ensureLocalPatient(pool, cpId, fallback = {}, tenantId = null) {
  if (!cpId) return null;
  const tId = await resolveTenantId(pool, tenantId);
  cpId = String(cpId);
  const found = await pool.query(
    `SELECT id FROM pacientes WHERE clinicorp_patient_id = $1 AND tenant_id = $2 LIMIT 1`,
    [cpId, tId]
  );
  const cp = await pool.query(`SELECT * FROM clinicorp_patients WHERE id = $1 AND tenant_id = $2`, [cpId, tId]);
  const src = cp.rows[0] || {};

  // Se não estiver no espelho, registra (auto-espelhamento)
  if (!cp.rows[0] && (fallback.name || fallback.phone)) {
    try {
      await upsertPatient(pool, {
        id: cpId,
        Name: fallback.name,
        MobilePhone: fallback.phone,
        Email: fallback.email,
        derived: true,
      }, tId, { project: false });
    } catch (err) { console.warn('[clinicorp] espelho paciente', cpId, err.message); }
  }

  const nome = src.name || fallback.name || 'Paciente';
  const telefone = src.mobile_phone || onlyDigits(fallback.phone) || null;
  const email = src.email || fallback.email || null;
  const nascimento = src.birth_date || null;
  const sexo = src.sex || null;
  const cpf = src.document_id || null;
  if (found.rows[0]) {
    await pool.query(
      `UPDATE pacientes SET nome=COALESCE(NULLIF($2,''),nome), telefone=COALESCE($3,telefone),
         email=COALESCE($4,email), data_nascimento=COALESCE($5,data_nascimento),
         sexo=COALESCE($6,sexo), cpf=COALESCE(NULLIF(cpf,''),$7), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$8`,
      [found.rows[0].id, nome, telefone, email, nascimento, sexo, cpf, tId]
    );
    return found.rows[0].id;
  }
  let matchId = null;
  if (telefone) {
    const r = await pool.query(
      `SELECT id FROM pacientes WHERE telefone=$1 AND tenant_id=$2 AND (clinicorp_patient_id IS NULL OR clinicorp_patient_id='') LIMIT 1`,
      [telefone, tId]
    );
    matchId = r.rows[0]?.id || null;
  }
  if (!matchId && cpf) {
    const r = await pool.query(
      `SELECT id FROM pacientes WHERE cpf=$1 AND tenant_id=$2 AND (clinicorp_patient_id IS NULL OR clinicorp_patient_id='') LIMIT 1`,
      [cpf, tId]
    );
    matchId = r.rows[0]?.id || null;
  }
  try {
    if (matchId) {
      await pool.query(
        `UPDATE pacientes SET clinicorp_patient_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
        [cpId, matchId, tId]
      );
      return matchId;
    }
    const ins = await pool.query(
      `INSERT INTO pacientes (nome, telefone, email, data_nascimento, sexo, cpf, clinicorp_patient_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [nome, telefone, email, nascimento, sexo, cpf, cpId, tId]
    );
    return ins.rows[0].id;
  } catch (e) {
    if (e.code === '23505') {
      // Corrida com outra sincronização do MESMO tenant: usa o registro dela.
      const r = await pool.query(
        `SELECT id FROM pacientes WHERE clinicorp_patient_id=$1 AND tenant_id=$2 LIMIT 1`,
        [cpId, tId]
      );
      if (r.rows[0]) return r.rows[0].id;
      // O id pertence a outro tenant (índice único global legado): não mexe.
      console.warn(`[clinicorp] paciente Clinicorp ${cpId} já vinculado a outro tenant — ignorado para ${tId}`);
      return null;
    }
    throw e;
  }
}

async function ensureLocalProfessional(pool, cpProfId, fallbackName = null, tenantId = null) {
  if (!cpProfId) return null;
  const tId = await resolveTenantId(pool, tenantId);
  cpProfId = String(cpProfId);
  const cleanFallback = (fallbackName || '').toString().trim() || null;
  const found = await pool.query(
    `SELECT id, nome FROM dentistas WHERE clinicorp_professional_id=$1 AND tenant_id=$2 LIMIT 1`,
    [cpProfId, tId]
  );

  if (found.rows[0]) {
    // Atualiza nome se estava como placeholder "Profissional XXX" e agora temos um real
    const currentName = (found.rows[0].nome || '').trim();
    const newName = cleanFallback && !/^Profissional\s+\d+$/i.test(cleanFallback) ? cleanFallback : null;
    if (newName && /^Profissional\s+\d+$/i.test(currentName)) {
      await pool.query(`UPDATE dentistas SET nome=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [newName, found.rows[0].id, tId]);
    }
    return found.rows[0].id;
  }
  const cp = await pool.query(`SELECT full_name FROM clinicorp_professionals WHERE id=$1 AND tenant_id=$2`, [cpProfId, tId]);
  const nome = (cp.rows[0]?.full_name || cleanFallback || `Profissional ${cpProfId}`).toString().trim();
  try {
    // Dedupe por LOWER(TRIM(nome)) dentro do mesmo tenant — evita "Dra X" duplicada
    const match = await pool.query(
      `SELECT id FROM dentistas
        WHERE tenant_id=$2 AND LOWER(TRIM(nome))=LOWER($1)
          AND (clinicorp_professional_id IS NULL OR clinicorp_professional_id='')
        LIMIT 1`,
      [nome, tId]
    );
    if (match.rows[0]) {
      await pool.query(
        `UPDATE dentistas SET clinicorp_professional_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
        [cpProfId, match.rows[0].id, tId]
      );
      return match.rows[0].id;
    }
    const ins = await pool.query(
      `INSERT INTO dentistas (nome, ativo, clinicorp_professional_id, tenant_id)
       VALUES ($1, true, $2, $3)
       RETURNING id`,
      [nome, cpProfId, tId]
    );
    return ins.rows[0].id;
  } catch (e) {
    if (e.code === '23505') {
      const r = await pool.query(
        `SELECT id FROM dentistas
          WHERE tenant_id=$1 AND (clinicorp_professional_id=$2 OR LOWER(TRIM(nome))=LOWER($3))
          ORDER BY (clinicorp_professional_id=$2) DESC NULLS LAST
          LIMIT 1`,
        [tId, cpProfId, nome]
      );
      if (r.rows[0]) return r.rows[0].id;
      console.warn(`[clinicorp] profissional Clinicorp ${cpProfId} já vinculado a outro tenant — ignorado para ${tId}`);
      return null;
    }
    throw e;
  }
}

async function ensureLeadForPatient(pool, pacienteId, cpPatientId, info = {}, tenantId = null) {
  if (!pacienteId) return null;
  const tId = await resolveTenantId(pool, tenantId);
  const existing = await pool.query(
    `SELECT id, kanban_stage FROM crm_leads WHERE (paciente_id=$1 OR clinicorp_patient_id=$2) AND tenant_id=$3 LIMIT 1`,
    [pacienteId, cpPatientId, tId]
  );
  if (existing.rows[0]) {
    const lead = existing.rows[0];
    const ahead = ['em_atendimento','pos_consulta','orcamento','orcamento_enviado','orcamento_aprovado'];
    const newStage = ahead.includes(lead.kanban_stage) ? lead.kanban_stage : 'paciente_agendado';
    await pool.query(
      `UPDATE crm_leads SET paciente_id=COALESCE(paciente_id,$2),
         clinicorp_patient_id=COALESCE(clinicorp_patient_id,$3),
         kanban_stage=$4, status=$4, updated_at=NOW() WHERE id=$1`,
      [lead.id, pacienteId, cpPatientId, newStage]
    );
    return lead.id;
  }
  const ins = await pool.query(
    `INSERT INTO crm_leads (nome, telefone, email, origem, status, kanban_stage, paciente_id, clinicorp_patient_id, tenant_id)
     VALUES ($1,$2,$3,'clinicorp','paciente_agendado','paciente_agendado',$4,$5,$6) RETURNING id`,
    [info.nome || 'Paciente Clinicorp', info.telefone || null, info.email || null, pacienteId, cpPatientId, tId]
  );
  return ins.rows[0].id;
}

// ─── Política de resolução de conflitos ────────────────────────
// Resolve estratégia efetiva e flag keep_local para um registro vindo da Clinicorp.
// Precedência: profissional > clínica > global > settings.conflict_strategy.
async function resolveConflictPolicy(pool, { clinicId, professionalId } = {}) {
  const defaultStrategy = 'newest_wins';
  const ovs = await pool.query(
    `SELECT scope_type, scope_id, keep_local, conflict_strategy
       FROM clinicorp_local_overrides
       WHERE (scope_type='global')
          OR (scope_type='clinic'       AND scope_id=$1)
          OR (scope_type='professional' AND scope_id=$2)`,
    [clinicId != null ? String(clinicId) : null, professionalId != null ? String(professionalId) : null]
  );
  const order = { global: 0, clinic: 1, professional: 2 };
  const sorted = ovs.rows.sort((a, b) => order[a.scope_type] - order[b.scope_type]);
  let strategy = defaultStrategy;
  let keepLocal = false;
  let scopeType = 'settings';
  let scopeId = null;
  for (const o of sorted) {
    if (o.conflict_strategy) { strategy = o.conflict_strategy; scopeType = o.scope_type; scopeId = o.scope_id; }
    if (o.keep_local) { keepLocal = true; scopeType = o.scope_type; scopeId = o.scope_id; }
  }
  return { strategy, keepLocal, scopeType, scopeId };
}

// Calcula campos alterados entre o estado local atual e o que viria do Clinicorp.
function diffFields(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changed = [];
  const beforeOut = {};
  const afterOut = {};
  for (const k of keys) {
    const b = before?.[k] ?? null;
    const a = after?.[k] ?? null;
    const norm = (v) => (v instanceof Date ? v.toISOString() : v);
    if (JSON.stringify(norm(b)) !== JSON.stringify(norm(a))) {
      changed.push(k);
      beforeOut[k] = b;
      afterOut[k] = a;
    }
  }
  return { changed, beforeOut, afterOut };
}

async function logConflict(pool, row) {
  try {
    await pool.query(
      `INSERT INTO clinicorp_conflicts
         (entity, clinicorp_id, local_id, decision, strategy, scope_type, scope_id,
          local_updated_at, clinicorp_updated_at, last_sync_at, diff,
          before_data, after_data, changed_fields,
          paciente_id, lead_id, agendamento_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [row.entity, row.clinicorp_id != null ? String(row.clinicorp_id) : null,
       row.local_id != null ? String(row.local_id) : null,
       row.decision, row.strategy, row.scope_type, row.scope_id,
       row.local_updated_at || null, row.clinicorp_updated_at || null,
       row.last_sync_at || null, row.diff ? JSON.stringify(row.diff) : null,
       row.before_data ? JSON.stringify(row.before_data) : null,
       row.after_data  ? JSON.stringify(row.after_data)  : null,
       row.changed_fields && row.changed_fields.length ? row.changed_fields : null,
       row.paciente_id || null, row.lead_id || null, row.agendamento_id || null,
       row.tenant_id || null]
    );
  } catch (e) { console.error('[clinicorp] logConflict', e.message); }
}

// Decide se devemos sobrescrever um registro local com dados do Clinicorp.
// localRow: { updated_at, last_clinicorp_sync_at, keep_local }
function decideOverwrite({ strategy, keepLocal, localRow, clinicorpUpdatedAt }) {
  // O usuário solicitou que SEMPRE sobrescreva para evitar duplicidade e erro de sincronização
  if (!localRow) return { write: true, decision: 'created' };
  
  // Mantemos apenas a trava explícita de "keepLocal" se configurada manualmente no banco
  if (keepLocal || localRow.keep_local) return { write: false, decision: 'kept_local' };
  
  // Por padrão, agora forçamos a vitória da Clinicorp conforme pedido do usuário
  return { write: true, decision: 'overwritten_by_clinicorp' };
}

async function projectAppointmentToLocal(pool, a, cpApptId, tenantId = null) {
  if (!cpApptId) return null;
  const tId = await resolveTenantId(pool, tenantId);
  const cpPatientId = pickFirst(a, 'PatientId', 'Patient_PersonId', 'PatientPersonId', 'Patient_Id', 'patient_id', 'patientId') ?? a.Patient?.Id ?? a.Patient?.PersonId ?? null;
  const cpProfId = pickFirst(a, 'ProfessionalId', 'Dentist_PersonId', 'DentistPersonId', 'Professional_PersonId', 'ScheduleToId', 'ScheduleTo_PersonId', 'DentistId', 'Dentist_Id', 'professional_id', 'dentist_id') ?? a.Dentist?.Id ?? a.Professional?.Id ?? null;
  const cpClinicId = pickFirst(a, 'BusinessId', 'Clinic_BusinessId', 'ClinicBusinessId', 'ClinicId', 'clinic_id', 'business_id') ?? a.Business?.Id ?? null;
  const cpUpdatedAt = a.UpdateDate || a.UpdatedAt || a.LastModified || a.ModifiedAt || a.z_LastChange_Date || a.ModifiedDate || null;
  const policy = await resolveConflictPolicy(pool, { clinicId: cpClinicId, professionalId: cpProfId });

  // Busca ou cria o dentista no schema local ANTES do agendamento
  const professionalName = pickFirst(a, 'ProfessionalName', 'Dentist_FullName', 'Dentist_Name', 'DentistName', 'ScheduleToName', 'Professional_Name', 'professional_name', 'dentist_name') ?? a.Dentist?.Name ?? a.Dentist?.FullName ?? a.Professional?.Name ?? a.Professional?.FullName ?? null;
  const dentistaId = await ensureLocalProfessional(pool, cpProfId, professionalName, tenantId);

  const pacienteId = await ensureLocalPatient(pool, cpPatientId, {
    name: pickFirst(a, 'PatientName', 'Patient_FullName', 'Patient_Name', 'PatientFullName', 'patient_name', 'patientName', 'Name') ?? a.Patient?.Name ?? a.Patient?.FullName,
    phone: pickFirst(a, 'PatientPhone', 'MobilePhone', 'PatientMobilePhone', 'Phone', 'phone'),
    email: pickFirst(a, 'PatientEmail', 'Email', 'email') ?? a.Patient?.Email,
  }, tenantId);
  
  const status = mapAppointmentStatus(pickFirst(a, 'Status', 'StatusId', 'status'));
  // AtomicDate (YYYYMMDD) primeiro: `date` vem em UTC e pode cair no dia seguinte.
  const data = normalizeClinicorpDate(pickFirst(a, 'AtomicDate', 'Date', 'date', 'AppointmentDate', 'SK_DateFirstTime', 'DateFirstTime', 'StartDate', 'StartDateTime', 'StartTime', 'fromTime', 'FromTime', 'appointment_date'));
  const fromT = normalizeClinicorpTime(pickFirst(a, 'FromTime', 'Time', 'StartTime', 'StartDateTime', 'ScheduleTime', 'Hour', 'fromTime', 'from_time', 'hora')) || '00:00';
  const toT = normalizeClinicorpTime(pickFirst(a, 'ToTime', 'FinalTime', 'EndTime', 'EndDateTime', 'toTime', 'to_time')) || '';
  const hora = fromT;
  const duracao = (() => {
    if (!fromT || !toT) return 30;
    const toMin = (s) => { const [h,m] = s.split(':').map(Number); return (h||0)*60+(m||0); };
    const d = toMin(toT) - toMin(fromT);
    return d > 0 ? d : 30;
  })();
  const procedimento = pickFirst(a, 'CategoryDescription', 'Category_Description', 'Category', 'category_description', 'ProcedureName', 'Procedure') ?? null;
  const categoriaCor = pickFirst(a, 'CategoryColor', 'Category_Color', 'Color', 'category_color') ?? null;
  const observacoes = pickFirst(a, 'Notes', 'Observation', 'Observations', 'notes', 'observacoes') ?? null;
  if (!data || !hora) {
    console.warn(`[clinicorp] skipping projection for appointment ${cpApptId} due to invalid date/time`, { data, hora });
    return null;
  }

  // Somente agendamentos deste tenant.
  const exists = await pool.query(
    `SELECT id, paciente_id, dentista_id, data, hora, duracao, procedimento, categoria,
            categoria_cor, status, observacoes, updated_at, last_clinicorp_sync_at, keep_local
       FROM agendamentos WHERE clinicorp_appointment_id=$1 AND tenant_id=$2 LIMIT 1`,
    [String(cpApptId), tId]
  );
  let agendamentoId;
  if (exists.rows[0]) {
    const localRow = exists.rows[0];
    agendamentoId = localRow.id;
    const decision = decideOverwrite({
      strategy: policy.strategy,
      keepLocal: policy.keepLocal,
      localRow,
      clinicorpUpdatedAt: cpUpdatedAt,
    });
    const beforeSnap = {
      data: localRow.data, hora: localRow.hora, duracao: localRow.duracao,
      procedimento: localRow.procedimento, categoria: localRow.categoria,
      categoria_cor: localRow.categoria_cor, status: localRow.status,
      observacoes: localRow.observacoes,
    };
    const afterSnap = { data, hora, duracao, procedimento, categoria: procedimento, categoria_cor: categoriaCor, status, observacoes };
    const { changed, beforeOut, afterOut } = diffFields(beforeSnap, afterSnap);
    if (decision.write) {
      await pool.query(
        `UPDATE agendamentos SET paciente_id=COALESCE($2,paciente_id), dentista_id=COALESCE($3,dentista_id),
           data=COALESCE($4,data), hora=COALESCE($5,hora), duracao=$6,
           procedimento=COALESCE($7,procedimento), categoria=COALESCE($8,categoria),
           categoria_cor=COALESCE($9,categoria_cor), status=$10,
           observacoes=COALESCE($11,observacoes),
           last_clinicorp_sync_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$12`,
        [agendamentoId, pacienteId, dentistaId, data, hora, duracao, procedimento, procedimento, categoriaCor, status, observacoes, tId]
      );
    }
    // Audit: registramos sempre que houver divergência real ou decisão não-trivial
    if (changed.length > 0 || decision.decision !== 'overwritten_by_clinicorp') {
      const leadRow = pacienteId
        ? (await pool.query(`SELECT id FROM crm_leads WHERE (paciente_id=$1 OR clinicorp_patient_id=$2) AND tenant_id=$3 LIMIT 1`, [pacienteId, cpPatientId, tId])).rows[0]
        : null;
      await logConflict(pool, {
        entity: 'appointment', clinicorp_id: cpApptId, local_id: agendamentoId, tenant_id: tId,
        decision: decision.decision, strategy: policy.strategy,
        scope_type: policy.scopeType, scope_id: policy.scopeId,
        local_updated_at: localRow.updated_at,
        clinicorp_updated_at: cpUpdatedAt,
        last_sync_at: localRow.last_clinicorp_sync_at,
        diff: { changed },
        before_data: beforeSnap,
        after_data: afterSnap,
        changed_fields: changed,
        paciente_id: pacienteId,
        lead_id: leadRow?.id || null,
        agendamento_id: agendamentoId,
      });
    }
  } else if (data) {
    const { randomUUID } = await import('crypto');
    const id = randomUUID();
    await pool.query(
      `INSERT INTO agendamentos
         (id, paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes,
          categoria, categoria_cor, clinicorp_appointment_id, last_clinicorp_sync_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW(), $13)`,
      [id, pacienteId, dentistaId, data, hora, duracao, procedimento, status, observacoes, procedimento, categoriaCor, String(cpApptId), tId]
    );
    agendamentoId = id;
  }

  if (pacienteId) {
    const leadId = await ensureLeadForPatient(pool, pacienteId, cpPatientId, {
      nome: pickFirst(a, 'PatientName', 'Patient_FullName', 'Patient_Name', 'PatientFullName', 'patient_name', 'patientName', 'Name') ?? a.Patient?.Name ?? a.Patient?.FullName,
      telefone: onlyDigits(pickFirst(a, 'PatientPhone', 'MobilePhone', 'PatientMobilePhone', 'Phone', 'phone')),
      email: pickFirst(a, 'PatientEmail', 'Email', 'email') ?? a.Patient?.Email,
    }, tenantId);
    if (leadId) {
      if (status === 'cancelado' || status === 'faltou') {
        await pool.query(
          `UPDATE crm_leads SET kanban_stage='reativacao', status='reativacao', updated_at=NOW()
           WHERE id=$1 AND tenant_id=$2 AND kanban_stage IN ('paciente_agendado','novo','followup')`,
          [leadId, tId]
        );
      } else if (status === 'em_atendimento') {
        await pool.query(`UPDATE crm_leads SET kanban_stage='em_atendimento', status='em_atendimento', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [leadId, tId]);
      } else if (status === 'finalizado') {
        await pool.query(`UPDATE crm_leads SET kanban_stage='pos_consulta', status='pos_consulta', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [leadId, tId]);
      }
    }
  }
  return { pacienteId, dentistaId, agendamentoId };
}

async function projectPatientToLocal(pool, p, tenantId = null) {
  const cpId = p.id ?? p.Patient_PersonId;
  if (!cpId) return null;
  const tId = await resolveTenantId(pool, tenantId);
  const cpUpdatedAt = p.UpdateDate || p.UpdatedAt || p.LastModified || null;
  const policy = await resolveConflictPolicy(pool, {});
  const existing = await pool.query(
    `SELECT id, nome, telefone, email, data_nascimento, sexo, cpf,
            updated_at, last_clinicorp_sync_at, keep_local
       FROM pacientes WHERE clinicorp_patient_id=$1 AND tenant_id=$2 LIMIT 1`,
    [String(cpId), tId]
  );
  // pickFirst é case-insensitive: cobre o formato da API (Name) e o do
  // espelho derivado da agenda (name, mobile_phone).
  const incoming = {
    nome: pickFirst(p, 'Name') || null,
    telefone: pickFirst(p, 'MobilePhone', 'mobile_phone') || null,
    email: pickFirst(p, 'Email') || null,
    data_nascimento: pickFirst(p, 'BirthDate', 'birth_date') || null,
    sexo: pickFirst(p, 'Sex') || null,
    cpf: pickFirst(p, 'DocumentId', 'document_id') || null,
  };
  // Campo ausente na Clinicorp não é divergência.
  for (const k of Object.keys(incoming)) if (incoming[k] === null) delete incoming[k];
  if (existing.rows[0]) {
    const localRow = existing.rows[0];
    const decision = decideOverwrite({
      strategy: policy.strategy,
      keepLocal: policy.keepLocal,
      localRow,
      clinicorpUpdatedAt: cpUpdatedAt,
    });
    const beforeSnap = {
      nome: localRow.nome, telefone: localRow.telefone, email: localRow.email,
      data_nascimento: localRow.data_nascimento, sexo: localRow.sexo, cpf: localRow.cpf,
    };
    const { changed, beforeOut, afterOut } = diffFields(
      Object.fromEntries(Object.keys(incoming).map((k) => [k, beforeSnap[k]])), incoming);
    if (changed.length > 0 || decision.decision !== 'overwritten_by_clinicorp') {
      const leadRow = (await pool.query(
        `SELECT id FROM crm_leads WHERE (paciente_id=$1 OR clinicorp_patient_id=$2) AND tenant_id=$3 LIMIT 1`,
        [localRow.id, String(cpId), tId]
      )).rows[0];
      await logConflict(pool, {
        entity: 'patient', clinicorp_id: cpId, local_id: localRow.id, tenant_id: tId,
        decision: decision.decision, strategy: policy.strategy,
        scope_type: policy.scopeType, scope_id: policy.scopeId,
        local_updated_at: localRow.updated_at,
        clinicorp_updated_at: cpUpdatedAt,
        last_sync_at: localRow.last_clinicorp_sync_at,
        diff: { changed },
        before_data: beforeSnap,
        after_data: incoming,
        changed_fields: changed,
        paciente_id: localRow.id,
        lead_id: leadRow?.id || null,
      });
    }
    if (!decision.write) return localRow.id;
  }
  const pacienteId = await ensureLocalPatient(pool, cpId, { name: incoming.nome, phone: incoming.telefone, email: incoming.email }, tId);
  if (pacienteId) {
    await pool.query(`UPDATE pacientes SET last_clinicorp_sync_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [pacienteId, tId]);
  }
  await ensureLeadForPatient(pool, pacienteId, cpId, {
    nome: incoming.nome, telefone: onlyDigits(incoming.telefone), email: incoming.email,
  }, tenantId);
  return pacienteId;
}

async function upsertEstimate(pool, e, tenantId = null, businessId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  const estId = pickFirst(e, 'id', 'Id', 'TreatmentId', 'treatment_id', 'EstimateId');
  if (!estId) return;
  e = { ...e, id: estId };
  await pool.query(
    `INSERT INTO clinicorp_estimates
       (id, tenant_id, treatment_id, patient_id, patient_name, professional_id, professional_name,
        business_id, amount, status, date, create_date, procedure_list, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       treatment_id = EXCLUDED.treatment_id,
       patient_id = EXCLUDED.patient_id,
       patient_name = EXCLUDED.patient_name,
       professional_id = EXCLUDED.professional_id,
       professional_name = EXCLUDED.professional_name,
       business_id = EXCLUDED.business_id,
       amount = EXCLUDED.amount,
       status = EXCLUDED.status,
       date = EXCLUDED.date,
       create_date = EXCLUDED.create_date,
       procedure_list = EXCLUDED.procedure_list,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      e.id, tId, e.TreatmentId ?? null, e.PatientId ?? e.Patient_PersonId ?? null,
      e.PatientName ?? e.Patient_FullName ?? e.Patient?.Name ?? null, e.ProfessionalId ?? e.Dentist_PersonId ?? e.ScheduleToId ?? null,
      e.ProfessionalName ?? e.Dentist_FullName ?? e.Dentist_Name ?? e.DentistName ?? e.ScheduleToName ?? e.Dentist?.Name ?? e.Dentist?.FullName ?? null, e.BusinessId ?? e.Clinic_BusinessId ?? businessId ?? null,
      e.Amount ?? null, e.Status ?? null,
      e.Date || null, e.CreateDate || null,
      e.ProcedureList ? JSON.stringify(e.ProcedureList) : null,
      JSON.stringify(e),
    ]
  );
  try { await projectEstimateToLocal(pool, e, tId); }
  catch (err) { console.error('[clinicorp] projectEstimateToLocal:', err.message); }
}

async function projectEstimateToLocal(pool, e, tenantId = null) {
  if (!e?.id) return;
  const tId = await resolveTenantId(pool, tenantId);
  const pacienteId = await ensureLocalPatient(pool, e.PatientId || e.Patient_PersonId, { name: e.PatientName }, tId);
  const dentistaId = await ensureLocalProfessional(pool, e.ProfessionalId || e.Dentist_PersonId, e.ProfessionalName, tId);
  
  const valor = Number(e.Amount || 0);
  const data = e.Date || e.CreateDate || null;
  const status = String(e.Status || '').toLowerCase().includes('aprov') ? 'aprovado' : 'em_aberto';

  const exists = await pool.query(
    `SELECT id FROM orcamentos WHERE clinicorp_estimate_id = $1 AND tenant_id = $2 LIMIT 1`,
    [String(e.id), tId]
  );

  if (exists.rows[0]) {
    await pool.query(
      `UPDATE orcamentos SET valor_total=$1, status=$2, updated_at=NOW() WHERE id=$3`,
      [valor, status, exists.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO orcamentos (id, tenant_id, paciente_id, dentista_id, valor_total, status, validade, clinicorp_estimate_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
      [tId, pacienteId, dentistaId, valor, status, data, String(e.id)]
    );
  }
}

async function upsertFinancial(pool, source, item, tenantId = null, businessId = null) {
  const externalId = String(item.id ?? item.Id ?? item.InvoiceId ?? item.PaymentId ?? '') || null;
  if (!externalId) return;
  const tId = await resolveTenantId(pool, tenantId);

  await pool.query(
    `INSERT INTO clinicorp_financial_entries
       (source, external_id, tenant_id, business_id, patient_id, amount, date, description, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
     ON CONFLICT (source, external_id, tenant_id) DO UPDATE SET
       business_id = EXCLUDED.business_id,
       patient_id = EXCLUDED.patient_id,
       amount = EXCLUDED.amount,
       date = EXCLUDED.date,
       description = EXCLUDED.description,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      source, externalId, tId,
      item.BusinessId ?? item.Clinic_BusinessId ?? businessId ?? null,
      item.PatientId ?? null,
      item.Amount ?? item.Value ?? null,
      item.Date || item.PaymentDate || item.DueDate || null,
      item.Description ?? item.Memo ?? null,
      JSON.stringify(item),
    ]
  );
  try { await projectFinanceToLocal(pool, source, item, tId); }
  catch (e) { console.error('[clinicorp] projectFinanceToLocal:', e.message); }
}

function parseClinicorpMonth(value) {
  if (!value) return null;
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-01`;
  const br = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[2]}-${br[1].padStart(2, '0')}-01`;
  const named = new Date(text + " 1, 2026"); // Tenta interpretar nome do mês fixando o ano atual
  if (!Number.isNaN(named.getTime())) return named.toISOString().slice(0, 7) + '-01';
  const monthMap = {
    'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04', 'maio': '05', 'junho': '06',
    'julho': '07', 'agosto': '08', 'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12',
    'january': '01', 'february': '02', 'march': '03', 'april': '04', 'may': '05', 'june': '06',
    'july': '07', 'august': '08', 'september': '09', 'october': '10', 'november': '11', 'december': '12'
  };
  const m = monthMap[text.toLowerCase()];
  if (m) return `${new Date().getFullYear()}-${m}-01`;
  return null;
}

async function upsertMonthlySummary(pool, source, item, businessId = null, tenantId = null) {
  const periodMonth = parseClinicorpMonth(item.month ?? item.Month ?? item.period ?? item.Period ?? item.date ?? item.Date);
  if (!periodMonth) return false;
  const tId = await resolveTenantId(pool, tenantId);

  await pool.query(
    `INSERT INTO clinicorp_monthly_summary
       (source, period_month, business_id, tenant_id, total_in, total_out, total_amount,
        cash, credit_card, debit_card, pix, bank_slip, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (source, period_month, business_id, tenant_id) DO UPDATE SET
       total_in = EXCLUDED.total_in,
       total_out = EXCLUDED.total_out,
       total_amount = EXCLUDED.total_amount,
       cash = EXCLUDED.cash,
       credit_card = EXCLUDED.credit_card,
       debit_card = EXCLUDED.debit_card,
       pix = EXCLUDED.pix,
       bank_slip = EXCLUDED.bank_slip,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      source,
      periodMonth,
      item.BusinessId ?? item.business_id ?? item.Clinic_BusinessId ?? businessId,
      tId,
      item.in ?? item.totalIn ?? item.total_in ?? null,
      item.out ?? item.totalOut ?? item.total_out ?? null,
      item.totalPaymentsAmount ?? item.totalAmount ?? item.total_amount ?? item.amount ?? item.Amount ?? null,
      item.cash ?? null,
      item.credit_card ?? item.creditCard ?? null,
      item.debit_card ?? item.debitCard ?? null,
      item.pix ?? null,
      item.bank_slip ?? item.bankSlip ?? item.boleto ?? null,
      JSON.stringify(item),
    ]
  );
  return true;
}

function isMonthlyFinancialSummary(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.id || item.Id || item.InvoiceId || item.PaymentId) return false;
  return Boolean(item.month || item.Month || item.period || item.Period || item.totalPaymentsAmount !== undefined || item.in !== undefined || item.out !== undefined);
}

async function projectFinanceToLocal(pool, source, item, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  const amount = Number(item.Amount ?? item.Value ?? 0);
  const date = item.Date || item.PaymentDate || item.DueDate || null;
  const description = item.Description || item.Memo || `Lançamento Clinicorp (${source})`;
  const patientId = await ensureLocalPatient(pool, item.PatientId, {}, tId);

  if (source === 'payment' || source === 'cashflow' && amount > 0) {
    // Projeta como receita
    const exists = await pool.query(
      `SELECT id FROM financeiro_receitas WHERE clinicorp_external_id = $1 AND tenant_id = $2`,
      [String(item.id || item.Id), tId]
    );
    if (!exists.rows[0]) {
      await pool.query(
        `INSERT INTO financeiro_receitas (id, tenant_id, valor, data, descricao, status, paciente_id, clinicorp_external_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pago', $5, $6)`,
        [tId, amount, date, description, patientId, String(item.id || item.Id)]
      );
    }
  } else if (amount < 0) {
    // Projeta como despesa
    const absAmount = Math.abs(amount);
    const exists = await pool.query(
      `SELECT id FROM financeiro_despesas WHERE clinicorp_external_id = $1 AND tenant_id = $2`,
      [String(item.id || item.Id), tId]
    );
    if (!exists.rows[0]) {
      await pool.query(
        `INSERT INTO financeiro_despesas (id, tenant_id, valor, data, descricao, status, clinicorp_external_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pago', $5)`,
        [tId, absAmount, date, description, String(item.id || item.Id)]
      );
    }
  }
}

// ─── Sync orchestration ───────────────────────────────────────
// Única sincronização da integração (o caminho via Supabase foi removido).
// Tudo é gravado no tenant informado; com user_id, o progresso e o resultado
// final ficam em clinicorp_user_settings (sync_progress / last_sync_*), que a
// tela consulta enquanto a sincronização roda.
export async function runFullSync(pool, { from, to, api_token, subscriber_id, base_url, tenant_id, force_metadata = false, user_id = null, apptFrom = null, apptTo = null, estFrom = null, estTo = null } = {}) {
  let settings = null;
  if (api_token && subscriber_id) {
    settings = { api_token, subscriber_id, base_url: base_url || DEFAULT_BASE_URL, enabled: true };
  } else if (user_id) {
    const { rows } = await pool.query(
      `SELECT enabled, api_token, subscriber_id, base_url FROM clinicorp_user_settings WHERE user_id = $1`,
      [user_id]
    );
    const r = rows[0];
    if (r?.enabled && r.api_token && r.subscriber_id) settings = { ...r, base_url: r.base_url || DEFAULT_BASE_URL };
  }
  if (!settings) throw new Error('Clinicorp: credenciais não configuradas ou integração desativada');
  const tId = await resolveTenantId(pool, tenant_id);

  const syncKey = `${settings.subscriber_id}:${tId}`;
  if (_activeSyncs.has(syncKey) && Date.now() - _activeSyncs.get(syncKey) < 30 * 60_000) {
    throw new Error('Já existe uma sincronização em andamento para esta conta. Por favor, aguarde alguns minutos.');
  }
  _activeSyncs.set(syncKey, Date.now());
  console.log(`[clinicorp sync] START tenant=${tId} subscriber=${settings.subscriber_id}`);

  const today = new Date();
  const ymdOffset = (days) => new Date(today.getTime() + days * 86400_000).toISOString().slice(0, 10);
  const fromDate = from || ymdOffset(-15);
  const toDate = to || ymdOffset(30);
  // Agenda: 3 dias atrás até 1 ano à frente por padrão
  const apptFromDate = apptFrom || from || ymdOffset(-3);
  const apptToDate = apptTo || to || ymdOffset(365);
  // Orçamentos: ±45 dias por padrão
  const estFromDate = estFrom || from || ymdOffset(-45);
  const estToDate = estTo || to || ymdOffset(45);

  const summary = { clinics: 0, professionals: 0, patients: 0, chairs: 0, categories: 0, specialties: 0, appointments: 0, estimates: 0, invoices: 0, payments: 0, cashflow: 0 };
  const errors = [];
  const MAX_ERRORS = 50;
  // Erros não-fatais ficam no resultado (e na tela); credencial inválida e
  // rate limit interrompem a sincronização inteira.
  const recordError = (label, e) => {
    if (isClinicorpFatalError(e)) throw e;
    if (errors.length < MAX_ERRORS) errors.push(`${label}: ${e?.message || e}`);
    console.error(`[clinicorp sync] ${label}:`, e?.message || e);
  };

  const progress = async (step, extra = {}) => {
    if (!user_id) return;
    await pool.query(
      `UPDATE clinicorp_user_settings
          SET last_sync_status = 'syncing', last_sync_error = NULL,
              sync_progress = $2::jsonb, updated_at = NOW()
        WHERE user_id = $1`,
      [user_id, JSON.stringify({ step, summary, errors: errors.slice(0, 5), timestamp: new Date().toISOString(), ...extra })]
    ).catch((e) => console.warn('[clinicorp sync] progress', e.message));
  };

  const step = async (label, fn) => {
    if (_globalPauseUntil > Date.now()) {
      const retryAfter = Math.ceil((_globalPauseUntil - Date.now()) / 1000);
      const err = new Error(`Clinicorp em rate limit — aguardando ${retryAfter}s antes de novas chamadas`);
      err.status = 429;
      err.retry_after_seconds = retryAfter;
      throw err;
    }
    await progress(`Sincronizando ${label}...`);
    try { await fn(); }
    catch (e) { recordError(label, e); }
  };

  // Janelas de 7 dias (a Clinicorp responde 400/timeout em faixas grandes)
  const sliceRange = (startStr, endStr) => {
    const dates = [];
    let current = new Date(startStr + 'T00:00:00Z');
    const end = new Date(endStr + 'T00:00:00Z');
    while (current <= end) {
      const next = new Date(current.getTime() + 6 * 86400_000);
      const rangeTo = next < end ? next : end;
      dates.push({ from: current.toISOString().slice(0, 10), to: rangeTo.toISOString().slice(0, 10) });
      current = new Date(rangeTo.getTime() + 86400_000);
    }
    return dates;
  };
  const clinicIdsOf = async () => {
    const { rows } = await pool.query('SELECT id FROM clinicorp_clinics WHERE tenant_id=$1', [tId]);
    return rows.map((r) => r.id).filter(Boolean);
  };

  try {
    await progress('Iniciando sincronização...');

    // Metadados (clínicas, profissionais, cadeiras, categorias, especialidades)
    // mudam pouco: só são buscados a cada 24h, salvo force_metadata.
    let metadataFresh = false;
    if (!force_metadata) {
      const { rows } = await pool.query(`SELECT MAX(synced_at) AS last FROM clinicorp_clinics WHERE tenant_id=$1`, [tId]);
      const last = rows[0]?.last ? new Date(rows[0].last).getTime() : 0;
      if (last && Date.now() - last < 24 * 3600_000) metadataFresh = true;
    }

    if (!metadataFresh) {
      await step('clínicas', async () => {
        const list = await clinicorpApi.listClinics(settings);
        for (const c of list) {
          try { await upsertClinic(pool, c, tId); summary.clinics++; }
          catch (e) { recordError('clínica', e); }
        }
      });

      await step('profissionais', async () => {
        const list = await clinicorpApi.listUsers(settings);
        for (const u of list) {
          try { await upsertProfessional(pool, u, tId); summary.professionals++; }
          catch (e) { recordError('profissional', e); }
        }
      });

      await step('cadeiras', async () => {
        for (const clinicId of await clinicIdsOf()) {
          try {
            const list = await clinicorpApi.listChairs(settings, clinicId);
            for (const ch of list) { await upsertChair(pool, ch, tId, clinicId); summary.chairs++; }
          } catch (e) {
            // Clínica sem cadeiras cadastradas responde 400 — não é erro da sincronização.
            if (e?.status === 400 || e?.status === 404) continue;
            recordError(`cadeiras (clínica ${clinicId})`, e);
          }
        }
      });

      await step('categorias', async () => {
        const list = await clinicorpApi.listAppointmentCategories(settings);
        for (const c of list) { await upsertCategory(pool, c, tId); summary.categories++; }
      });

      await step('especialidades', async () => {
        const list = await clinicorpApi.listSpecialties(settings);
        for (const sp of list) { await upsertSpecialty(pool, sp, tId); summary.specialties++; }
      });
    } else {
      console.log('[clinicorp sync] metadados recentes (<24h) — pulando clínicas/profissionais/cadeiras/categorias/especialidades');
    }

    // Agenda (pacientes são derivados dela: a Clinicorp não lista pacientes)
    await step('agenda', async () => {
      const clinics = await clinicIdsOf();
      const ranges = sliceRange(apptFromDate, apptToDate);
      const apiIds = new Set();
      const rawByApptId = new Map();
      let failedRanges = 0;
      const targets = clinics.length ? clinics : [null];
      const total = targets.length * ranges.length;
      let done = 0;
      console.log(`[clinicorp sync] agenda ${apptFromDate} → ${apptToDate} (${ranges.length} janelas × ${targets.length} clínica(s))`);

      for (const clinicId of targets) {
        for (const r of ranges) {
          let list = [];
          try {
            list = await clinicorpApi.listAppointments(settings, r.from, r.to, clinicId);
          } catch (e) {
            failedRanges++;
            recordError(`agenda ${r.from}..${r.to}${clinicId ? ` (clínica ${clinicId})` : ''}`, e);
            continue;
          }
          for (const a of list) {
            const id = String(getAppointmentId(a));
            if (apiIds.has(id)) continue;
            apiIds.add(id);
            rawByApptId.set(id, a);
            try { await upsertAppointment(pool, a, tId); summary.appointments++; }
            catch (e) { recordError(`agendamento ${id}`, e); }
          }
          done++;
          if (done % 5 === 0 || done === total) {
            await progress(`Agenda: ${done}/${total} janelas (${summary.appointments} agendamentos)`);
          }
        }
      }

      // Agendamentos sem dentista: resolve a partir do bruto recebido agora.
      try {
        const { rows: orphans } = await pool.query(
          `SELECT id, clinicorp_appointment_id FROM agendamentos
            WHERE tenant_id=$1 AND dentista_id IS NULL AND clinicorp_appointment_id IS NOT NULL`,
          [tId]
        );
        for (const row of orphans) {
          const raw = rawByApptId.get(String(row.clinicorp_appointment_id));
          if (!raw) continue;
          const cpProfId = pickFirst(raw, 'ProfessionalId', 'Dentist_PersonId', 'DentistPersonId', 'Professional_PersonId', 'ScheduleToId', 'ScheduleTo_PersonId', 'DentistId', 'Dentist_Id', 'professional_id', 'dentist_id') ?? raw.Dentist?.Id ?? raw.Professional?.Id ?? null;
          if (!cpProfId) continue;
          const profName = pickFirst(raw, 'ProfessionalName', 'Dentist_FullName', 'Dentist_Name', 'DentistName', 'ScheduleToName', 'Professional_Name', 'professional_name', 'dentist_name') ?? raw.Dentist?.Name ?? raw.Dentist?.FullName ?? null;
          await pool.query(
            `INSERT INTO clinicorp_professionals (id, tenant_id, full_name, user_name, raw, synced_at)
             VALUES ($1,$2,$3,NULL,$4,NOW())
             ON CONFLICT (id, tenant_id) DO UPDATE SET
               full_name = COALESCE(NULLIF(EXCLUDED.full_name,''), clinicorp_professionals.full_name),
               synced_at = NOW()`,
            [String(cpProfId), tId, String(profName || `Profissional ${cpProfId}`).trim(), JSON.stringify({ derived_from: 'agendamento_backfill', id: cpProfId, name: profName })]
          );
          const dId = await ensureLocalProfessional(pool, String(cpProfId), profName, tId);
          if (dId) await pool.query(`UPDATE agendamentos SET dentista_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [dId, row.id, tId]);
        }
      } catch (e) { recordError('agenda → dentista', e); }

      // Espelho fiel: some da Clinicorp → cancelado aqui. Só quando TODAS as
      // janelas responderam; senão um erro de rede cancelaria a agenda local.
      if (failedRanges === 0) {
        try {
          const { rows: localRows } = await pool.query(
            `SELECT id FROM clinicorp_appointments WHERE tenant_id=$3 AND date >= $1 AND date <= $2
               AND COALESCE(status,'') <> 'DELETED_IN_CLINICORP'`,
            [apptFromDate, apptToDate, tId]
          );
          for (const local of localRows) {
            if (apiIds.has(String(local.id))) continue;
            await pool.query(`UPDATE clinicorp_appointments SET status = 'DELETED_IN_CLINICORP', synced_at = NOW() WHERE id = $1 AND tenant_id=$2`, [local.id, tId]);
            await pool.query(`UPDATE agendamentos SET status = 'cancelado', updated_at = NOW() WHERE clinicorp_appointment_id = $1 AND tenant_id=$2`, [String(local.id), tId]);
          }
        } catch (e) { recordError('remoção de agendamentos excluídos', e); }
      } else {
        console.warn(`[clinicorp sync] ${failedRanges} janela(s) da agenda falharam — detecção de exclusões pulada`);
      }

    // Backfill de profissionais a partir dos agendamentos DESTE tenant
    try {
      const { rows: distinctProfs } = await pool.query(
        `SELECT DISTINCT professional_id::text AS id,
                MAX(raw->>'Dentist_FullName') AS name_df,
                MAX(raw->>'Dentist_Name') AS name_dn,
                MAX(raw->>'ScheduleToName') AS name_a,
                MAX(raw->'Dentist'->>'Name') AS name_b,
                MAX(raw->'Dentist'->>'FullName') AS name_bf,
                MAX(raw->>'DentistName') AS name_c,
                MAX(raw->>'ProfessionalName') AS name_d,
                MAX(professional_name) AS name_e
           FROM clinicorp_appointments
          WHERE tenant_id=$1 AND professional_id IS NOT NULL
          GROUP BY 1`,
        [tId]
      );
      for (const p of distinctProfs) {
        const { rows: apptRows } = await pool.query(
          `SELECT raw FROM clinicorp_appointments WHERE tenant_id=$2 AND professional_id = $1 LIMIT 1`,
          [p.id, tId]
        );
        const rawAppt = apptRows[0]?.raw || {};
        const rawName = p.name_df || p.name_dn || p.name_a || p.name_b || p.name_bf || p.name_c || p.name_d || p.name_e ||
                     rawAppt.Dentist_FullName || rawAppt.Dentist_Name || rawAppt.ScheduleToName || rawAppt.DentistName ||
                     (rawAppt.Dentist && (rawAppt.Dentist.FullName || rawAppt.Dentist.Name)) ||
                     `Profissional ${p.id}`;
        const name = String(rawName).trim();

        await pool.query(
          `INSERT INTO clinicorp_professionals (id, tenant_id, full_name, user_name, raw, synced_at)
           VALUES ($1,$2,$3,NULL,$4,NOW())
           ON CONFLICT (id, tenant_id) DO UPDATE SET
             full_name = EXCLUDED.full_name,
             synced_at = NOW()`,
          [p.id, tId, name, JSON.stringify({ derived_from: 'appointments', id: p.id, name })]
        );
        await ensureLocalProfessional(pool, p.id, name, tId);
        await pool.query(
          `UPDATE clinicorp_appointments SET professional_name = $2 WHERE tenant_id=$3 AND professional_id = $1 AND (professional_name IS NULL OR professional_name = '')`,
          [p.id, name, tId]
        );
      }

      // Fallback: se professional_id ainda for nulo em alguma appt, varre raw JSONB
      // procurando chaves de ID com case-insensitive em "Dentist*", "Professional*",
      // "ScheduleTo*" e atualiza professional_id na appt + cria o professional.
      const { rows: nullProfRows } = await pool.query(
        `SELECT id, raw FROM clinicorp_appointments
          WHERE tenant_id=$1 AND professional_id IS NULL LIMIT 2000`,
        [tId]
      );
      if (nullProfRows.length) {
        console.log(`[clinicorp sync] backfill scan: ${nullProfRows.length} appts sem professional_id`);
        const found = new Map(); // id -> name
        const extractId = (raw) => {
          if (!raw || typeof raw !== 'object') return { id: null, name: null };
          let id = null, name = null;
          for (const [k, v] of Object.entries(raw)) {
            const kl = k.toLowerCase();
            if (!id && /^(dentist|professional|scheduleto|doctor)/i.test(k) && /(id|personid)$/i.test(k) && (typeof v === 'string' || typeof v === 'number')) {
              const n = Number(String(v).replace(/\D/g, ''));
              if (n) id = n;
            }
            if (!name && /^(dentist|professional|scheduleto|doctor)/i.test(k) && /(name|fullname)$/i.test(k) && typeof v === 'string') {
              name = v;
            }
            if (!id && v && typeof v === 'object') {
              const sub = extractId(v);
              if (sub.id) id = sub.id;
              if (!name && sub.name) name = sub.name;
            }
          }
          return { id, name };
        };
        for (const row of nullProfRows) {
          const { id, name } = extractId(row.raw);
          if (!id) continue;
          await pool.query(
            `UPDATE clinicorp_appointments SET professional_id=$1, professional_name=COALESCE(NULLIF($2,''), professional_name) WHERE id=$3 AND tenant_id=$4`,
            [String(id), name || null, row.id, tId]
          );
          if (!found.has(String(id))) found.set(String(id), name || `Profissional ${id}`);
        }
        for (const [pid, pname] of found) {
          await pool.query(
            `INSERT INTO clinicorp_professionals (id, tenant_id, full_name, user_name, raw, synced_at)
             VALUES ($1,$2,$3,NULL,$4,NOW())
             ON CONFLICT (id, tenant_id) DO UPDATE SET
               full_name = COALESCE(NULLIF(EXCLUDED.full_name,''), clinicorp_professionals.full_name),
               synced_at = NOW()`,
            [pid, tId, pname, JSON.stringify({ derived_from: 'raw_scan', id: pid, name: pname })]
          );
          await ensureLocalProfessional(pool, pid, pname, tId);
        }
        console.log(`[clinicorp sync] backfill scan: criou ${found.size} profissionais via raw scan`);
      }

      const { rows: pcount } = await pool.query(`SELECT COUNT(*)::int AS c FROM clinicorp_professionals WHERE tenant_id=$1`, [tId]);
      summary.professionals = pcount[0]?.c || summary.professionals;
    } catch (e) { recordError('profissionais derivados da agenda', e); }

      const { rows: pc } = await pool.query(`SELECT COUNT(*)::int AS c FROM clinicorp_patients WHERE tenant_id=$1`, [tId]);
      summary.patients = pc[0]?.c || 0;
    });

    await step('orçamentos', async () => {
      const clinics = await clinicIdsOf();
      const targets = clinics.length ? clinics : [null];
      for (const r of sliceRange(estFromDate, estToDate)) {
        for (const clinicId of targets) {
          try {
            const list = await clinicorpApi.listEstimates(settings, r.from, r.to, clinicId || undefined);
            for (const e of list) { await upsertEstimate(pool, e, tId, clinicId); summary.estimates++; }
          } catch (e) { recordError(`orçamentos ${r.from}..${r.to}${clinicId ? ` (clínica ${clinicId})` : ''}`, e); }
        }
      }
    });

    await step('faturas', async () => {
      const clinics = await clinicIdsOf();
      const targets = clinics.length ? clinics : [null];
      for (const r of sliceRange(fromDate, toDate)) {
        for (const clinicId of targets) {
          try {
            const list = await clinicorpApi.listInvoices(settings, { from: r.from, to: r.to, clinic_id: clinicId || undefined });
            for (const i of list) { await upsertFinancial(pool, 'invoice', i, tId, clinicId); summary.invoices++; }
          } catch (e) { recordError(`faturas ${r.from}..${r.to}`, e); }
        }
      }
    });

    // list_payments e list_cash_flow exigem business_id: só rodam por clínica.
    for (const [key, label, fetcher] of [
      ['payments', 'pagamentos', clinicorpApi.listPayments],
      ['cashflow', 'fluxo de caixa', clinicorpApi.listCashFlow],
    ]) {
      const source = key === 'payments' ? 'payment' : 'cashflow';
      await step(label, async () => {
        const clinics = await clinicIdsOf();
        if (!clinics.length) {
          console.warn(`[clinicorp sync] ${label}: nenhuma clínica espelhada para este tenant — pulando`);
          return;
        }
        for (const r of sliceRange(fromDate, toDate)) {
          for (const clinicId of clinics) {
            try {
              const list = await fetcher(settings, { from: r.from, to: r.to, clinic_id: clinicId });
              for (const item of list) {
                if (isMonthlyFinancialSummary(item)) {
                  if (await upsertMonthlySummary(pool, source, item, clinicId, tId)) summary[key]++;
                } else {
                  await upsertFinancial(pool, source, item, tId, clinicId);
                  summary[key]++;
                }
              }
            } catch (e) { recordError(`${label} ${r.from}..${r.to} (clínica ${clinicId})`, e); }
          }
        }
      });
    }

    // Re-extrai colunas a partir do raw JSONB (linhas antigas) — só deste tenant.
    await progress('Consolidando dados...');
    try {
      await pool.query(`
        UPDATE clinicorp_appointments SET
          patient_name = COALESCE(NULLIF(patient_name,''), raw->>'PatientName', raw->>'Patient_FullName', raw->>'Patient_Name', raw->'Patient'->>'Name', raw->'Patient'->>'FullName'),
          patient_id = COALESCE(patient_id, NULLIF(regexp_replace(COALESCE(raw->>'Patient_PersonId', raw->>'PatientId', raw->>'PatientPersonId', raw->'Patient'->>'Id', ''), '\\D', '', 'g'), '')::bigint),
          professional_id = COALESCE(professional_id, NULLIF(regexp_replace(COALESCE(raw->>'Dentist_PersonId', raw->>'ProfessionalId', raw->>'ScheduleToId', raw->'Dentist'->>'Id', ''), '\\D', '', 'g'), '')::bigint),
          professional_name = COALESCE(NULLIF(professional_name,''), raw->>'Dentist_FullName', raw->>'Dentist_Name', raw->>'ScheduleToName', raw->>'ProfessionalName', raw->'Dentist'->>'FullName', raw->'Dentist'->>'Name'),
          category_id = COALESCE(category_id, NULLIF(regexp_replace(COALESCE(raw->>'CategoryId', ''), '\\D', '', 'g'), '')::bigint),
          category_description = COALESCE(NULLIF(category_description,''), raw->>'CategoryDescription', raw->>'Category'),
          category_color = COALESCE(NULLIF(category_color,''), raw->>'CategoryColor', raw->>'Color'),
          business_id = COALESCE(business_id, NULLIF(regexp_replace(COALESCE(raw->>'Clinic_BusinessId', raw->>'BusinessId', ''), '\\D', '', 'g'), '')::bigint),
          from_time = COALESCE(NULLIF(from_time,''), raw->>'fromTime', raw->>'FromTime'),
          to_time = COALESCE(NULLIF(to_time,''), raw->>'toTime', raw->>'ToTime'),
          notes = COALESCE(NULLIF(notes,''), raw->>'Notes', raw->>'notes')
        WHERE tenant_id = $1 AND raw IS NOT NULL
          AND (patient_name IS NULL OR patient_name='' OR patient_id IS NULL OR from_time IS NULL OR professional_id IS NULL)
      `, [tId]);

      // Deriva clinicorp_patients a partir dos agendamentos deste tenant
      await pool.query(`
        INSERT INTO clinicorp_patients (id, tenant_id, name, mobile_phone, raw, synced_at)
        SELECT DISTINCT ON (pid)
          pid::bigint AS id, $1::uuid,
          NULLIF(raw->>'PatientName',''),
          NULLIF(raw->>'MobilePhone',''),
          jsonb_build_object('derived_from','appointment_backfill','id',pid,'name',raw->>'PatientName','mobile_phone',raw->>'MobilePhone'),
          NOW()
        FROM (
          SELECT raw, NULLIF(regexp_replace(COALESCE(raw->>'Patient_PersonId', raw->>'PatientId',''), '\\D', '', 'g'), '') AS pid
            FROM clinicorp_appointments
           WHERE tenant_id = $1 AND raw IS NOT NULL
        ) s
        WHERE pid IS NOT NULL AND pid ~ '^\\d+$'
        ON CONFLICT (id, tenant_id) DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name,''), clinicorp_patients.name),
          mobile_phone = COALESCE(NULLIF(EXCLUDED.mobile_phone,''), clinicorp_patients.mobile_phone),
          synced_at = NOW()
      `, [tId]);

      // StatusId numérico → texto legível (heurística sobre o raw)
      await pool.query(`
        UPDATE clinicorp_appointments SET status =
          CASE
            WHEN raw->>'CheckinTime' IS NOT NULL AND raw->>'CheckinTime' <> '' AND raw->>'WaitEnds' IS NOT NULL AND raw->>'WaitEnds' <> '' THEN 'em_atendimento'
            WHEN (raw->>'StatusColor') ILIKE '%66bb6a%' THEN 'confirmado'
            WHEN (raw->>'StatusColor') ILIKE '%f44%' OR (raw->>'StatusColor') ILIKE '%e53%' THEN 'cancelado'
            WHEN (raw->>'StatusColor') ILIKE '%ffa%' OR (raw->>'StatusColor') ILIKE '%ff9%' THEN 'faltou'
            ELSE 'agendado'
          END
        WHERE tenant_id = $1 AND (status IS NULL OR status ~ '^\\d+$')
      `, [tId]);
    } catch (e) { recordError('consolidação SQL', e); }

    // Projeção final nas tabelas que o app lê (pacientes, agendamentos, dentistas, orçamentos, financeiro)
    await progress('Atualizando agenda e pacientes do sistema...');
    try {
      const counts = await reprojectTenant(pool, tId, { apptFrom: apptFromDate, apptTo: apptToDate, estFrom: estFromDate, estTo: estToDate, finFrom: fromDate, finTo: toDate });
      summary.patients = Math.max(summary.patients, counts.patients);
    } catch (e) { recordError('projeção local', e); }

    const status = errors.length === 0 ? 'success' : (Object.values(summary).some(Boolean) ? 'partial' : 'error');
    const result = { status, summary, errors, from: fromDate, to: toDate };
    if (user_id) {
      await pool.query(
        `UPDATE clinicorp_user_settings
            SET last_sync_at = NOW(), last_sync_status = $2, last_sync_error = $3,
                sync_progress = $4::jsonb, updated_at = NOW()
          WHERE user_id = $1`,
        [user_id, status, errors.length ? errors.slice(0, 3).join(' | ') : null,
         JSON.stringify({ step: 'Concluído', completed: true, timestamp: new Date().toISOString(), summary, result })]
      );
    }
    console.log(`[clinicorp sync] END tenant=${tId} status=${status}`, summary);
    return result;
  } catch (err) {
    if (user_id) {
      const rateLimited = isClinicorpRateLimitError(err);
      await pool.query(
        `UPDATE clinicorp_user_settings
            SET last_sync_at = NOW(), last_sync_status = $2, last_sync_error = $3,
                sync_progress = $4::jsonb, updated_at = NOW()
          WHERE user_id = $1`,
        [user_id, rateLimited ? 'rate_limited' : 'error', err.message,
         JSON.stringify({ step: `Erro: ${err.message}`, failed: true, timestamp: new Date().toISOString(), summary, errors: errors.slice(0, 5) })]
      ).catch(() => {});
    }
    throw err;
  } finally {
    _activeSyncs.delete(syncKey);
  }
}

// Re-projeta o espelho (clinicorp_*) do tenant nas tabelas do app.
// Sem janelas, reprocessa tudo (usado por POST /api/clinicorp/reproject).
export async function reprojectTenant(pool, tenantId, { apptFrom = null, apptTo = null, estFrom = null, estTo = null, finFrom = null, finTo = null } = {}) {
  const tId = await resolveTenantId(pool, tenantId);
  const counts = { professionals: 0, patients: 0, appointments: 0, estimates: 0, financial: 0, errors: 0 };
  const parse = (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw);
  const range = (col, a, b, params) => {
    const where = [];
    if (a) { params.push(a); where.push(`${col} >= $${params.length}`); }
    if (b) { params.push(b); where.push(`${col} <= $${params.length}`); }
    return where.length ? ` AND ${where.join(' AND ')}` : '';
  };

  const { rows: profs } = await pool.query('SELECT id, full_name FROM clinicorp_professionals WHERE tenant_id = $1', [tId]);
  for (const p of profs) {
    try { if (await ensureLocalProfessional(pool, String(p.id), p.full_name, tId)) counts.professionals++; }
    catch (e) { counts.errors++; console.error('[clinicorp reproject] professional', p.id, e.message); }
  }

  const { rows: pats } = await pool.query('SELECT id, raw FROM clinicorp_patients WHERE tenant_id = $1', [tId]);
  for (const r of pats) {
    try { if (await projectPatientToLocal(pool, { ...(parse(r.raw) || {}), id: r.id }, tId)) counts.patients++; }
    catch (e) { counts.errors++; console.error('[clinicorp reproject] patient', r.id, e.message); }
  }

  let params = [tId];
  const { rows: aps } = await pool.query(
    `SELECT id, raw FROM clinicorp_appointments WHERE tenant_id = $1 AND raw IS NOT NULL${range('date', apptFrom, apptTo, params)}`,
    params
  );
  for (const r of aps) {
    try { if (await projectAppointmentToLocal(pool, parse(r.raw), String(r.id), tId)) counts.appointments++; }
    catch (e) { counts.errors++; console.error('[clinicorp reproject] appointment', r.id, e.message); }
  }

  params = [tId];
  const { rows: ests } = await pool.query(
    `SELECT id, raw FROM clinicorp_estimates WHERE tenant_id = $1 AND raw IS NOT NULL${range('date', estFrom, estTo, params)}`,
    params
  );
  for (const r of ests) {
    try { await projectEstimateToLocal(pool, { ...(parse(r.raw) || {}), id: r.id }, tId); counts.estimates++; }
    catch (e) { counts.errors++; console.error('[clinicorp reproject] estimate', r.id, e.message); }
  }

  params = [tId];
  const { rows: fin } = await pool.query(
    `SELECT source, raw FROM clinicorp_financial_entries WHERE tenant_id = $1 AND raw IS NOT NULL${range('date', finFrom, finTo, params)}`,
    params
  );
  for (const f of fin) {
    try { await projectFinanceToLocal(pool, f.source, parse(f.raw), tId); counts.financial++; }
    catch (e) { counts.errors++; console.error('[clinicorp reproject] financial', e.message); }
  }
  return counts;
}

/**
 * Bidirectional Mirroring (Push to Clinicorp)
 *
 * As credenciais vêm do tenant do registro (clinicorp_user_settings de um
 * usuário daquele tenant com a integração ativa). A spec oficial só oferece:
 *   - POST /patient/create
 *   - POST /appointment/create_appointment_by_api
 *   - POST /appointment/cancel_appointment {subscriber_id, id}
 * Não existe atualização de paciente nem de agendamento: essas operações são
 * puladas e registradas em clinicorp_push_log com status 'skipped'.
 */
function addMinutesToTime(hhmm, minutes) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const total = Math.max(0, (h || 0) * 60 + (m || 0) + (Number(minutes) || 0));
  const capped = Math.min(total, 23 * 60 + 59);
  return `${String(Math.floor(capped / 60)).padStart(2, '0')}:${String(capped % 60).padStart(2, '0')}`;
}

function toYmd(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return normalizeClinicorpDate(v);
}

function firstCreatedId(res) {
  const obj = Array.isArray(res) ? res[0] : res;
  if (!obj || typeof obj !== 'object') return null;
  const id = pickFirst(obj, 'id', 'Id', 'PersonId', 'Patient_PersonId', 'PatientId', 'AppointmentId');
  return id != null ? String(id) : null;
}

export const clinicorpPush = {
  log: async (pool, data) => {
    try {
      await pool.query(
        `INSERT INTO clinicorp_push_log (entity_type, local_id, clinicorp_id, action, status, payload, response, error_message, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [data.entity, String(data.local_id ?? ''), data.clinicorp_id != null ? String(data.clinicorp_id) : null,
         data.action, data.status,
         data.payload ? JSON.stringify(data.payload) : null,
         data.response ? JSON.stringify(data.response) : null,
         data.error || null, data.tenant_id || null]
      );
    } catch (e) { console.error('[clinicorp push log]', e.message); }
  },

  skip: async (pool, data, reason) => {
    console.log(`[clinicorp push] ${data.entity} ${data.local_id} ${data.action} pulado: ${reason}`);
    await clinicorpPush.log(pool, { ...data, status: 'skipped', error: reason });
  },

  pushPatient: async (pool, patientId) => {
    let tenantId = null;
    try {
      const { rows } = await pool.query('SELECT * FROM pacientes WHERE id = $1', [patientId]);
      const p = rows[0];
      if (!p?.tenant_id) return;
      tenantId = p.tenant_id;
      const s = await loadSettingsForTenant(pool, tenantId);
      if (!s) return; // tenant sem integração Clinicorp ativa

      if (p.clinicorp_patient_id) {
        await clinicorpPush.skip(pool, {
          entity: 'patient', local_id: patientId, clinicorp_id: p.clinicorp_patient_id, action: 'update', tenant_id: tenantId,
        }, 'A API da Clinicorp não tem endpoint de atualização de paciente');
        return;
      }
      if (!p.nome) return;

      const sexo = String(p.sexo || '').toUpperCase();
      const body = {
        Name: p.nome,
        ...(toYmd(p.data_nascimento) ? { BirthDate: toYmd(p.data_nascimento) } : {}),
        ...(sexo.startsWith('M') ? { Sex: 'M' } : sexo.startsWith('F') ? { Sex: 'F' } : {}),
        ...(p.email ? { Email: p.email } : {}),
        ...(onlyDigits(p.telefone) ? { MobilePhone: onlyDigits(p.telefone) } : {}),
        ...(onlyDigits(p.cpf) ? { OtherDocumentId: onlyDigits(p.cpf) } : {}),
      };
      const res = await clinicorpApi.createPatient(s, body);
      const cpId = firstCreatedId(res);
      if (cpId) {
        await pool.query(
          'UPDATE pacientes SET clinicorp_patient_id = $1, last_clinicorp_sync_at = NOW() WHERE id = $2 AND tenant_id = $3',
          [cpId, patientId, tenantId]
        );
      }
      await clinicorpPush.log(pool, { entity: 'patient', local_id: patientId, clinicorp_id: cpId, action: 'create', status: 'success', payload: body, response: res, tenant_id: tenantId });
    } catch (e) {
      await clinicorpPush.log(pool, { entity: 'patient', local_id: patientId, action: 'create', status: 'error', error: e.message, tenant_id: tenantId });
      console.error('[clinicorp push patient]', e.message);
    }
  },

  pushAppointment: async (pool, appointmentId) => {
    let tenantId = null;
    try {
      const { rows } = await pool.query(`
        SELECT a.*, p.clinicorp_patient_id, p.nome AS paciente_nome, p.telefone AS paciente_telefone,
               p.email AS paciente_email, d.clinicorp_professional_id
          FROM agendamentos a
          LEFT JOIN pacientes p ON p.id = a.paciente_id AND p.tenant_id = a.tenant_id
          LEFT JOIN dentistas d ON d.id = a.dentista_id AND d.tenant_id = a.tenant_id
         WHERE a.id = $1
      `, [appointmentId]);
      const a = rows[0];
      if (!a?.tenant_id) return;
      tenantId = a.tenant_id;
      const s = await loadSettingsForTenant(pool, tenantId);
      if (!s) return;
      const base = { entity: 'appointment', local_id: appointmentId, tenant_id: tenantId };

      if (a.clinicorp_appointment_id) {
        if (a.status === 'cancelado') {
          const res = await clinicorpApi.cancelAppointment(s, a.clinicorp_appointment_id);
          await clinicorpPush.log(pool, { ...base, clinicorp_id: a.clinicorp_appointment_id, action: 'cancel', status: 'success', response: res });
          return;
        }
        await clinicorpPush.skip(pool, { ...base, clinicorp_id: a.clinicorp_appointment_id, action: 'update' },
          'A API da Clinicorp não tem endpoint de atualização de agendamento (apenas cancelamento)');
        return;
      }
      if (a.status === 'cancelado') return;

      if (!a.clinicorp_professional_id) {
        await clinicorpPush.skip(pool, { ...base, action: 'create' }, 'Dentista sem vínculo com a Clinicorp (clinicorp_professional_id)');
        return;
      }
      // Clínica: a mais usada por esse profissional no espelho; senão a única do tenant.
      const { rows: biz } = await pool.query(
        `SELECT business_id FROM (
           SELECT business_id, COUNT(*) AS n FROM clinicorp_appointments
            WHERE tenant_id = $1 AND professional_id::text = $2 AND business_id IS NOT NULL
            GROUP BY business_id
         ) x ORDER BY n DESC LIMIT 1`,
        [tenantId, String(a.clinicorp_professional_id)]
      );
      let businessId = biz[0]?.business_id ?? null;
      if (!businessId) {
        const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics WHERE tenant_id = $1', [tenantId]);
        if (clinics.length === 1) businessId = clinics[0].id;
      }
      if (!businessId) {
        await clinicorpPush.skip(pool, { ...base, action: 'create' }, 'Não foi possível determinar a clínica (Clinic_BusinessId) do agendamento');
        return;
      }
      const date = toYmd(a.data);
      const fromTime = normalizeClinicorpTime(a.hora);
      if (!date || !fromTime) {
        await clinicorpPush.skip(pool, { ...base, action: 'create' }, 'Agendamento sem data/hora válida');
        return;
      }

      const body = {
        ...(toBigIntOrNull(a.clinicorp_patient_id) ? { Patient_PersonId: Number(a.clinicorp_patient_id) } : {}),
        ...(a.paciente_nome ? { PatientName: a.paciente_nome } : {}),
        ...(a.paciente_telefone ? { MobilePhone: a.paciente_telefone } : {}),
        ...(a.paciente_email ? { Email: a.paciente_email } : {}),
        // Data à meia-noite de Brasília (formato do exemplo da spec)
        date: new Date(`${date}T00:00:00-03:00`).toISOString(),
        fromTime,
        toTime: addMinutesToTime(fromTime, a.duracao || 30),
        Clinic_BusinessId: Number(businessId),
        Dentist_PersonId: Number(a.clinicorp_professional_id),
        ...(a.procedimento ? { Procedures: a.procedimento } : {}),
        ...(a.categoria ? { CategoryDescription: a.categoria } : {}),
      };
      if (!body.Patient_PersonId && !body.PatientName) {
        await clinicorpPush.skip(pool, { ...base, action: 'create' }, 'Agendamento sem paciente');
        return;
      }
      const res = await clinicorpApi.createAppointment(s, body);
      const cpId = firstCreatedId(res);
      if (cpId) {
        await pool.query(
          'UPDATE agendamentos SET clinicorp_appointment_id = $1, last_clinicorp_sync_at = NOW() WHERE id = $2 AND tenant_id = $3',
          [cpId, appointmentId, tenantId]
        );
      }
      await clinicorpPush.log(pool, { ...base, clinicorp_id: cpId, action: 'create', status: 'success', payload: body, response: res });
    } catch (e) {
      await clinicorpPush.log(pool, { entity: 'appointment', local_id: appointmentId, action: 'push', status: 'error', error: e.message, tenant_id: tenantId });
      console.error('[clinicorp push appointment]', e.message);
    }
  },

  // Exclusão local → cancelamento na Clinicorp (a spec não tem delete).
  // `snapshot` ({ clinicorp_appointment_id, tenant_id }) deve ser lido ANTES
  // do DELETE local; sem ele tentamos ler a linha (se ainda existir).
  deleteAppointment: async (pool, appointmentId, snapshot = null) => {
    let tenantId = snapshot?.tenant_id || null;
    try {
      let cpId = snapshot?.clinicorp_appointment_id || null;
      if (!snapshot) {
        const { rows } = await pool.query('SELECT clinicorp_appointment_id, tenant_id FROM agendamentos WHERE id = $1', [appointmentId]);
        cpId = rows[0]?.clinicorp_appointment_id || null;
        tenantId = rows[0]?.tenant_id || null;
      }
      if (!cpId || !tenantId) return;
      const s = await loadSettingsForTenant(pool, tenantId);
      if (!s) return;
      const res = await clinicorpApi.cancelAppointment(s, cpId);
      await clinicorpPush.log(pool, { entity: 'appointment', local_id: appointmentId, clinicorp_id: cpId, action: 'cancel', status: 'success', response: res, tenant_id: tenantId });
    } catch (e) {
      await clinicorpPush.log(pool, { entity: 'appointment', local_id: appointmentId, action: 'cancel', status: 'error', error: e.message, tenant_id: tenantId });
      console.error('[clinicorp delete appointment]', e.message);
    }
  },
};

/**

 * Tick de reconciliação agendada.
 * - Usa lock no Postgres para evitar execução concorrente / múltiplas instâncias.
 * - Catch-up automático após interrupções: se last_sync_at é antigo, alarga a janela.
 */
export async function reconciliationTick(pool) {
  // Sincronização automática global removida.
  // Apenas a sincronização por usuário (SaaS) é mantida para ser chamada manualmente
  // ou através de gatilhos específicos do painel de integração.
  
  const results = [];


  // 2. PER-USER SYNC (SaaS SaaS)
  const usersToSync = await pool.query(
    `SELECT s.user_id, p.tenant_id
     FROM clinicorp_user_settings s
     JOIN profiles p ON p.id = s.user_id
     WHERE s.enabled = true
       AND s.api_token IS NOT NULL
       AND s.subscriber_id IS NOT NULL
       AND p.tenant_id IS NOT NULL
       AND (COALESCE(s.last_sync_status, '') <> 'syncing' OR s.updated_at < NOW() - INTERVAL '30 minutes')
       AND (s.last_sync_at IS NULL OR s.last_sync_at < NOW() - INTERVAL '30 minutes')
     LIMIT 5` // Sincroniza até 5 usuários por tick para evitar sobrecarga
  );

  for (const u of usersToSync.rows) {
    const today = new Date();
    const from = new Date(today.getTime() - 7 * 86400_000).toISOString().slice(0, 10); // SaaS: janela menor (7 dias) por performance
    const to   = new Date(today.getTime() + 14 * 86400_000).toISOString().slice(0, 10);
    console.log(`[clinicorp] auto-reconcile user ${u.user_id} rodando ${from} → ${to}`);
    try {
      // runFullSync grava last_sync_* / sync_progress do usuário.
      const r = await runFullSync(pool, { from, to, user_id: u.user_id, tenant_id: u.tenant_id });
      results.push({ type: 'user', user_id: u.user_id, ...r });
    } catch (e) {
      console.error(`[clinicorp] user ${u.user_id} tick error:`, e.message);
      // Circuit breaker: se rate-limited (429), empurra last_sync_at para o futuro
      // para que o próximo tick (60s) NÃO tente de novo. Respeita o retry-after da Clinicorp.
      if (isClinicorpRateLimitError(e)) {
        const retryAfter = Number(e.retry_after_seconds ?? e.retryAfter);
        const waitSeconds = Math.min(Math.max(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1800, 300), 3600);
        await pool.query(
          `UPDATE clinicorp_user_settings
             SET last_sync_at = NOW() + ($2::int * INTERVAL '1 second'),
                 last_sync_status = 'rate_limited',
                  last_sync_error = $3
           WHERE user_id = $1`,
          [u.user_id, waitSeconds, `Rate limit Clinicorp — aguardando ${Math.ceil(waitSeconds / 60)} min`]
        );
        console.warn(`[clinicorp] user ${u.user_id} rate-limited, pausando auto-sync por ${waitSeconds}s`);
      } else {
        await pool.query(`UPDATE clinicorp_user_settings SET last_sync_at = NOW(), last_sync_status = 'error', last_sync_error = $2 WHERE user_id = $1`, [u.user_id, e.message]);
      }
    }
  }

  return results.length > 0 ? { ran: true, results } : { skipped: true };
}

async function runFinancialReconciliation(pool) {

  try {
    const { rows: alerts } = await pool.query(`
      WITH monthly_data AS (
        SELECT 
          tenant_id,
          period_month,
          SUM(CASE WHEN source = 'payment' THEN total_amount ELSE 0 END) as total_payments,
          SUM(CASE WHEN source = 'cashflow' THEN total_in ELSE 0 END) as total_cash_in
        FROM clinicorp_monthly_summary
        WHERE period_month >= NOW() - INTERVAL '3 months'
        GROUP BY tenant_id, period_month
      )
      SELECT 
        tenant_id,
        period_month,
        total_payments,
        total_cash_in,
        ABS(total_payments - total_cash_in) as divergence
      FROM monthly_data
      WHERE ABS(total_payments - total_cash_in) > 0.01
      ORDER BY period_month DESC
    `);

    for (const alert of alerts) {
      const tp = Number(alert.total_payments) || 0;
      const tc = Number(alert.total_cash_in) || 0;
      const dv = Number(alert.divergence) || 0;
      const period = alert.period_month instanceof Date
        ? alert.period_month.toISOString().slice(0, 7)
        : String(alert.period_month).slice(0, 7);
      console.warn(`[clinicorp alert] Divergência financeira em ${period} (tenant ${alert.tenant_id}): Payments R$ ${tp.toFixed(2)} vs Cashflow R$ ${tc.toFixed(2)} (Diff: R$ ${dv.toFixed(2)})`);

      await pool.query(
        `INSERT INTO clinicorp_webhook_events (event_type, status, payload, received_at, tenant_id)
         VALUES ($1, $2, $3, NOW(), $4)`,
        ['financial_divergence_alert', 'processed', JSON.stringify({ ...alert, period_month: period, total_payments: tp, total_cash_in: tc, divergence: dv }), alert.tenant_id]
      );
    }

    return { alerts_count: alerts.length, alerts };
  } catch (e) {
    console.error('[clinicorp] falha na reconciliação financeira:', e.message);
    return { error: e.message };
  }
}

// ─── Webhook event processor ──────────────────────────────────
// tenantId vem do webhook_secret (clinicorp_user_settings → profiles) e é
// repassado a TODAS as gravações.
async function processWebhookEvent(pool, event, tenantId) {
  const tId = await resolveTenantId(pool, tenantId);
  // Clinicorp envia eventos heterogêneos. Tentamos inferir o tipo.
  const type = (event?.event || event?.Event || event?.type || event?.action || '').toString().toLowerCase();
  const data = event?.data || event?.Data || event?.payload || event;

  if (!data || typeof data !== 'object') return { handled: false };

  // Agendamento
  if (type.includes('appointment') || data.AppointmentId || data.Patient_PersonId && (data.FromTime || data.Date)) {
    const deleted = type.includes('deleted') || type.includes('cancel') || data.Deleted === 'X';
    if (deleted) {
      const id = getAppointmentId(data) ?? data.AppointmentId;
      if (id) {
        await pool.query(
          `UPDATE clinicorp_appointments SET status = 'DELETED_IN_CLINICORP', synced_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          [String(id), tId]
        );
        await pool.query(
          `UPDATE agendamentos SET status = 'cancelado', updated_at = NOW() WHERE clinicorp_appointment_id = $1 AND tenant_id = $2`,
          [String(id), tId]
        );
        return { handled: true, target: 'appointment_deleted' };
      }
    }
    await upsertAppointment(pool, data, tId);
    return { handled: true, target: 'appointment' };
  }

  // Paciente
  if (type.includes('patient') || (data.Patient_PersonId && data.Name && !data.FromTime)) {
    await upsertPatient(pool, data, tId);
    return { handled: true, target: 'patient' };
  }

  // Evolução / Prontuário
  if (type.includes('evolution') || data.EvolutionId) {
    await upsertEvolution(pool, data, tId);
    return { handled: true, target: 'evolution' };
  }

  // Documento / Anexo
  if (type.includes('document') || data.DocumentId || data.FileUrl) {
    await upsertDocument(pool, data, tId);
    return { handled: true, target: 'document' };
  }

  // Orçamento / tratamento
  if (type.includes('estimate') || type.includes('treatment') || data.TreatmentId) {
    await upsertEstimate(pool, data, tId);
    return { handled: true, target: 'estimate' };
  }

  // Financeiro
  if (type.includes('payment') || type.includes('invoice') || type.includes('cashflow')) {
    const src = type.includes('invoice') ? 'invoice' : type.includes('cashflow') ? 'cashflow' : 'payment';
    await upsertFinancial(pool, src, data, tId);
    return { handled: true, target: src };
  }

  return { handled: false, reason: 'tipo de evento desconhecido' };
}

// ─── Express routes ───────────────────────────────────────────
export function registerClinicorp(app, pool, { verifyUser } = {}) {
  // Colunas usadas pela integração na VPS (idempotente; antes ficavam só no
  // schema do Supabase).
  (async () => {
    for (const sql of [
      `ALTER TABLE clinicorp_user_settings ADD COLUMN IF NOT EXISTS sync_progress JSONB`,
      `ALTER TABLE clinicorp_push_log ADD COLUMN IF NOT EXISTS tenant_id UUID`,
      `ALTER TABLE clinicorp_webhook_events ADD COLUMN IF NOT EXISTS tenant_id UUID`,
      `ALTER TABLE clinicorp_conflicts ADD COLUMN IF NOT EXISTS tenant_id UUID`,
      `CREATE INDEX IF NOT EXISTS idx_clinicorp_push_log_tenant ON clinicorp_push_log(tenant_id, created_at DESC)`,
    ]) {
      try { await pool.query(sql); }
      catch (e) { console.warn('[clinicorp] schema:', e.message); }
    }
  })();

  // ── Webhook receiver (público; protegido por ?user_api=<webhook_secret>) ──
  app.post('/api/webhook/clinicorp', async (req, res) => {
    const startedAt = Date.now();
    let eventId = null;
    try {
      const userApi = (req.query.user_api || req.headers['x-user-api'] || '').toString();
      if (!userApi || userApi.length < 8) {
        return res.status(401).json({ error: 'unauthorized: missing or invalid user_api' });
      }

      // Resolvido: busca as configurações do usuário SaaS pelo webhook_secret (user_api)
      const { rows } = await pool.query(
        `SELECT s.user_id, s.api_token, s.subscriber_id, s.base_url, p.tenant_id
         FROM clinicorp_user_settings s
         JOIN profiles p ON p.id = s.user_id
         WHERE s.webhook_secret = $1 AND s.enabled = true
         LIMIT 1`,
        [userApi]
      );
      const settings = rows[0];

      if (!settings) {
        return res.status(401).json({ error: 'unauthorized: valid subscriber not found for this secret' });
      }

      const payload = req.body || {};
      const event = Array.isArray(payload) ? payload[0] : payload;
      const eventType = (event?.event || event?.Event || event?.type || event?.action || 'unknown').toString();
      const externalId = String(event?.id || event?.Id || event?.AppointmentId || event?.Patient_PersonId || event?.TreatmentId || '') || null;

      const webhookTenantId = settings.tenant_id;

      const ins = await pool.query(
        `INSERT INTO clinicorp_webhook_events (event_type, external_id, status, payload, headers, ip, tenant_id)
         VALUES ($1, $2, 'received', $3, $4, $5, $6) RETURNING id`,
        [eventType, externalId, JSON.stringify(payload), JSON.stringify(req.headers), req.ip, webhookTenantId]
      );
      eventId = ins.rows[0].id;

      let result;
      try {
        result = await processWebhookEvent(pool, event, webhookTenantId);
        await pool.query(
          `UPDATE clinicorp_webhook_events SET status = $1, processed_at = NOW() WHERE id = $2`,
          [result.handled ? 'processed' : 'ignored', eventId]
        );
      } catch (procErr) {
        console.error('[clinicorp webhook] processing error', procErr);
        await pool.query(
          `UPDATE clinicorp_webhook_events SET status = 'error', error_message = $1, processed_at = NOW() WHERE id = $2`,
          [procErr.message, eventId]
        );
        return res.status(200).json({ ok: true, stored: true, processed: false, error: procErr.message });
      }

      res.json({ ok: true, eventId, ...result, latencyMs: Date.now() - startedAt });
    } catch (err) {
      console.error('[clinicorp webhook] fatal', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ROTAS GLOBAIS REMOVIDAS (SaaS Multi-tenant deve usar /api/clinicorp/my-settings)


  // Helper: extrai tenant_id REAL do usuário autenticado.
  // O JWT do Supabase não inclui tenant_id nas claims, então decodificamos o
  // `sub` (user_id) e buscamos o tenant_id correspondente em profiles.
  // Se não houver usuário válido ou tenant, retornamos null — o caller deve
  // responder com lista vazia (NUNCA cair em fallback global, que vaza dados
  // do tenant do admin original para todos os usuários novos).
  // Todas as rotas /api/clinicorp/* exigem um token verificado (assinatura
  // checada por verifyUser). O webhook usa outro prefixo e continua público,
  // protegido pelo user_api.
  app.use('/api/clinicorp', async (req, res, next) => {
    if (typeof verifyUser !== 'function') {
      return res.status(503).json({ error: 'Autenticação indisponível' });
    }
    try {
      const { user } = await verifyUser(req);
      req.clinicorpUser = user;
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  });

  const tenantOf = async (req) => req.clinicorpUser?.tenant_id || null;

  // Overrides, histórico e reconciliação financeira são globais (não têm
  // tenant_id), então só o super admin pode lê-los ou alterá-los.
  const requireSuperAdmin = (req, res) => {
    if (req.clinicorpUser?.is_super_admin) return true;
    res.status(403).json({ error: 'Apenas super admin' });
    return false;
  };

  // Express 4 não captura rejeições de handlers async: sem isto um erro do
  // Postgres deixava a requisição pendurada.
  const route = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error(`[clinicorp] ${req.method} ${req.path}:`, e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  };
  // Leituras do espelho exigem tenant; sem ele, lista vazia (nunca global).
  const tenantList = (fn) => route(async (req, res) => {
    const tId = await tenantOf(req);
    if (!tId) return res.json([]);
    await fn(req, res, tId);
  });

  // ── Local read-only data (espelho) — escopo por tenant ───────
  app.get('/api/clinicorp/clinics', tenantList(async (req, res, tId) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_clinics WHERE tenant_id=$1 ORDER BY name', [tId]);
    res.json(rows);
  }));
  app.get('/api/clinicorp/professionals', tenantList(async (req, res, tId) => {
    const { rows } = await pool.query(`
      SELECT cp.*, d.id as local_id, d.ativo as local_ativo, d.cor_agenda as local_cor
      FROM clinicorp_professionals cp
      LEFT JOIN dentistas d ON d.clinicorp_professional_id::text = cp.id::text AND d.tenant_id = cp.tenant_id
      WHERE cp.tenant_id = $1
      ORDER BY cp.full_name
    `, [tId]);
    res.json(rows);
  }));
  app.get('/api/clinicorp/categories', tenantList(async (req, res, tId) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_appointment_categories WHERE tenant_id=$1 ORDER BY description', [tId]);
    res.json(rows);
  }));
  app.get('/api/clinicorp/specialties', tenantList(async (req, res, tId) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_specialties WHERE tenant_id=$1 ORDER BY description', [tId]);
    res.json(rows);
  }));
  app.get('/api/clinicorp/patients', tenantList(async (req, res, tId) => {
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const search = req.query.search ? `%${req.query.search}%` : null;
    const { rows } = search
      ? await pool.query(
          `SELECT * FROM clinicorp_patients
           WHERE tenant_id=$3 AND (name ILIKE $1 OR mobile_phone ILIKE $1 OR document_id ILIKE $1)
           ORDER BY name LIMIT $2`,
          [search, limit, tId]
        )
      : await pool.query('SELECT * FROM clinicorp_patients WHERE tenant_id=$2 ORDER BY synced_at DESC LIMIT $1', [limit, tId]);
    res.json(rows);
  }));
  app.get('/api/clinicorp/appointments', tenantList(async (req, res, tId) => {
    const { from, to, professional_id, business_id } = req.query;
    const where = ['tenant_id = $1'];
    const params = [tId];
    if (from) { params.push(from); where.push(`date >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`date <= $${params.length}`); }
    if (professional_id && professional_id !== 'all') { params.push(String(professional_id)); where.push(`professional_id::text = $${params.length}`); }
    if (business_id) { params.push(String(business_id)); where.push(`business_id::text = $${params.length}`); }
    const limit = Math.min(Number(req.query.limit) || 5000, 10000);
    params.push(limit);
    const sql = `SELECT * FROM clinicorp_appointments WHERE ${where.join(' AND ')} ORDER BY date, from_time LIMIT $${params.length}`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  }));
  app.get('/api/clinicorp/estimates', tenantList(async (req, res, tId) => {
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const { rows } = await pool.query('SELECT * FROM clinicorp_estimates WHERE tenant_id=$1 ORDER BY date DESC NULLS LAST LIMIT $2', [tId, limit]);
    res.json(rows);
  }));
  app.get('/api/clinicorp/financial', tenantList(async (req, res, tId) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await pool.query('SELECT * FROM clinicorp_financial_entries WHERE tenant_id = $2 ORDER BY date DESC NULLS LAST LIMIT $1', [limit, tId]);
    res.json(rows);
  }));
  app.get('/api/clinicorp/financial/monthly-summary', tenantList(async (req, res, tId) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await pool.query('SELECT * FROM clinicorp_monthly_summary WHERE tenant_id = $2 ORDER BY period_month DESC, source LIMIT $1', [limit, tId]);
    res.json(rows);
  }));
  app.get('/api/clinicorp/chairs', tenantList(async (req, res, tId) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_chairs WHERE tenant_id=$1 ORDER BY name', [tId]);
    res.json(rows);
  }));

  // ── Webhook events log ───────────────────────────────────────
  app.get('/api/clinicorp/webhook-events', tenantList(async (req, res, tId) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await pool.query(
      `SELECT id, event_type, external_id, status, error_message, received_at, processed_at
         FROM clinicorp_webhook_events
         WHERE tenant_id = $2
         ORDER BY received_at DESC LIMIT $1`,
      [limit, tId]
    );
    res.json(rows);
  }));

  app.get('/api/clinicorp/webhook-events/:id', route(async (req, res) => {
    const tId = await tenantOf(req);
    if (!tId) return res.status(404).json({ error: 'not found' });
    const { rows } = await pool.query('SELECT * FROM clinicorp_webhook_events WHERE id = $1 AND tenant_id = $2', [req.params.id, tId]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  }));

  // ── Live API passthrough (sem persistir) — credenciais do tenant ──
  const liveSettings = async (req, res) => {
    const s = await loadSettingsForTenant(pool, await tenantOf(req));
    if (!s) res.status(400).json({ error: 'Integração Clinicorp não configurada ou desativada para esta clínica' });
    return s;
  };
  app.get('/api/clinicorp/live/available-times', route(async (req, res) => {
    const s = await liveSettings(req, res);
    if (!s) return;
    const { professionalId, clinicId, fromDate, toDate } = req.query;
    res.json(await clinicorpApi.listAvailableTimes(s, professionalId, clinicId, fromDate, toDate));
  }));

  app.post('/api/clinicorp/live/create-appointment', route(async (req, res) => {
    const s = await liveSettings(req, res);
    if (!s) return;
    try {
      res.json(await clinicorpApi.createAppointment(s, req.body || {}));
    } catch (e) { res.status(e.status === 400 ? 400 : 502).json({ error: e.message, details: e.body }); }
  }));

  // ── Re-projeta o espelho do tenant nas tabelas do app (pacientes/dentistas/agendamentos/orçamentos/financeiro) ──
  app.post('/api/clinicorp/reproject', route(async (req, res) => {
    const tId = await tenantOf(req);
    if (!tId) return res.status(403).json({ error: 'Usuário sem clínica (tenant) associada' });
    const counts = await reprojectTenant(pool, tId);
    res.json({ ok: true, ...counts });
  }));

  // ── Conflict overrides (global / clinic / professional) ─────
  app.get('/api/clinicorp/overrides', async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const { rows } = await pool.query(
        `SELECT id, scope_type, scope_id, keep_local, conflict_strategy, note, updated_at
           FROM clinicorp_local_overrides ORDER BY scope_type, scope_id`
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/clinicorp/overrides', async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const { scope_type, scope_id, keep_local, conflict_strategy, note, scope_label } = req.body || {};
      if (!['global','clinic','professional'].includes(scope_type))
        return res.status(400).json({ error: 'scope_type inválido' });
      if (conflict_strategy && !['clinicorp_wins','local_wins','newest_wins'].includes(conflict_strategy))
        return res.status(400).json({ error: 'conflict_strategy inválido' });
      const sid = scope_type === 'global' ? null : (scope_id != null ? String(scope_id).trim() : null);
      if (scope_type !== 'global') {
        if (!sid) return res.status(400).json({ error: 'scope_id obrigatório' });
        if (!/^[0-9A-Za-z_-]{1,64}$/.test(sid)) return res.status(400).json({ error: 'scope_id deve ser alfanumérico (1-64)' });
      }
      if (note != null && String(note).length > 500)
        return res.status(400).json({ error: 'note muito longo (máx 500)' });
      if (keep_local == null && !conflict_strategy)
        return res.status(400).json({ error: 'Defina ao menos uma regra (manter local ou estratégia)' });

      // snapshot anterior
      const prev = (await pool.query(
        `SELECT * FROM clinicorp_local_overrides WHERE scope_type=$1 AND COALESCE(scope_id,'')=COALESCE($2,'')`,
        [scope_type, sid]
      )).rows[0] || null;

      const result = await pool.query(
        `INSERT INTO clinicorp_local_overrides (scope_type, scope_id, keep_local, conflict_strategy, note)
         VALUES ($1,$2,COALESCE($3,FALSE),$4,$5)
         ON CONFLICT (scope_type, COALESCE(scope_id,'')) DO UPDATE SET
           keep_local = COALESCE(EXCLUDED.keep_local, clinicorp_local_overrides.keep_local),
           conflict_strategy = COALESCE(EXCLUDED.conflict_strategy, clinicorp_local_overrides.conflict_strategy),
           note = COALESCE(EXCLUDED.note, clinicorp_local_overrides.note),
           updated_at = NOW()
         RETURNING *`,
        [scope_type, sid, typeof keep_local === 'boolean' ? keep_local : null, conflict_strategy ?? null, note ?? null]
      );
      const next = result.rows[0];

      const action = prev ? 'update' : 'create';
      const fields = ['keep_local', 'conflict_strategy', 'note'];
      const changed = [];
      const beforeOut = {}; const afterOut = {};
      for (const k of fields) {
        const b = prev?.[k] ?? null; const a = next?.[k] ?? null;
        if (JSON.stringify(b) !== JSON.stringify(a)) {
          changed.push(k); beforeOut[k] = b; afterOut[k] = a;
        }
      }
      if (action === 'create' || changed.length > 0) {
        await pool.query(
          `INSERT INTO clinicorp_override_history
             (override_id, action, scope_type, scope_id, scope_label, before_data, after_data, changed_fields, changed_by, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [next.id, action, scope_type, sid, scope_label || null,
           prev ? JSON.stringify(prev) : null, JSON.stringify(next),
           changed.length ? changed : null, req.clinicorpUser?.email || req.clinicorpUser?.id || 'system', note || null]
        );
      }

      res.json({ ok: true, override: next });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/clinicorp/overrides/:id', async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const prev = (await pool.query(
        `SELECT * FROM clinicorp_local_overrides WHERE id=$1`, [req.params.id]
      )).rows[0];
      if (prev) {
        await pool.query(`DELETE FROM clinicorp_local_overrides WHERE id=$1`, [req.params.id]);
        await pool.query(
          `INSERT INTO clinicorp_override_history
             (override_id, action, scope_type, scope_id, before_data, after_data, changed_by)
           VALUES ($1,'delete',$2,$3,$4,NULL,$5)`,
          [prev.id, prev.scope_type, prev.scope_id, JSON.stringify(prev), req.clinicorpUser?.email || req.clinicorpUser?.id || 'system']
        );
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Histórico de alterações dos overrides
  app.get('/api/clinicorp/overrides/history', async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const scope_type = req.query.scope_type ? String(req.query.scope_type) : null;
      const scope_id = req.query.scope_id ? String(req.query.scope_id) : null;
      const where = []; const params = [];
      if (scope_type) { params.push(scope_type); where.push(`scope_type=$${params.length}`); }
      if (scope_id)   { params.push(scope_id);   where.push(`scope_id=$${params.length}`); }
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT * FROM clinicorp_override_history
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Conflict log ────────────────────────────────────────────
  app.get('/api/clinicorp/conflicts', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const entity = req.query.entity ? String(req.query.entity) : null;
      const decision = req.query.decision ? String(req.query.decision) : null;
      const where = []; const params = [];
      if (!req.clinicorpUser?.is_super_admin) {
        const tId = await tenantOf(req);
        if (!tId) return res.json([]);
        params.push(tId); where.push(`COALESCE(c.tenant_id, p.tenant_id)=$${params.length}`);
      }
      if (entity)   { params.push(entity);   where.push(`c.entity=$${params.length}`); }
      if (decision) { params.push(decision); where.push(`c.decision=$${params.length}`); }
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT c.*,
                p.nome AS paciente_nome,
                l.id   AS lead_id_resolved,
                l.kanban_stage AS lead_stage
           FROM clinicorp_conflicts c
           LEFT JOIN pacientes p ON p.id = c.paciente_id
           LEFT JOIN crm_leads  l ON l.id = c.lead_id
                                  OR (c.lead_id IS NULL AND l.paciente_id = c.paciente_id)
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY c.created_at DESC
          LIMIT $${params.length}`,
        params
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Per-record keep_local lock ──────────────────────────────
  app.put('/api/clinicorp/keep-local', async (req, res) => {
    try {
      const { entity, id, keep_local } = req.body || {};
      const table = entity === 'appointment' ? 'agendamentos'
                  : entity === 'patient'    ? 'pacientes' : null;
      if (!table || !id) return res.status(400).json({ error: 'entity ou id inválido' });
      const tId = await tenantOf(req);
      if (!tId) return res.status(403).json({ error: 'Sem tenant' });
      const { rowCount } = await pool.query(
        `UPDATE ${table} SET keep_local=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
        [Boolean(keep_local), id, tId]);
      if (!rowCount) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Rota de sync automático removida.


  // ── Unified Audit Log (Webhook + Push) — escopo por tenant ──
  app.get('/api/clinicorp/audit-log', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const tId = await tenantOf(req);
      if (!tId) return res.json([]);
      const { rows } = await pool.query(`
        (
          SELECT 
            id, 'clinicorp' as source, event_type as event, status, 
            external_id as target_id, received_at as timestamp, payload, error_message
          FROM clinicorp_webhook_events
          WHERE tenant_id = $2
          ORDER BY received_at DESC
          LIMIT $1
        )
        UNION ALL
        (
          SELECT 
            id, 'odonto_connect' as source, action as event, status, 
            clinicorp_id as target_id, created_at as timestamp, payload, error_message
          FROM clinicorp_push_log
          WHERE tenant_id = $2
          ORDER BY created_at DESC
          LIMIT $1
        )
        ORDER BY timestamp DESC
        LIMIT $1
      `, [limit, tId]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Rodar SÓ a reconciliação financeira (sem refazer sync) ──
  app.post('/api/clinicorp/reconcile-financial', async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const result = await runFinancialReconciliation(pool);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('🦷 Clinicorp routes registered');
}
