/**
 * VPS API Service — Odonto Connect
 * All API calls go through the VPS Express server
 */

const VPS_API_BASE = 'https://odontoconnect.tech/api';
const TOKEN_KEY = 'odonto_jwt';

function isAuthError(status: number, _error: unknown): boolean {
  // Only treat HTTP 401 as auth failure — avoid false positives from error message content
  return status === 401;
}

let _isRedirecting = false;

function handleAuthFailure(background = false) {
  // Background calls should never force logout or redirect.
  // They can fail silently and let explicit user actions handle session expiry.
  if (background) return;
  if (_isRedirecting) return;

  _isRedirecting = true;
  clearToken();

  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
  setTimeout(() => { _isRedirecting = false; }, 2000);
}

function resetAuthFailureCount() {
  // no-op: kept to avoid changing callers and preserve a stable API surface
}


// ─── Auth helpers ───────────────────────────────────────────

export function getAuthHeaders(): Record<string, string> {
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
  options?: { method?: string; body?: unknown; params?: Record<string, string>; background?: boolean }
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
      if (isAuthError(response.status, data?.error)) {
        handleAuthFailure(!!options?.background);
        return { data: null, error: 'Sessão expirada. Faça login novamente.' };
      }

      return { data: null, error: data.error || `HTTP ${response.status}` };
    }

    // Successful response — reset consecutive 401 counter
    resetAuthFailureCount();
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
  return vpsApiFetch<{ id: string; name: string; email: string; role: string; avatar_url: string }>('/auth/me', { background: true });
}

// ─── Profile (self-service) ─────────────────────────────────

export const profileApi = {
  update: (body: { name?: string; email?: string }) =>
    vpsApiFetch<{ success: boolean }>('/auth/profile', { method: 'PUT', body }),
  changePassword: (currentPassword: string, newPassword: string) =>
    vpsApiFetch<{ success: boolean }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  uploadAvatar: async (file: File) => {
    try {
      // Convert file to base64 data URI
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      return vpsApiFetch<{ avatar_url: string }>('/auth/avatar', {
        method: 'POST',
        body: { avatar: base64 },
      });
    } catch (error: unknown) {
      return { data: null, error: error instanceof Error ? error.message : 'Erro de rede' };
    }
  },
};

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

export async function adminUploadUserAvatar(userId: string, file: File) {
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return vpsApiFetch<{ avatar_url: string }>(`/auth/users/${userId}/avatar`, {
      method: 'POST',
      body: { avatar: base64 },
    });
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : 'Erro de rede' };
  }
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
  list: (params?: Record<string, string>) => vpsApiFetch<AgendamentoVPS[]>('/agenda', { params }),
  create: (body: unknown) => vpsApiFetch('/agenda', { method: 'POST', body }),
  update: (id: string, body: { status?: string; hora?: string; data?: string; duracao?: number; procedimento?: string; observacoes?: string; sala?: string }) =>
    vpsApiFetch(`/agenda/${encodeURIComponent(id)}`, { method: 'PUT', body }),
};

export interface AgendamentoVPS {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  dentista_id: string;
  dentista_nome: string;
  data: string;
  hora: string;
  duracao: number;
  procedimento: string;
  status: string;
  observacoes: string;
  sala?: string;
}

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

// ─── CRM Leads ──────────────────────────────────────────────

export const crmApi = {
  list: (params?: Record<string, string>) =>
    vpsApiFetch<{ rows: any[]; total: number; limit: number; offset: number }>('/crm/leads', { params }),
  kanban: () => vpsApiFetch('/crm/leads', { params: { grouped: 'kanban' } }),
  updateStage: (id: string, stage: string, reason?: string) =>
    vpsApiFetch(`/crm/leads/${id}/stage`, { method: 'PATCH', body: { stage, reason } }),
  updateConsciousness: (id: string, level: string) =>
    vpsApiFetch(`/crm/leads/${id}/consciousness`, { method: 'PATCH', body: { level } }),
  assign: (id: string, assignedTo: string, assignedToName: string) =>
    vpsApiFetch(`/crm/leads/${id}/assign`, { method: 'PATCH', body: { assignedTo, assignedToName } }),
  movements: (id: string) =>
    vpsApiFetch<Array<{ id: string; from_stage: string; to_stage: string; moved_by_name: string; reason: string; created_at: string }>>(`/crm/leads/${id}/movements`),
};

// ─── Orçamentos ─────────────────────────────────────────────

export const orcamentosApi = {
  list: () => vpsApiFetch('/orcamentos'),
  updateStatus: (id: string, status: string) =>
    vpsApiFetch<{ success: boolean; budget: any; leadMoved: boolean }>(`/orcamentos/${id}/status`, { method: 'PATCH', body: { status } }),
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
  sendText: (instance: string, number: string, text: string, quoted?: { key: { remoteJid: string; id: string } }) =>
    vpsApiFetch('/whatsapp/send-text', { method: 'POST', body: { instance, number, text, quoted } }),
  sendMedia: (instance: string, number: string, mediaType: string, media: {
    base64?: string; url?: string; fileName?: string; caption?: string; mimeType?: string;
  }) => vpsApiFetch('/whatsapp/send-media', { method: 'POST', body: { instance, number, mediaType, media } }),
  sendMediaUpload: async (instance: string, number: string, mediaType: string, file: File, media: {
    fileName?: string; caption?: string; mimeType?: string;
  }) => {
    try {
      const token = getToken();
      const params = new URLSearchParams({
        instance,
        number,
        mediaType,
        ...(media.fileName ? { fileName: media.fileName } : {}),
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.mimeType ? { mimeType: media.mimeType } : {}),
      });

      const response = await fetch(`${VPS_API_BASE}/whatsapp/send-media-upload?${params.toString()}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': file.type || media.mimeType || 'application/octet-stream',
        },
        body: file,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (isAuthError(response.status, data?.error)) {
          handleAuthFailure(false);
          return { data: null, error: 'Sessão expirada. Faça login novamente.' };
        }
        return { data: null, error: data.error || `HTTP ${response.status}` };
      }

      return { data, error: null };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro de rede';
      return { data: null, error: message };
    }
  },
  getMediaSendStatus: (jobId: string) => vpsApiFetch<{ status: string; result?: { key?: { id?: string } }; error?: string }>(`/whatsapp/send-media-status/${jobId}`, { background: true }),
  sendLocation: (instance: string, number: string, location: {
    latitude: number; longitude: number; name?: string; address?: string;
  }) => vpsApiFetch('/whatsapp/send-location', { method: 'POST', body: { instance, number, ...location } }),
  sendContact: (instance: string, number: string, contact: {
    fullName: string; phone: string; email?: string; company?: string; url?: string;
  }) => vpsApiFetch('/whatsapp/send-contact', { method: 'POST', body: { instance, number, contact } }),
  sendPoll: (instance: string, number: string, question: string, options: string[]) =>
    vpsApiFetch('/whatsapp/send-poll', { method: 'POST', body: { instance, number, question, options } }),
  sendSticker: (instance: string, number: string, sticker: string) =>
    vpsApiFetch('/whatsapp/send-sticker', { method: 'POST', body: { instance, number, sticker } }),
  sendList: (instance: string, number: string, list: {
    title: string; buttonText: string; description?: string; footerText?: string;
    sections: Array<{ title: string; rows: Array<{ title: string; description?: string; id?: string }> }>;
  }) => vpsApiFetch('/whatsapp/send-list', { method: 'POST', body: { instance, number, ...list } }),
  sendReaction: (instance: string, number: string, messageId: string, reaction: string) =>
    vpsApiFetch('/whatsapp/send-reaction', { method: 'POST', body: { instance, number, messageId, reaction } }),
  fetchProfilePicture: (instance: string, number: string, leadId?: string) =>
    vpsApiFetch<{ profilePictureUrl: string | null }>('/whatsapp/profile-picture', {
      method: 'POST',
      body: { instance, number, leadId },
      background: true,
    }),
  syncProfilePictures: (instance: string) =>
    vpsApiFetch<{ total: number; updated: number; failed: number }>('/whatsapp/sync-profile-pictures', {
      method: 'POST',
      body: { instance },
    }),
  offerCall: (instance: string, number: string, isVideo = false) =>
    vpsApiFetch<{ success: boolean }>('/whatsapp/call', {
      method: 'POST',
      body: { instance, number, isVideo },
    }),
  sendPresence: (instance: string, number: string, presence: 'composing' | 'recording' | 'paused', delay = 200) =>
    vpsApiFetch<{ success?: boolean; presence?: string }>('/whatsapp/send-presence', {
      method: 'POST',
      body: { instance, number, presence, delay },
      background: true,
    }),
  subscribePresence: (instance: string, number: string) =>
    vpsApiFetch<{ subscribed: boolean; number: string; presence?: string; updatedAt?: string | null }>('/whatsapp/subscribe-presence', {
      method: 'POST',
      body: { instance, number },
      background: true,
    }),
  /** Mark messages as read on WhatsApp (blue ticks for the patient) */
  markWhatsAppRead: (instance: string, number: string, messageIds: string[]) =>
    vpsApiFetch<{ success: boolean; marked: number }>('/whatsapp/mark-read', {
      method: 'POST',
      body: { instance, number, messageIds },
      background: true,
    }),
  /** Delete message for everyone on WhatsApp */
  deleteMessage: (instance: string, number: string, messageId: string, fromMe = true) =>
    vpsApiFetch<{ success: boolean }>('/whatsapp/delete-message', {
      method: 'POST',
      body: { instance, number, messageId, fromMe },
    }),
  /** Archive chat on WhatsApp */
  archiveChat: (instance: string, number: string, archive = true) =>
    vpsApiFetch<{ success: boolean }>('/whatsapp/archive-chat', {
      method: 'POST',
      body: { instance, number, archive },
    }),
};

// ─── Attendance Settings ────────────────────────────────────

export const attendanceSettingsApi = {
  get: () => vpsApiFetch('/attendance-settings'),
  update: (body: unknown) => vpsApiFetch('/attendance-settings', { method: 'PUT', body }),
};

// ─── Attendance Queues ──────────────────────────────────────

export const queuesApi = {
  list: () => vpsApiFetch<Array<{
    id: string; name: string; color: string; icon: string; description: string;
    whatsapp_button_label: string; contact_numbers: string[]; team_member_ids: string[];
    active: boolean; created_at: string;
  }>>('/queues'),
  create: (body: {
    name: string; color?: string; icon?: string; description?: string;
    whatsapp_button_label?: string; contact_numbers?: string[]; team_member_ids?: string[];
  }) => vpsApiFetch<{ success: boolean; id: string }>('/queues', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) =>
    vpsApiFetch<{ success: boolean }>(`/queues/${id}`, { method: 'PUT', body }),
  delete: (id: string) => vpsApiFetch<{ success: boolean }>(`/queues/${id}`, { method: 'DELETE' }),
};

// ─── Generic table ──────────────────────────────────────────

export const tableApi = {
  list: (tableName: string) => vpsApiFetch(`/table/${tableName}`),
};

// ─── Transfer Logs ──────────────────────────────────────────

export const transferApi = {
  create: (body: {
    leadId: string;
    leadName?: string;
    leadPhone?: string;
    toUserId: string;
    toUserName?: string;
    reason: string;
    queueId?: string;
    queueName?: string;
  }) => vpsApiFetch<{ success: boolean; id: string }>('/transfers', { method: 'POST', body }),
  list: (params?: Record<string, string>) => vpsApiFetch<Array<{
    id: string;
    lead_id: string;
    lead_name: string;
    from_user_name: string;
    to_user_name: string;
    reason: string;
    queue_name: string;
    created_at: string;
  }>>('/transfers', { params }),
};

// ─── Attendance Sessions ────────────────────────────────────

export const sessionsApi = {
  start: (body: { leadId: string; leadName?: string; leadPhone?: string; queueId?: string; queueName?: string }) =>
    vpsApiFetch<{ success: boolean; id: string }>('/sessions/start', { method: 'POST', body }),
  assign: (body: { leadId: string }) =>
    vpsApiFetch<{ success: boolean; id: string; waitTime: number }>('/sessions/assign', { method: 'POST', body }),
  checkActive: (leadId: string) =>
    vpsApiFetch<{ active: boolean; attendantId?: string; attendantName?: string; isCurrentUser?: boolean }>(`/sessions/active/${leadId}`),
  firstResponse: (body: { leadId: string }) =>
    vpsApiFetch('/sessions/first-response', { method: 'POST', body }),
  close: (body: { leadId: string; leadPhone?: string; instance?: string }) =>
    vpsApiFetch<{ success: boolean; sessionId?: string; duration?: number }>('/sessions/close', { method: 'POST', body }),
};

// ─── Attendance Metrics ─────────────────────────────────────

export interface AttendanceMetrics {
  general: {
    total_sessions: string;
    closed_sessions: string;
    avg_wait_time: string | null;
    avg_response_time: string | null;
    avg_duration: string | null;
    max_wait_time: number | null;
    min_wait_time: number | null;
  };
  perAttendant: Array<{
    attendant_id: string;
    attendant_name: string;
    total_sessions: string;
    closed_sessions: string;
    avg_wait_time: string | null;
    avg_response_time: string | null;
    avg_duration: string | null;
  }>;
  satisfaction: {
    avg_rating: string | null;
    total_ratings: string;
    five_star: string;
    four_star: string;
    three_star: string;
    two_star: string;
    one_star: string;
  };
  satisfactionPerAttendant: Array<{
    attendant_id: string;
    attendant_name: string;
    avg_rating: string;
    total_ratings: string;
  }>;
}

export const metricsApi = {
  attendance: (days?: number) =>
    vpsApiFetch<AttendanceMetrics>('/metrics/attendance', { params: days ? { days: String(days) } : undefined }),
};

// ─── Lead Tags ──────────────────────────────────────────────

export interface LeadTagApi {
  id: string;
  name: string;
  color: string;
  icon: string;
  created_at: string;
}

export const tagsApi = {
  list: () => vpsApiFetch<LeadTagApi[]>('/tags'),
  create: (body: { name: string; color?: string; icon?: string }) =>
    vpsApiFetch<LeadTagApi>('/tags', { method: 'POST', body }),
  update: (id: string, body: { name?: string; color?: string; icon?: string }) =>
    vpsApiFetch<{ success: boolean }>(`/tags/${id}`, { method: 'PUT', body }),
  delete: (id: string) => vpsApiFetch<{ success: boolean }>(`/tags/${id}`, { method: 'DELETE' }),
  assignments: () => vpsApiFetch<Record<string, string[]>>('/tag-assignments'),
  toggle: (leadId: string, tagId: string) =>
    vpsApiFetch<{ action: 'added' | 'removed' }>('/tag-assignments/toggle', { method: 'POST', body: { leadId, tagId } }),
};

// ─── Contatos ───────────────────────────────────────────────

export interface Contato {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  tipo: string;
  empresa: string | null;
  cargo: string | null;
  observacoes: string | null;
  avatar_url: string | null;
  favorito: boolean;
  created_at: string;
  updated_at: string;
}

export const contatosApi = {
  list: (params?: Record<string, string>) =>
    vpsApiFetch<Contato[]>('/contatos', { params }),
  create: (body: { nome: string; telefone?: string; email?: string; tipo?: string; empresa?: string; cargo?: string; observacoes?: string }) =>
    vpsApiFetch<Contato>('/contatos', { method: 'POST', body }),
  update: (id: string, body: Partial<Contato>) =>
    vpsApiFetch<Contato>(`/contatos/${id}`, { method: 'PUT', body }),
  delete: (id: string) =>
    vpsApiFetch<{ success: boolean }>(`/contatos/${id}`, { method: 'DELETE' }),
  toggleFavorito: (id: string) =>
    vpsApiFetch<Contato>(`/contatos/${id}/favorito`, { method: 'PATCH' }),
  bulkImport: (contatos: Array<{ telefone: string; nome: string }>) =>
    vpsApiFetch<{ imported: number; skipped: number; total: number }>('/contatos/import', { method: 'POST', body: { contatos } }),
  syncNow: () =>
    vpsApiFetch<{ success: boolean; imported: number; totalContatos: number; instances: Array<{ name: string; imported: number; skipped: number; total: number; error: string | null }>; message?: string }>('/contatos/sync/now', { method: 'POST' }),
  syncStatus: () =>
    vpsApiFetch<{ autoSync: boolean; intervalMinutes: number; totalContatos: number }>('/contatos/sync/status'),
};

// ─── Messages / Chat History ────────────────────────────────

export interface ChatMessageApi {
  id: string;
  lead_id: string;
  lead_name?: string;
  content: string;
  sender: 'lead' | 'attendant';
  type: string;
  timestamp: string;
  status?: string;
  media_url?: string;
  file_name?: string;
  mime_type?: string;
  reply_to_id?: string;
  reactions?: Array<{ emoji: string; count: number }>;
  metadata?: Record<string, unknown>;
}

export const messagesApi = {
  /** Fetch paginated message history for a lead (oldest first) */
  list: (leadId: string, params?: { before?: string; limit?: number }) =>
    vpsApiFetch<{ messages: ChatMessageApi[]; hasMore: boolean }>(
      `/messages/${encodeURIComponent(leadId)}`,
      {
        params: {
          ...(params?.before ? { before: params.before } : {}),
          ...(params?.limit ? { limit: String(params.limit) } : {}),
        },
        background: true,
      }
    ),
  /** Save an outgoing message to the database */
  save: (body: {
    id: string; leadId: string; content: string; type: string;
    status?: string; fileName?: string; fileUrl?: string; mimeType?: string;
    replyTo?: { messageId: string; content: string; sender: string } | null;
    instance?: string; phone?: string;
  }) => vpsApiFetch<{ success: boolean; mediaUrl?: string }>('/messages', { method: 'POST', body }),
  /** Save multiple messages in batch */
  saveBatch: (messages: Array<{
    id: string; lead_id: string; content: string; sender: string; type?: string;
    status?: string; timestamp?: string; media_url?: string; file_name?: string; mime_type?: string;
    reply_to_id?: string; reply_to_content?: string; reply_to_sender?: string;
    attendant_id?: string; attendant_name?: string; instance?: string; phone?: string;
  }>) => vpsApiFetch<{ success: boolean; count: number }>('/messages/batch', { method: 'POST', body: { messages } }),
  /** Mark messages as read for a lead */
  markRead: (leadId: string) =>
    vpsApiFetch<{ success: boolean }>('/messages/mark-read', { method: 'POST', body: { leadId }, background: true }),
  /** Update message status */
  updateStatus: (id: string, status: string) =>
    vpsApiFetch<{ success: boolean }>(`/messages/${id}/status`, { method: 'PUT', body: { status } }),
  /** Delete a message (soft by default, hard with flag) */
  delete: (id: string, hard = false) =>
    vpsApiFetch<{ success: boolean }>(`/messages/${id}${hard ? '?hard=true' : ''}`, { method: 'DELETE' }),
  /** Get unread counts per lead */
  unreadCounts: () =>
    vpsApiFetch<Record<string, number>>('/messages/unread', { background: true }),
  /** Search messages */
  search: (q: string, leadId?: string) =>
    vpsApiFetch<ChatMessageApi[]>('/messages/search', {
      params: { q, ...(leadId ? { lead_id: leadId } : {}) },
    }),
};

// ─── Media Upload ───────────────────────────────────────────

export const mediaApi = {
  /** Upload a file to the VPS and get a persistent URL */
  upload: async (file: File): Promise<{ url: string | null; error: string | null }> => {
    try {
      const token = getToken();
      const params = new URLSearchParams({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      });

      const response = await fetch(`${VPS_API_BASE}/media/upload?${params.toString()}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { url: null, error: data.error || `HTTP ${response.status}` };
      }

      return { url: data.url, error: null };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro de rede';
      return { url: null, error: message };
    }
  },
};

// ─── Queue Leads ────────────────────────────────────────────

export const queueLeadsApi = {
  list: () => vpsApiFetch<{ queue: any[]; active: any[] }>('/queue/leads', { background: true }),
};

// ─── Automations ────────────────────────────────────────────

export interface FollowupAutomationConfig {
  enabled: boolean;
  stages: string[];
  messages: Record<string, string>;
  delaySeconds: number;
  delayDays: Record<string, number>;
  returnToQueueOnReply: boolean;
}

export const automationsApi = {
  /** Get follow-up automation config */
  getFollowup: () =>
    vpsApiFetch<FollowupAutomationConfig>('/automations/followup'),
  /** Update follow-up automation config (admin only) */
  updateFollowup: (config: Partial<FollowupAutomationConfig>) =>
    vpsApiFetch<FollowupAutomationConfig>('/automations/followup', {
      method: 'PUT',
      body: config,
    }),
  /** List all automation flows */
  listFlows: () =>
    vpsApiFetch<import('@/data/automationMockData').AutomationFlow[]>('/automations/flows'),
  /** Create a new automation flow */
  createFlow: (flow: import('@/data/automationMockData').AutomationFlow) =>
    vpsApiFetch<{ success: boolean; id: string }>('/automations/flows', { method: 'POST', body: flow }),
  /** Update an existing automation flow */
  updateFlow: (id: string, data: Partial<import('@/data/automationMockData').AutomationFlow>) =>
    vpsApiFetch<{ success: boolean }>(`/automations/flows/${id}`, { method: 'PUT', body: data }),
  /** Delete an automation flow */
  deleteFlow: (id: string) =>
    vpsApiFetch<{ success: boolean }>(`/automations/flows/${id}`, { method: 'DELETE' }),
  /** Toggle active status */
  toggleFlow: (id: string) =>
    vpsApiFetch<{ success: boolean; active: boolean }>(`/automations/flows/${id}/toggle`, { method: 'PATCH' }),
  /** Get automation stats/report */
  getStats: (days = 30) =>
    vpsApiFetch<Record<string, unknown>>(`/automations/stats?days=${days}`),
  /** Get dynamic patient counts for pre-configured solutions */
  getSolutionCounts: () =>
    vpsApiFetch<Record<string, number>>('/automations/solution-counts'),
  /** Get solution business hours config */
  getSolutionHours: () =>
    vpsApiFetch<{ inicio: string; fim: string; diasSemana: string[] }>('/automations/solution-hours'),
  /** Update solution business hours config */
  updateSolutionHours: (config: { inicio: string; fim: string; diasSemana: string[] }) =>
    vpsApiFetch<{ inicio: string; fim: string; diasSemana: string[] }>('/automations/solution-hours', { method: 'PUT', body: config }),
};

// ─── Broadcast Campaigns (Disparos) ────────────────────────

export const campaignsApi = {
  list: () =>
    vpsApiFetch<import('@/data/disparosMockData').DisparoProgramado[]>('/campaigns'),
  create: (campaign: Omit<import('@/data/disparosMockData').DisparoProgramado, 'id' | 'stats' | 'criadoEm'>) =>
    vpsApiFetch<{ success: boolean; id: string }>('/campaigns', { method: 'POST', body: campaign }),
  update: (id: string, data: Partial<import('@/data/disparosMockData').DisparoProgramado>) =>
    vpsApiFetch<{ success: boolean }>(`/campaigns/${id}`, { method: 'PUT', body: data }),
  remove: (id: string) =>
    vpsApiFetch<{ success: boolean }>(`/campaigns/${id}`, { method: 'DELETE' }),
  toggle: (id: string) =>
    vpsApiFetch<{ success: boolean; ativo: boolean }>(`/campaigns/${id}/toggle`, { method: 'PATCH' }),
  duplicate: (id: string) =>
    vpsApiFetch<{ success: boolean; id: string }>(`/campaigns/${id}/duplicate`, { method: 'POST' }),
  execute: (id: string) =>
    vpsApiFetch<{ success: boolean; enqueued: number; total: number; skipped: number }>(`/campaigns/${id}/execute`, { method: 'POST' }),
  jobs: (id: string) =>
    vpsApiFetch<{ summary: Record<string, number>; recent: Array<{ patient_name: string; patient_phone: string; status: string; sent_at: string; error: string; scheduled_at: string }> }>(`/campaigns/${id}/jobs`),
};

// ─── AI Settings & Transcription ────────────────────────────

export interface AISettingApi {
  provider: string;
  api_key: string;
  model: string;
  enabled: boolean;
}

export interface ClinicalReportApi {
  id: string;
  patient_name: string;
  transcription: string;
  report: string;
  queixa_principal: string;
  procedimento: string;
  dente_regiao: string;
  prescricoes: Array<{ medicamento: string; dosagem: string; posologia: string; duracao: string }>;
  duration_seconds: number;
  created_at: string;
}

export const aiApi = {
  getSettings: () => vpsApiFetch<AISettingApi[]>('/ai/settings'),
  saveSettings: (body: { provider: string; api_key: string; model?: string; enabled?: boolean }) =>
    vpsApiFetch<{ success: boolean }>('/ai/settings', { method: 'POST', body }),

  transcribe: async (audioBlob: Blob): Promise<{ data: { transcription: string } | null; error: string | null }> => {
    try {
      const token = getToken();
      const response = await fetch(`${VPS_API_BASE}/ai/transcribe`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': audioBlob.type || 'audio/webm',
        },
        body: audioBlob,
      });
      const data = await response.json();
      if (!response.ok) return { data: null, error: data.error || `HTTP ${response.status}` };
      return { data, error: null };
    } catch (err: unknown) {
      return { data: null, error: err instanceof Error ? err.message : 'Erro de rede' };
    }
  },

  generateReport: (body: {
    transcription: string;
    queixaPrincipal?: string;
    procedimento?: string;
    dente?: string;
    prescricoes?: Array<{ medicamento: string; dosagem: string; posologia: string; duracao: string }>;
    patientId?: string;
    patientName?: string;
    durationSeconds?: number;
  }) => vpsApiFetch<{ id: string; report: string; transcription: string }>('/ai/clinical-report', { method: 'POST', body }),

  getReports: (patientId: string) =>
    vpsApiFetch<ClinicalReportApi[]>(`/ai/reports/${encodeURIComponent(patientId)}`),

  generateFollowupMessages: (body: { reportId: string; patientName?: string; patientPhone?: string }) =>
    vpsApiFetch<{ messages: Array<{ delay_days: number; text: string }>; summary: string }>('/ai/followup-messages', { method: 'POST', body }),

  scheduleFollowup: (body: {
    reportId: string;
    patientName?: string;
    patientPhone?: string;
    messages: Array<{ delay_days: number; text: string }>;
    instance?: string;
  }) => vpsApiFetch<{ success: boolean; flowId: string; jobs: Array<{ id: string; scheduled_at: string; delay_days: number; message: string }> }>('/ai/schedule-followup', { method: 'POST', body }),

  // Meta Ads / Manus AI
  getMetaAdsOverview: () => vpsApiFetch<import('@/components/MetaAdsDashboard').MetaOverview>('/ai/meta-ads/overview'),
  syncMetaAds: () => vpsApiFetch<{ success: boolean; synced: number; ai_insight: string | null }>('/ai/meta-ads/sync', { method: 'POST' }),
  getMetaAdsInsight: () => vpsApiFetch<{ insight: string }>('/ai/meta-ads/insight'),
};

// ─── Consultations ──────────────────────────────────────────

export interface ConsultationRecord {
  id: string;
  patient_name: string;
  dentist_name: string;
  queixa_principal: string;
  procedimento: string;
  dente_regiao: string;
  observacoes: string;
  prescricoes: Array<{ medicamento: string; dosagem: string; posologia: string; duracao: string }>;
  duration_seconds: number;
  gravacoes_count: number;
  clinical_report_id: string | null;
  status: string;
  started_at: string;
  finished_at: string;
}

export const consultationsApi = {
  finalize: (body: {
    patient_id: string;
    patient_name?: string;
    appointment_id?: string;
    queixa_principal?: string;
    procedimento?: string;
    dente_regiao?: string;
    observacoes?: string;
    prescricoes?: Array<{ medicamento: string; dosagem: string; posologia: string; duracao: string }>;
    duration_seconds?: number;
    gravacoes_count?: number;
    clinical_report_id?: string;
    started_at?: string;
  }) => vpsApiFetch<{ id: string; finished_at: string }>('/consultations', { method: 'POST', body }),

  getHistory: (patientId: string) =>
    vpsApiFetch<ConsultationRecord[]>(`/consultations/${encodeURIComponent(patientId)}`),
};

// ─── Health check ───────────────────────────────────────────

export const healthCheck = () => vpsApiFetch('/health');

export { VPS_API_BASE };
