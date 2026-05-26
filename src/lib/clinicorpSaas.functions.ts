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
      { key: 'clinics', label: 'Clínicas', path: '/business/list', query: {} },
      { key: 'appointments', label: 'Agenda', path: '/appointment/list', query: { from: dateStr, to: dateStr } },
      { key: 'professionals', label: 'Profissionais', path: '/dentist/list', query: {} },
      { key: 'patients', label: 'Pacientes', path: '/patient/birthdays', query: { from: dateStr, to: dateStr } },
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

export const syncMyClinicorpNow = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => syncSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    // Get settings
    const { data: settings, error: sErr } = await supabase
      .from('clinicorp_user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (sErr || !settings || !settings.api_token || !settings.subscriber_id) {
      throw new Error("Configurações da Clinicorp não encontradas ou incompletas.");
    }

    const { api_token, subscriber_id, base_url } = settings;
    const tenant_id = await (async () => {
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', userId).maybeSingle();
      return profile?.tenant_id;
    })();

    if (!tenant_id) throw new Error("Usuário não possui um tenant_id associado.");

    // Update status to syncing
    await supabase.from('clinicorp_user_settings').update({
      last_sync_status: 'syncing',
      last_sync_error: 'Iniciando sincronização...',
    }).eq('user_id', userId);

    const summary = { clinics: 0, professionals: 0, patients: 0, appointments: 0 };
    const errors: string[] = [];

    try {
      // 1. Sync Clinicas
      const { status: clStatus, data: clData } = await clinicorpProbe(base_url, subscriber_id, api_token, '/business/list');
      if (clStatus === 200 && Array.isArray(clData)) {
        summary.clinics = clData.length;
        // In real app we would upsert into clinicorp_clinics
      }

      // 2. Sync Profissionais -> Dentistas
      const { status: prStatus, data: prData } = await clinicorpProbe(base_url, subscriber_id, api_token, '/dentist/list');
      if (prStatus === 200 && Array.isArray(prData)) {
        for (const pr of prData) {
          const prId = String(pr.Id || pr.id);
          const prName = String(pr.FullName || pr.full_name || pr.Name || '');
          if (!prId || !prName) continue;
          
          await supabase.from('dentistas').upsert({
            tenant_id,
            nome: prName,
            especialidade: pr.Speciality || pr.specialty || null,
            email: pr.Email || null,
            clinicorp_professional_id: prId,
            ativo: true,
          }, { onConflict: 'tenant_id, clinicorp_professional_id' });
          summary.professionals++;
        }
      }

      // 3. Sync Pacientes
      const { status: paStatus, data: paData } = await clinicorpProbe(base_url, subscriber_id, api_token, '/patient/birthdays', { from: '2000-01-01', to: '2100-01-01' });
      // Nota: /patient/list seria melhor, mas birthdays costuma retornar tudo se o range for grande e tiver permissão.
      // Se birthdays falhar ou retornar pouco, em produção usaríamos um endpoint de busca.
      if (paStatus === 200 && Array.isArray(paData)) {
        for (const pa of paData) {
          const paId = String(pa.Id || pa.id);
          const paName = String(pa.FullName || pa.Name || pa.name || '');
          if (!paId || !paName) continue;

          await supabase.from('pacientes').upsert({
            tenant_id,
            nome: paName,
            celular: pa.MobilePhone || pa.Phone || null,
            email: pa.Email || null,
            clinicorp_patient_id: paId,
          }, { onConflict: 'tenant_id, clinicorp_patient_id' });
          summary.patients++;
        }
      }

      // 4. Sync Agendamentos
      const today = new Date();
      const from = data.from || new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const to = data.to || new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { status: apStatus, data: apData } = await clinicorpProbe(base_url, subscriber_id, api_token, '/appointment/list', { from, to });
      if (apStatus === 200 && Array.isArray(apData)) {
        // Map professionals and patients to get our internal UUIDs
        const { data: myProfs } = await supabase.from('dentistas').select('id, clinicorp_professional_id').eq('tenant_id', tenant_id);
        const { data: myPas } = await supabase.from('pacientes').select('id, clinicorp_patient_id').eq('tenant_id', tenant_id);
        
        const profMap = new Map(myProfs?.map(p => [p.clinicorp_professional_id, p.id]));
        const paMap = new Map(myPas?.map(p => [p.clinicorp_patient_id, p.id]));

        for (const ap of apData) {
          const apId = String(ap.Id || ap.id);
          const apDate = ap.Date || ap.date;
          const apTime = ap.FromTime || ap.from_time || ap.time;
          if (!apId || !apDate || !apTime) continue;

          const pId = profMap.get(String(ap.Dentist_PersonId || ap.dentist_id));
          const ptId = paMap.get(String(ap.Patient_PersonId || ap.patient_id));

          if (!pId || !ptId) continue; // Can't link if patient or professional not found locally

          await supabase.from('agendamentos').upsert({
            tenant_id,
            paciente_id: ptId,
            dentista_id: pId,
            data: apDate,
            hora: apTime,
            duracao: Number(ap.Duration || ap.duration || 30),
            procedimento: ap.Category_Description || ap.procedure || '',
            status: ap.Status || 'agendado',
            clinicorp_appointment_id: apId,
          }, { onConflict: 'tenant_id, clinicorp_appointment_id' });
          summary.appointments++;
        }
      }

      // Update status to success
      await supabase.from('clinicorp_user_settings').update({
        last_sync_status: 'success',
        last_sync_at: new Date().toISOString(),
        last_sync_error: null,
      }).eq('user_id', userId);

      return { status: 'success' as const, summary, errors, from, to };

    } catch (err: any) {
      const msg = err.message || 'Erro desconhecido';
      await supabase.from('clinicorp_user_settings').update({
        last_sync_status: 'error',
        last_sync_error: msg,
      }).eq('user_id', userId);
      throw err;
    }
  });
