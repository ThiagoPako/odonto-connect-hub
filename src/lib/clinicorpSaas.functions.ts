import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

const DEFAULT_BASE_URL = 'https://api.clinicorp.com/rest/v1';

export interface ClinicorpUserSettingsDTO {
  enabled: boolean;
  subscriber_id: string;
  base_url: string;
  has_api_token: boolean;
  has_webhook_secret: boolean;
  webhook_secret_preview: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  sync_progress: any | null;
  updated_at: string | null;
}

function toDTO(row: {
  enabled: boolean | null;
  subscriber_id: string | null;
  base_url: string | null;
  api_token: string | null;
  webhook_secret: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  sync_progress: any | null;
  updated_at: string | null;
} | null): ClinicorpUserSettingsDTO {
  if (!row) {
    return {
      enabled: false,
      subscriber_id: '',
      base_url: DEFAULT_BASE_URL,
      has_api_token: false,
      has_webhook_secret: false,
      webhook_secret_preview: '',
      last_sync_at: null,
      last_sync_status: null,
      last_sync_error: null,
      sync_progress: null,
      updated_at: null,
    };
  }
  const ws = row.webhook_secret || '';
  return {
    enabled: !!row.enabled,
    subscriber_id: row.subscriber_id || '',
    base_url: row.base_url || DEFAULT_BASE_URL,
    has_api_token: !!row.api_token,
    has_webhook_secret: !!ws,
    webhook_secret_preview: ws ? `${ws.slice(0, 4)}…${ws.slice(-4)}` : '',
    last_sync_at: row.last_sync_at,
    last_sync_status: row.last_sync_status,
    last_sync_error: row.last_sync_error,
    sync_progress: row.sync_progress,
    updated_at: row.updated_at,
  };
}

export const getMyClinicorpSettings = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data, error } = await supabase
      .from('clinicorp_user_settings')
      .select('enabled, subscriber_id, base_url, api_token, webhook_secret, last_sync_at, last_sync_status, last_sync_error, sync_progress, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return toDTO(data);
  });

const saveSchema = z.object({
  enabled: z.boolean().optional(),
  api_token: z.string().max(500).optional(),
  subscriber_id: z.string().max(255).optional(),
  webhook_secret: z.string().max(255).optional(),
  base_url: z.string().url().max(500).optional(),
});

export const saveMyClinicorpSettings = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: existing } = await supabase
      .from('clinicorp_user_settings')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    const patch: Record<string, unknown> = {};
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.api_token !== undefined && data.api_token !== '') patch.api_token = data.api_token;
    if (data.subscriber_id !== undefined) patch.subscriber_id = data.subscriber_id || null;
    if (data.webhook_secret !== undefined && data.webhook_secret !== '') patch.webhook_secret = data.webhook_secret;
    if (data.base_url !== undefined && data.base_url !== '') patch.base_url = data.base_url;

    if (existing) {
      const { error } = await supabase
        .from('clinicorp_user_settings')
        .update(patch)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from('clinicorp_user_settings')
        .insert({ user_id: userId, base_url: DEFAULT_BASE_URL, ...patch });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deleteMyClinicorpSettings = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { error } = await supabase
      .from('clinicorp_user_settings')
      .delete()
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const testSchema = z.object({
  api_token: z.string().max(500).optional(),
  subscriber_id: z.string().max(255).optional(),
  base_url: z.string().url().max(500).optional(),
}).default({});

interface ProbeResult {
  key: string;
  label: string;
  path: string;
  ok: boolean;
  latency_ms: number;
  count?: number;
  status?: number | null;
  error?: string;
}

async function clinicorpProbe(
  base_url: string,
  subscriber_id: string,
  api_token: string,
  pathName: string,
  query: Record<string, string> = {},
  timeoutMs = 25000,
  forcedAuthHeader?: string,
): Promise<{ status: number; data: unknown; usedAuth?: string }> {
  const base = base_url.replace(/\/$/, '');
  const cleanToken = api_token.replace(/^Bearer\s+/i, '').trim();
  const cleanUser = subscriber_id.trim();
  
  const attempt = async (url: string, authHeader?: string, attemptCount = 0): Promise<{ status: number; data: unknown }> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (authHeader) headers.Authorization = authHeader;

      const r = await fetch(url, {
        method: 'GET',
        headers,
        signal: ctrl.signal,
      });
      
      if (r.status === 429 && attemptCount < 2) {
        const wait = 5000 * (attemptCount + 1);
        await new Promise(res => setTimeout(res, wait));
        return attempt(url, authHeader, attemptCount + 1);
      }

      const text = await r.text();
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: r.status, data };
    } catch (e: any) {
      if (e.name === 'AbortError' && attemptCount < 1) {
        return attempt(url, authHeader, attemptCount + 1);
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  };

  const basicAuth = `Basic ${btoa(`${cleanUser}:${cleanToken}`)}`;
  const bearerAuth = `Bearer ${cleanToken}`;
  
  // Create versions of the URL: one with query params, one without
  const urlWithParams = new URL(base + pathName);
  urlWithParams.searchParams.set('subscriber_id', cleanUser);
  urlWithParams.searchParams.set('user_api', cleanUser);
  urlWithParams.searchParams.set('api_key', cleanToken);
  for (const [k, v] of Object.entries(query)) urlWithParams.searchParams.set(k, v);

  const urlPlain = new URL(base + pathName);
  for (const [k, v] of Object.entries(query)) urlPlain.searchParams.set(k, v);

  if (forcedAuthHeader) {
    const res = await attempt(urlWithParams.toString(), forcedAuthHeader);
    if (res.status >= 200 && res.status < 300) return { ...res, usedAuth: forcedAuthHeader };
    const res2 = await attempt(urlPlain.toString(), forcedAuthHeader);
    return { ...res2, usedAuth: forcedAuthHeader };
  }

  // Strategy 1: URL params + Basic Auth
  let res = await attempt(urlWithParams.toString(), basicAuth);
  if (res.status >= 200 && res.status < 300) return { ...res, usedAuth: basicAuth };

  // Strategy 2: URL params + Bearer Auth
  res = await attempt(urlWithParams.toString(), bearerAuth);
  if (res.status >= 200 && res.status < 300) return { ...res, usedAuth: bearerAuth };

  // Strategy 3: Just URL params (no header)
  res = await attempt(urlWithParams.toString());
  if (res.status >= 200 && res.status < 300) return { ...res, usedAuth: 'QueryParam' };

  // Strategy 4: Plain URL + Basic Auth
  res = await attempt(urlPlain.toString(), basicAuth);
  if (res.status >= 200 && res.status < 300) return { ...res, usedAuth: basicAuth };

  return { ...res, usedAuth: bearerAuth }; // Return last attempt
}

export const testMyClinicorpConnection = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => testSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    let { api_token, subscriber_id, base_url } = data;
    if (!api_token || !subscriber_id) {
      const { data: saved } = await supabase
        .from('clinicorp_user_settings')
        .select('api_token, subscriber_id, base_url')
        .eq('user_id', userId)
        .maybeSingle();
      api_token = api_token || saved?.api_token || '';
      subscriber_id = subscriber_id || saved?.subscriber_id || '';
      base_url = base_url || saved?.base_url || DEFAULT_BASE_URL;
    }
    base_url = base_url || DEFAULT_BASE_URL;

    if (!api_token) return { ok: false, auth: 'invalid_token' as const, error: 'Informe o API Token', total_latency_ms: 0, base_url, subscriber_id: subscriber_id || '', results: [] };
    if (!subscriber_id) return { ok: false, auth: 'invalid_token' as const, error: 'Informe o Subscriber ID', total_latency_ms: 0, base_url, subscriber_id: '', results: [] };

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const probes = [
      { key: 'clinics', label: 'Clínicas', path: '/business/list', query: {} as Record<string, string> },
      { key: 'appointments', label: 'Agenda', path: '/appointment/list', query: { from: dateStr, to: dateStr } as Record<string, string> },
      { key: 'professionals', label: 'Profissionais', path: '/professional/list_all_professionals', query: {} as Record<string, string> },
      { key: 'patients', label: 'Pacientes', path: '/patient/birthdays', query: { from: dateStr, to: dateStr } as Record<string, string> },
      { key: 'estimates', label: 'Orçamentos', path: '/estimates/list', query: { from: dateStr, to: dateStr } as Record<string, string> },
      { key: 'financial', label: 'Financeiro', path: '/financial/list_invoices', query: { from: dateStr, to: dateStr } as Record<string, string> },
    ];

    const startedAt = Date.now();
    const results: ProbeResult[] = [];
    for (const p of probes) {
      const t0 = Date.now();
      try {
        const { status, data: payload } = await clinicorpProbe(base_url, subscriber_id, api_token, p.path, p.query);
        if (status >= 200 && status < 300) {
          results.push({ key: p.key, label: p.label, path: p.path, ok: true, latency_ms: Date.now() - t0, count: Array.isArray(payload) ? payload.length : (payload ? 1 : 0) });
        } else {
          const msg = typeof payload === 'object' && payload && 'message' in (payload as Record<string, unknown>)
            ? String((payload as Record<string, unknown>).message)
            : `HTTP ${status}`;
          results.push({ key: p.key, label: p.label, path: p.path, ok: false, latency_ms: Date.now() - t0, status, error: msg });
          if (status === 429) break;
        }
      } catch (e) {
        results.push({ key: p.key, label: p.label, path: p.path, ok: false, latency_ms: Date.now() - t0, status: null, error: (e as Error).message || 'erro de rede' });
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const ok = results.every((r) => r.ok);
    const has401 = results.some((r) => r.status === 401);
    const rateLimited = results.some((r) => r.status === 429);
    const auth: 'valid' | 'invalid_token' | 'partial' | 'rate_limited' = has401 ? 'invalid_token' : rateLimited ? 'rate_limited' : ok ? 'valid' : 'partial';

    return {
      ok,
      auth,
      rate_limited: rateLimited,
      retry_after_seconds: null,
      total_latency_ms: Date.now() - startedAt,
      base_url,
      subscriber_id,
      error: rateLimited ? 'A Clinicorp limitou as chamadas. Aguarde alguns minutos.' : undefined,
      results,
    };
  });

const syncSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  force_metadata: z.boolean().optional(),
}).default({});

// ─── helpers ─────────────────────────────────────────────────
function mapAppointmentStatus(raw: any): string {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return 'agendado';
  if (s.includes('confirm')) return 'confirmado';
  if (s.includes('cancel') || s.includes('desmarc')) return 'cancelado';
  if (s.includes('falt') || s.includes('no_show') || s.includes('noshow')) return 'faltou';
  if (s.includes('atend') || s.includes('progress')) return 'em_atendimento';
  if (s.includes('final') || s.includes('conclu') || s.includes('done') || s.includes('complete')) return 'finalizado';
  return 'agendado';
}

function normalizeClinicorpDate(...values: any[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const raw = value instanceof Date ? value.toISOString() : String(value).trim();
    if (/^\d{8}(\d{4,6})?$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const msDate = raw.match(/\/Date\((\d+)/);
    if (msDate) return new Date(Number(msDate[1])).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    // Case where ISO string is passed directly
    if (raw.includes("T")) return raw.split("T")[0];
  }
  return null;
}

function normalizeClinicorpTime(...values: any[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const raw = String(value).trim();
    if (/^\d{1,2}:\d{2}/.test(raw)) return raw.slice(0, 5).padStart(5, "0");
    if (/^\d{12,14}$/.test(raw)) return `${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
    if (/^\d{3,4}$/.test(raw)) return `${raw.slice(0, -2).padStart(2, "0")}:${raw.slice(-2)}`;
    const isoTime = raw.match(/T(\d{2}:\d{2})/);
    if (isoTime) return isoTime[1];
    // Handle "HH:mm:ss"
    if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw.slice(0, 5);
  }
  return null;
}

function pickFirst(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function getAppointmentId(a: any): string | null {
  return pickFirst(a, 'id', 'Id', 'ID', 'AppointmentId', 'AppointmentID', 'Appointment_Id', 'appointment_id', 'appointmentId', 'ScheduleId', 'Schedule_ID', 'id_agendamento', 'AtomicId');
}

function extractList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const direct = pickFirst(data,
    "Results", "Result", "Data", "data", "Items", "items", "Rows", "rows", "Records", "records",
    "Appointments", "appointments", "Patients", "patients", "Dentists", "dentists",
    "Professionals", "professionals", "Professional", "professional", "Businesses", "businesses", "Clinics", "clinics", "Business", "business",
    "List", "list",
  );
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === "object") {
    const nested = extractList(direct);
    if (nested.length) return nested;
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = extractList(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const syncMyClinicorpNow = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => syncSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: settings, error: sErr } = await supabase
      .from('clinicorp_user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (sErr || !settings || !settings.api_token || !settings.subscriber_id) {
      throw new Error('Configurações da Clinicorp não encontradas ou incompletas.');
    }

    const { api_token, subscriber_id } = settings;
    const base_url = settings.base_url || DEFAULT_BASE_URL;

    const { data: profile } = await supabase
      .from('profiles').select('tenant_id').eq('id', userId).maybeSingle();
    const tenant_id = profile?.tenant_id;
    if (!tenant_id) throw new Error('Usuário não possui um tenant_id associado.');

    const summary = { clinics: 0, professionals: 0, patients: 0, appointments: 0, estimates: 0, financial: 0 };
    const errors: string[] = [];
    const log = (msg: string, extra?: any) => console.log(`[clinicorp-sync] ${msg}`, extra ?? '');

    const updateProgress = async (step: string) => {
      await supabase.from('clinicorp_user_settings').update({
        last_sync_status: 'syncing',
        last_sync_error: step,
        sync_progress: { summary, step, timestamp: new Date().toISOString() }
      }).eq('user_id', userId);
    };

    await updateProgress('Iniciando sincronização...');

    try {
      // 0. Determinar Auth Header uma vez
      let activeAuthHeader: string | undefined = undefined;
      try {
        const { status, usedAuth } = await clinicorpProbe(base_url, subscriber_id, api_token, '/business/list');
        if (status === 429) {
          throw new Error('A Clinicorp bloqueou temporariamente o acesso (Rate Limit). Por favor, aguarde pelo menos 15-30 minutos sem tentar sincronizar.');
        }
        activeAuthHeader = usedAuth;
        log(`Auth detectado: ${activeAuthHeader?.split(' ')[0]}`);
      } catch (e: any) {
        if (e.message.includes('Rate Limit')) throw e;
        errors.push(`Erro ao validar autenticação: ${e.message}`);
      }

      // 1. Clinicas
      let clinicIds: string[] = [];
      try {
        const { status, data: cl } = await clinicorpProbe(base_url, subscriber_id, api_token, '/business/list', {}, 25000, activeAuthHeader);
        const list = extractList(cl);
        const clinicUpserts = list.map((c: any) => ({
          id: pickFirst(c, 'Id', 'id', 'BusinessId', 'Clinic_BusinessId', 'ClinicBusinessId', 'CompanyId') || '0',
          tenant_id,
          name: pickFirst(c, 'Name', 'name', 'BusinessName') || '',
          business_name: pickFirst(c, 'BusinessName', 'Name') || '',
          address: pickFirst(c, 'Address', 'address') || '',
          email: pickFirst(c, 'Email', 'email') || '',
          raw: c,
          synced_at: new Date().toISOString()
        })).filter(c => c.id !== '0');
        
        if (clinicUpserts.length) {
          await supabase.from('clinicorp_clinics').upsert(clinicUpserts, { onConflict: 'id,tenant_id' });
          summary.clinics = clinicUpserts.length;
          clinicIds = clinicUpserts.map(c => String(c.id));
        }
        log(`clinics status=${status} count=${list.length}`);
        if (status === 429) throw new Error('Rate Limit na listagem de clínicas.');
      } catch (e: any) { 
        if (e.message.includes('Rate Limit')) throw e;
        errors.push(`clinicas: ${e.message}`); 
      }

      await updateProgress('Buscando profissionais...');

      // 2. Profissionais
      try {
        const { status, data: pr } = await clinicorpProbe(base_url, subscriber_id, api_token, '/professional/list_all_professionals', {}, 25000, activeAuthHeader);
        const list = extractList(pr);
        log(`dentists status=${status} count=${list.length}`);
        
        const dentistUpserts = [];
        for (const d of list) {
          const id = String(pickFirst(d, 'Id', 'id', 'PersonId', 'Person_Id', 'Dentist_PersonId', 'DentistPersonId', 'Professional_PersonId', 'DentistId', 'professional_id', 'ProfessionalId', 'dentist_id', 'ScheduleToId') ?? '');
          const nome = String(pickFirst(d, 'FullName', 'Name', 'full_name', 'name', 'professional_name', 'ProfessionalName', 'Dentist_FullName', 'Dentist_Name', 'ScheduleToName') ?? '').trim();

          if (!id || !nome) continue;
          dentistUpserts.push({
            tenant_id, nome,
            especialidade: pickFirst(d, 'Speciality', 'Specialty', 'specialty', 'category_name', 'CategoryName') ?? null,
            email: pickFirst(d, 'Email', 'email') ?? null,
            cro: pickFirst(d, 'Cro', 'CRO', 'cro', 'identity_number') ?? null,
            clinicorp_professional_id: id,
            ativo: true,
          });
        }
        if (dentistUpserts.length) {
          // Mirror table sync
          const mirrorProfs = dentistUpserts.map(d => ({
            id: d.clinicorp_professional_id,
            tenant_id: d.tenant_id,
            full_name: d.nome,
            user_name: d.email,
            synced_at: new Date().toISOString()
          }));
          await supabase.from('clinicorp_professionals').upsert(mirrorProfs, { onConflict: 'id,tenant_id' });

          const { error: upErr } = await supabase.from('dentistas').upsert(dentistUpserts, { onConflict: 'tenant_id,clinicorp_professional_id' });
          if (upErr) errors.push(`profissionais upsert: ${upErr.message}`);
          else summary.professionals = dentistUpserts.length;
        }
        if (status === 429) throw new Error('Rate Limit na listagem de profissionais.');
      } catch (e: any) { 
        if (e.message.includes('Rate Limit')) throw e;
        errors.push(`profissionais: ${e.message}`); 
      }

      await updateProgress('Buscando agenda (paralelo)...');

      // 3. Agendamentos
      const today = new Date();
      const from = data.from || ymd(new Date(today.getTime() - 7 * 86400000));
      const to = data.to || ymd(new Date(today.getTime() + 365 * 86400000));

      log(`appointments range ${from} → ${to}`);

      // 3.1 Categorias e Especialidades (Novas)
      try {
        await updateProgress('Sincronizando categorias e especialidades...');
        const [{ data: cats }, { data: specs }] = await Promise.all([
          clinicorpProbe(base_url, subscriber_id, api_token, '/appointment/list_categories', {}, 20000, activeAuthHeader),
          clinicorpProbe(base_url, subscriber_id, api_token, '/professional/list_specialties', {}, 20000, activeAuthHeader)
        ]);

        const catList = extractList(cats);
        const specList = extractList(specs);

        if (catList.length) {
          const catUpserts = catList.map((c: any) => ({
            id: pickFirst(c, 'Id', 'id') || '0',
            tenant_id,
            description: pickFirst(c, 'Description', 'description', 'Name', 'name') || '',
            color: pickFirst(c, 'Color', 'color') || null,
            raw: c,
            synced_at: new Date().toISOString()
          })).filter((c: any) => c.id !== '0');
          await supabase.from('clinicorp_appointment_categories').upsert(catUpserts, { onConflict: 'id,tenant_id' });
        }

        if (specList.length) {
          const specUpserts = specList.map((s: any) => ({
            id: pickFirst(s, 'Id', 'id') || '0',
            tenant_id,
            description: pickFirst(s, 'Description', 'description', 'Name', 'name') || '',
            raw: s,
            synced_at: new Date().toISOString()
          })).filter((s: any) => s.id !== '0');
          await supabase.from('clinicorp_specialties').upsert(specUpserts, { onConflict: 'id,tenant_id' });
        }
      } catch (e: any) {
        errors.push(`categorias/especialidades: ${e.message}`);
      }


      const chunks: { from: string; to: string }[] = [];
      {
        let current = new Date(from + 'T00:00:00Z');
        const end = new Date(to + 'T00:00:00Z');
        while (current <= end) {
          const next = new Date(current.getTime() + 14 * 86400000); // Chunks de 14 dias
          const toDs = next < end ? next : end;
          chunks.push({ from: ymd(current), to: ymd(toDs) });
          current = new Date(toDs.getTime() + 86400000);
        }
      }

      const allAppts: any[] = [];
      let rateLimitHit = false;
      const CONCURRENCY = 1; 
      for (let i = 0; i < chunks.length && !rateLimitHit; i += CONCURRENCY) {
        const batch = chunks.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(c =>
          clinicorpProbe(base_url, subscriber_id, api_token, '/appointment/list', { from: c.from, to: c.to }, 30000, activeAuthHeader)
            .then(res => ({ ds: c.from, ...res }))
        ));
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const { ds, status, data: ap } = r.value;
            if (status === 429) {
              errors.push(`Rate limit em ${ds}. Parando sincronização para proteger a conta.`);
              rateLimitHit = true;
              break;
            }
            const list = extractList(ap);
            if (list.length) allAppts.push(...list);
          } else {
            errors.push(`appt chunk: ${(r.reason as any)?.message || 'erro'}`);
          }
        }
        if (rateLimitHit) break;
        summary.appointments = allAppts.length;
        await updateProgress(`Agenda: ${Math.min(i + CONCURRENCY, chunks.length)}/${chunks.length} janelas (${allAppts.length} agendamentos)`);
        await new Promise(r => setTimeout(r, 500)); 
      }
      log(`appointments total coletados=${allAppts.length}`);
      if (rateLimitHit) {
        throw new Error('A sincronização foi interrompida devido ao limite de chamadas da Clinicorp (Rate Limit). Aguarde 15-30 minutos.');
      }

      await updateProgress('Sincronizando pacientes...');

      // 4. Pacientes — Backfill a partir dos agendamentos
      const patientSeeds = new Map<string, { name?: string; phone?: string; email?: string; cpf?: string; sex?: string; birthDate?: string }>();
      for (const a of allAppts) {
        const pid = String(pickFirst(a, 'PatientId', 'Patient_PersonId', 'PatientPersonId', 'PersonId', 'Person_Id', 'Patient_Id', 'patient_id', 'id_paciente') ?? a?.Patient?.Id ?? a?.Patient?.id ?? a?.Patient?.PersonId ?? '');
        if (!pid) continue;
        if (!patientSeeds.has(pid)) {
          patientSeeds.set(pid, {
            name: pickFirst(a, 'PatientName', 'Patient_FullName', 'Patient_Name', 'PatientFullName', 'patient_name', 'nome_paciente') ?? a?.Patient?.Name ?? a?.Patient?.FullName ?? a?.Patient?.nome,
            phone: pickFirst(a, 'Patient_MobilePhone', 'PatientMobilePhone', 'Patient_Phone', 'PatientPhone', 'MobilePhone', 'mobile_phone', 'celular_paciente') ?? a?.Patient?.MobilePhone ?? a?.Patient?.celular,
            email: pickFirst(a, 'Patient_Email', 'PatientEmail', 'Email', 'email', 'email_paciente') ?? a?.Patient?.Email ?? a?.Patient?.email,
            cpf: pickFirst(a, 'Patient_Cpf', 'PatientCpf', 'Patient_CPF', 'PatientCPF', 'Cpf', 'cpf', 'cpf_paciente') ?? a?.Patient?.Cpf ?? a?.Patient?.CPF ?? a?.Patient?.cpf,
            sex: pickFirst(a, 'Patient_Sex', 'PatientSex', 'Patient_Gender', 'PatientGender', 'Sex', 'Gender', 'sexo_paciente') ?? a?.Patient?.Sex ?? a?.Patient?.Gender ?? a?.Patient?.sexo,
            birthDate: pickFirst(a, 'Patient_BirthDate', 'PatientBirthDate', 'Patient_BirthDay', 'PatientBirthday', 'BirthDate', 'BirthDay', 'data_nascimento_paciente') ?? a?.Patient?.BirthDate ?? a?.Patient?.BirthDay ?? a?.Patient?.data_nascimento,
          });
        }
      }
      
      const patientUpserts = [];
      for (const [pid, info] of patientSeeds) {
        const nome = (info.name || '').trim();
        if (!nome) continue;

        // Map gender
        let sexo: 'M' | 'F' | 'O' | null = null;
        const s = String(info.sex || '').toUpperCase();
        if (s.startsWith('M')) sexo = 'M';
        else if (s.startsWith('F')) sexo = 'F';
        else if (s) sexo = 'O';

        patientUpserts.push({
          tenant_id, nome,
          celular: info.phone || null,
          email: info.email || null,
          cpf: info.cpf || null,
          sexo,
          data_nascimento: info.birthDate ? String(info.birthDate).slice(0, 10) : null,
          clinicorp_patient_id: pid,
        });
      }

      // Batch upsert patients in chunks
      for (let i = 0; i < patientUpserts.length; i += 200) {
        const chunk = patientUpserts.slice(i, i + 200);
        
        // Populate main table
        const { error: upErr } = await supabase.from('pacientes').upsert(chunk, { onConflict: 'tenant_id,clinicorp_patient_id' });
        
        // Populate mirror table (New)
        const mirrorPatients = chunk.map(p => ({
          id: p.clinicorp_patient_id,
          tenant_id: p.tenant_id,
          name: p.nome,
          email: p.email,
          mobile_phone: p.celular,
          birth_date: p.data_nascimento,
          sex: p.sexo,
          synced_at: new Date().toISOString()
        })).filter(p => p.id); // Garante que temos ID

        if (mirrorPatients.length) {
          const { error: mirrorErr } = await supabase.from('clinicorp_patients').upsert(mirrorPatients, { onConflict: 'id,tenant_id' });
          if (mirrorErr) log('Error syncing mirror clinicorp_patients', mirrorErr);
        }

        if (upErr) errors.push(`pacientes chunk ${i}: ${upErr.message}`);
        else summary.patients += chunk.length;
        await updateProgress(`Salvando pacientes: ${summary.patients}/${patientUpserts.length}`);
      }


      await updateProgress('Finalizando agendamentos...');

      // 5. Upsert agendamentos (após pacientes/dentistas existirem)
      const { data: myProfs } = await supabase.from('dentistas').select('id, clinicorp_professional_id').eq('tenant_id', tenant_id);
      const { data: myPas } = await supabase.from('pacientes').select('id, clinicorp_patient_id').eq('tenant_id', tenant_id);

      const profMap = new Map<string, string>((myProfs || []).filter((p: any) => p.clinicorp_professional_id).map((p: any) => [String(p.clinicorp_professional_id), p.id]));
      const paMap = new Map<string, string>((myPas || []).filter((p: any) => p.clinicorp_patient_id).map((p: any) => [String(p.clinicorp_patient_id), p.id]));

      const appointmentUpserts = [];
      for (const a of allAppts) {
        const apId = String(pickFirst(a, "Id", "id", "ID", "AppointmentId", "AppointmentID", "Appointment_Id", "appointment_id", "appointmentId", "ScheduleId", "Schedule_ID", "id_agendamento", "AtomicId") ?? "");
        const apDate = normalizeClinicorpDate(pickFirst(a, "Date", "date", "AppointmentDate", "Appointment_Date", "SK_DateFirstTime", "DateFirstTime", "StartDate", "StartDateTime", "StartTime", "fromTime", "FromTime", "appointment_date", "AtomicDate", "data", "data_agendamento"));
        const apTime = normalizeClinicorpTime(pickFirst(a, "FromTime", "Time", "StartTime", "StartDateTime", "ScheduleTime", "Hour", "fromTime", "from_time", "hora", "toTime", "hora_agendamento"));


        if (!apId || !apDate || !apTime) {
          if (allAppts.indexOf(a) === 0 || allAppts.length < 5) {
            log("Appointment skip - missing fields:", { apId, apDate, apTime, keys: Object.keys(a).slice(0, 20) });
          }
          continue;
        }

        const pid = String(pickFirst(a, "PatientId", "Patient_PersonId", "PatientPersonId", "Patient_Id", "patient_id", "id_paciente") ?? a?.Patient?.Id ?? a?.Patient?.id ?? "");
        const did = String(pickFirst(a, "ProfessionalId", "Dentist_PersonId", "DentistPersonId", "Professional_PersonId", "ScheduleToId", "DentistId", "professional_id", "dentist_id", "id_profissional") ?? a?.Dentist?.Id ?? a?.Dentist?.id ?? "");
        
        const procedimento = pickFirst(a, "Category_Description", "CategoryDescription", "procedure", "Procedure", "description", "Description", "category_name") ?? "";
        const categoriaCor = pickFirst(a, "CategoryColor", "Category_Color", "Color", "category_color") ?? null;

        appointmentUpserts.push({
          tenant_id,
          paciente_id: paMap.get(pid) || null,
          dentista_id: profMap.get(did) || null,
          data: apDate,
          hora: apTime,
          duracao: Number(pickFirst(a, "Duration", "duration", "minutes", "Minutes", "ProceduresDuration") ?? 30),
          procedimento: procedimento,
          categoria: procedimento,
          categoria_cor: categoriaCor,
          status: mapAppointmentStatus(pickFirst(a, "Status", "status", "status_name", "StatusName", "StatusId", "StatusDescription")),
          clinicorp_appointment_id: apId,
        });
      }

      if (allAppts.length > 0 && appointmentUpserts.length === 0) {
        const first = allAppts[0];
        errors.push(`Aviso: ${allAppts.length} agendamentos recebidos, mas nenhum pôde ser processado. Verifique os campos: ${Object.keys(first).join(", ")}`);
        log("DEBUG: First appt keys", Object.keys(first));
        log("DEBUG: First appt sample values", { 
          id: pickFirst(first, "Id", "id", "AppointmentId"),
          date: pickFirst(first, "Date", "date", "AtomicDate"),
          time: pickFirst(first, "FromTime", "fromTime")
        });
      }

      // Batch upsert appointments in chunks
      let apptsSaved = 0;
      for (let i = 0; i < appointmentUpserts.length; i += 200) {
        const chunk = appointmentUpserts.slice(i, i + 200);
        
        // Save to mirror table first
        const mirrorChunk = chunk.map(a => {
          const raw = allAppts.find(rawA => String(getAppointmentId(rawA)) === String(a.clinicorp_appointment_id));
          return {
            id: a.clinicorp_appointment_id,
            tenant_id: a.tenant_id,
            date: a.data,
            raw: raw ? JSON.stringify(raw) : null,
            synced_at: new Date().toISOString()
          };
        });
        await supabase.from('clinicorp_appointments').upsert(mirrorChunk, { onConflict: 'id,tenant_id' });

        const { error: upErr } = await supabase.from('agendamentos').upsert(chunk, { onConflict: 'tenant_id,clinicorp_appointment_id' });
        if (upErr) {
          log(`AGENDAMENTOS UPSERT ERROR chunk ${i}`, upErr);
          errors.push(`agendamentos chunk ${i}: ${upErr.message}`);
        } else {
          apptsSaved += chunk.length;
        }
        await updateProgress(`Salvando agenda: ${apptsSaved}/${appointmentUpserts.length}`);
      }
      summary.appointments = apptsSaved;

      // 6. Orçamentos e Financeiro
      await updateProgress('Buscando orçamentos e financeiro...');
      const finFrom = data.from || ymd(new Date(today.getTime() - 90 * 86400000));
      const finTo = data.to || ymd(new Date(today.getTime() + 30 * 86400000));

      for (const clinicId of (clinicIds.length ? clinicIds : [undefined])) {
        // Estimates
        try {
          const estEndpoints = ['/estimates/list', '/budget/list', '/treatment/list'];
          let estList: any[] = [];
          
          for (const ep of estEndpoints) {
            const { status, data: estData } = await clinicorpProbe(base_url, subscriber_id, api_token, ep, { 
              from: finFrom, to: finTo, ...(clinicId ? { clinic_id: clinicId } : {}) 
            }, 30000, activeAuthHeader);
            
            if (status === 200) {
              const list = extractList(estData);
              if (list.length) {
                estList = list;
                log(`Estates found using ${ep}: ${list.length}`);
                break;
              }
            }
          }

          if (estList.length) {
            const estUpserts = estList.map((e: any) => ({
              id: pickFirst(e, 'Id', 'id', 'treatment_id', 'estimate_id', 'EstimateId') || '0',
              tenant_id,
              treatment_id: pickFirst(e, 'treatment_id', 'Id', 'id', 'estimate_id'),
              patient_id: pickFirst(e, 'patient_id', 'PatientId', 'Patient_PersonId'),
              patient_name: pickFirst(e, 'patient_name', 'PatientName', 'Patient_FullName'),
              professional_id: pickFirst(e, 'professional_id', 'ProfessionalId', 'Professional_PersonId'),
              professional_name: pickFirst(e, 'professional_name', 'ProfessionalName', 'Professional_FullName'),
              business_id: clinicId || pickFirst(e, 'business_id', 'ClinicId', 'BusinessId'),
              amount: pickFirst(e, 'amount', 'total_amount', 'value', 'TotalValue', 'total_value') || 0,
              status: pickFirst(e, 'status', 'status_name', 'StatusDescription') || 'Pendente',
              date: normalizeClinicorpDate(pickFirst(e, 'date', 'create_date', 'EstimateDate')),
              create_date: normalizeClinicorpDate(pickFirst(e, 'create_date', 'date')),
              raw: e,
              synced_at: new Date().toISOString()
            })).filter(e => e.id !== '0');
            await supabase.from('clinicorp_estimates').upsert(estUpserts, { onConflict: 'id,tenant_id' });
            summary.estimates += estUpserts.length;
          }
        } catch (e: any) { errors.push(`orçamentos (${clinicId || 'global'}): ${e.message}`); }

        // Financial (Invoices/Payments)
        const finEndpoints = [
          { key: 'invoice', path: '/financial/list_invoices' },
          { key: 'payment', path: '/financial/list_payments' },
          { key: 'cashflow', path: '/financial/list_cash_flow' }
        ];

        for (const ep of finEndpoints) {
          try {
            const { data: finData } = await clinicorpProbe(base_url, subscriber_id, api_token, ep.path, {
              from: finFrom, to: finTo, ...(clinicId ? { business_id: clinicId } : {})
            }, 30000, activeAuthHeader);
            const finList = extractList(finData);
            if (finList.length) {
              const finUpserts = finList.map((f: any) => ({
                tenant_id,
                source: ep.key,
                external_id: String(pickFirst(f, 'Id', 'id', 'InvoiceId', 'PaymentId', 'CashFlowId') || ''),
                business_id: clinicId || pickFirst(f, 'business_id', 'BusinessId'),
                patient_id: pickFirst(f, 'patient_id', 'PatientId'),
                amount: pickFirst(f, 'amount', 'value', 'total') || 0,
                date: normalizeClinicorpDate(pickFirst(f, 'date', 'vencimento', 'Data')),
                description: pickFirst(f, 'description', 'memo', 'Note') || '',
                raw: f,
                synced_at: new Date().toISOString()
              })).filter(f => f.external_id !== '');
              
              if (finUpserts.length) {
                await supabase.from('clinicorp_financial_entries').upsert(finUpserts, { onConflict: 'source,external_id,tenant_id' });
                summary.financial += finUpserts.length;
              }
            }
          } catch (e: any) { errors.push(`${ep.key} (${clinicId || 'global'}): ${e.message}`); }
        }
      }

      log('summary', summary);
      const finalStatus = errors.length > 3 ? 'partial' : 'success';
      
      // 7. Gravar log de auditoria do sync (Novo)
      try {
        await supabase.from('clinicorp_push_log').insert({
          tenant_id,
          entity_type: 'sync_summary',
          action: 'bulk_sync',
          status: finalStatus,
          payload: { summary, from, to },
          error_message: errors.length ? errors.join(' | ') : null
        });
      } catch (logErr) {
        log('Audit log error', logErr);
      }

      await supabase.from('clinicorp_user_settings').update({
        last_sync_status: finalStatus,
        last_sync_at: new Date().toISOString(),
        last_sync_error: errors.length ? errors.slice(0, 3).join(' | ') : null,
        sync_progress: { summary, step: 'Concluído', completed: true, timestamp: new Date().toISOString() }
      }).eq('user_id', userId);


      return { ok: true, status: finalStatus, summary, errors: errors.slice(0, 20), from, to };
    } catch (err: any) {
      const msg = err.message || 'Erro desconhecido';
      log('FATAL', msg);
      await supabase.from('clinicorp_user_settings').update({
        last_sync_status: 'error',
        last_sync_error: msg,
        sync_progress: { summary, step: 'Erro fatal: ' + msg, failed: true, timestamp: new Date().toISOString() }
      }).eq('user_id', userId);
      throw err;
    }
  });
