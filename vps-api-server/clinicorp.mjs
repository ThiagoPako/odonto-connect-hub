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
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
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

// ─── HTTP client ──────────────────────────────────────────────
async function clinicorpFetch(settings, pathName, { method = 'GET', query = {}, body } = {}) {
  if (!settings?.api_token) {
    throw new Error('Clinicorp: api_token não configurado');
  }
  const base = (settings.base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = new URL(base + pathName);
  
  // Limpar query parameters vazios ou nulos para evitar erros na API do Clinicorp
  const allQuery = { ...query };
  if (settings.subscriber_id && allQuery.subscriber_id === undefined) {
    allQuery.subscriber_id = settings.subscriber_id;
  }
  
  for (const [k, v] of Object.entries(allQuery)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const requestOnce = async (authMode) => {
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
      if (!res.ok) {
        const err = new Error(`Clinicorp ${method} ${pathName} → HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
        err.status = res.status;
        err.body = data;
        err.authMode = authMode;
        throw err;
      }
      return data;
    };

    try {
      return await requestOnce('basic');
    } catch (err) {
      if (err?.status === 401) return await requestOnce('bearer');
      throw err;
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ─── High-level API helpers ───────────────────────────────────
export const clinicorpApi = {
  listUsers: async (s) => {
    // A API Clinicorp pode retornar lista direta, ou envelope {Results|Users|Items|data}.
    // Tentamos múltiplos endpoints porque alguns subscribers expõem rotas distintas.
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
  listClinics: (s) => clinicorpFetch(s, '/business/list'),
  listSubscribersClinics: (s) => clinicorpFetch(s, '/group/list_subscribers_clinics'),
  listChairs: (s, businessId) => clinicorpFetch(s, '/business/list_chairs', { query: { Clinic_BusinessId: businessId } }),
  listAvailableTimes: (s, professionalId, clinicId, fromDate, toDate) =>
    clinicorpFetch(s, '/business/list_available_times', {
      query: { professionalId, clinicId, fromDate, toDate },
    }),
  listAppointmentCategories: (s) => clinicorpFetch(s, '/appointment/list_categories'),
  listSpecialties: (s) => clinicorpFetch(s, '/procedures/list_specialties'),
  listAppointments: (s, from, to, businessId) =>
    clinicorpFetch(s, '/appointment/list', { query: { from, to, business_id: businessId } }),
  appointmentStatusList: (s) => clinicorpFetch(s, '/appointment/status_list'),
  changeAppointmentStatus: (s, query) => clinicorpFetch(s, '/appointment/change_status', { query }),
  confirmAppointment: (s, body) => clinicorpFetch(s, '/appointment/confirm_appointment', { method: 'POST', body }),
  cancelAppointment: (s, body) => clinicorpFetch(s, '/appointment/cancel_appointment', { method: 'POST', body }),
  createAppointment: (s, body) => clinicorpFetch(s, '/appointment/create_appointment_by_api', { method: 'POST', body }),
  createOnlineScheduling: (s, body) => clinicorpFetch(s, '/appointment/create_online_scheduling', { method: 'POST', body }),
  getAvailableDays: (s, query) => clinicorpFetch(s, '/appointment/get_avaliable_days', { query }),
  getAvailableTimesCalendar: (s, query) => clinicorpFetch(s, '/appointment/get_avaliable_times_calendar', { query }),
  getPatient: (s, id) => clinicorpFetch(s, '/patient/get', { query: { id } }),
  listPatients: (s) => clinicorpFetch(s, '/patient/list'),
  patientBirthdays: (s, query) => clinicorpFetch(s, '/patient/birthdays', { query }),
  createPatient: (s, body) => clinicorpFetch(s, '/patient/create', { method: 'POST', body }),
  patientAppointments: (s, patientId) => clinicorpFetch(s, '/patient/list_appointments', { query: { patient_id: patientId } }),
  patientEstimates: (s, patientId) => clinicorpFetch(s, '/patient/list_estimates', { query: { patient_id: patientId } }),
  listEstimates: (s, from, to, clinicId) => clinicorpFetch(s, '/estimates/list', { query: { from, to, clinic_id: clinicId } }),
  getEstimate: (s, treatmentId) => clinicorpFetch(s, '/estimates/get', { query: { treatment_id: treatmentId } }),
  analytics: (s, from, to) => clinicorpFetch(s, '/analytics/list_results', { query: { from, to } }),
  listInvoices: (s, query) => clinicorpFetch(s, '/financial/list_invoices', { query }),
  listCashFlow: (s, query) => clinicorpFetch(s, '/financial/list_cash_flow', { query }),
  listPayments: (s, query) => clinicorpFetch(s, '/financial/list_payments', { query }),
  salesEstimatesAndConversion: (s, query) => clinicorpFetch(s, '/sales/estimates_and_conversion', { query }),
  salesExpertiseRevenue: (s, query) => clinicorpFetch(s, '/sales/expertise_revenue', { query }),
  addLead: (s, body) => clinicorpFetch(s, '/crm/add_leads', { method: 'POST', body }),
};

// ─── Upserts ──────────────────────────────────────────────────
async function upsertClinic(pool, c) {
  await pool.query(
    `INSERT INTO clinicorp_clinics
       (id, company_id, business_name, name, email, address, active,
        landline, other_landline, slot_time, no_limit_apt_same_time,
        subscriber_business_uid, working_days_hours, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
     ON CONFLICT (id) DO UPDATE SET
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
      c.id ?? c.CompanyId, c.CompanyId ?? null, c.BusinessName ?? null,
      c.Name ?? null, c.Email ?? null, c.Address ?? null, c.Active ?? null,
      c.Landline ?? null, c.OtherLandline ?? null, c.SlotTime ?? null,
      c.NoLimitAptSameTime ?? null, c.SubscriberBussinessUID ?? null,
      c.WorkingDaysHours ? JSON.stringify(c.WorkingDaysHours) : null,
      JSON.stringify(c),
    ]
  );
}

async function upsertProfessional(pool, p) {
  const id = p.id ?? p.Id ?? p.UserId ?? p.PersonId ?? null;
  if (!id) return;
  const fullName = p.FullName ?? p.Name ?? p.UserName ?? p.full_name ?? `Profissional ${id}`;
  const userName = p.UserName ?? p.Username ?? p.Email ?? null;
  await pool.query(
    `INSERT INTO clinicorp_professionals (id, full_name, user_name, raw, synced_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       user_name = EXCLUDED.user_name,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [String(id), fullName, userName, JSON.stringify(p)]
  );
}

async function upsertChair(pool, c) {
  await pool.query(
    `INSERT INTO clinicorp_chairs (id, business_id, name, raw, synced_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       business_id = EXCLUDED.business_id,
       name = EXCLUDED.name,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [c.id, c.BusinessId ?? null, c.Name ?? null, JSON.stringify(c)]
  );
}

async function upsertCategory(pool, c) {
  await pool.query(
    `INSERT INTO clinicorp_appointment_categories (id, description, color, raw, synced_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       description = EXCLUDED.description,
       color = EXCLUDED.color,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [c.id, c.Description ?? null, c.Color ?? null, JSON.stringify(c)]
  );
}

async function upsertSpecialty(pool, s) {
  await pool.query(
    `INSERT INTO clinicorp_specialties (id, description, raw, synced_at)
     VALUES ($1,$2,$3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       description = EXCLUDED.description,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [s.id, s.Description ?? s.Name ?? null, JSON.stringify(s)]
  );
}

async function upsertPatient(pool, p) {
  await pool.query(
    `INSERT INTO clinicorp_patients
       (id, name, email, mobile_phone, birth_date, sex, document_id, notes, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
     ON CONFLICT (id) DO UPDATE SET
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
      p.id ?? p.Patient_PersonId, p.Name ?? null, p.Email ?? null,
      String(p.MobilePhone ?? '') || null,
      p.BirthDate || null, p.Sex ?? null,
      String(p.DocumentId ?? '') || null, p.Notes ?? null,
      JSON.stringify(p),
    ]
  );
  try { await projectPatientToLocal(pool, p); }
  catch (e) { console.error('[clinicorp] projectPatientToLocal:', e.message); }
}

async function upsertAppointment(pool, a) {
  const id = a.id ?? a.AppointmentId ?? a.Id;
  if (!id) return;
  await pool.query(
    `INSERT INTO clinicorp_appointments
       (id, business_id, patient_id, patient_name, professional_id, professional_name,
        category_id, category_description, category_color, chair_id,
        status, date, from_time, to_time, notes, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
     ON CONFLICT (id) DO UPDATE SET
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
      id,
      a.BusinessId ?? a.Clinic_BusinessId ?? null,
      a.PatientId ?? a.Patient_PersonId ?? null,
      a.PatientName ?? null,
      a.ProfessionalId ?? a.Dentist_PersonId ?? a.ScheduleToId ?? null,
      a.ProfessionalName ?? a.DentistName ?? a.ScheduleToName ?? a.Dentist?.Name ?? null,
      a.CategoryId ?? a.Category_id ?? null,
      a.CategoryDescription ?? a.Category ?? null,
      a.CategoryColor ?? a.Color ?? null,
      a.ChairId ?? null,
      a.Status ?? a.StatusId ?? null,
      a.Date || a.AppointmentDate || a.date || null,
      a.FromTime ?? a.StartTime ?? a.fromTime ?? null,
      a.ToTime ?? a.EndTime ?? a.toTime ?? null,
      a.Notes ?? a.notes ?? null,
      JSON.stringify(a),
    ]
  );
  try { await projectAppointmentToLocal(pool, a, id); }
  catch (e) { console.error('[clinicorp] projectAppointmentToLocal:', e.message); }
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

async function ensureLocalPatient(pool, cpId, fallback = {}, tenantId = null) {
  if (!cpId) return null;
  const found = await pool.query(`SELECT id FROM pacientes WHERE clinicorp_patient_id = $1 LIMIT 1`, [cpId]);
  const cp = await pool.query(`SELECT * FROM clinicorp_patients WHERE id = $1`, [cpId]);
  const src = cp.rows[0] || {};
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
         sexo=COALESCE($6,sexo), cpf=COALESCE(NULLIF(cpf,''),$7), updated_at=NOW() WHERE id=$1`,
      [found.rows[0].id, nome, telefone, email, nascimento, sexo, cpf]
    );
    return found.rows[0].id;
  }
  let matchId = null;
  if (telefone) {
    const r = await pool.query(`SELECT id FROM pacientes WHERE telefone=$1 LIMIT 1`, [telefone]);
    matchId = r.rows[0]?.id || null;
  }
  if (!matchId && cpf) {
    const r = await pool.query(`SELECT id FROM pacientes WHERE cpf=$1 LIMIT 1`, [cpf]);
    matchId = r.rows[0]?.id || null;
  }
  if (matchId) {
    await pool.query(`UPDATE pacientes SET clinicorp_patient_id=$1, updated_at=NOW() WHERE id=$2`, [cpId, matchId]);
    return matchId;
  }
  const tId = await resolveTenantId(pool, tenantId);
  const ins = await pool.query(
    `INSERT INTO pacientes (nome, telefone, email, data_nascimento, sexo, cpf, clinicorp_patient_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [nome, telefone, email, nascimento, sexo, cpf, cpId, tId]
  );
  return ins.rows[0].id;
}

async function ensureLocalProfessional(pool, cpProfId, fallbackName = null, tenantId = null) {
  if (!cpProfId) return null;
  const found = await pool.query(`SELECT id FROM dentistas WHERE clinicorp_professional_id=$1 LIMIT 1`, [cpProfId]);
  if (found.rows[0]) return found.rows[0].id;
  const cp = await pool.query(`SELECT * FROM clinicorp_professionals WHERE id=$1`, [cpProfId]);
  const nome = cp.rows[0]?.full_name || fallbackName || `Profissional ${cpProfId}`;
  const match = await pool.query(`SELECT id FROM dentistas WHERE LOWER(nome)=LOWER($1) LIMIT 1`, [nome]);
  if (match.rows[0]) {
    await pool.query(`UPDATE dentistas SET clinicorp_professional_id=$1, updated_at=NOW() WHERE id=$2`, [cpProfId, match.rows[0].id]);
    return match.rows[0].id;
  }
  const tId = await resolveTenantId(pool, tenantId);
  const ins = await pool.query(
    `INSERT INTO dentistas (nome, ativo, clinicorp_professional_id, tenant_id) VALUES ($1, true, $2, $3) RETURNING id`,
    [nome, cpProfId, tId]
  );
  return ins.rows[0].id;
}

async function ensureLeadForPatient(pool, pacienteId, cpPatientId, info = {}) {
  if (!pacienteId) return null;
  const existing = await pool.query(
    `SELECT id, kanban_stage FROM crm_leads WHERE paciente_id=$1 OR clinicorp_patient_id=$2 LIMIT 1`,
    [pacienteId, cpPatientId]
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
  const tenantId = await resolveTenantId(pool);
  const ins = await pool.query(
    `INSERT INTO crm_leads (nome, telefone, email, origem, status, kanban_stage, paciente_id, clinicorp_patient_id, tenant_id)
     VALUES ($1,$2,$3,'clinicorp','paciente_agendado','paciente_agendado',$4,$5,$6) RETURNING id`,
    [info.nome || 'Paciente Clinicorp', info.telefone || null, info.email || null, pacienteId, cpPatientId, tenantId]
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

async function projectAppointmentToLocal(pool, a, cpApptId) {
  const cpPatientId = a.PatientId ?? a.Patient_PersonId ?? null;
  const cpProfId = a.ProfessionalId ?? a.Dentist_PersonId ?? a.ScheduleToId ?? null;
  const cpClinicId = a.BusinessId ?? a.Clinic_BusinessId ?? a.ClinicId ?? null;
  const cpUpdatedAt = a.UpdateDate || a.UpdatedAt || a.LastModified || a.ModifiedAt || a.z_LastChange_Date || a.ModifiedDate || null;
  const policy = await resolveConflictPolicy(pool, { clinicId: cpClinicId, professionalId: cpProfId });

  const pacienteId = await ensureLocalPatient(pool, cpPatientId, {
    name: a.PatientName, phone: a.PatientPhone || a.MobilePhone, email: a.PatientEmail,
  });
  const dentistaId = await ensureLocalProfessional(pool, cpProfId, a.ProfessionalName || a.DentistName || a.ScheduleToName || a.Dentist?.Name);
  const status = mapAppointmentStatus(a.Status ?? a.StatusId);
  const rawDate = a.Date || a.AppointmentDate || a.date || null;
  // Normaliza para YYYY-MM-DD (a API retorna ISO 8601 com timezone)
  const data = rawDate ? String(rawDate).slice(0, 10) : null;
  const fromT = (a.FromTime || a.StartTime || a.fromTime || '').toString();
  const toT = (a.ToTime || a.EndTime || a.toTime || '').toString();
  const hora = (fromT || '00:00').slice(0, 5);
  const duracao = (() => {
    if (!fromT || !toT) return 30;
    const toMin = (s) => { const [h,m] = s.split(':').map(Number); return (h||0)*60+(m||0); };
    const d = toMin(toT) - toMin(fromT);
    return d > 0 ? d : 30;
  })();
  const procedimento = a.CategoryDescription || a.Category || null;
  const categoriaCor = a.CategoryColor || a.Color || null;
  const observacoes = a.Notes || a.notes || null;

  const exists = await pool.query(
    `SELECT id, paciente_id, dentista_id, data, hora, duracao, procedimento, categoria,
            categoria_cor, status, observacoes, updated_at, last_clinicorp_sync_at, keep_local
       FROM agendamentos WHERE clinicorp_appointment_id=$1 LIMIT 1`,
    [cpApptId]
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
        ? (await pool.query(`SELECT id FROM crm_leads WHERE paciente_id=$1 LIMIT 1`, [pacienteId])).rows[0]
        : null;
      await logConflict(pool, {
        entity: 'appointment', clinicorp_id: cpApptId, local_id: agendamentoId,
        decision: decision.decision, strategy: policy.strategy,
        scope_type: policy.scopeType, scope_id: policy.scopeId,
        local_updated_at: localRow.updated_at,
        clinicorp_updated_at: cpUpdatedAt,
        last_sync_at: localRow.last_clinicorp_sync_at,
        diff: { changed },
        before_data: beforeOut,
        after_data: afterOut,
        changed_fields: changed,
        paciente_id: pacienteId,
        lead_id: leadRow?.id || null,
        agendamento_id: agendamentoId,
      });
    }
  } else if (data) {
    const { randomUUID } = await import('crypto');
    const id = randomUUID();
    const tenantId = await resolveTenantId(pool);
    await pool.query(
      `INSERT INTO agendamentos
         (id, paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes,
          categoria, categoria_cor, clinicorp_appointment_id, last_clinicorp_sync_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW(), $13)`,
      [id, pacienteId, dentistaId, data, hora, duracao, procedimento, status, observacoes, procedimento, categoriaCor, cpApptId, tenantId]
    );
    agendamentoId = id;
  }

  if (pacienteId) {
    const leadId = await ensureLeadForPatient(pool, pacienteId, cpPatientId, {
      nome: a.PatientName, telefone: onlyDigits(a.PatientPhone || a.MobilePhone), email: a.PatientEmail,
    });
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

async function projectPatientToLocal(pool, p) {
  const cpId = p.id ?? p.Patient_PersonId;
  if (!cpId) return null;
  const cpUpdatedAt = p.UpdateDate || p.UpdatedAt || p.LastModified || null;
  const policy = await resolveConflictPolicy(pool, {});
  const existing = await pool.query(
    `SELECT id, nome, telefone, email, data_nascimento, sexo, cpf,
            updated_at, last_clinicorp_sync_at, keep_local
       FROM pacientes WHERE clinicorp_patient_id=$1 LIMIT 1`,
    [cpId]
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
        `SELECT id FROM crm_leads WHERE paciente_id=$1 OR clinicorp_patient_id=$2 LIMIT 1`,
        [localRow.id, cpId]
      )).rows[0];
      await logConflict(pool, {
        entity: 'patient', clinicorp_id: cpId, local_id: localRow.id,
        decision: decision.decision, strategy: policy.strategy,
        scope_type: policy.scopeType, scope_id: policy.scopeId,
        local_updated_at: localRow.updated_at,
        clinicorp_updated_at: cpUpdatedAt,
        last_sync_at: localRow.last_clinicorp_sync_at,
        diff: { changed },
        before_data: beforeOut,
        after_data: afterOut,
        changed_fields: changed,
        paciente_id: localRow.id,
        lead_id: leadRow?.id || null,
      });
    }
    if (!decision.write) return localRow.id;
  }
  const pacienteId = await ensureLocalPatient(pool, cpId, { name: p.Name, phone: p.MobilePhone, email: p.Email });
  if (pacienteId) {
    await pool.query(`UPDATE pacientes SET last_clinicorp_sync_at=NOW() WHERE id=$1`, [pacienteId]);
  }
  await ensureLeadForPatient(pool, pacienteId, cpId, {
    nome: p.Name, telefone: onlyDigits(p.MobilePhone), email: p.Email,
  });
  return pacienteId;
}

async function upsertEstimate(pool, e) {
  await pool.query(
    `INSERT INTO clinicorp_estimates
       (id, treatment_id, patient_id, patient_name, professional_id, professional_name,
        business_id, amount, status, date, create_date, procedure_list, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
     ON CONFLICT (id) DO UPDATE SET
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
      e.id, e.TreatmentId ?? null, e.PatientId ?? e.Patient_PersonId ?? null,
      e.PatientName ?? null, e.ProfessionalId ?? e.Dentist_PersonId ?? null,
      e.ProfessionalName ?? null, e.BusinessId ?? null,
      e.Amount ?? null, e.Status ?? null,
      e.Date || null, e.CreateDate || null,
      e.ProcedureList ? JSON.stringify(e.ProcedureList) : null,
      JSON.stringify(e),
    ]
  );
}

async function upsertFinancial(pool, source, item) {
  const externalId = String(item.id ?? item.Id ?? item.InvoiceId ?? item.PaymentId ?? '') || null;
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
}

// ─── Sync orchestration ───────────────────────────────────────
export async function runFullSync(pool, { from, to, api_token, subscriber_id, base_url, force_metadata = false } = {}) {
  // Se passarmos credenciais explícitas (ex: manual sync com per-user settings), as usamos.
  // Caso contrário, carrega as globais.
  let settings;
  if (api_token && subscriber_id) {
    settings = { api_token, subscriber_id, base_url, enabled: true };
  } else {
    settings = await loadSettings(pool, true);
    if (!settings?.enabled) throw new Error('Clinicorp desabilitado');
    if (!settings.api_token || !settings.subscriber_id) {
      throw new Error('Clinicorp: api_token e subscriber_id são obrigatórios');
    }
  }

  const today = new Date();
  const fromDate = from || new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const toDate = to || new Date(today.getTime() + 60 * 86400_000).toISOString().slice(0, 10);

  const summary = { clinics: 0, professionals: 0, patients: 0, chairs: 0, categories: 0, specialties: 0, appointments: 0, estimates: 0, invoices: 0, payments: 0, cashflow: 0 };
  const errors = [];

  // Backfill tenant_id em registros antigos vindos do Clinicorp (criados antes do fix)
  try {
    const tenantId = await resolveTenantId(pool);
    await pool.query(`UPDATE dentistas SET tenant_id=$1 WHERE tenant_id IS NULL AND clinicorp_professional_id IS NOT NULL`, [tenantId]);
    await pool.query(`UPDATE pacientes SET tenant_id=$1 WHERE tenant_id IS NULL AND clinicorp_patient_id IS NOT NULL`, [tenantId]);
    await pool.query(`UPDATE agendamentos SET tenant_id=$1 WHERE tenant_id IS NULL AND clinicorp_appointment_id IS NOT NULL`, [tenantId]);
    await pool.query(`UPDATE crm_leads SET tenant_id=$1 WHERE tenant_id IS NULL AND (clinicorp_patient_id IS NOT NULL OR origem='clinicorp')`, [tenantId]);
  } catch (e) { console.error('[clinicorp sync] tenant backfill', e.message); }


  const safe = async (label, fn) => {
    try { await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); console.error(`[clinicorp sync] ${label}`, e.message); }
  };

  // Helper para fatiar períodos em janelas de 30 dias para evitar erro 400 da Clinicorp
  const sliceRange = (startStr, endStr) => {
    const dates = [];
    let current = new Date(startStr);
    const end = new Date(endStr);
    while (current < end) {
      const next = new Date(current.getTime() + 30 * 86400_000);
      const to = next < end ? next : end;
      dates.push({
        from: current.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10)
      });
      current = new Date(to.getTime() + 86400_000);
    }
    return dates;
  };

  await safe('clinics', async () => {
    const list = await clinicorpApi.listClinics(settings);
    for (const c of (Array.isArray(list) ? list : [])) { await upsertClinic(pool, c); summary.clinics++; }
  });

  await safe('professionals', async () => {
    const list = await clinicorpApi.listUsers(settings);
    for (const u of (Array.isArray(list) ? list : [])) { await upsertProfessional(pool, u); summary.professionals++; }
  });

  // Pacientes são sincronizados via agendamentos (ensureLocalPatient projeta cada paciente referenciado).
  // A Clinicorp não expõe um endpoint público de listagem completa de pacientes (/patient/list retorna 404),
  // então não tentamos buscar a lista — o backfill acontece naturalmente conforme os agendamentos chegam.



  // Chairs por clínica
  await safe('chairs', async () => {
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics');
    for (const { id } of clinics) {
      if (!id) continue;
      try {
        const list = await clinicorpApi.listChairs(settings, id);
        for (const ch of (Array.isArray(list) ? list : [])) { await upsertChair(pool, ch); summary.chairs++; }
      } catch (e) { /* silencia 400 sem chairs */ }
    }
  });

  await safe('categories', async () => {
    const list = await clinicorpApi.listAppointmentCategories(settings);
    for (const c of (Array.isArray(list) ? list : [])) { await upsertCategory(pool, c); summary.categories++; }
  });

  await safe('specialties', async () => {
    const list = await clinicorpApi.listSpecialties(settings);
    for (const s of (Array.isArray(list) ? list : [])) { await upsertSpecialty(pool, s); summary.specialties++; }
  });

  await safe('appointments', async () => {
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics');
    const apiIds = new Set();
    const ranges = sliceRange(fromDate, toDate);
    
    const processAppts = async (list) => {
      for (const a of (Array.isArray(list) ? list : [])) { 
        const id = a.id ?? a.AppointmentId ?? a.Id;
        if (id) { apiIds.add(String(id)); await upsertAppointment(pool, a); summary.appointments++; }
      }
    };

    if (clinics.length === 0) {
      for (const r of ranges) {
        const list = await clinicorpApi.listAppointments(settings, r.from, r.to);
        await processAppts(list);
      }
    } else {
      for (const { id: clinicId } of clinics) {
        if (!clinicId) continue;
        for (const r of ranges) {
          try {
            const list = await clinicorpApi.listAppointments(settings, r.from, r.to, clinicId);
            await processAppts(list);
          } catch (e) { console.error(`[clinicorp sync] appointments clinic ${clinicId}`, e.message); }
        }
      }
    }
    
    // Deletion detection (faithfull mirror)
    try {
      const { rows: localRows } = await pool.query(
        `SELECT id FROM clinicorp_appointments WHERE date >= $1 AND date <= $2`,
        [fromDate, toDate]
      );
      for (const local of localRows) {
        if (!apiIds.has(String(local.id))) {
          await pool.query(`UPDATE clinicorp_appointments SET status = 'DELETED_IN_CLINICORP', synced_at = NOW() WHERE id = $1`, [local.id]);
          await pool.query(`UPDATE agendamentos SET status = 'cancelado', updated_at = NOW() WHERE clinicorp_appointment_id = $1`, [local.id]);
        }
      }
    } catch (e) { console.error('[clinicorp sync] pruning appointments', e.message); }
    
    // Backfill de profissionais a partir dos agendamentos:
    // a Clinicorp não expõe /security/list_users de forma confiável,
    // então derivamos os dentistas dos Dentist_PersonId distintos vistos nos agendamentos.
    try {
      const { rows: distinctProfs } = await pool.query(
        `SELECT DISTINCT professional_id::text AS id,
                MAX(raw->>'ScheduleToName') AS name_a,
                MAX(raw->'Dentist'->>'Name') AS name_b,
                MAX(raw->>'DentistName') AS name_c,
                MAX(raw->>'ProfessionalName') AS name_d,
                MAX(professional_name) AS name_e
           FROM clinicorp_appointments
          WHERE professional_id IS NOT NULL
          GROUP BY 1`
      );
      for (const p of distinctProfs) {
        // Busca o objeto original para garantir que temos os metadados
        const { rows: apptRows } = await pool.query(
          `SELECT raw FROM clinicorp_appointments WHERE professional_id = $1 LIMIT 1`,
          [p.id]
        );
        const rawAppt = apptRows[0]?.raw || {};
        const name = p.name_a || p.name_b || p.name_c || p.name_d || p.name_e || 
                     rawAppt.ScheduleToName || rawAppt.DentistName || (rawAppt.Dentist && rawAppt.Dentist.Name) || 
                     `Profissional ${p.id}`;

        await pool.query(
          `INSERT INTO clinicorp_professionals (id, full_name, user_name, raw, synced_at)
           VALUES ($1,$2,NULL,$3,NOW())
           ON CONFLICT (id) DO UPDATE SET
             full_name = EXCLUDED.full_name,
             synced_at = NOW()`,
          [p.id, name, JSON.stringify({ derived_from: 'appointments', id: p.id, name })]
        );
        // Garante existência no schema local (dentistas) com o tenant atual.
        await ensureLocalProfessional(pool, p.id, name);
      }
      const { rows: pcount } = await pool.query(`SELECT COUNT(*)::int AS c FROM clinicorp_professionals`);
      summary.professionals = pcount[0]?.c || summary.professionals;
    } catch (e) { console.error('[clinicorp sync] backfill professionals', e.message); }
    
    // Conta pacientes únicos sincronizados (criados via ensureLocalPatient pelos agendamentos)
    try {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM clinicorp_patients`);
      summary.patients = rows[0]?.c || 0;
    } catch { /* ignore */ }
  });

  await safe('estimates', async () => {
    const ranges = sliceRange(fromDate, toDate);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics');
    
    for (const r of ranges) {
      if (clinics.length > 0) {
        for (const { id: clinicId } of clinics) {
          try {
            const list = await clinicorpApi.listEstimates(settings, r.from, r.to, clinicId);
            for (const e of (Array.isArray(list) ? list : [])) { await upsertEstimate(pool, e); summary.estimates++; }
          } catch (e) { /* silent fail for clinic range */ }
        }
      } else {
        const list = await clinicorpApi.listEstimates(settings, r.from, r.to);
        for (const e of (Array.isArray(list) ? list : [])) { await upsertEstimate(pool, e); summary.estimates++; }
      }
    }
  });

  await safe('invoices', async () => {
    const ranges = sliceRange(fromDate, toDate);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics');
    for (const r of ranges) {
      if (clinics.length > 0) {
        for (const { id: clinicId } of clinics) {
          try {
            const list = await clinicorpApi.listInvoices(settings, { from: r.from, to: r.to, clinic_id: clinicId });
            for (const i of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'invoice', i); summary.invoices++; }
          } catch (e) { /* silent */ }
        }
      } else {
        const list = await clinicorpApi.listInvoices(settings, { from: r.from, to: r.to });
        for (const i of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'invoice', i); summary.invoices++; }
      }
    }
  });

  await safe('payments', async () => {
    const ranges = sliceRange(fromDate, toDate);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics');
    for (const r of ranges) {
      if (clinics.length > 0) {
        for (const { id: clinicId } of clinics) {
          try {
            const list = await clinicorpApi.listPayments(settings, { from: r.from, to: r.to, clinic_id: clinicId });
            for (const p of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'payment', p); summary.payments++; }
          } catch (e) { /* silent */ }
        }
      } else {
        const list = await clinicorpApi.listPayments(settings, { from: r.from, to: r.to });
        for (const p of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'payment', p); summary.payments++; }
      }
    }
  });

  await safe('cashflow', async () => {
    const ranges = sliceRange(fromDate, toDate);
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics');
    for (const r of ranges) {
      if (clinics.length > 0) {
        for (const { id: clinicId } of clinics) {
          try {
            const list = await clinicorpApi.listCashFlow(settings, { from: r.from, to: r.to, clinic_id: clinicId });
            for (const c of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'cashflow', c); summary.cashflow++; }
          } catch (e) { /* silent */ }
        }
      } else {
        const list = await clinicorpApi.listCashFlow(settings, { from: r.from, to: r.to });
        for (const c of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'cashflow', c); summary.cashflow++; }
      }
    }
  });

  const status = errors.length === 0 ? 'success' : (Object.values(summary).some(Boolean) ? 'partial' : 'error');
  
  // Se forem as globais (carregadas via id=1), atualiza o status na tabela.
  // Se forem per-user settings passadas explicitamente, pulamos a escrita no id=1.
  if (settings.id === 1 || (!api_token && settings.id === undefined)) {
    await pool.query(
      `UPDATE clinicorp_settings SET last_sync_at = NOW(), last_sync_status = $1, last_sync_error = $2, updated_at = NOW() WHERE id = 1`,
      [status, errors.length ? errors.join(' | ') : null]
    );
    invalidateSettings();
  }


  return { status, summary, errors, from: fromDate, to: toDate };
}

/**
 * Tick de reconciliação agendada.
 * - Usa lock no Postgres para evitar execução concorrente / múltiplas instâncias.
 * - Catch-up automático após interrupções: se last_sync_at é antigo, alarga a janela.
 */
export async function reconciliationTick(pool) {
  const claim = await pool.query(
    `UPDATE clinicorp_settings SET sync_lock_until = NOW() + INTERVAL '15 minutes',
       next_sync_at = NOW() + (COALESCE(sync_interval_minutes, 30) || ' minutes')::interval,
       updated_at = NOW()
     WHERE id = 1
       AND COALESCE(enabled, false) = true
       AND COALESCE(auto_sync_enabled, true) = true
       AND api_token IS NOT NULL AND subscriber_id IS NOT NULL
       AND (sync_lock_until IS NULL OR sync_lock_until < NOW())
       AND (next_sync_at   IS NULL OR next_sync_at   <= NOW())
     RETURNING id, last_sync_at, sync_lookback_days, sync_lookahead_days`
  );
  if (!claim.rows[0]) return { skipped: true };
  const cfg = claim.rows[0];
  const lookback = cfg.sync_lookback_days ?? 30;
  const lookahead = cfg.sync_lookahead_days ?? 60;
  const today = new Date();
  let backDays = lookback;
  if (cfg.last_sync_at) {
    const diff = Math.ceil((today.getTime() - new Date(cfg.last_sync_at).getTime()) / 86400_000);
    backDays = Math.max(lookback, diff + 2);
  } else {
    backDays = Math.max(lookback, 90);
  }
  const from = new Date(today.getTime() - backDays * 86400_000).toISOString().slice(0, 10);
  const to   = new Date(today.getTime() + lookahead * 86400_000).toISOString().slice(0, 10);
  console.log(`[clinicorp] auto-reconcile rodando ${from} → ${to}`);
  try {
    const r = await runFullSync(pool, { from, to });
    await pool.query(`UPDATE clinicorp_settings SET sync_lock_until = NULL WHERE id = 1`);
    return { ran: true, ...r };
  } catch (e) {
    console.error('[clinicorp] auto-reconcile falhou', e.message);
    await pool.query(
      `UPDATE clinicorp_settings SET sync_lock_until = NULL, last_sync_status='error',
         last_sync_error=$1, updated_at=NOW() WHERE id = 1`,
      [e.message]
    );
    return { ran: true, error: e.message };
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
    await upsertAppointment(pool, data);
    return { handled: true, target: 'appointment' };
  }

  // Paciente
  if (type.includes('patient') || (data.Patient_PersonId && data.Name && !data.FromTime)) {
    await upsertPatient(pool, data);
    return { handled: true, target: 'patient' };
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

  // ── Local read-only data (espelho) ───────────────────────────
  app.get('/api/clinicorp/clinics', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_clinics ORDER BY name');
    res.json(rows);
  });
  app.get('/api/clinicorp/professionals', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_professionals ORDER BY full_name');
    res.json(rows);
  });
  app.get('/api/clinicorp/categories', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_appointment_categories ORDER BY description');
    res.json(rows);
  });
  app.get('/api/clinicorp/specialties', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_specialties ORDER BY description');
    res.json(rows);
  });
  app.get('/api/clinicorp/patients', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const search = req.query.search ? `%${req.query.search}%` : null;
    const { rows } = search
      ? await pool.query(
          `SELECT * FROM clinicorp_patients
           WHERE name ILIKE $1 OR mobile_phone ILIKE $1 OR document_id ILIKE $1
           ORDER BY name LIMIT $2`,
          [search, limit]
        )
      : await pool.query('SELECT * FROM clinicorp_patients ORDER BY synced_at DESC LIMIT $1', [limit]);
    res.json(rows);
  });
  app.get('/api/clinicorp/appointments', async (req, res) => {
    const { from, to, professional_id, business_id } = req.query;
    const where = [];
    const params = [];
    if (from) { params.push(from); where.push(`date >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`date <= $${params.length}`); }
    if (professional_id) { params.push(professional_id); where.push(`professional_id = $${params.length}`); }
    if (business_id) { params.push(business_id); where.push(`business_id = $${params.length}`); }
    const sql = `SELECT * FROM clinicorp_appointments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date, from_time LIMIT 2000`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  });
  app.get('/api/clinicorp/estimates', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_estimates ORDER BY date DESC LIMIT 500');
    res.json(rows);
  });
  app.get('/api/clinicorp/financial', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await pool.query('SELECT * FROM clinicorp_financial_entries ORDER BY date DESC LIMIT $1', [limit]);
    res.json(rows);
  });
  app.get('/api/clinicorp/chairs', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM clinicorp_chairs ORDER BY name');
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

  app.post('/api/clinicorp/live/create-appointment', async (req, res) => {
    try {
      const s = await loadSettings(pool);
      if (!s?.enabled) return res.status(400).json({ error: 'Clinicorp desabilitado' });
      const data = await clinicorpApi.createAppointment(s, { subscriber_id: s.subscriber_id, ...(req.body || {}) });
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message, details: e.body }); }
  });

  // ── Re-projeta espelho atual nas tabelas locais (pacientes/dentistas/agendamentos/crm_leads) ──
  app.post('/api/clinicorp/reproject', async (_req, res) => {
    try {
      const { rows: pats } = await pool.query('SELECT raw FROM clinicorp_patients');
      let patients = 0, appts = 0;
      for (const r of pats) { try { await projectPatientToLocal(pool, r.raw); patients++; } catch (e) { /* skip */ } }
      const { rows: aps } = await pool.query('SELECT id, raw FROM clinicorp_appointments');
      for (const r of aps) { try { await projectAppointmentToLocal(pool, r.raw, r.id); appts++; } catch (e) { /* skip */ } }
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

  console.log('🦷 Clinicorp routes registered');
}
