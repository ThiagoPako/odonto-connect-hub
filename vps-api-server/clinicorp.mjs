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

function clinicorpAuthHeaders(settings, authMode = 'basic') {
  const apiToken = normalizeApiToken(settings?.api_token);
  const apiUser = String(settings?.subscriber_id || '').trim();
  const headers = { Accept: 'application/json' };

  if (authMode === 'basic' && apiUser) {
    headers.Authorization = `Basic ${Buffer.from(`${apiUser}:${apiToken}`).toString('base64')}`;
  } else {
    headers.Authorization = `Bearer ${apiToken}`;
  }

  return headers;
}

// ─── Settings cache ───────────────────────────────────────────
let _settingsCache = null;
let _settingsCacheAt = 0;

async function loadSettings(pool, force = false) {
  const now = Date.now();
  if (!force && _settingsCache && now - _settingsCacheAt < 30_000) {
    return _settingsCache;
  }
  const { rows } = await pool.query(
    `SELECT id, enabled, api_token, subscriber_id, webhook_secret, base_url,
            last_sync_at, last_sync_status, last_sync_error,
            auto_sync_enabled, sync_interval_minutes, sync_lookback_days, sync_lookahead_days,
            next_sync_at, sync_lock_until, conflict_strategy
       FROM clinicorp_settings WHERE id = 1`
  );
  _settingsCache = rows[0] || null;
  _settingsCacheAt = now;
  return _settingsCache;
}

// ─── Tenant resolver ──────────────────────────────────────────
// A integração Clinicorp grava em tabelas multi-tenant (dentistas, pacientes,
// agendamentos, crm_leads). Sem tenant_id os GETs filtrados não enxergam nada.
const DEFAULT_TENANT_ID = '3806a6cc-6058-477d-b35f-14f7b6059d4c';
let _tenantCache = null;
let _tenantCacheAt = 0;
async function resolveTenantId(pool, manualId = null) {
  if (manualId) return manualId;
  const now = Date.now();
  if (_tenantCache && now - _tenantCacheAt < 10_000) return _tenantCache;
  try {
    const { rows } = await pool.query(
      `SELECT tenant_id FROM profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`
    );
    _tenantCache = rows[0]?.tenant_id || DEFAULT_TENANT_ID;
  } catch {
    _tenantCache = DEFAULT_TENANT_ID;
  }
  _tenantCacheAt = now;
  return _tenantCache;
}

function invalidateSettings() {
  _settingsCache = null;
  _settingsCacheAt = 0;
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
const THROTTLE_MS = 700; // ~1.4 req/s por subscriber — Clinicorp aplica limites agressivos por hora.
const GLOBAL_PAUSE_AFTER_429_MS = 60_000; // se levarmos 429, pausa toda a fila por 60s
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fila por subscriber + pausa global compartilhada
const _queues = new Map(); // subscriber_id -> Promise chain
let _globalPauseUntil = 0;

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

  if (!settings?.api_token) {
    throw new Error('Clinicorp: api_token não configurado');
  }
  const base = (settings.base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = new URL(base + pathName);
  
  // Limpar query parameters vazios ou nulos para evitar erros na API do Clinicorp
  const allQuery = { ...query };
  // subscriber_id é OBRIGATÓRIO em TODAS as chamadas da Clinicorp (mesmo quando há business_id).
  // A API retorna HTTP 400 "É necessário informar o id do assinante" se omitido.
  if (settings.subscriber_id && (allQuery.subscriber_id === undefined || allQuery.subscriber_id === null || allQuery.subscriber_id === '')) {
    allQuery.subscriber_id = settings.subscriber_id;
  }
  
  for (const [k, v] of Object.entries(allQuery)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const maxRetries = 3;
  let retryCount = 0;

  const requestOnceWithRetry = async (authMode) => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 45_000); // 45s timeout
    
    try {
      const headers = clinicorpAuthHeaders(settings, authMode);
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

      // Retry logic for 429 (Rate Limit) and 502/503/504 (Server Overload/Gateway errors)
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const raSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
        // Pausa GLOBAL pelo tempo REAL informado pela Clinicorp (cap em 1h para evitar travamento eterno).
        const pauseMs = Math.min(raSec * 1000, 3600_000);
        _globalPauseUntil = Math.max(_globalPauseUntil, Date.now() + pauseMs);
        console.warn(`[clinicorp] HTTP 429 em ${pathName}. Retry-After=${raSec}s → pausando fila global por ${Math.round(pauseMs/1000)}s. SEM retry imediato.`);
        const err = new Error(`Clinicorp ${method} ${pathName} → HTTP 429: rate limited (retry-after ${raSec}s)`);
        err.status = 429;
        err.retry_after_seconds = raSec;
        err.retryAfter = raSec;
        throw err;
      }
      const shouldRetry = (res.status === 502 || res.status === 503 || res.status === 504) && retryCount < maxRetries;
      if (shouldRetry) {
        retryCount++;
        const delay = Math.min(Math.pow(2, retryCount) * 2500, 30_000);
        console.warn(`[clinicorp] HTTP ${res.status} em ${pathName}. Backoff ${delay}ms (tentativa ${retryCount}/${maxRetries})`);
        await sleep(delay);
        return requestOnceWithRetry(authMode);
      }


      if (!res.ok) {
        const err = new Error(`Clinicorp ${method} ${pathName} → HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
        err.status = res.status;
        err.body = data;
        err.authMode = authMode;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    return await requestOnceWithRetry('basic');
  } catch (err) {
    // Se falhar 401 no basic, tenta bearer
    if (err?.status === 401) return await requestOnceWithRetry('bearer');
    throw err;
  }
}


// ─── High-level API helpers ───────────────────────────────────
export const clinicorpApi = {
  listUsers: async (s) => {
    const endpoints = ['/security/list_users', '/security/user/list', '/user/list'];
    for (const ep of endpoints) {
      try {
        const r = await clinicorpFetch(s, ep);
        const list = Array.isArray(r) ? r
          : (r?.Results || r?.Users || r?.Items || r?.data || r?.users || []);
        if (Array.isArray(list) && list.length > 0) return list;
      } catch (e) { /* tenta o próximo */ }
    }
    return [];
  },
  listClinics: (s) => clinicorpFetch(s, '/business/list', { query: { subscriber_id: s.subscriber_id } }),
  listSubscribersClinics: (s) => clinicorpFetch(s, '/group/list_subscribers_clinics', { query: { subscriber_id: s.subscriber_id } }),
  listChairs: (s, businessId) => clinicorpFetch(s, '/business/list_chairs', { query: { Clinic_BusinessId: businessId } }),
  listAvailableTimes: (s, professionalId, clinicId, fromDate, toDate) =>
    clinicorpFetch(s, '/business/list_available_times', {
      query: { professionalId, clinicId, fromDate, toDate },
    }),
  listAppointmentCategories: (s) => clinicorpFetch(s, '/appointment/list_categories'),
  listSpecialties: (s) => clinicorpFetch(s, '/procedures/list_specialties'),
  listAppointments: async (s, from, to, businessId) => {
    // Clinicorp's canonical endpoint for listing appointments in a date range is
    // /appointment/list_by_date_and_clinic, which requires Clinic_BusinessId and
    // SK_DateFirstTime (YYYYMMDD integer). We iterate day-by-day on that endpoint
    // first, then fall back to /appointment/list with multiple param variants to
    // survive API drift between sandbox and production environments.
    const toAtomic = (d) => String(d).replaceAll('-', '').slice(0, 8);
    const aggregate = [];
    const seen = new Set();
    const push = (arr) => {
      for (const a of (Array.isArray(arr) ? arr : [])) {
        const id = getAppointmentId(a);
        if (!id || seen.has(String(id))) continue;
        seen.add(String(id));
        aggregate.push(a);
      }
    };
    const extract = extractClinicorpList;

    // 1) Preferred path: try /appointment/list with the whole range FIRST (efficient)
    const baseBiz = businessId
      ? { Clinic_BusinessId: businessId, business_id: businessId, BusinessId: businessId }
      : {};

    try {
      const data = await clinicorpFetch(s, '/appointment/list', { 
        query: { fromDate: from, toDate: to, ...baseBiz } 
      });
      const arr = extract(data);
      if (Array.isArray(arr) && arr.length > 0) {
        push(arr);
        // If we got results from the range call, we can skip the expensive per-day loop
        return aggregate;
      }
    } catch (e) {
      // If 404 or specific error, continue to per-day loop for precision
    }

    // 2) Granular path: list_by_date_and_clinic per day, per clinic (only if businessId is present and first call failed)
    if (businessId) {
      try {
        const start = new Date(from + 'T00:00:00Z');
        const end = new Date(to + 'T00:00:00Z');
        for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const sk = toAtomic(d.toISOString().slice(0, 10));
          try {
            const data = await clinicorpFetch(s, '/appointment/list_by_date_and_clinic', {
              query: { Clinic_BusinessId: businessId, SK_DateFirstTime: sk },
            });
            push(extract(data));
          } catch (e) {
            // If this endpoint doesn't exist on the account, abort the per-day loop and fall back
            if (e?.status === 404 || e?.status === 400) break;
            // For 5xx we keep trying other days
          }
        }
        if (aggregate.length > 0) return aggregate;
      } catch (_) { /* fall through to variants */ }
    }

    // 3) Fallback: /appointment/list with multiple param naming variants
    const variants = [
      { fromDate: from, toDate: to, ...baseBiz },
      { from, to, ...baseBiz },
      { date_from: from, date_to: to, ...baseBiz },
      { startDate: from, endDate: to, ...baseBiz },
      { initialDate: from, finalDate: to, ...baseBiz },
      { DateFrom: from, DateTo: to, ...baseBiz },
      { BeginDate: from, EndDate: to, ...baseBiz },
      { StartDate: from, EndDate: to, ...baseBiz },
      { DataInicial: from, DataFinal: to, ...baseBiz },
      { SK_DateFirstTime: toAtomic(from), ...baseBiz },
    ];
    let lastErr = null;
    for (const q of variants) {
      try {
        const data = await clinicorpFetch(s, '/appointment/list', { query: q });
        const arr = extract(data);
        if (Array.isArray(arr) && arr.length > 0) push(arr);
      } catch (e) { lastErr = e; }
    }
    if (aggregate.length > 0) return aggregate;
    if (lastErr) throw lastErr;
    return [];
  },
  appointmentStatusList: (s) => clinicorpFetch(s, '/appointment/status_list'),
  changeAppointmentStatus: (s, query) => clinicorpFetch(s, '/appointment/change_status', { query }),
  confirmAppointment: (s, body) => clinicorpFetch(s, '/appointment/confirm_appointment', { method: 'POST', body }),
  cancelAppointment: (s, body) => clinicorpFetch(s, '/appointment/cancel_appointment', { method: 'POST', body }),
  createAppointment: (s, body) => clinicorpFetch(s, '/appointment/create_appointment_by_api', { method: 'POST', body }),
  updateAppointment: (s, id, body) => clinicorpFetch(s, `/appointment/update/${id}`, { method: 'PUT', body }),
  deleteAppointment: (s, id) => clinicorpFetch(s, `/appointment/delete/${id}`, { method: 'DELETE' }),
  createOnlineScheduling: (s, body) => clinicorpFetch(s, '/appointment/create_online_scheduling', { method: 'POST', body }),
  getAvailableDays: (s, query) => clinicorpFetch(s, '/appointment/get_avaliable_days', { query }),
  getAvailableTimesCalendar: (s, query) => clinicorpFetch(s, '/appointment/get_avaliable_times_calendar', { query }),
  getPatient: (s, id) => clinicorpFetch(s, '/patient/get', { query: { id } }),
  listPatients: (s) => clinicorpFetch(s, '/patient/list'),
  patientBirthdays: (s, query) => clinicorpFetch(s, '/patient/birthdays', { query }),
  createPatient: (s, body) => clinicorpFetch(s, '/patient/create', { method: 'POST', body }),
  updatePatient: (s, id, body) => clinicorpFetch(s, `/patient/update/${id}`, { method: 'PUT', body }),
  patientAppointments: (s, patientId) => clinicorpFetch(s, '/patient/list_appointments', { query: { patient_id: patientId } }),
  patientEstimates: (s, patientId) => clinicorpFetch(s, '/patient/list_estimates', { query: { patient_id: patientId } }),
  listEstimates: (s, from, to, clinicId) => clinicorpFetch(s, '/estimates/list', { query: { from, to, clinic_id: clinicId } }),
  getEstimate: (s, treatmentId) => clinicorpFetch(s, '/estimates/get', { query: { treatment_id: treatmentId } }),
  analytics: (s, from, to) => clinicorpFetch(s, '/analytics/list_results', { query: { from, to } }),
  listInvoices: (s, { from, to, clinic_id } = {}) => clinicorpFetch(s, '/financial/list_invoices', { query: { from, to, business_id: clinic_id } }),
  listCashFlow: (s, { from, to, clinic_id } = {}) => clinicorpFetch(s, '/financial/list_cash_flow', { query: { from, to, business_id: clinic_id } }),
  listPayments: (s, { from, to, clinic_id } = {}) => clinicorpFetch(s, '/financial/list_payments', { query: { from, to, business_id: clinic_id } }),
  salesEstimatesAndConversion: (s, query) => clinicorpFetch(s, '/sales/estimates_and_conversion', { query }),
  salesExpertiseRevenue: (s, query) => clinicorpFetch(s, '/sales/expertise_revenue', { query }),
  addLead: (s, body) => clinicorpFetch(s, '/crm/add_leads', { method: 'POST', body }),
};

// ─── Upserts ──────────────────────────────────────────────────
async function upsertClinic(pool, c, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  const clinicId = c.id ?? c.Id ?? c.BusinessId ?? c.Clinic_BusinessId ?? c.ClinicBusinessId ?? c.CompanyId ?? c.Business?.Id;
  if (!clinicId) return;
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
}

async function upsertProfessional(pool, p, tenantId = null) {
  const id = p.id ?? p.Id ?? p.UserId ?? p.PersonId ?? null;
  if (!id) return;
  const tId = await resolveTenantId(pool, tenantId);
  // A API Clinicorp retorna o nome em diversos campos dependendo da versão/endpoint
  const fullName = (p.FullName ?? p.Full_Name ?? p.Name ?? p.PersonName ?? p.UserName ?? p.full_name ?? `Profissional ${id}`).toString().trim();
  const userName = p.UserName ?? p.Username ?? p.Email ?? null;
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
    // Atualiza status ativo/inativo local baseado no Clinicorp
    const isActive = p.Active === true || p.active === true || p.status === 'active';
    await pool.query(`UPDATE dentistas SET ativo = $1, updated_at = NOW() WHERE clinicorp_professional_id = $2 AND tenant_id = $3`, [isActive, String(id), tId]);
  }
  catch (e) { console.error('[clinicorp] ensureLocalProfessional:', e.message); }
}

async function upsertChair(pool, c, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  await pool.query(
    `INSERT INTO clinicorp_chairs (id, tenant_id, business_id, name, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       business_id = EXCLUDED.business_id,
       name = EXCLUDED.name,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [c.id, tId, c.BusinessId ?? null, c.Name ?? null, JSON.stringify(c)]
  );
}

async function upsertCategory(pool, c, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  await pool.query(
    `INSERT INTO clinicorp_appointment_categories (id, tenant_id, description, color, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       description = EXCLUDED.description,
       color = EXCLUDED.color,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [c.id, tId, c.Description ?? null, c.Color ?? null, JSON.stringify(c)]
  );
}

async function upsertSpecialty(pool, s, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
  await pool.query(
    `INSERT INTO clinicorp_specialties (id, tenant_id, description, raw, synced_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET
       description = EXCLUDED.description,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [s.id, tId, s.Description ?? s.Name ?? null, JSON.stringify(s)]
  );
}

async function upsertPatient(pool, p, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
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
      String(p.id ?? p.Patient_PersonId), tId, p.Name ?? null, p.Email ?? null,
      String(p.MobilePhone ?? '') || null,
      p.BirthDate || null, p.Sex ?? null,
      String(p.DocumentId ?? '') || null, p.Notes ?? null,
      JSON.stringify(p),
    ]
  );
  try { await projectPatientToLocal(pool, p, tId); }
  catch (e) { console.error('[clinicorp] projectPatientToLocal:', e.message); }
}

async function upsertAppointment(pool, a, tenantId = null) {
  const id = getAppointmentId(a);
  if (!id) return;
  const tId = await resolveTenantId(pool, tenantId);
  const businessId = pickFirst(a, 'BusinessId', 'Clinic_BusinessId', 'ClinicBusinessId', 'ClinicId', 'clinic_id', 'business_id') ?? a.Business?.Id ?? null;
  const patientId = pickFirst(a, 'PatientId', 'Patient_PersonId', 'PatientPersonId', 'Patient_Id', 'patient_id', 'patientId') ?? a.Patient?.Id ?? a.Patient?.PersonId ?? null;
  const professionalId = pickFirst(a, 'ProfessionalId', 'Dentist_PersonId', 'DentistPersonId', 'Professional_PersonId', 'ScheduleToId', 'ScheduleTo_PersonId', 'DentistId', 'Dentist_Id', 'professional_id', 'dentist_id') ?? a.Dentist?.Id ?? a.Professional?.Id ?? null;
  const appointmentDate = normalizeClinicorpDate(pickFirst(a, 'Date', 'AppointmentDate', 'SK_DateFirstTime', 'DateFirstTime', 'StartDate', 'StartDateTime', 'StartTime', 'fromTime', 'FromTime', 'date', 'appointment_date'));
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

async function ensureLocalPatient(pool, cpId, fallback = {}, tenantId = null) {
  if (!cpId) return null;
  const tId = await resolveTenantId(pool, tenantId);
  const found = await pool.query(`SELECT id, tenant_id FROM pacientes WHERE clinicorp_patient_id = $1 LIMIT 1`, [cpId]);
  const cp = await pool.query(`SELECT * FROM clinicorp_patients WHERE id = $1 AND tenant_id = $2`, [cpId, tId]);
  const src = cp.rows[0] || {};
  const nome = src.name || fallback.name || 'Paciente';
  const telefone = src.mobile_phone || onlyDigits(fallback.phone) || null;
  const email = src.email || fallback.email || null;
  const nascimento = src.birth_date || null;
  const sexo = src.sex || null;
  const cpf = src.document_id || null;
  if (found.rows[0]) {
    if (String(found.rows[0].tenant_id || '') !== String(tId)) {
      await pool.query(`UPDATE pacientes SET tenant_id=$1, updated_at=NOW() WHERE id=$2`, [tId, found.rows[0].id]);
    }
    await pool.query(
      `UPDATE pacientes SET nome=COALESCE(NULLIF($2,''),nome), telefone=COALESCE($3,telefone),
         email=COALESCE($4,email), data_nascimento=COALESCE($5,data_nascimento),
         sexo=COALESCE($6,sexo), cpf=COALESCE(NULLIF(cpf,''),$7), updated_at=NOW() WHERE id=$1`,
      [found.rows[0].id, nome, telefone, email, nascimento, sexo, cpf]
    );
    return found.rows[0].id;
  }
  let matchId = null;
  if (telefone) {
    const r = await pool.query(`SELECT id FROM pacientes WHERE telefone=$1 AND tenant_id=$2 LIMIT 1`, [telefone, tId]);
    matchId = r.rows[0]?.id || null;
  }
  if (!matchId && cpf) {
    const r = await pool.query(`SELECT id FROM pacientes WHERE cpf=$1 AND tenant_id=$2 LIMIT 1`, [cpf, tId]);
    matchId = r.rows[0]?.id || null;
  }
  if (matchId) {
    try {
      await pool.query(`UPDATE pacientes SET clinicorp_patient_id=$1, tenant_id=$2, updated_at=NOW() WHERE id=$3`, [cpId, tId, matchId]);
    } catch (e) {
      if (e.code === '23505') {
        const r = await pool.query(`SELECT id, tenant_id FROM pacientes WHERE clinicorp_patient_id=$1 LIMIT 1`, [cpId]);
        if (r.rows[0]) {
          if (String(r.rows[0].tenant_id || '') !== String(tId)) {
            await pool.query(`UPDATE pacientes SET tenant_id=$1, updated_at=NOW() WHERE id=$2`, [tId, r.rows[0].id]);
          }
          return r.rows[0].id;
        }
      }
      throw e;
    }
    return matchId;
  }
  try {
    const ins = await pool.query(
      `INSERT INTO pacientes (nome, telefone, email, data_nascimento, sexo, cpf, clinicorp_patient_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [nome, telefone, email, nascimento, sexo, cpf, cpId, tId]
    );
    return ins.rows[0].id;
  } catch (e) {
    // Race condition: outro processo inseriu o mesmo paciente — busca e retorna
    if (e.code === '23505') {
      const r = await pool.query(`SELECT id, tenant_id FROM pacientes WHERE clinicorp_patient_id=$1 LIMIT 1`, [cpId]);
      if (r.rows[0]) {
        if (String(r.rows[0].tenant_id || '') !== String(tId)) {
          await pool.query(`UPDATE pacientes SET tenant_id=$1, updated_at=NOW() WHERE id=$2`, [tId, r.rows[0].id]);
        }
        return r.rows[0].id;
      }
    }
    throw e;
  }
}

async function ensureLocalProfessional(pool, cpProfId, fallbackName = null, tenantId = null) {
  if (!cpProfId) return null;
  const tId = await resolveTenantId(pool, tenantId);
  const cleanFallback = (fallbackName || '').toString().trim() || null;
  const found = await pool.query(`SELECT id, nome, tenant_id FROM dentistas WHERE clinicorp_professional_id=$1 LIMIT 1`, [cpProfId]);
  if (found.rows[0]) {
    if (!found.rows[0].tenant_id) {
      await pool.query(`UPDATE dentistas SET tenant_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id IS NULL`, [tId, found.rows[0].id]);
    }
    // Atualiza nome se estava como placeholder "Profissional XXX" e agora temos um real
    const currentName = (found.rows[0].nome || '').trim();
    const newName = cleanFallback && !/^Profissional\s+\d+$/i.test(cleanFallback) ? cleanFallback : null;
    if (newName && /^Profissional\s+\d+$/i.test(currentName)) {
      await pool.query(`UPDATE dentistas SET nome=$1, updated_at=NOW() WHERE id=$2`, [newName, found.rows[0].id]);
    }
    return found.rows[0].id;
  }
  const cp = await pool.query(`SELECT * FROM clinicorp_professionals WHERE id=$1 AND tenant_id=$2`, [cpProfId, tId]);
  const nome = (cp.rows[0]?.full_name || cleanFallback || `Profissional ${cpProfId}`).toString().trim();
  // Dedupe por LOWER(TRIM(nome)) dentro do mesmo tenant — evita "Dra Napoliane" duplicado
  const match = await pool.query(
    `SELECT id FROM dentistas WHERE tenant_id=$2 AND LOWER(TRIM(nome))=LOWER($1) LIMIT 1`,
    [nome, tId]
  );
  if (match.rows[0]) {
    try {
      await pool.query(`UPDATE dentistas SET clinicorp_professional_id=$1, updated_at=NOW() WHERE id=$2`, [cpProfId, match.rows[0].id]);
      return match.rows[0].id;
    } catch (e) {
      if (e.code === '23505') {
        const existing = await pool.query(`SELECT id, tenant_id FROM dentistas WHERE clinicorp_professional_id=$1 LIMIT 1`, [cpProfId]);
        if (existing.rows[0]) {
          if (!existing.rows[0].tenant_id) {
            await pool.query(`UPDATE dentistas SET tenant_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id IS NULL`, [tId, existing.rows[0].id]);
          }
          return existing.rows[0].id;
        }
      }
      throw e;
    }
  }
  try {
    const ins = await pool.query(
      `INSERT INTO dentistas (nome, ativo, clinicorp_professional_id, tenant_id)
       VALUES ($1, true, $2, $3)
       RETURNING id`,
      [nome, cpProfId, tId]
    );
    return ins.rows[0].id;
  } catch (e) {
    // race condition: outro insert paralelo já criou o registro
    if (e.code === '23505') {
      const r = await pool.query(
        `SELECT id FROM dentistas WHERE clinicorp_professional_id=$1 AND tenant_id=$2 LIMIT 1`,
        [cpProfId, tId]
      );
      if (r.rows[0]) return r.rows[0].id;
      const r2 = await pool.query(
        `SELECT id FROM dentistas WHERE tenant_id=$2 AND LOWER(TRIM(nome))=LOWER($1) LIMIT 1`,
        [nome, tId]
      );
      if (r2.rows[0]) {
        await pool.query(`UPDATE dentistas SET clinicorp_professional_id=$1, updated_at=NOW() WHERE id=$2`, [cpProfId, r2.rows[0].id]);
        return r2.rows[0].id;
      }
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
  const settings = await loadSettings(pool);
  const defaultStrategy = settings?.conflict_strategy || 'newest_wins';
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
          paciente_id, lead_id, agendamento_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [row.entity, row.clinicorp_id != null ? String(row.clinicorp_id) : null,
       row.local_id != null ? String(row.local_id) : null,
       row.decision, row.strategy, row.scope_type, row.scope_id,
       row.local_updated_at || null, row.clinicorp_updated_at || null,
       row.last_sync_at || null, row.diff ? JSON.stringify(row.diff) : null,
       row.before_data ? JSON.stringify(row.before_data) : null,
       row.after_data  ? JSON.stringify(row.after_data)  : null,
       row.changed_fields && row.changed_fields.length ? row.changed_fields : null,
       row.paciente_id || null, row.lead_id || null, row.agendamento_id || null]
    );
  } catch (e) { console.error('[clinicorp] logConflict', e.message); }
}

// Decide se devemos sobrescrever um registro local com dados do Clinicorp.
// localRow: { updated_at, last_clinicorp_sync_at, keep_local }
function decideOverwrite({ strategy, keepLocal, localRow, clinicorpUpdatedAt }) {
  if (!localRow) return { write: true, decision: 'created' };
  if (keepLocal || localRow.keep_local) return { write: false, decision: 'kept_local' };
  const lastSync = localRow.last_clinicorp_sync_at ? new Date(localRow.last_clinicorp_sync_at).getTime() : 0;
  const localUpd = localRow.updated_at ? new Date(localRow.updated_at).getTime() : 0;
  const cpUpd    = clinicorpUpdatedAt ? new Date(clinicorpUpdatedAt).getTime() : Date.now();
  const localChangedSinceSync = localUpd > lastSync + 1500; // tolerância 1.5s
  if (strategy === 'clinicorp_wins') return { write: true, decision: 'overwritten_by_clinicorp' };
  if (strategy === 'local_wins')     return localChangedSinceSync
    ? { write: false, decision: 'kept_local' }
    : { write: true, decision: 'overwritten_by_clinicorp' };
  // newest_wins (padrão)
  if (!localChangedSinceSync) return { write: true, decision: 'overwritten_by_clinicorp' };
  if (cpUpd > localUpd)        return { write: true, decision: 'kept_clinicorp_newer' };
  return { write: false, decision: 'kept_local_newer' };
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
  const data = normalizeClinicorpDate(pickFirst(a, 'Date', 'AppointmentDate', 'SK_DateFirstTime', 'DateFirstTime', 'StartDate', 'StartDateTime', 'StartTime', 'fromTime', 'FromTime', 'date', 'appointment_date'));
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
           last_clinicorp_sync_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [agendamentoId, pacienteId, dentistaId, data, hora, duracao, procedimento, procedimento, categoriaCor, status, observacoes]
      );
    }
    // Audit: registramos sempre que houver divergência real ou decisão não-trivial
    if (changed.length > 0 || decision.decision !== 'overwritten_by_clinicorp') {
      const leadRow = pacienteId
        ? (await pool.query(`SELECT id FROM crm_leads WHERE (paciente_id=$1 OR clinicorp_patient_id=$2) AND tenant_id=$3 LIMIT 1`, [pacienteId, cpPatientId, tId])).rows[0]
        : null;
      await logConflict(pool, {
        entity: 'appointment', clinicorp_id: cpApptId, local_id: agendamentoId,
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
           WHERE id=$1 AND kanban_stage IN ('paciente_agendado','novo','followup')`,
          [leadId]
        );
      } else if (status === 'em_atendimento') {
        await pool.query(`UPDATE crm_leads SET kanban_stage='em_atendimento', status='em_atendimento', updated_at=NOW() WHERE id=$1`, [leadId]);
      } else if (status === 'finalizado') {
        await pool.query(`UPDATE crm_leads SET kanban_stage='pos_consulta', status='pos_consulta', updated_at=NOW() WHERE id=$1`, [leadId]);
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
  const incoming = {
    nome: p.Name || null,
    telefone: p.MobilePhone || null,
    email: p.Email || null,
    data_nascimento: p.BirthDate || null,
    sexo: p.Sex || null,
    cpf: p.DocumentId || null,
  };
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
    const { changed, beforeOut, afterOut } = diffFields(beforeSnap, incoming);
    if (changed.length > 0 || decision.decision !== 'overwritten_by_clinicorp') {
      const leadRow = (await pool.query(
        `SELECT id FROM crm_leads WHERE (paciente_id=$1 OR clinicorp_patient_id=$2) AND tenant_id=$3 LIMIT 1`,
        [localRow.id, String(cpId), tId]
      )).rows[0];
      await logConflict(pool, {
        entity: 'patient', clinicorp_id: cpId, local_id: localRow.id,
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
  const pacienteId = await ensureLocalPatient(pool, cpId, { name: p.Name, phone: p.MobilePhone, email: p.Email }, tenantId);
  if (pacienteId) {
    await pool.query(`UPDATE pacientes SET last_clinicorp_sync_at=NOW(), updated_at=NOW() WHERE id=$1`, [pacienteId]);
  }
  await ensureLeadForPatient(pool, pacienteId, cpId, {
    nome: p.Name, telefone: onlyDigits(p.MobilePhone), email: p.Email,
  }, tenantId);
  return pacienteId;
}

async function upsertEstimate(pool, e, tenantId = null) {
  const tId = await resolveTenantId(pool, tenantId);
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
      e.ProfessionalName ?? e.Dentist_FullName ?? e.Dentist_Name ?? e.DentistName ?? e.ScheduleToName ?? e.Dentist?.Name ?? e.Dentist?.FullName ?? null, e.BusinessId ?? null,
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

async function upsertFinancial(pool, source, item, tenantId = null) {
  const externalId = String(item.id ?? item.Id ?? item.InvoiceId ?? item.PaymentId ?? '') || null;
  if (!externalId) return;

  await pool.query(
    `INSERT INTO clinicorp_financial_entries
       (source, external_id, business_id, patient_id, amount, date, description, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
     ON CONFLICT (source, external_id) DO UPDATE SET
       business_id = EXCLUDED.business_id,
       patient_id = EXCLUDED.patient_id,
       amount = EXCLUDED.amount,
       date = EXCLUDED.date,
       description = EXCLUDED.description,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      source, externalId,
      item.BusinessId ?? null,
      item.PatientId ?? null,
      item.Amount ?? item.Value ?? null,
      item.Date || item.PaymentDate || item.DueDate || null,
      item.Description ?? item.Memo ?? null,
      JSON.stringify(item),
    ]
  );
  try { await projectFinanceToLocal(pool, source, item, tenantId); }
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

async function upsertMonthlySummary(pool, source, item, businessId = null) {
  const periodMonth = parseClinicorpMonth(item.month ?? item.Month ?? item.period ?? item.Period ?? item.date ?? item.Date);
  if (!periodMonth) return false;

  await pool.query(
    `INSERT INTO clinicorp_monthly_summary
       (source, period_month, business_id, total_in, total_out, total_amount,
        cash, credit_card, debit_card, pix, bank_slip, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (source, period_month, business_id) DO UPDATE SET
       total_in = COALESCE(clinicorp_monthly_summary.total_in, 0) + COALESCE(EXCLUDED.total_in, 0),
       total_out = COALESCE(clinicorp_monthly_summary.total_out, 0) + COALESCE(EXCLUDED.total_out, 0),
       total_amount = COALESCE(clinicorp_monthly_summary.total_amount, 0) + COALESCE(EXCLUDED.total_amount, 0),
       cash = COALESCE(clinicorp_monthly_summary.cash, 0) + COALESCE(EXCLUDED.cash, 0),
       credit_card = COALESCE(clinicorp_monthly_summary.credit_card, 0) + COALESCE(EXCLUDED.credit_card, 0),
       debit_card = COALESCE(clinicorp_monthly_summary.debit_card, 0) + COALESCE(EXCLUDED.debit_card, 0),
       pix = COALESCE(clinicorp_monthly_summary.pix, 0) + COALESCE(EXCLUDED.pix, 0),
       bank_slip = COALESCE(clinicorp_monthly_summary.bank_slip, 0) + COALESCE(EXCLUDED.bank_slip, 0),
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      source,
      periodMonth,
      item.BusinessId ?? item.business_id ?? item.Clinic_BusinessId ?? businessId,
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
export async function runFullSync(pool, { from, to, api_token, subscriber_id, base_url, tenant_id, force_metadata = false, user_id = null } = {}) {
  // Se passarmos credenciais explícitas (ex: manual sync com per-user settings), as usamos.
  // Caso contrário, tenta carregar as do usuário específico ou as globais.
  let settings;
  if (api_token && subscriber_id) {
    settings = { api_token, subscriber_id, base_url, enabled: true };
  } else if (user_id) {
    const { rows: userRows } = await pool.query(
      `SELECT enabled, api_token, subscriber_id, base_url FROM clinicorp_user_settings WHERE user_id = $1`,
      [user_id]
    );
    if (userRows[0]?.enabled && userRows[0]?.api_token && userRows[0]?.subscriber_id) {
      settings = userRows[0];
    }
  }

  if (!settings) {
    settings = await loadSettings(pool, true);
    if (!settings?.enabled) throw new Error('Clinicorp desabilitado');
    if (!settings.api_token || !settings.subscriber_id) {
      throw new Error('Clinicorp: api_token e subscriber_id são obrigatórios');
    }
  }

  const today = new Date();
  const fromDate = from || new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const toDate = to || new Date(today.getTime() + 60 * 86400_000).toISOString().slice(0, 10);

  const summary = { clinics: 0, professionals: 0, patients: 0, chairs: 0, categories: 0, specialties: 0, appointments: 0, estimates: 0, invoices: 0, payments: 0, cashflow: 0, evolutions: 0, documents: 0 };
  const errors = [];

  // Backfill tenant_id em registros antigos vindos do Clinicorp (criados antes do fix)
  try {
    const tId = await resolveTenantId(pool, tenant_id);
    await pool.query(`UPDATE dentistas SET tenant_id=$1 WHERE tenant_id IS NULL AND clinicorp_professional_id IS NOT NULL`, [tId]);
    await pool.query(`UPDATE pacientes SET tenant_id=$1 WHERE tenant_id IS NULL AND clinicorp_patient_id IS NOT NULL`, [tId]);
    await pool.query(`UPDATE agendamentos SET tenant_id=$1 WHERE tenant_id IS NULL AND clinicorp_appointment_id IS NOT NULL`, [tId]);
    await pool.query(`UPDATE crm_leads SET tenant_id=$1 WHERE tenant_id IS NULL AND (clinicorp_patient_id IS NOT NULL OR origem='clinicorp')`, [tId]);
    await pool.query(`UPDATE orcamentos SET tenant_id=$1 WHERE tenant_id IS NULL AND clinicorp_estimate_id IS NOT NULL`, [tId]);
  } catch (e) { console.error('[clinicorp sync] tenant backfill', e.message); }

  // Garante que os registros recentes sejam projetados (espelhamento forçado)
  try {
    const tId = await resolveTenantId(pool, tenant_id);
    const { rows: appts } = await pool.query(
      `SELECT raw, id FROM clinicorp_appointments WHERE tenant_id=$3 AND date >= $1 AND date <= $2`,
      [fromDate, toDate, tId]
    );
    for (const r of appts) { 
      const rawData = typeof r.raw === 'string' ? JSON.parse(r.raw) : r.raw;
      await projectAppointmentToLocal(pool, rawData, r.id, tId); 
    }
  } catch (e) { console.error('[clinicorp sync] forced projection', e.message); }




  const safe = async (label, fn) => {
    try { 
      if (_globalPauseUntil > Date.now()) {
        const retryAfter = Math.ceil((_globalPauseUntil - Date.now()) / 1000);
        const err = new Error(`Clinicorp em rate limit — aguardando ${retryAfter}s antes de novas chamadas`);
        err.status = 429;
        err.retry_after_seconds = retryAfter;
        throw err;
      }
      if (user_id) {
        await pool.query(
          `UPDATE clinicorp_user_settings SET last_sync_status = 'syncing', last_sync_error = $2, updated_at = NOW() WHERE user_id = $1`,
          [user_id, `Processando: ${label}...`]
        ).catch(() => {});
      }
      await fn(); 
    } catch (e) { 
      errors.push(`${label}: ${e.message}`); 
      console.error(`[clinicorp sync] ${label}`, e.message); 
      if (isClinicorpRateLimitError(e)) throw e;
    }
  };

  // Helper para fatiar períodos em janelas menores para evitar erro 400 ou timeouts da Clinicorp
  const sliceRange = (startStr, endStr) => {
    const dates = [];
    let current = new Date(startStr);
    const end = new Date(endStr);
    // Janelas de 7 dias são mais seguras para evitar 502/timeouts no VPS
    while (current <= end) {
      const next = new Date(current.getTime() + 7 * 86400_000);
      const to = next < end ? next : end;
      dates.push({
        from: current.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10)
      });
      current = new Date(to.getTime() + 86400_000);
    }
    return dates;
  };


  // Metadata (clínicas, profissionais, cadeiras, categorias, especialidades) raramente muda.
  // Para reduzir drasticamente o número de chamadas (Clinicorp aplica limites por hora),
  // só atualizamos esses endpoints se a última sincronização foi há mais de 24h
  // (ou se force_metadata=true via /sync com flag explícita).
  let metadataFresh = false;
  if (!force_metadata) {
    try {
      const tIdMeta = await resolveTenantId(pool, tenant_id);
      const { rows } = await pool.query(
        `SELECT MAX(synced_at) AS last FROM clinicorp_clinics WHERE tenant_id=$1`,
        [tIdMeta]
      );
      const last = rows[0]?.last ? new Date(rows[0].last).getTime() : 0;
      if (last && (Date.now() - last) < 24 * 3600_000) metadataFresh = true;
    } catch { /* ignore */ }
  }

  if (!metadataFresh) {
    await safe('clinics', async () => {
      const list = await clinicorpApi.listClinics(settings);
      for (const c of (Array.isArray(list) ? list : [])) { await upsertClinic(pool, c, tenant_id); summary.clinics++; }
    });

    await safe('professionals', async () => {
      const list = await clinicorpApi.listUsers(settings);
      for (const u of (Array.isArray(list) ? list : [])) { await upsertProfessional(pool, u, tenant_id); summary.professionals++; }

      try {
        const tId = await resolveTenantId(pool, tenant_id);
        const { rows } = await pool.query('SELECT id, full_name FROM clinicorp_professionals WHERE tenant_id=$1', [tId]);
        for (const p of rows) {
          await ensureLocalProfessional(pool, String(p.id), p.full_name, tId);
        }
      } catch (e) { console.error('[clinicorp sync] dentists backfill', e.message); }
    });

    // Chairs por clínica
    await safe('chairs', async () => {
      const tId = await resolveTenantId(pool, tenant_id);
      const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics WHERE tenant_id=$1', [tId]);
      for (const { id } of clinics) {
        if (!id) continue;
        try {
          const list = await clinicorpApi.listChairs(settings, id);
          for (const ch of (Array.isArray(list) ? list : [])) { await upsertChair(pool, ch, tenant_id); summary.chairs++; }
        } catch (e) { /* silencia 400 sem chairs */ }
      }
    });

    await safe('categories', async () => {
      const list = await clinicorpApi.listAppointmentCategories(settings);
      for (const c of (Array.isArray(list) ? list : [])) { await upsertCategory(pool, c, tenant_id); summary.categories++; }
    });

    await safe('specialties', async () => {
      const list = await clinicorpApi.listSpecialties(settings);
      for (const s of (Array.isArray(list) ? list : [])) { await upsertSpecialty(pool, s, tenant_id); summary.specialties++; }
    });
  } else {
    console.log('[clinicorp sync] metadata recente (<24h) — pulando clinics/professionals/chairs/categories/specialties');
  }

  // PATIENTS: /patient/list não é exposto pela Clinicorp (404). Não chamamos esse endpoint
  // para evitar gastar requisições — o backfill acontece via projeção dos agendamentos.

  await safe('appointments', async () => {
    const tId = await resolveTenantId(pool, tenant_id);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics WHERE tenant_id=$1', [tId]);
    const apiIds = new Set();
    const ranges = sliceRange(fromDate, toDate);

    const processAppts = async (list) => {
      for (const a of (Array.isArray(list) ? list : [])) {
        const id = getAppointmentId(a);
        if (!id || apiIds.has(String(id))) continue;
        apiIds.add(String(id));
        await upsertAppointment(pool, a, tenant_id);
        await projectAppointmentToLocal(pool, a, id, tenant_id);
        summary.appointments++;
      }
    };

    // Quando temos clínicas, iteramos apenas por clínica para evitar
    // duplicar todas as chamadas com a versão "global" (que ANTES rodava
    // antes do loop por clínica e dobrava o consumo da API).
    if (clinics.length === 0) {
      for (const r of ranges) {
        try {
          const list = await clinicorpApi.listAppointments(settings, r.from, r.to);
          await processAppts(list);
        } catch (e) { console.error(`[clinicorp sync] appointments ${r.from}..${r.to}`, e.message); }
      }
    } else {
      for (const { id: clinicId } of clinics) {
        if (!clinicId) continue;
        for (const r of ranges) {
          try {
            const list = await clinicorpApi.listAppointments(settings, r.from, r.to, clinicId);
            await processAppts(list);
          } catch (e) { console.error(`[clinicorp sync] appointments clinic ${clinicId} ${r.from}..${r.to}`, e.message); }
        }
      }
    }

    
    // Deletion detection (faithfull mirror) — escopo por tenant
    try {
      const { rows: localRows } = await pool.query(
        `SELECT id FROM clinicorp_appointments WHERE tenant_id=$3 AND date >= $1 AND date <= $2`,
        [fromDate, toDate, tId]
      );
      for (const local of localRows) {
        if (!apiIds.has(String(local.id))) {
          await pool.query(`UPDATE clinicorp_appointments SET status = 'DELETED_IN_CLINICORP', synced_at = NOW() WHERE id = $1 AND tenant_id=$2`, [local.id, tId]);
          await pool.query(`UPDATE agendamentos SET status = 'cancelado', updated_at = NOW() WHERE clinicorp_appointment_id = $1 AND tenant_id=$2`, [local.id, tId]);
        }
      }
    } catch (e) { console.error('[clinicorp sync] pruning appointments', e.message); }
    
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

      const { rows: pcount } = await pool.query(`SELECT COUNT(*)::int AS c FROM clinicorp_professionals WHERE tenant_id=$1`, [tId]);
      summary.professionals = pcount[0]?.c || summary.professionals;
    } catch (e) { console.error('[clinicorp sync] backfill professionals', e.message); }
    
    // Conta pacientes únicos sincronizados DESTE tenant
    try {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM clinicorp_patients WHERE tenant_id=$1`, [tId]);
      summary.patients = rows[0]?.c || 0;
    } catch { /* ignore */ }
  });

  await safe('estimates', async () => {
    const tId = await resolveTenantId(pool, tenant_id);
    const ranges = sliceRange(fromDate, toDate);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics WHERE tenant_id=$1', [tId]);
    
    for (const r of ranges) {
      if (clinics.length > 0) {
        for (const { id: clinicId } of clinics) {
          try {
            const list = await clinicorpApi.listEstimates(settings, r.from, r.to, clinicId);
            for (const e of (Array.isArray(list) ? list : [])) { await upsertEstimate(pool, e, tenant_id); summary.estimates++; }
          } catch (e) { console.error('[clinicorp sync] estimates clinic range:', e.message); }
        }
      } else {
        const list = await clinicorpApi.listEstimates(settings, r.from, r.to);
        for (const e of (Array.isArray(list) ? list : [])) { await upsertEstimate(pool, e, tenant_id); summary.estimates++; }
      }
    }
  });

  await safe('invoices', async () => {
    const ranges = sliceRange(fromDate, toDate);
    const tId_loc = await resolveTenantId(pool, tenant_id);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics WHERE tenant_id=$1', [tId_loc]);
    for (const r of ranges) {
      if (clinics.length > 0) {
        for (const { id: clinicId } of clinics) {
          try {
            const list = await clinicorpApi.listInvoices(settings, { from: r.from, to: r.to, clinic_id: clinicId });
            for (const i of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'invoice', i, tenant_id); summary.invoices++; }
          } catch (e) { console.error('[clinicorp sync] financial:', e.message); }
        }
      } else {
        const list = await clinicorpApi.listInvoices(settings, { from: r.from, to: r.to });
        for (const i of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'invoice', i, tenant_id); summary.invoices++; }
      }
    }
  });

  await safe('payments', async () => {
    const ranges = sliceRange(fromDate, toDate);
    const tId_loc = await resolveTenantId(pool, tenant_id);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics WHERE tenant_id=$1', [tId_loc]);
    const processPayment = async (item, clinicId = null) => {
      if (isMonthlyFinancialSummary(item)) {
        if (await upsertMonthlySummary(pool, 'payment', item, clinicId)) summary.payments++;
        return;
      }
      await upsertFinancial(pool, 'payment', item, tenant_id);
      summary.payments++;
    };
    if (clinics.length === 0) {
      console.warn('[clinicorp sync] payments: nenhuma clínica espelhada para este tenant — pulando');
      return;
    }
    for (const r of ranges) {
      for (const { id: clinicId } of clinics) {
        try {
          const list = await clinicorpApi.listPayments(settings, { from: r.from, to: r.to, clinic_id: clinicId });
          for (const p of (Array.isArray(list) ? list : [])) { await processPayment(p, clinicId); }
        } catch (e) { console.error('[clinicorp sync] financial:', e.message); }
      }
    }
  });

  await safe('cashflow', async () => {
    const ranges = sliceRange(fromDate, toDate);
    const tId_loc = await resolveTenantId(pool, tenant_id);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics WHERE tenant_id=$1', [tId_loc]);
    const processCashflow = async (item, clinicId = null) => {
      if (isMonthlyFinancialSummary(item)) {
        if (await upsertMonthlySummary(pool, 'cashflow', item, clinicId)) summary.cashflow++;
        return;
      }
      await upsertFinancial(pool, 'cashflow', item, tenant_id);
      summary.cashflow++;
    };
    if (clinics.length === 0) {
      console.warn('[clinicorp sync] cashflow: nenhuma clínica espelhada para este tenant — pulando');
      return;
    }
    for (const r of ranges) {
      for (const { id: clinicId } of clinics) {
        try {
          const list = await clinicorpApi.listCashFlow(settings, { from: r.from, to: r.to, clinic_id: clinicId });
          for (const c of (Array.isArray(list) ? list : [])) { await processCashflow(c, clinicId); }
        } catch (e) { console.error('[clinicorp sync] financial:', e.message); }
      }
    }
  });

  await safe('evolutions', async () => {
    // Evoluções geralmente são buscadas por paciente ou período se a API suportar
    // Como estamos espelhando tudo, tentamos buscar por período
    try {
      const list = await clinicorpFetch(settings, '/treatment/evolution/list', { query: { from: fromDate, to: toDate } });
      for (const e of (Array.isArray(list) ? list : [])) { await upsertEvolution(pool, e, tenant_id); summary.evolutions++; }
    } catch (e) { /* skip se endpoint não existir */ }
  });

  await safe('documents', async () => {
    try {
      const list = await clinicorpFetch(settings, '/patient/document/list', { query: { from: fromDate, to: toDate } });
      for (const d of (Array.isArray(list) ? list : [])) { await upsertDocument(pool, d, tenant_id); summary.documents++; }
    } catch (e) { /* skip */ }
  });

  // Força re-projeção final de orçamentos e agendamentos para garantir espelhamento
  try {
    const tId = await resolveTenantId(pool, tenant_id);
    // Agendamentos
    const { rows: appts } = await pool.query(
      `SELECT raw, id FROM clinicorp_appointments WHERE tenant_id=$3 AND date >= $1 AND date <= $2`,
      [fromDate, toDate, tId]
    );
    for (const r of appts) { 
      const raw = typeof r.raw === 'string' ? JSON.parse(r.raw) : r.raw;
      await projectAppointmentToLocal(pool, raw, r.id, tId).catch(() => {}); 
    }
    // Orçamentos
    const { rows: ests } = await pool.query(
      `SELECT raw FROM clinicorp_estimates WHERE tenant_id=$3 AND date >= $1 AND date <= $2`,
      [fromDate, toDate, tId]
    );
    for (const r of ests) {
      const raw = typeof r.raw === 'string' ? JSON.parse(r.raw) : r.raw;
      await projectEstimateToLocal(pool, raw, tId).catch(() => {});
    }
  } catch (e) { console.error('[clinicorp sync] final mirroring projection', e.message); }

  const status = errors.length === 0 ? 'success' : (Object.values(summary).some(Boolean) ? 'partial' : 'error');
  
  // Se forem as globais (carregadas via id=1), atualiza o status na tabela.
  if (settings.id === 1 || (!api_token && settings.id === undefined)) {
    // Verificação de integridade multi-tenant após o sync
    try {
      // Verifica quais tabelas possuem PK simples (id) em vez de composta (id, tenant_id)
      const { rows: pkStatus } = await pool.query(`
        SELECT 
          relname as table_name,
          (SELECT count(*) FROM pg_constraint c 
           WHERE c.conrelid = cl.oid AND c.contype = 'p' 
           AND (SELECT count(*) FROM unnest(c.conkey)) = 1
          ) as has_simple_pk
        FROM pg_class cl
        WHERE relname IN (
          'clinicorp_clinics', 'clinicorp_professionals', 'clinicorp_chairs',
          'clinicorp_appointment_categories', 'clinicorp_specialties', 'clinicorp_patients',
          'clinicorp_appointments', 'clinicorp_estimates', 'clinicorp_evolutions', 'clinicorp_documents'
        )
      `);

      const tablesWithSimplePk = pkStatus.filter(r => r.has_simple_pk > 0).map(r => r.table_name);
      
      if (tablesWithSimplePk.length > 0) {
        errors.push(`PK Integrity: ${tablesWithSimplePk.join(', ')} still using single-column PK`);
        console.error(`[clinicorp sync] Tables still using single-column PK: ${tablesWithSimplePk.join(', ')}`);
      }

      // Verifica se há tenant_id NULL em qualquer uma das tabelas
      const tableList = [
        'clinicorp_clinics', 'clinicorp_professionals', 'clinicorp_chairs',
        'clinicorp_appointment_categories', 'clinicorp_specialties', 'clinicorp_patients',
        'clinicorp_appointments', 'clinicorp_estimates', 'clinicorp_evolutions', 'clinicorp_documents'
      ];
      
      for (const table of tableList) {
        const { rows: nullCount } = await pool.query(`SELECT count(*) as count FROM ${table} WHERE tenant_id IS NULL`);
        if (parseInt(nullCount[0].count) > 0) {
          errors.push(`Data Integrity: ${table} has ${nullCount[0].count} NULL tenant_ids`);
          console.error(`[clinicorp sync] Table ${table} has ${nullCount[0].count} records with NULL tenant_id`);
        }
      }
    } catch (e) {
      console.error('[clinicorp sync] Integrity check failed:', e.message);
    }

    await pool.query(
      `UPDATE clinicorp_settings SET last_sync_at = NOW(), last_sync_status = $1, last_sync_error = $2, updated_at = NOW() WHERE id = 1`,
      [status, errors.length ? errors.join(' | ') : null]
    );
    invalidateSettings();
  }

  try {
    // Desativado re-projeção final forçada em massa
  } catch (e) { console.error('[clinicorp sync] final forced projection', e.message); }

  return { status, summary, errors, from: fromDate, to: toDate };
}


/**
 * Bidirectional Mirroring (Push to Clinicorp)
 */
export const clinicorpPush = {
  log: async (pool, data) => {
    try {
      await pool.query(
        `INSERT INTO clinicorp_push_log (entity_type, local_id, clinicorp_id, action, status, payload, response, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [data.entity, data.local_id, data.clinicorp_id, data.action, data.status,
         data.payload ? JSON.stringify(data.payload) : null,
         data.response ? JSON.stringify(data.response) : null,
         data.error]
      );
    } catch (e) { console.error('[clinicorp push log]', e.message); }
  },

  pushPatient: async (pool, patientId, tenantId = null) => {
    try {
      const s = await loadSettings(pool);
      if (!s?.enabled) return;
      const { rows } = await pool.query('SELECT * FROM pacientes WHERE id = $1', [patientId]);
      const p = rows[0];
      if (!p) return;

      const body = {
        Name: p.nome,
        MobilePhone: p.telefone,
        Email: p.email,
        BirthDate: p.data_nascimento,
        Sex: p.sexo,
        DocumentId: p.cpf,
      };

      if (p.clinicorp_patient_id) {
        const res = await clinicorpApi.updatePatient(s, p.clinicorp_patient_id, body);
        await clinicorpPush.log(pool, { entity: 'patient', local_id: patientId, clinicorp_id: p.clinicorp_patient_id, action: 'update', status: 'success', payload: body, response: res });
      } else {
        const res = await clinicorpApi.createPatient(s, body);
        const cpId = res.id ?? res.Patient_PersonId;
        if (cpId) {
          await pool.query('UPDATE pacientes SET clinicorp_patient_id = $1 WHERE id = $2', [cpId, patientId]);
          await clinicorpPush.log(pool, { entity: 'patient', local_id: patientId, clinicorp_id: cpId, action: 'create', status: 'success', payload: body, response: res });
        }
      }
    } catch (e) {
      await clinicorpPush.log(pool, { entity: 'patient', local_id: patientId, action: 'error', error: e.message });
      console.error('[clinicorp push patient]', e.message);
    }
  },

  pushAppointment: async (pool, appointmentId, tenantId = null) => {
    try {
      const s = await loadSettings(pool);
      if (!s?.enabled) return;
      const { rows } = await pool.query(`
        SELECT a.*, p.clinicorp_patient_id, d.clinicorp_professional_id
        FROM agendamentos a
        LEFT JOIN pacientes p ON a.paciente_id = p.id
        LEFT JOIN dentistas d ON a.dentista_id = d.id
        WHERE a.id = $1
      `, [appointmentId]);
      const a = rows[0];
      if (!a) return;

      const body = {
        PatientId: a.clinicorp_patient_id,
        ProfessionalId: a.clinicorp_professional_id,
        Date: a.data,
        FromTime: a.hora,
        Notes: a.observacoes,
        Status: a.status,
      };

      if (a.clinicorp_appointment_id) {
        const res = await clinicorpApi.updateAppointment(s, a.clinicorp_appointment_id, body);
        await clinicorpPush.log(pool, { entity: 'appointment', local_id: appointmentId, clinicorp_id: a.clinicorp_appointment_id, action: 'update', status: 'success', payload: body, response: res });
      } else {
        const res = await clinicorpApi.createAppointment(s, body);
        const cpId = res.id ?? res.AppointmentId;
        if (cpId) {
          await pool.query('UPDATE agendamentos SET clinicorp_appointment_id = $1 WHERE id = $2', [cpId, appointmentId]);
          await clinicorpPush.log(pool, { entity: 'appointment', local_id: appointmentId, clinicorp_id: cpId, action: 'create', status: 'success', payload: body, response: res });
        }
      }
    } catch (e) {
      await clinicorpPush.log(pool, { entity: 'appointment', local_id: appointmentId, action: 'error', error: e.message });
      console.error('[clinicorp push appointment]', e.message);
    }
  },

  deleteAppointment: async (pool, appointmentId) => {
    try {
      const s = await loadSettings(pool);
      if (!s?.enabled) return;
      const { rows } = await pool.query('SELECT clinicorp_appointment_id FROM agendamentos WHERE id = $1', [appointmentId]);
      const cpId = rows[0]?.clinicorp_appointment_id;
      if (cpId) {
        await clinicorpApi.deleteAppointment(s, cpId);
        await clinicorpPush.log(pool, { entity: 'appointment', local_id: appointmentId, clinicorp_id: cpId, action: 'delete', status: 'success' });
      }
    } catch (e) {
      console.error('[clinicorp delete appointment]', e.message);
    }
  }
};

/**

 * Tick de reconciliação agendada.
 * - Usa lock no Postgres para evitar execução concorrente / múltiplas instâncias.
 * - Catch-up automático após interrupções: se last_sync_at é antigo, alarga a janela.
 */
export async function reconciliationTick(pool) {
  // 1. GLOBAL SYNC (Legacy/Admin)
  const claimGlobal = await pool.query(
    `UPDATE clinicorp_settings SET sync_lock_until = NOW() + INTERVAL '15 minutes',
       next_sync_at = NOW() + (COALESCE(sync_interval_minutes, 30) || ' minutes')::interval,
       updated_at = NOW()
     WHERE id = 1
       AND COALESCE(enabled, false) = true
       AND api_token IS NOT NULL AND subscriber_id IS NOT NULL
       AND (sync_lock_until IS NULL OR sync_lock_until < NOW())
       AND (next_sync_at   IS NULL OR next_sync_at   <= NOW())
     RETURNING id, last_sync_at, sync_lookback_days, sync_lookahead_days`
  );

  const results = [];

  if (claimGlobal.rows[0]) {
    const cfg = claimGlobal.rows[0];
    const today = new Date();
    const from = new Date(today.getTime() - (cfg.sync_lookback_days ?? 30) * 86400_000).toISOString().slice(0, 10);
    const to   = new Date(today.getTime() + (cfg.sync_lookahead_days ?? 60) * 86400_000).toISOString().slice(0, 10);
    console.log(`[clinicorp] auto-reconcile global rodando ${from} → ${to}`);
    try {
      const r = await runFullSync(pool, { from, to });
      await runFinancialReconciliation(pool);
      await pool.query(`UPDATE clinicorp_settings SET sync_lock_until = NULL, last_sync_at = NOW() WHERE id = 1`);
      results.push({ type: 'global', ...r });
    } catch (e) {
      console.error('[clinicorp] global tick error:', e.message);
      await pool.query(`UPDATE clinicorp_settings SET sync_lock_until = NULL WHERE id = 1`);
    }
  }

  // 2. PER-USER SYNC (SaaS SaaS)
  const usersToSync = await pool.query(
    `SELECT s.user_id, p.tenant_id
     FROM clinicorp_user_settings s
     JOIN profiles p ON p.id = s.user_id
     WHERE s.enabled = true 
       AND s.api_token IS NOT NULL 
       AND s.subscriber_id IS NOT NULL
       AND (s.last_sync_at IS NULL OR s.last_sync_at < NOW() - INTERVAL '30 minutes')
     LIMIT 5` // Sincroniza até 5 usuários por tick para evitar sobrecarga
  );

  for (const u of usersToSync.rows) {
    const today = new Date();
    const from = new Date(today.getTime() - 7 * 86400_000).toISOString().slice(0, 10); // SaaS: janela menor (7 dias) por performance
    const to   = new Date(today.getTime() + 14 * 86400_000).toISOString().slice(0, 10);
    console.log(`[clinicorp] auto-reconcile user ${u.user_id} rodando ${from} → ${to}`);
    try {
      const r = await runFullSync(pool, { from, to, user_id: u.user_id, tenant_id: u.tenant_id });
      await pool.query(`UPDATE clinicorp_user_settings SET last_sync_at = NOW(), last_sync_status = 'success' WHERE user_id = $1`, [u.user_id]);
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
          period_month,
          SUM(CASE WHEN source = 'payment' THEN total_amount ELSE 0 END) as total_payments,
          SUM(CASE WHEN source = 'cashflow' THEN total_in ELSE 0 END) as total_cash_in
        FROM clinicorp_monthly_summary
        WHERE period_month >= NOW() - INTERVAL '3 months'
        GROUP BY period_month
      )
      SELECT 
        period_month,
        total_payments,
        total_cash_in,
        ABS(total_payments - total_cash_in) as divergence,
        CASE 
          WHEN ABS(total_payments - total_cash_in) > 0.01 THEN true 
          ELSE false 
        END as has_divergence
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
      console.warn(`[clinicorp alert] Divergência financeira detectada em ${period}: Payments R$ ${tp.toFixed(2)} vs Cashflow R$ ${tc.toFixed(2)} (Diff: R$ ${dv.toFixed(2)})`);

      await pool.query(
        `INSERT INTO clinicorp_webhook_events (event_type, status, payload, received_at)
         VALUES ($1, $2, $3, NOW())`,
        ['financial_divergence_alert', 'processed', JSON.stringify({ ...alert, period_month: period, total_payments: tp, total_cash_in: tc, divergence: dv })]
      );
    }

    return { alerts_count: alerts.length, alerts };
  } catch (e) {
    console.error('[clinicorp] falha na reconciliação financeira:', e.message);
    return { error: e.message };
  }
}

// ─── Webhook event processor ──────────────────────────────────
async function processWebhookEvent(pool, event) {
  // Clinicorp envia eventos heterogêneos. Tentamos inferir o tipo.
  const type = (event?.event || event?.Event || event?.type || event?.action || '').toString().toLowerCase();
  const data = event?.data || event?.Data || event?.payload || event;

  if (!data || typeof data !== 'object') return { handled: false };

  // Agendamento
  if (type.includes('appointment') || data.AppointmentId || data.Patient_PersonId && (data.FromTime || data.Date)) {
    if (type.includes('deleted') || type.includes('cancel')) {
      const id = data.id ?? data.AppointmentId;
      if (id) {
        await pool.query(`UPDATE clinicorp_appointments SET status = 'DELETED_IN_CLINICORP', synced_at = NOW() WHERE id = $1`, [id]);
        await pool.query(`UPDATE agendamentos SET status = 'cancelado', updated_at = NOW() WHERE clinicorp_appointment_id = $1`, [String(id)]);
        return { handled: true, target: 'appointment_deleted' };
      }
    }
    await upsertAppointment(pool, data);
    return { handled: true, target: 'appointment' };
  }

  // Paciente
  if (type.includes('patient') || (data.Patient_PersonId && data.Name && !data.FromTime)) {
    await upsertPatient(pool, data);
    return { handled: true, target: 'patient' };
  }

  // Evolução / Prontuário
  if (type.includes('evolution') || data.EvolutionId) {
    await upsertEvolution(pool, data);
    return { handled: true, target: 'evolution' };
  }

  // Documento / Anexo
  if (type.includes('document') || data.DocumentId || data.FileUrl) {
    await upsertDocument(pool, data);
    return { handled: true, target: 'document' };
  }

  // Orçamento / tratamento
  if (type.includes('estimate') || type.includes('treatment') || data.TreatmentId) {
    await upsertEstimate(pool, data);
    return { handled: true, target: 'estimate' };
  }

  // Financeiro
  if (type.includes('payment') || type.includes('invoice') || type.includes('cashflow')) {
    const src = type.includes('invoice') ? 'invoice' : type.includes('cashflow') ? 'cashflow' : 'payment';
    await upsertFinancial(pool, src, data);
    return { handled: true, target: src };
  }

  return { handled: false, reason: 'tipo de evento desconhecido' };
}

// ─── Express routes ───────────────────────────────────────────
export function registerClinicorp(app, pool) {
  // ── Webhook receiver (público; protegido por ?user_api=<webhook_secret>) ──
  app.post('/api/webhook/clinicorp', async (req, res) => {
    const startedAt = Date.now();
    let eventId = null;
    try {
      const settings = await loadSettings(pool);
      const userApi = (req.query.user_api || req.headers['x-user-api'] || '').toString();
      if (!settings?.webhook_secret || userApi !== settings.webhook_secret) {
        return res.status(401).json({ error: 'unauthorized' });
      }

      const payload = req.body || {};
      const event = Array.isArray(payload) ? payload[0] : payload;
      const eventType = (event?.event || event?.Event || event?.type || event?.action || 'unknown').toString();
      const externalId = String(event?.id || event?.Id || event?.AppointmentId || event?.Patient_PersonId || event?.TreatmentId || '') || null;

      const ins = await pool.query(
        `INSERT INTO clinicorp_webhook_events (event_type, external_id, status, payload, headers, ip)
         VALUES ($1, $2, 'received', $3, $4, $5) RETURNING id`,
        [eventType, externalId, JSON.stringify(payload), JSON.stringify(req.headers), req.ip]
      );
      eventId = ins.rows[0].id;

      let result;
      try {
        result = await processWebhookEvent(pool, event);
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

  // ── Settings (admin) ─────────────────────────────────────────
  app.get('/api/clinicorp/settings', async (_req, res) => {
    try {
      const s = await loadSettings(pool, true);
      res.json({
        enabled: s?.enabled ?? false,
        subscriber_id: s?.subscriber_id || '',
        base_url: s?.base_url || DEFAULT_BASE_URL,
        has_api_token: Boolean(s?.api_token),
        has_webhook_secret: Boolean(s?.webhook_secret),
        webhook_secret_preview: s?.webhook_secret ? `${s.webhook_secret.slice(0, 4)}…${s.webhook_secret.slice(-4)}` : '',
        last_sync_at: s?.last_sync_at,
        last_sync_status: s?.last_sync_status,
        last_sync_error: s?.last_sync_error,
        auto_sync_enabled: s?.auto_sync_enabled ?? true,
        sync_interval_minutes: s?.sync_interval_minutes ?? 30,
        sync_lookback_days: s?.sync_lookback_days ?? 30,
        sync_lookahead_days: s?.sync_lookahead_days ?? 60,
        next_sync_at: s?.next_sync_at,
        sync_lock_until: s?.sync_lock_until,
        conflict_strategy: s?.conflict_strategy || 'newest_wins',
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/clinicorp/settings', async (req, res) => {
    try {
      const { enabled, api_token, subscriber_id, webhook_secret, base_url,
              auto_sync_enabled, sync_interval_minutes, sync_lookback_days, sync_lookahead_days,
              conflict_strategy } = req.body || {};
      const validStrategy = ['clinicorp_wins','local_wins','newest_wins'].includes(conflict_strategy)
        ? conflict_strategy : null;
      await pool.query(
        `UPDATE clinicorp_settings SET
           enabled = COALESCE($1, enabled),
           api_token = COALESCE(NULLIF($2, ''), api_token),
           subscriber_id = COALESCE($3, subscriber_id),
           webhook_secret = COALESCE(NULLIF($4, ''), webhook_secret),
           base_url = COALESCE($5, base_url),
           auto_sync_enabled = COALESCE($6, auto_sync_enabled),
           sync_interval_minutes = COALESCE($7, sync_interval_minutes),
          sync_lookback_days = COALESCE($8, sync_lookback_days),
          sync_lookahead_days = COALESCE($9, sync_lookahead_days),
          next_sync_at = NOW(), -- Força sincronização imediata após salvar
          sync_lock_until = NULL,
           conflict_strategy = COALESCE($10, conflict_strategy),
           updated_at = NOW()
         WHERE id = 1`,
        [
          typeof enabled === 'boolean' ? enabled : null,
          api_token ?? '',
          subscriber_id ?? null,
          webhook_secret ?? '',
          base_url ?? null,
          typeof auto_sync_enabled === 'boolean' ? auto_sync_enabled : null,
          Number.isFinite(sync_interval_minutes) ? sync_interval_minutes : null,
          Number.isFinite(sync_lookback_days) ? sync_lookback_days : null,
          Number.isFinite(sync_lookahead_days) ? sync_lookahead_days : null,
          validStrategy,
        ]
      );
      invalidateSettings();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Test connection ──────────────────────────────────────────
  app.post('/api/clinicorp/test', async (_req, res) => {
    try {
      const s = await loadSettings(pool, true);
      if (!s?.api_token || !s?.subscriber_id) return res.status(400).json({ ok: false, error: 'Configure api_token e subscriber_id' });
      const clinics = await clinicorpApi.listClinics(s);
      res.json({ ok: true, clinics_count: Array.isArray(clinics) ? clinics.length : 0, sample: Array.isArray(clinics) ? clinics.slice(0, 3) : clinics });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message, details: e.body });
    }
  });

  // ── Manual sync ──────────────────────────────────────────────
  app.post('/api/clinicorp/sync', async (req, res) => {
    try {
      const result = await runFullSync(pool, { 
        from: req.body?.from, 
        to: req.body?.to,
        force_metadata: req.body?.force_metadata === true 
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Forçar reconciliação agora (reseta next_sync_at) ─────────
  app.post('/api/clinicorp/reconcile', async (_req, res) => {
    try {
      await pool.query(`UPDATE clinicorp_settings SET next_sync_at = NOW(), sync_lock_until = NULL WHERE id = 1`);
      invalidateSettings();
      const r = await reconciliationTick(pool);
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Helper: extrai tenant_id do JWT do request (sem dep externa)
  const tenantOf = async (req) => {
    try {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ')) return await resolveTenantId(pool, null);
      const token = auth.slice(7);
      const part = token.split('.')[1];
      if (!part) return await resolveTenantId(pool, null);
      const payload = JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
      return payload.tenant_id || await resolveTenantId(pool, null);
    } catch { return await resolveTenantId(pool, null); }
  };

  // ── Local read-only data (espelho) — escopo por tenant ───────
  app.get('/api/clinicorp/clinics', async (req, res) => {
    const tId = await tenantOf(req);
    const { rows } = await pool.query('SELECT * FROM clinicorp_clinics WHERE tenant_id=$1 ORDER BY name', [tId]);
    res.json(rows);
  });
  app.get('/api/clinicorp/professionals', async (req, res) => {
    const tId = await tenantOf(req);
    const { rows } = await pool.query(`
      SELECT cp.*, d.id as local_id, d.ativo as local_ativo, d.cor_agenda as local_cor
      FROM clinicorp_professionals cp
      LEFT JOIN dentistas d ON d.clinicorp_professional_id::text = cp.id::text AND d.tenant_id = cp.tenant_id
      WHERE cp.tenant_id = $1
      ORDER BY cp.full_name
    `, [tId]);
    res.json(rows);
  });
  app.get('/api/clinicorp/categories', async (req, res) => {
    const tId = await tenantOf(req);
    const { rows } = await pool.query('SELECT * FROM clinicorp_appointment_categories WHERE tenant_id=$1 ORDER BY description', [tId]);
    res.json(rows);
  });
  app.get('/api/clinicorp/specialties', async (req, res) => {
    const tId = await tenantOf(req);
    const { rows } = await pool.query('SELECT * FROM clinicorp_specialties WHERE tenant_id=$1 ORDER BY description', [tId]);
    res.json(rows);
  });
  app.get('/api/clinicorp/patients', async (req, res) => {
    const tId = await tenantOf(req);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
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
  });
  app.get('/api/clinicorp/appointments', async (req, res) => {
    const tId = await tenantOf(req);
    const { from, to, professional_id, business_id } = req.query;
    const where = ['tenant_id = $1'];
    const params = [tId];
    if (from) { params.push(from); where.push(`date >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`date <= $${params.length}`); }
    if (professional_id) { params.push(professional_id); where.push(`professional_id = $${params.length}`); }
    if (business_id) { params.push(business_id); where.push(`business_id = $${params.length}`); }
    const sql = `SELECT * FROM clinicorp_appointments WHERE ${where.join(' AND ')} ORDER BY date, from_time LIMIT 2000`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  });
  app.get('/api/clinicorp/estimates', async (req, res) => {
    const tId = await tenantOf(req);
    const { rows } = await pool.query('SELECT * FROM clinicorp_estimates WHERE tenant_id=$1 ORDER BY date DESC LIMIT 500', [tId]);
    res.json(rows);
  });
  app.get('/api/clinicorp/financial', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await pool.query('SELECT * FROM clinicorp_financial_entries ORDER BY date DESC LIMIT $1', [limit]);
    res.json(rows);
  });
  app.get('/api/clinicorp/financial/monthly-summary', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await pool.query('SELECT * FROM clinicorp_monthly_summary ORDER BY period_month DESC, source LIMIT $1', [limit]);
    res.json(rows);
  });
  app.get('/api/clinicorp/chairs', async (req, res) => {
    const tId = await tenantOf(req);
    const { rows } = await pool.query('SELECT * FROM clinicorp_chairs WHERE tenant_id=$1 ORDER BY name', [tId]);
    res.json(rows);
  });

  // ── Webhook events log ───────────────────────────────────────
  app.get('/api/clinicorp/webhook-events', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await pool.query(
      `SELECT id, event_type, external_id, status, error_message, received_at, processed_at
         FROM clinicorp_webhook_events
         ORDER BY received_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  });

  app.get('/api/clinicorp/webhook-events/:id', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_webhook_events WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  });

  // ── Live API passthrough (sem persistir) ─────────────────────
  app.get('/api/clinicorp/live/available-times', async (req, res) => {
    try {
      const s = await loadSettings(pool);
      if (!s?.enabled) return res.status(400).json({ error: 'Clinicorp desabilitado' });
      const { professionalId, clinicId, fromDate, toDate } = req.query;
      const data = await clinicorpApi.listAvailableTimes(s, professionalId, clinicId, fromDate, toDate);
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Debug: probe /appointment/list with arbitrary params ──
  app.get('/api/clinicorp/debug/probe-appointments', async (req, res) => {
    try {
      const s = await loadSettings(pool);
      if (!s?.enabled) return res.status(400).json({ error: 'Clinicorp desabilitado' });
      const { from = '2026-05-19', to = '2026-05-19' } = req.query;
      const variants = [
        { label: 'no_params', q: {} },
        { label: 'fromDate_toDate', q: { fromDate: from, toDate: to } },
        { label: 'from_to', q: { from, to } },
        { label: 'date_from_date_to', q: { date_from: from, date_to: to } },
        { label: 'startDate_endDate', q: { startDate: from, endDate: to } },
        { label: 'start_date_end_date', q: { start_date: from, end_date: to } },
        { label: 'initialDate_finalDate', q: { initialDate: from, finalDate: to } },
        { label: 'dateStart_dateEnd', q: { dateStart: from, dateEnd: to } },
        { label: 'date_eq', q: { date: from } },
        { label: 'AtomicDate', q: { AtomicDate: from.replace(/-/g,'') } },
        { label: 'SK_DateFirstTime', q: { SK_DateFirstTime: from.replace(/-/g,'') } },
      ];
      const results = [];
      for (const v of variants) {
        try {
          const data = await clinicorpFetch(s, '/appointment/list', { query: v.q });
          const arr = Array.isArray(data) ? data : (data?.appointments || data?.data || data?.result || data?.items || []);
          const dates = [...new Set(arr.map(a => a.date || a.Date).filter(Boolean))].sort();
          results.push({ label: v.label, q: v.q, count: arr.length, dates: dates.slice(0, 10), hasTarget: dates.includes(from) });
        } catch (e) {
          results.push({ label: v.label, q: v.q, error: e.message });
        }
      }
      res.json({ from, to, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/clinicorp/live/create-appointment', async (req, res) => {
    try {
      const s = await loadSettings(pool);
      if (!s?.enabled) return res.status(400).json({ error: 'Clinicorp desabilitado' });
      const data = await clinicorpApi.createAppointment(s, { subscriber_id: s.subscriber_id, ...(req.body || {}) });
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message, details: e.body }); }
  });

  // ── Re-projeta espelho atual nas tabelas locais (pacientes/dentistas/agendamentos/crm_leads) ──
  app.post('/api/clinicorp/reproject', async (req, res) => {
    try {
      const tId = await tenantOf(req);
      const { rows: pats } = await pool.query('SELECT raw FROM clinicorp_patients WHERE tenant_id = $1', [tId]);
      let patients = 0, appts = 0;
      for (const r of pats) { 
        try { 
          const raw = typeof r.raw === 'string' ? JSON.parse(r.raw) : r.raw;
          await projectPatientToLocal(pool, raw, tId); 
          patients++; 
        } catch (e) { console.error('[reproject] patient', e.message); } 
      }
      const { rows: aps } = await pool.query('SELECT id, raw FROM clinicorp_appointments WHERE tenant_id = $1', [tId]);
      for (const r of aps) { 
        try { 
          const raw = typeof r.raw === 'string' ? JSON.parse(r.raw) : r.raw;
          await projectAppointmentToLocal(pool, raw, r.id, tId); 
          appts++; 
        } catch (e) { console.error('[reproject] appt', e.message); } 
      }
      res.json({ ok: true, patients, appointments: appts });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Conflict overrides (global / clinic / professional) ─────
  app.get('/api/clinicorp/overrides', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, scope_type, scope_id, keep_local, conflict_strategy, note, updated_at
           FROM clinicorp_local_overrides ORDER BY scope_type, scope_id`
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/clinicorp/overrides', async (req, res) => {
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
           changed.length ? changed : null, req.user?.email || req.user?.id || 'system', note || null]
        );
      }

      res.json({ ok: true, override: next });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/clinicorp/overrides/:id', async (req, res) => {
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
          [prev.id, prev.scope_type, prev.scope_id, JSON.stringify(prev), req.user?.email || req.user?.id || 'system']
        );
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Histórico de alterações dos overrides
  app.get('/api/clinicorp/overrides/history', async (req, res) => {
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
      await pool.query(`UPDATE ${table} SET keep_local=$1, updated_at=NOW() WHERE id=$2`,
        [Boolean(keep_local), id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Auto-sync manual trigger (force:true reseta lock/next_sync_at) ──
  app.post('/api/clinicorp/sync/auto', async (req, res) => {
    try {
      if (req.body?.force === true) {
        await pool.query(`UPDATE clinicorp_settings SET next_sync_at = NOW(), sync_lock_until = NULL WHERE id = 1`);
        invalidateSettings();
      }
      const result = await reconciliationTick(pool);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Unified Audit Log (Webhook + Push) ──
  app.get('/api/clinicorp/audit-log', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const { rows } = await pool.query(`
        (
          SELECT 
            id, 'clinicorp' as source, event_type as event, status, 
            external_id as target_id, received_at as timestamp, payload, error_message
          FROM clinicorp_webhook_events
          ORDER BY received_at DESC
          LIMIT $1
        )
        UNION ALL
        (
          SELECT 
            id, 'odonto_connect' as source, action as event, status, 
            clinicorp_id as target_id, created_at as timestamp, payload, error_message
          FROM clinicorp_push_log
          ORDER BY created_at DESC
          LIMIT $1
        )
        ORDER BY timestamp DESC
        LIMIT $1
      `, [limit]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Rodar SÓ a reconciliação financeira (sem refazer sync) ──
  app.post('/api/clinicorp/reconcile-financial', async (_req, res) => {
    try {
      const result = await runFinancialReconciliation(pool);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('🦷 Clinicorp routes registered');
}
