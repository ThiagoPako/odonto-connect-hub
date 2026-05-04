/**
 * Clinicorp integration module
 * - REST API client (https://api.clinicorp.com/rest/v1)
 * - Sync helpers (clinics, professionals, patients, appointments, estimates...)
 * - Webhook receiver (validated by ?user_api=<webhook_secret>)
 *
 * Mounted by server.mjs via registerClinicorp(app, pool).
 */

const DEFAULT_BASE_URL = 'https://api.clinicorp.com/rest/v1';

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
            last_sync_at, last_sync_status, last_sync_error
       FROM clinicorp_settings WHERE id = 1`
  );
  _settingsCache = rows[0] || null;
  _settingsCacheAt = now;
  return _settingsCache;
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
  // subscriber_id sempre que não vier explícito
  const allQuery = { ...query };
  if (settings.subscriber_id && allQuery.subscriber_id === undefined) {
    allQuery.subscriber_id = settings.subscriber_id;
  }
  for (const [k, v] of Object.entries(allQuery)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const headers = {
    Authorization: `Bearer ${settings.api_token}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30_000);
  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const err = new Error(`Clinicorp ${method} ${pathName} → HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ─── High-level API helpers ───────────────────────────────────
export const clinicorpApi = {
  listUsers: (s) => clinicorpFetch(s, '/security/list_users'),
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
  await pool.query(
    `INSERT INTO clinicorp_professionals (id, full_name, user_name, raw, synced_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       user_name = EXCLUDED.user_name,
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [p.id, p.FullName ?? null, p.UserName ?? null, JSON.stringify(p)]
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
      a.BusinessId ?? null,
      a.PatientId ?? a.Patient_PersonId ?? null,
      a.PatientName ?? null,
      a.ProfessionalId ?? a.Dentist_PersonId ?? null,
      a.ProfessionalName ?? null,
      a.CategoryId ?? a.Category_id ?? null,
      a.CategoryDescription ?? a.Category ?? null,
      a.CategoryColor ?? a.Color ?? null,
      a.ChairId ?? null,
      a.Status ?? null,
      a.Date || a.AppointmentDate || null,
      a.FromTime ?? a.StartTime ?? null,
      a.ToTime ?? a.EndTime ?? null,
      a.Notes ?? null,
      JSON.stringify(a),
    ]
  );
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
export async function runFullSync(pool, { from, to } = {}) {
  const settings = await loadSettings(pool, true);
  if (!settings?.enabled) throw new Error('Clinicorp desabilitado');
  if (!settings.api_token || !settings.subscriber_id) {
    throw new Error('Clinicorp: api_token e subscriber_id são obrigatórios');
  }

  const today = new Date();
  const fromDate = from || new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const toDate = to || new Date(today.getTime() + 60 * 86400_000).toISOString().slice(0, 10);

  const summary = { clinics: 0, professionals: 0, chairs: 0, categories: 0, specialties: 0, appointments: 0, estimates: 0, invoices: 0, payments: 0, cashflow: 0 };
  const errors = [];

  const safe = async (label, fn) => {
    try { await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); console.error(`[clinicorp sync] ${label}`, e.message); }
  };

  await safe('clinics', async () => {
    const list = await clinicorpApi.listClinics(settings);
    for (const c of (Array.isArray(list) ? list : [])) { await upsertClinic(pool, c); summary.clinics++; }
  });

  await safe('professionals', async () => {
    const list = await clinicorpApi.listUsers(settings);
    for (const u of (Array.isArray(list) ? list : [])) { await upsertProfessional(pool, u); summary.professionals++; }
  });

  // Chairs por clínica
  await safe('chairs', async () => {
    const { rows: clinics } = await pool.query('SELECT id FROM clinicorp_clinics');
    for (const { id } of clinics) {
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
    const list = await clinicorpApi.listAppointments(settings, fromDate, toDate);
    for (const a of (Array.isArray(list) ? list : [])) { await upsertAppointment(pool, a); summary.appointments++; }
  });

  await safe('estimates', async () => {
    const list = await clinicorpApi.listEstimates(settings, fromDate, toDate);
    for (const e of (Array.isArray(list) ? list : [])) { await upsertEstimate(pool, e); summary.estimates++; }
  });

  await safe('invoices', async () => {
    const list = await clinicorpApi.listInvoices(settings, { from: fromDate, to: toDate });
    for (const i of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'invoice', i); summary.invoices++; }
  });

  await safe('payments', async () => {
    const list = await clinicorpApi.listPayments(settings, { from: fromDate, to: toDate });
    for (const p of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'payment', p); summary.payments++; }
  });

  await safe('cashflow', async () => {
    const list = await clinicorpApi.listCashFlow(settings, { from: fromDate, to: toDate });
    for (const c of (Array.isArray(list) ? list : [])) { await upsertFinancial(pool, 'cashflow', c); summary.cashflow++; }
  });

  const status = errors.length === 0 ? 'success' : (Object.values(summary).some(Boolean) ? 'partial' : 'error');
  await pool.query(
    `UPDATE clinicorp_settings SET last_sync_at = NOW(), last_sync_status = $1, last_sync_error = $2, updated_at = NOW() WHERE id = 1`,
    [status, errors.length ? errors.join(' | ') : null]
  );
  invalidateSettings();

  return { status, summary, errors, from: fromDate, to: toDate };
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
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/clinicorp/settings', async (req, res) => {
    try {
      const { enabled, api_token, subscriber_id, webhook_secret, base_url } = req.body || {};
      await pool.query(
        `UPDATE clinicorp_settings SET
           enabled = COALESCE($1, enabled),
           api_token = COALESCE(NULLIF($2, ''), api_token),
           subscriber_id = COALESCE($3, subscriber_id),
           webhook_secret = COALESCE(NULLIF($4, ''), webhook_secret),
           base_url = COALESCE($5, base_url),
           updated_at = NOW()
         WHERE id = 1`,
        [
          typeof enabled === 'boolean' ? enabled : null,
          api_token ?? '',
          subscriber_id ?? null,
          webhook_secret ?? '',
          base_url ?? null,
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
      const result = await runFullSync(pool, { from: req.body?.from, to: req.body?.to });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
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

  console.log('🦷 Clinicorp routes registered');
}
