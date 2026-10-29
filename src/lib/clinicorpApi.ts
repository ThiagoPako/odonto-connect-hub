/**
 * Clinicorp integration API client (frontend → VPS).
 * Tudo passa pela VPS (credenciais, sincronização, espelho, webhook, push);
 * não há mais caminho via Supabase.
 */
import { getAuthHeaders } from "@/lib/vpsApi";

const VPS_API_BASE = (() => {
  if (typeof window === 'undefined') return 'https://backend.odontoconnect.tech/api';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return '/api';
  if (host.includes('lovableproject.com') || host.includes('lovable.app') || host.includes('lovable.dev')) {
    return 'https://backend.odontoconnect.tech/api';
  }
  return 'https://backend.odontoconnect.tech/api';
})();

const API_BASE = `${VPS_API_BASE}/clinicorp`;
const WEBHOOK_BASE = `${VPS_API_BASE}/webhook/clinicorp`;

class ClinicorpHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T = unknown>(path: string, init: RequestInit = {}, base: string = API_BASE): Promise<T> {
  const doFetch = async (forceRefresh: boolean) => fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders(forceRefresh)),
      ...(init.headers || {}),
    },
  });
  let res = await doFetch(false);
  if (res.status === 401) res = await doFetch(true);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (typeof data === 'string' && /<!DOCTYPE html>|<html/i.test(data)) {
      throw new ClinicorpHttpError(`Servidor API indisponível (HTTP ${res.status}). Verifique o status do serviço no VPS.`, res.status);
    }
    const msg = (data && typeof data === 'object' && 'error' in data) ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new ClinicorpHttpError(msg, res.status);
  }
  return data as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const str = q.toString();
  return str ? `?${str}` : '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClinicorpUserSettings {
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
  /** Vem da VPS (perfil verificado do usuário logado). */
  is_super_admin?: boolean;
}

export interface ClinicorpSettings {
  enabled: boolean;
  subscriber_id: string;
  base_url: string;
  has_api_token: boolean;
  has_webhook_secret: boolean;
  webhook_secret_preview: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  sync_lookback_days: number;
  sync_lookahead_days: number;
  next_sync_at: string | null;
  sync_lock_until: string | null;
  conflict_strategy: 'clinicorp_wins' | 'local_wins' | 'newest_wins';
}

export interface ClinicorpOverride {
  id: number;
  scope_type: 'global' | 'clinic' | 'professional';
  scope_id: string | null;
  keep_local: boolean;
  conflict_strategy: 'clinicorp_wins' | 'local_wins' | 'newest_wins' | null;
  note: string | null;
  updated_at: string;
}

export interface ClinicorpOverrideHistory {
  id: number;
  override_id: number | null;
  action: 'create' | 'update' | 'delete';
  scope_type: 'global' | 'clinic' | 'professional';
  scope_id: string | null;
  scope_label: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  changed_by: string | null;
  note: string | null;
  created_at: string;
}

export interface ClinicorpConflict {
  id: number;
  entity: 'appointment' | 'patient';
  clinicorp_id: string | null;
  local_id: string | null;
  decision: string;
  strategy: string;
  scope_type: string | null;
  scope_id: string | null;
  local_updated_at: string | null;
  clinicorp_updated_at: string | null;
  last_sync_at: string | null;
  diff: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  paciente_id: string | null;
  lead_id: string | null;
  agendamento_id: string | null;
  paciente_nome: string | null;
  lead_id_resolved: string | null;
  lead_stage: string | null;
  created_at: string;
}

export interface ClinicorpAuditEntry {
  id: number;
  source: 'clinicorp' | 'odonto_connect';
  event: string;
  status: string;
  target_id: string | null;
  timestamp: string;
  payload: any;
  error_message: string | null;
}

export interface ClinicorpWebhookEvent {
  id: number;
  event_type: string | null;
  external_id: string | null;
  status: 'received' | 'processed' | 'error' | 'ignored';
  error_message: string | null;
  received_at: string;
  processed_at: string | null;
}

export interface ClinicorpSyncResult {
  status: 'success' | 'partial' | 'error';
  summary: Record<string, number>;
  errors: string[];
  from: string;
  to: string;
}

type AnyRow = Record<string, any>;

type SyncRange = { from?: string; to?: string; force_metadata?: boolean };

/**
 * POST /sync/now pode demorar mais que o timeout do proxy (agenda de 1 ano).
 * Se a conexão cair (502/503/504 ou rede), a sincronização continua na VPS:
 * acompanhamos /my-settings até sair de "syncing" e devolvemos o resultado
 * gravado em sync_progress.
 */
async function waitForSyncResult(startedAt: number): Promise<ClinicorpSyncResult> {
  const deadline = Date.now() + 45 * 60_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    let s: ClinicorpUserSettings;
    try { s = await clinicorpApi.getMySettings(); } catch { continue; }
    if (s.last_sync_status === 'syncing') continue;
    const finishedAt = s.last_sync_at ? new Date(s.last_sync_at).getTime() : 0;
    if (finishedAt < startedAt - 5000) continue;
    const progress = s.sync_progress || {};
    if (progress.result) return progress.result as ClinicorpSyncResult;
    if (s.last_sync_status === 'error' || s.last_sync_status === 'rate_limited') {
      throw new Error(s.last_sync_error || 'Falha na sincronização Clinicorp');
    }
    return {
      status: (s.last_sync_status as ClinicorpSyncResult['status']) || 'success',
      summary: progress.summary || {},
      errors: s.last_sync_error ? [s.last_sync_error] : [],
      from: '',
      to: '',
    };
  }
  throw new Error('A sincronização ainda está em andamento. Acompanhe o status na tela de integração.');
}

export const clinicorpApi = {
  // ── Espelho Clinicorp (tabelas clinicorp_* da VPS, escopo do tenant) ──
  listClinics: () => req<AnyRow[]>('/clinics'),
  listProfessionals: () => req<AnyRow[]>('/professionals'),
  listCategories: () => req<AnyRow[]>('/categories'),
  listSpecialties: () => req<AnyRow[]>('/specialties'),
  listPatients: (search?: string) => req<AnyRow[]>(`/patients${qs({ search })}`),
  listAppointments: (params: { from?: string; to?: string; professional_id?: string | number; business_id?: string | number } = {}) =>
    req<any[]>(`/appointments${qs({
      from: params.from,
      to: params.to,
      professional_id: params.professional_id && params.professional_id !== 'all' ? params.professional_id : undefined,
      business_id: params.business_id,
    })}`),
  listEstimates: () => req<AnyRow[]>('/estimates'),
  listFinancial: (limit = 200) => req<AnyRow[]>(`/financial${qs({ limit })}`),
  listChairs: () => req<AnyRow[]>('/chairs'),

  listWebhookEvents: (limit = 50) => req<ClinicorpWebhookEvent[]>(`/webhook-events?limit=${limit}`),
  getWebhookEvent: (id: number) => req<ClinicorpWebhookEvent & { payload: unknown; headers: unknown; ip: string }>(`/webhook-events/${id}`),
  // Reprojeta o espelho Clinicorp da clínica do usuário nas tabelas do app
  // (pacientes, dentistas, agendamentos, orçamentos, financeiro).
  reproject: () => req<{ ok: true; patients: number; appointments: number; professionals: number; estimates?: number; financial?: number; errors?: number }>(
    '/reproject', { method: 'POST', body: '{}' },
  ),
  listOverrides: () => req<ClinicorpOverride[]>('/overrides'),
  upsertOverride: (payload: Partial<Pick<ClinicorpOverride, 'scope_type' | 'scope_id' | 'keep_local' | 'conflict_strategy' | 'note'>> & { scope_label?: string }) =>
    req<{ ok: true; override: ClinicorpOverride }>('/overrides', { method: 'PUT', body: JSON.stringify(payload) }),
  deleteOverride: (id: number) => req<{ ok: true }>(`/overrides/${id}`, { method: 'DELETE' }),
  listOverrideHistory: (params: { limit?: number; scope_type?: string; scope_id?: string } = {}) =>
    req<ClinicorpOverrideHistory[]>(`/overrides/history${qs({ limit: params.limit ?? 100, scope_type: params.scope_type, scope_id: params.scope_id })}`),
  listConflicts: (params: { limit?: number; entity?: 'appointment' | 'patient'; decision?: string } = {}) =>
    req<ClinicorpConflict[]>(`/conflicts${qs({ limit: params.limit ?? 100, entity: params.entity, decision: params.decision })}`),
  setKeepLocal: (entity: 'appointment' | 'patient', id: string, keep_local: boolean) =>
    req<{ ok: true }>('/keep-local', { method: 'PUT', body: JSON.stringify({ entity, id, keep_local }) }),

  // ── Credenciais por usuário (SaaS) — VPS ──
  getMySettings: () => req<ClinicorpUserSettings>('/my-settings'),
  saveMySettings: (payload: Partial<{
    enabled: boolean;
    api_token: string;
    subscriber_id: string;
    webhook_secret: string;
    base_url: string;
  }>) => req<{ ok: true }>('/my-settings', { method: 'PUT', body: JSON.stringify(payload) }),
  deleteMySettings: () => req<{ ok: true }>('/my-settings', { method: 'DELETE' }),
  testMyConnection: (payload: Partial<{ api_token: string; subscriber_id: string; base_url: string }> = {}) =>
    req<ClinicorpConnectionTest>('/my-settings/test', { method: 'POST', body: JSON.stringify(payload) }),
  syncMyNow: async (range?: SyncRange): Promise<ClinicorpSyncResult> => {
    const startedAt = Date.now();
    try {
      return await req<ClinicorpSyncResult>('/sync/now', { method: 'POST', body: JSON.stringify(range || {}) });
    } catch (e) {
      const status = e instanceof ClinicorpHttpError ? e.status : 0;
      const connectionDropped = e instanceof TypeError || status === 502 || status === 503 || status === 504;
      if (!connectionDropped) throw e;
      return waitForSyncResult(startedAt);
    }
  },
  listAuditLogs: (limit = 100) => req<ClinicorpAuditEntry[]>(`/audit-log?limit=${limit}`),
};

export interface ClinicorpConnectionTest {
  ok: boolean;
  auth: 'valid' | 'invalid_token' | 'partial' | 'rate_limited';
  rate_limited?: boolean;
  retry_after_seconds?: number | null;
  total_latency_ms: number;
  base_url: string;
  subscriber_id: string;
  error?: string;
  results: Array<{
    key: string;
    label: string;
    path: string;
    ok: boolean;
    latency_ms: number;
    count?: number;
    status?: number | null;
    error?: string;
    retry_after_seconds?: number | null;
  }>;
}

export function buildWebhookUrl(secret: string): string {
  return `${WEBHOOK_BASE}?user_api=${encodeURIComponent(secret || '<seu-secret>')}`;
}

export function generateWebhookSecret(length = 40): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}
