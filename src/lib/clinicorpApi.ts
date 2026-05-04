/**
 * Clinicorp integration API client (frontend → VPS).
 */

const API_BASE = 'https://odontoconnect.tech/api/clinicorp';
const WEBHOOK_BASE = 'https://odontoconnect.tech/api/webhook/clinicorp';
const TOKEN_KEY = 'odonto_jwt';

function authHeaders(): HeadersInit {
  const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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
  created_at: string;
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
  sync: (range?: { from?: string; to?: string }) =>
    req<ClinicorpSyncResult>('/sync', { method: 'POST', body: JSON.stringify(range || {}) }),
  reconcileNow: () => req<{ ran?: boolean; skipped?: boolean; status?: string; summary?: Record<string, number>; error?: string }>('/reconcile', { method: 'POST' }),
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
  listWebhookEvents: (limit = 50) => req<ClinicorpWebhookEvent[]>(`/webhook-events?limit=${limit}`),
  getWebhookEvent: (id: number) => req<ClinicorpWebhookEvent & { payload: unknown; headers: unknown; ip: string }>(`/webhook-events/${id}`),
  reproject: () => req<{ ok: true; patients: number; appointments: number }>('/reproject', { method: 'POST' }),
};

export function buildWebhookUrl(secret: string): string {
  return `${WEBHOOK_BASE}?user_api=${encodeURIComponent(secret || '<seu-secret>')}`;
}

export function generateWebhookSecret(length = 40): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}
