/**
 * VPS API Service — Odonto Connect
 * All API calls go through the VPS Express server
 */

const VPS_API_BASE = 'https://odontoconnect.tech/api';
const TOKEN_KEY = 'odonto_jwt';

// ─── Auth helpers ───────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// ─── Generic fetch ──────────────────────────────────────────

export async function vpsApiFetch<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown; params?: Record<string, string> }
): Promise<{ data: T | null; error: string | null }> {
  try {
    const method = options?.method || 'GET';
    const fetchOptions: RequestInit = { method, headers: getAuthHeaders() };

    let url = `${VPS_API_BASE}${path}`;

    if (method === 'GET' && options?.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams.toString()}`;
    } else if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      return { data: null, error: data.error || `HTTP ${response.status}` };
    }

    return { data, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro de rede';
    return { data: null, error: message };
  }
}

// ─── Auth ───────────────────────────────────────────────────

export async function login(email: string, password: string) {
  const result = await vpsApiFetch<{ token: string; user: { id: string; name: string; email: string; role: string; avatar_url: string } }>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (result.data?.token) {
    setToken(result.data.token);
  }
  return result;
}

export async function getMe() {
  return vpsApiFetch<{ id: string; name: string; email: string; role: string; avatar_url: string }>('/auth/me');
}

export function logout() {
  clearToken();
  window.location.href = '/login';
}

// ─── Password Recovery ─────────────────────────────────────

export async function forgotPassword(email: string) {
  return vpsApiFetch<{ success: boolean }>('/auth/forgot-password', {
    method: 'POST',
    body: { email },
  });
}

export async function getResetRequests() {
  return vpsApiFetch<Array<{ id: string; email: string; user_id: string; status: string; created_at: string }>>('/auth/reset-requests');
}

export async function adminResetPassword(userId: string, newPassword: string) {
  return vpsApiFetch<{ success: boolean }>('/auth/admin-reset-password', {
    method: 'POST',
    body: { userId, newPassword },
  });
}

export async function adminCreateUser(name: string, email: string, password: string, role: string) {
  return vpsApiFetch<{ success: boolean; user: { id: string; name: string; email: string; role: string } }>('/auth/create-user', {
    method: 'POST',
    body: { name, email, password, role },
  });
}

export async function adminListUsers() {
  return vpsApiFetch<Array<{ id: string; name: string; email: string; role: string; active: boolean; avatar_url: string | null; created_at: string }>>('/auth/users');
}

export async function adminUpdateUser(id: string, data: { name?: string; email?: string; role?: string; active?: boolean }) {
  return vpsApiFetch<{ success: boolean }>(`/auth/users/${id}`, {
    method: 'PUT',
    body: data,
  });
}

// ─── Pacientes ──────────────────────────────────────────────

export const pacientesApi = {
  list: () => vpsApiFetch('/pacientes'),
  create: (body: unknown) => vpsApiFetch('/pacientes', { method: 'POST', body }),
  update: (id: string, body: unknown) => vpsApiFetch(`/pacientes/${id}`, { method: 'PUT', body }),
  delete: (id: string) => vpsApiFetch(`/pacientes/${id}`, { method: 'DELETE' }),
};

// ─── Agenda ─────────────────────────────────────────────────

export const agendaApi = {
  list: (params?: Record<string, string>) => vpsApiFetch('/agenda', { params }),
  create: (body: unknown) => vpsApiFetch('/agenda', { method: 'POST', body }),
};

// ─── Financeiro ─────────────────────────────────────────────

export const financeiroApi = {
  list: (params?: Record<string, string>) => vpsApiFetch('/financeiro', { params }),
  create: (body: unknown) => vpsApiFetch('/financeiro', { method: 'POST', body }),
};

// ─── Dentistas ──────────────────────────────────────────────

export const dentistasApi = {
  list: () => vpsApiFetch('/dentistas'),
  create: (body: unknown) => vpsApiFetch('/dentistas', { method: 'POST', body }),
};

// ─── Dashboard ──────────────────────────────────────────────

export const dashboardApi = {
  kpis: () => vpsApiFetch('/dashboard/kpis'),
};

// ─── WhatsApp (via proxy) ───────────────────────────────────

export const whatsappApi = {
  instances: () => vpsApiFetch('/whatsapp/instances'),
  create: (instanceName: string) => vpsApiFetch('/whatsapp/instances', { method: 'POST', body: { instanceName } }),
  connect: (instance: string) => vpsApiFetch(`/whatsapp/connect/${instance}`),
  state: (instance: string) => vpsApiFetch(`/whatsapp/state/${instance}`),
  logout: (instance: string) => vpsApiFetch(`/whatsapp/logout/${instance}`, { method: 'DELETE' }),
  delete: (instance: string) => vpsApiFetch(`/whatsapp/instances/${instance}`, { method: 'DELETE' }),
  restart: (instance: string) => vpsApiFetch(`/whatsapp/restart/${instance}`, { method: 'PUT' }),
  sendText: (instance: string, number: string, text: string) =>
    vpsApiFetch('/whatsapp/send-text', { method: 'POST', body: { instance, number, text } }),
};

// ─── Generic table ──────────────────────────────────────────

export const tableApi = {
  list: (tableName: string) => vpsApiFetch(`/table/${tableName}`),
};

// ─── Health check ───────────────────────────────────────────

export const healthCheck = () => vpsApiFetch('/health');

export { VPS_API_BASE };
