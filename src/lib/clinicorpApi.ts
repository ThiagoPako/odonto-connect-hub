/**
 * Clinicorp integration API client (frontend → VPS).
 */

const VPS_API_BASE = (() => {
  if (typeof window === 'undefined') return 'https://odontoconnect.tech/api';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return '/api';
  if (host.includes('lovableproject.com') || host.includes('lovable.app') || host.includes('lovable.dev')) {
    return 'https://odontoconnect.tech/api';
  }
  return '/api';
})();

const API_BASE = `${VPS_API_BASE}/clinicorp`;
const WEBHOOK_BASE = `${VPS_API_BASE}/webhook/clinicorp`;
const TOKEN_KEY = 'odonto_jwt';

function authHeaders(): HeadersInit {
  const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req<T = unknown>(path: string, init: RequestInit = {}, base: string = API_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data) ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

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
  updated_at: string | null;
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

export const clinicorpApi = {
  getSettings: () => req<ClinicorpSettings>('/settings'),
  saveSettings: (payload: Partial<{
    enabled: boolean;
    api_token: string;
    subscriber_id: string;
    webhook_secret: string;
    base_url: string;
    auto_sync_enabled: boolean;
    sync_interval_minutes: number;
    sync_lookback_days: number;
    sync_lookahead_days: number;
    conflict_strategy: 'clinicorp_wins' | 'local_wins' | 'newest_wins';
  }>) => req<{ ok: true }>('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testConnection: () => req<{ ok: boolean; clinics_count: number; sample: unknown; error?: string }>('/test', { method: 'POST' }),
  sync: (range?: { from?: string; to?: string; force_metadata?: boolean }) =>
    req<ClinicorpSyncResult>('/sync', { method: 'POST', body: JSON.stringify(range || {}) }),
  reconcileNow: () => req<{ ran?: boolean; skipped?: boolean; status?: string; summary?: Record<string, number>; error?: string }>('/reconcile', { method: 'POST' }),
  syncAuto: () => req<{ ran?: boolean; skipped?: boolean; status?: string; summary?: Record<string, number>; error?: string }>('/sync/auto', { method: 'POST' }),
  listClinics: () => req<Array<Record<string, unknown>>>('/clinics'),
  listProfessionals: () => req<Array<Record<string, unknown>>>('/professionals'),
  listCategories: () => req<Array<Record<string, unknown>>>('/categories'),
  listSpecialties: () => req<Array<Record<string, unknown>>>('/specialties'),
  listPatients: (search?: string) => req<Array<Record<string, unknown>>>(`/patients${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  listAppointments: (params: { from?: string; to?: string; professional_id?: string | number; business_id?: string | number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
    return req<Array<Record<string, unknown>>>(`/appointments${qs.toString() ? `?${qs}` : ''}`);
  },
  listEstimates: () => req<Array<Record<string, unknown>>>('/estimates'),
  listFinancial: (limit = 200) => req<Array<Record<string, unknown>>>(`/financial?limit=${limit}`),
  listChairs: () => req<Array<Record<string, unknown>>>('/chairs'),
  listWebhookEvents: (limit = 50) => req<ClinicorpWebhookEvent[]>(`/webhook-events?limit=${limit}`),
  getWebhookEvent: (id: number) => req<ClinicorpWebhookEvent & { payload: unknown; headers: unknown; ip: string }>(`/webhook-events/${id}`),
  reproject: () => req<{ ok: true; patients: number; appointments: number }>('/reproject', { method: 'POST' }),
  listOverrides: () => req<ClinicorpOverride[]>('/overrides'),
  upsertOverride: (payload: Partial<Pick<ClinicorpOverride, 'scope_type' | 'scope_id' | 'keep_local' | 'conflict_strategy' | 'note'>> & { scope_label?: string }) =>
    req<{ ok: true; override: ClinicorpOverride }>('/overrides', { method: 'PUT', body: JSON.stringify(payload) }),
  deleteOverride: (id: number) => req<{ ok: true }>(`/overrides/${id}`, { method: 'DELETE' }),
  listOverrideHistory: (params: { limit?: number; scope_type?: string; scope_id?: string } = {}) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(params.limit ?? 100));
    if (params.scope_type) qs.set('scope_type', params.scope_type);
    if (params.scope_id) qs.set('scope_id', params.scope_id);
    return req<ClinicorpOverrideHistory[]>(`/overrides/history?${qs.toString()}`);
  },
  listConflicts: (params: { limit?: number; entity?: 'appointment' | 'patient'; decision?: string } = {}) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(params.limit ?? 100));
    if (params.entity) qs.set('entity', params.entity);
    if (params.decision) qs.set('decision', params.decision);
    return req<ClinicorpConflict[]>(`/conflicts?${qs.toString()}`);
  },
  setKeepLocal: (entity: 'appointment' | 'patient', id: string, keep_local: boolean) =>
    req<{ ok: true }>('/keep-local', { method: 'PUT', body: JSON.stringify({ entity, id, keep_local }) }),

  // ── Per-user (SaaS) credentials ──
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
  syncMyNow: () => req<ClinicorpSyncResult>('/sync/now', { method: 'POST' }),
  listAuditLogs: (limit = 100) => req<ClinicorpAuditEntry[]>(`/audit-log?limit=${limit}`),
};

export interface ClinicorpConnectionTest {
  ok: boolean;
  auth: 'valid' | 'invalid_token' | 'partial';
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
