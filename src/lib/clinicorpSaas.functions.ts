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
    updated_at: row.updated_at,
  };
}

export const getMyClinicorpSettings = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data, error } = await supabase
      .from('clinicorp_user_settings')
      .select('enabled, subscriber_id, base_url, api_token, webhook_secret, last_sync_at, last_sync_status, last_sync_error, updated_at')
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
  timeoutMs = 15000,
): Promise<{ status: number; data: unknown }> {
  const base = base_url.replace(/\/$/, '');
  const url = new URL(base + pathName);
  const cleanToken = api_token.replace(/^Bearer\s+/i, '').trim();
  const cleanUser = subscriber_id.trim();
  url.searchParams.set('subscriber_id', cleanUser);
  url.searchParams.set('user_api', cleanUser);
  url.searchParams.set('api_key', cleanToken);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const basicAuth = `Basic ${btoa(`${cleanUser}:${cleanToken}`)}`;
  const bearerAuth = `Bearer ${cleanToken}`;

  const attempt = async (authHeader: string) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authHeader },
        signal: ctrl.signal,
      });
      const text = await r.text();
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: r.status, data };
    } finally {
      clearTimeout(t);
    }
  };

  let result = await attempt(basicAuth);
  if (result.status === 401) {
    result = await attempt(bearerAuth);
  }
  return result;
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
      { key: 'professionals', label: 'Profissionais', path: '/dentist/list', query: {} as Record<string, string> },
      { key: 'patients', label: 'Pacientes', path: '/patient/birthdays', query: { from: dateStr, to: dateStr } as Record<string, string> },
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
function pickFirst(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

function extractList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const direct = pickFirst(data,
    'Results', 'Result', 'Data', 'data', 'Items', 'items', 'Rows', 'rows', 'Records', 'records',
    'Appointments', 'appointments', 'Patients', 'patients', 'Dentists', 'dentists',
    'Professionals', 'professionals', 'Businesses', 'businesses', 'Clinics', 'clinics',
    'List', 'list',
  );
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') {
    const nested = extractList(direct);
    if (nested.length) return nested;
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = extractList(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
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

    await supabase.from('clinicorp_user_settings').update({
      last_sync_status: 'syncing',
      last_sync_error: 'Iniciando sincronização...',
    }).eq('user_id', userId);

    const summary = { clinics: 0, professionals: 0, patients: 0, appointments: 0 };
    const errors: string[] = [];
    const log = (msg: string, extra?: any) => console.log(`[clinicorp-sync] ${msg}`, extra ?? '');

    try {
      // 1. Clinicas (apenas contagem)
      try {
        const { status, data: cl } = await clinicorpProbe(base_url, subscriber_id, api_token, '/business/list');
        const list = extractList(cl);
        summary.clinics = list.length;
        log(`clinics status=${status} count=${list.length}`);
      } catch (e: any) { errors.push(`clinicas: ${e.message}`); }

      // 2. Profissionais
      try {
        const { status, data: pr } = await clinicorpProbe(base_url, subscriber_id, api_token, '/dentist/list');
        const list = extractList(pr);
        log(`dentists status=${status} count=${list.length}`, list[0]);
        for (const d of list) {
          const id = String(pickFirst(d, 'Id', 'id', 'PersonId', 'Dentist_PersonId', 'DentistId') ?? '');
          const nome = String(pickFirst(d, 'FullName', 'Name', 'full_name', 'name') ?? '').trim();
          if (!id || !nome) continue;
          const up = await supabase.from('dentistas').upsert({
            tenant_id, nome,
            especialidade: pickFirst(d, 'Speciality', 'Specialty', 'specialty') ?? null,
            email: pickFirst(d, 'Email', 'email') ?? null,
            cro: pickFirst(d, 'Cro', 'CRO', 'cro') ?? null,
            clinicorp_professional_id: id,
            ativo: true,
          }, { onConflict: 'tenant_id,clinicorp_professional_id' });
          if (up.error) { errors.push(`dentista ${nome}: ${up.error.message}`); continue; }
          summary.professionals++;
        }
      } catch (e: any) { errors.push(`profissionais: ${e.message}`); }

      // 3. Agendamentos — Clinicorp /appointment/list só aceita from === to. Iterar dia a dia.
      const today = new Date();
      const from = data.from || ymd(new Date(today.getTime() - 30 * 86400000));
      const to = data.to || ymd(new Date(today.getTime() + 60 * 86400000));
      log(`appointments range ${from} → ${to}`);

      const allAppts: any[] = [];
      const start = new Date(from + 'T00:00:00Z');
      const end = new Date(to + 'T00:00:00Z');
      let day = new Date(start);
      let dayCount = 0;
      while (day <= end && dayCount < 120) {
        const ds = ymd(day);
        try {
          const { status, data: ap } = await clinicorpProbe(base_url, subscriber_id, api_token, '/appointment/list', { from: ds, to: ds });
          if (status === 429) { errors.push('rate limited em agendamentos'); break; }
          const list = extractList(ap);
          if (list.length) {
            log(`appt ${ds}: ${list.length}`);
            allAppts.push(...list);
          }
        } catch (e: any) {
          errors.push(`appt ${ds}: ${e.message}`);
        }
        dayCount++;
        day = new Date(day.getTime() + 86400000);
        await new Promise(r => setTimeout(r, 300));
      }
      log(`appointments total coletados=${allAppts.length}`);

      // 4. Pacientes — Clinicorp não expõe /patient/list. Backfill a partir dos agendamentos.
      const patientSeeds = new Map<string, { name?: string; phone?: string; email?: string }>();
      for (const a of allAppts) {
        const pid = String(pickFirst(a, 'PatientId', 'Patient_PersonId', 'PatientPersonId', 'Patient_Id', 'patient_id') ?? a?.Patient?.Id ?? '');
        if (!pid) continue;
        if (!patientSeeds.has(pid)) {
          patientSeeds.set(pid, {
            name: pickFirst(a, 'PatientName', 'Patient_FullName', 'Patient_Name', 'PatientFullName', 'patient_name') ?? a?.Patient?.Name ?? a?.Patient?.FullName,
            phone: pickFirst(a, 'Patient_MobilePhone', 'PatientMobilePhone', 'Patient_Phone', 'PatientPhone') ?? a?.Patient?.MobilePhone,
            email: pickFirst(a, 'Patient_Email', 'PatientEmail') ?? a?.Patient?.Email,
          });
        }
      }
      log(`pacientes seeds=${patientSeeds.size}`);

      for (const [pid, info] of patientSeeds) {
        const nome = (info.name || '').trim();
        if (!nome) continue;
        const up = await supabase.from('pacientes').upsert({
          tenant_id, nome,
          celular: info.phone || null,
          email: info.email || null,
          clinicorp_patient_id: pid,
        }, { onConflict: 'tenant_id,clinicorp_patient_id' });
        if (up.error) { errors.push(`paciente ${nome}: ${up.error.message}`); continue; }
        summary.patients++;
      }

      // 5. Upsert agendamentos (após pacientes/dentistas existirem)
      const { data: myProfs } = await supabase
        .from('dentistas').select('id, clinicorp_professional_id').eq('tenant_id', tenant_id);
      const { data: myPas } = await supabase
        .from('pacientes').select('id, clinicorp_patient_id').eq('tenant_id', tenant_id);

      const profMap = new Map<string, string>(
        (myProfs || []).filter((p: any) => p.clinicorp_professional_id).map((p: any) => [p.clinicorp_professional_id, p.id])
      );
      const paMap = new Map<string, string>(
        (myPas || []).filter((p: any) => p.clinicorp_patient_id).map((p: any) => [p.clinicorp_patient_id, p.id])
      );

      for (const a of allAppts) {
        const apId = String(pickFirst(a, 'Id', 'id', 'AppointmentId', 'AppointmentID', 'Appointment_Id') ?? '');
        const apDate = pickFirst(a, 'Date', 'date', 'AppointmentDate');
        const apTime = pickFirst(a, 'FromTime', 'from_time', 'StartTime', 'time', 'Time');
        if (!apId || !apDate || !apTime) continue;

        const pid = String(pickFirst(a, 'PatientId', 'Patient_PersonId', 'PatientPersonId', 'Patient_Id', 'patient_id') ?? a?.Patient?.Id ?? '');
        const did = String(pickFirst(a, 'ProfessionalId', 'Dentist_PersonId', 'DentistPersonId', 'Professional_PersonId', 'ScheduleToId', 'DentistId', 'professional_id', 'dentist_id') ?? a?.Dentist?.Id ?? '');
        const paciente_id = paMap.get(pid) || null;
        const dentista_id = profMap.get(did) || null;

        const up = await supabase.from('agendamentos').upsert({
          tenant_id,
          paciente_id, dentista_id,
          data: String(apDate).slice(0, 10),
          hora: String(apTime).slice(0, 8),
          duracao: Number(pickFirst(a, 'Duration', 'duration') ?? 30),
          procedimento: pickFirst(a, 'Category_Description', 'CategoryDescription', 'procedure', 'Procedure') ?? '',
          status: String(pickFirst(a, 'Status', 'status') ?? 'agendado'),
          clinicorp_appointment_id: apId,
        }, { onConflict: 'tenant_id,clinicorp_appointment_id' });
        if (up.error) { errors.push(`appt ${apId}: ${up.error.message}`); continue; }
        summary.appointments++;
      }

      log('summary', summary);
      log('errors', errors.slice(0, 10));

      await supabase.from('clinicorp_user_settings').update({
        last_sync_status: errors.length ? 'partial' : 'success',
        last_sync_at: new Date().toISOString(),
        last_sync_error: errors.length ? errors.slice(0, 3).join(' | ') : null,
      }).eq('user_id', userId);

      const status: 'partial' | 'success' = errors.length ? 'partial' : 'success';
      return { status, summary, errors: errors.slice(0, 20), from, to };
    } catch (err: any) {
      const msg = err.message || 'Erro desconhecido';
      log('FATAL', msg);
      await supabase.from('clinicorp_user_settings').update({
        last_sync_status: 'error',
        last_sync_error: msg,
      }).eq('user_id', userId);
      throw err;
    }
  });
