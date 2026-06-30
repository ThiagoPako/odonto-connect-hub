/**
 * VPS API Service — Odonto Connect
 * All API calls go through the VPS Express server.
 *
 * Auth bridge: o login agora é gerenciado pela Supabase. O VPS aceita
 * o access_token Supabase como Bearer, então buscamos a sessão atual
 * em vez do antigo `odonto_jwt` em localStorage.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { sbMessagesApi, sbQueueLeadsApi, sbSessionsApi } from "./sbAdapters";

// Lovable preview (lovableproject.com / lovable.app) doesn't proxy /api to the VPS,
// so we must hit the absolute VPS URL there. Only localhost uses the local proxy.
const VPS_API_BASE = (() => {
  if (typeof window === 'undefined') return 'https://backend.odontoconnect.tech/api';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return '/api';
  if (host.includes('lovableproject.com') || host.includes('lovable.app') || host.includes('lovable.dev')) {
    return 'https://backend.odontoconnect.tech/api';
  }
  return 'https://backend.odontoconnect.tech/api';
})();
const TOKEN_KEY = 'odonto_jwt'; // legacy — mantido só para cleanup
const TENANT_KEY = 'odonto_active_tenant_id';
let cachedSupabaseAccessToken: string | null = null;

export function getCachedTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(TENANT_KEY); } catch { return null; }
}

export function setCachedTenantId(tenantId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    if (tenantId) localStorage.setItem(TENANT_KEY, tenantId);
    else localStorage.removeItem(TENANT_KEY);
  } catch { /* ignore */ }
}

export function setCachedAccessToken(sessionOrToken: Pick<Session, 'access_token'> | string | null | undefined): void {
  if (!sessionOrToken) {
    cachedSupabaseAccessToken = null;
    return;
  }

  cachedSupabaseAccessToken = typeof sessionOrToken === 'string'
    ? sessionOrToken
    : sessionOrToken.access_token || null;
}

function isAuthError(status: number, _error: unknown): boolean {
  return status === 401;
}

let _isRedirecting = false;

async function handleAuthFailure(background = false) {
  if (background) return;
  if (_isRedirecting) return;

  // Confirma com a Supabase antes de derrubar a sessão.
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) return; // sessão Supabase ok — 401 é da rota específica
  } catch {
    return;
  }

  _isRedirecting = true;
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
  setTimeout(() => { _isRedirecting = false; }, 2000);
}

function resetAuthFailureCount() {
  // no-op
}


// ─── Auth helpers ───────────────────────────────────────────

/** Retorna o access_token Supabase da sessão atual (ou null). */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  try {
    if (forceRefresh) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session?.access_token) {
        setCachedAccessToken(refreshed.session);
        clearToken();
        return refreshed.session.access_token;
      }
    }

    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      setCachedAccessToken(data.session);
      clearToken();
      return data.session.access_token;
    }

    return cachedSupabaseAccessToken || getToken();
  } catch {
    return cachedSupabaseAccessToken || getToken();
  }
}

export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await getAccessToken(forceRefresh);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const cachedTenantId = getCachedTenantId();
  if (cachedTenantId) headers['X-Tenant-Id'] = cachedTenantId;
  
  // Try to get tenant_id from local storage cache or fetch it
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.tenant_id) {
        headers['X-Tenant-Id'] = profile.tenant_id;
        setCachedTenantId(profile.tenant_id);
      }
    }
  } catch (e) {
    console.error("Failed to append tenant header", e);
  }
  
  return headers;
}

/**
 * @deprecated Prefira `getAccessToken()` (async). Mantido sync para callers
 * legados — lê do storage da Supabase.
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const legacyToken = localStorage.getItem(TOKEN_KEY);
    if (legacyToken) return legacyToken;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        return parsed?.access_token
          ?? parsed?.currentSession?.access_token
          ?? parsed?.session?.access_token
          ?? null;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export function setToken(token: string): void {
  if (typeof window !== 'undefined') localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  cachedSupabaseAccessToken = null;
  if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY);
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

    let url = `${VPS_API_BASE}${path}`;

    if (options?.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams.toString()}`;
    }

    const buildFetchOptions = async (forceRefresh = false): Promise<RequestInit> => ({
      method,
      headers: await getAuthHeaders(forceRefresh),
      ...(method !== 'GET' && options?.body ? { body: JSON.stringify(options.body) } : {}),
    });

    let response = await fetch(url, await buildFetchOptions(false));
    if (response.status === 401) {
      response = await fetch(url, await buildFetchOptions(true));
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // Server returned HTML instead of JSON — API is unreachable
      return { data: null, error: 'Servidor indisponível. Verifique se a API está rodando no VPS (pm2 status).' };
    }

    const data = await response.json();

    if (!response.ok) {
      if (isAuthError(response.status, data?.error)) {
        handleAuthFailure(!!options?.background);
        return { data: null, error: data?.error || 'Sessão expirada. Faça login novamente.' };
      }

      return { data: null, error: data.error || `HTTP ${response.status}` };
    }

    // Successful response — reset consecutive 401 counter
    resetAuthFailureCount();
    return { data, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro de rede';
    if (message.includes('is not valid JSON') || message.includes('Unexpected token')) {
      return { data: null, error: 'Servidor indisponível. Verifique se a API está rodando no VPS (pm2 status).' };
    }
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

// ─── Pacientes / Agenda / Marcadores → migrados pra Supabase ─
// (reexportados de sbAdapters para não quebrar imports existentes)

export {
  pacientesApi,
  agendaApi,
  marcadoresAgendaApi,
} from './sbAdapters';
export type { MarcadorAgenda } from './sbAdapters';

export interface HistoricoConsulta {
  id: string;
  data: string;
  hora: string;
  duracao: number;
  procedimento: string | null;
  status: string;
  observacoes: string | null;
  dentista_nome: string | null;
  dentista_especialidade: string | null;
}

// ─── Clínica config (horários + regras de agenda) ────────────

export type DiaSemana = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';
export type HorarioDia = { ativo: boolean; inicio: string; fim: string };
export type HorariosSemana = Record<DiaSemana, HorarioDia>;

export interface ClinicaConfig {
  id: number;
  horarios: HorariosSemana;
  intervalo_agenda: number;
  limitar_mesmo_horario: boolean;
  permitir_horario_indisponivel: boolean;
  habilitar_sessoes_procedimento: boolean;
  updated_at: string;
}

export const clinicaApi = {
  getConfig: () => vpsApiFetch<ClinicaConfig>('/clinica/config'),
  updateConfig: (body: Partial<Omit<ClinicaConfig, 'id' | 'updated_at'>>) =>
    vpsApiFetch<ClinicaConfig>('/clinica/config', { method: 'PUT', body }),
  getDentistaHorarios: (dentistaId: string) =>
    vpsApiFetch<{ id: string; nome: string; usar_horario_clinica: boolean; horarios: HorariosSemana; herdado?: boolean }>(
      `/dentistas/${encodeURIComponent(dentistaId)}/horarios`
    ),
  updateDentistaHorarios: (dentistaId: string, body: { usar_horario_clinica?: boolean; horarios?: HorariosSemana | null }) =>
    vpsApiFetch(`/dentistas/${encodeURIComponent(dentistaId)}/horarios`, { method: 'PUT', body }),
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
  tipo?: string;
  primeira_consulta?: boolean;
  dia_inteiro?: boolean;
  escopo?: string;
  categoria?: string;
  categoria_cor?: string;
  confirmacao_canal?: string;
  confirmacao_quando?: string;
  alerta_retorno_canal?: string;
  alerta_retorno_quando?: string;
  evento_titulo?: string;
  serie_id?: string | null;
  telefone?: string;
  marcadores?: Array<{ id: string; nome: string; cor: string }>;
  como_conheceu?: string | null;
}

// ─── Financeiro / Estoque / Tratamentos / Comissões / Prontuários / Dentistas / Comercial / CRM
// migrados pra Supabase via sbAdapters
export {
  financeiroApi,
  finBanksApi,
  finEmployeesApi,
  finPayrollsApi,
  finBillsApi,
  finMovementsApi,
  finOverdueApi,
  dentistasApi,
  estoqueApi,
  tratamentosApi,
  comissoesApi,
  prontuariosApi,
  leadsApi,
  funisApi,
  etapasApi,
  followUpsApi,
  atendentesApi,
  origensApi,
  comercialApi,
} from './sbAdapters';

// ─── Dashboard ──────────────────────────────────────────────
export { sbDashboardApi as dashboardApi } from './sbAdapters';


// ─── Painel Dentista ────────────────────────────────────────

export interface DentistaPainelInfo {
  id: string;
  nome: string;
  email: string;
  telefone?: string;
  cro?: string;
  especialidade?: string;
  comissao: number;
  status: 'ativo' | 'inativo';
}
export interface PainelAtendimento {
  id: string;
  pacienteId?: string;
  pacienteNome: string;
  pacienteIniciais: string;
  horario: string;
  tipo: string;
  status: 'agendado' | 'em_atendimento' | 'concluido' | 'cancelado';
  procedimento: string;
  valor?: number;
}
export interface PainelAgenda {
  id: string;
  pacienteId?: string;
  pacienteNome: string;
  data: string;
  horario: string;
  duracao: number;
  tipo: string;
  status: 'agendado' | 'confirmado' | 'cancelado';
  observacao?: string;
}
export interface PainelOrcamento {
  id: string;
  pacienteId?: string;
  pacienteNome: string;
  itens: { procedimento: string; valor: number; quantidade: number }[];
  total: number;
  status: 'pendente' | 'aprovado' | 'recusado' | 'em_andamento' | 'reprovado' | 'em_tratamento' | 'finalizado';
  criadoEm: string;
}
export interface PainelProntuario {
  id: string;
  pacienteId?: string;
  pacienteNome: string;
  pacienteIniciais: string;
  ultimaConsulta: string;
  diagnostico: string;
  tratamento: string;
  observacoes: string;
  alergias: string[];
}
export interface PainelComissao {
  id: string;
  pacienteNome: string;
  procedimento: string;
  data: string;
  valorProcedimento: number;
  percentual: number;
  valorComissao: number;
  status: 'pendente' | 'aprovada' | 'paga' | 'aprovado' | 'pago';
}
export interface PainelTratamento {
  id: string;
  pacienteId?: string;
  pacienteNome: string;
  descricao: string;
  dente: string;
  valor: number;
  status: 'planejado' | 'em_andamento' | 'pausado' | 'finalizado' | string;
  plano: string;
  observacoes: string;
  criadoEm: string;
  atualizadoEm?: string;
}
export interface DentistaPainel {
  dentista: DentistaPainelInfo;
  atendimentos: PainelAtendimento[];
  agenda: PainelAgenda[];
  orcamentos: PainelOrcamento[];
  prontuarios: PainelProntuario[];
  comissoes: PainelComissao[];
  tratamentos: PainelTratamento[];
}

// painelDentistaApi migrado pra Supabase via sbAdapters
export { painelDentistaApi } from './sbAdapters';


// ─── CRM Leads ──────────────────────────────────────────────


// crmApi e orcamentosApi migrados pra Supabase via sbAdapters
export { crmApi, orcamentosApi } from './sbAdapters';

// ─── Catálogo de Procedimentos (Fase B) ──────────────────────
export { procedimentosCatalogoApi } from './sbAdapters';
export type { ProcedimentoCatalogo, ProcedimentoVersao } from './sbAdapters';


// ─── Execuções e Assinaturas (Fase C) ───────────────────────
export interface AssinaturaPayload {
  base64: string;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  canal?: 'sms' | 'whatsapp' | 'none';
  codigo?: string | null;
  // Consentimento LGPD (Lei 13.709/2018)
  consentimento_aceito?: boolean;
  consentimento_em?: string | null;     // ISO timestamp
  consentimento_versao?: string;
  consentimento_texto?: string;
}
export interface ExecucaoPayload {
  orcamento_id?: string | null;
  orcamento_item_id?: string | null;
  paciente_id: string;
  dentista_id?: string | null;
  procedimento_id?: string | null;
  procedimento_nome: string;
  dente?: number | null;
  faces?: string[];
  valor?: number;
  observacoes?: string | null;
  assinatura?: AssinaturaPayload | null;
}
export interface ExecucaoRow {
  id: string;
  orcamento_id: string | null;
  orcamento_item_id: string | null;
  paciente_id: string;
  dentista_id: string | null;
  dentista_nome?: string | null;
  procedimento_id: string | null;
  procedimento_nome: string;
  dente: number | null;
  faces: string[];
  valor: number;
  observacoes: string | null;
  status: string;
  executado_em: string;
  assinatura_id: string | null;
  assinatura_base64?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_m?: number | null;
}
export const execucoesApi = {
  listByOrcamento: (id: string) => vpsApiFetch<ExecucaoRow[]>(`/orcamentos/${id}/execucoes`),
  listByPaciente: (id: string) => vpsApiFetch<ExecucaoRow[]>(`/pacientes/${id}/execucoes`),
  create: (body: ExecucaoPayload) => vpsApiFetch<ExecucaoRow>('/execucoes', { method: 'POST', body }),
  delete: (id: string) => vpsApiFetch(`/execucoes/${id}`, { method: 'DELETE' }),
  getAssinatura: (id: string) => vpsApiFetch(`/assinaturas/${id}`),
};

// ─── WhatsApp (via proxy) ───────────────────────────────────

export const whatsappApi = {
  instances: () => vpsApiFetch('/whatsapp/instances'),
  create: (instanceName: string) => vpsApiFetch('/whatsapp/instances', { method: 'POST', body: { instanceName } }),
  connect: (instance: string) => vpsApiFetch(`/whatsapp/connect/${instance}`),
  syncChat: (instance: string, days = 30) => vpsApiFetch<{
    success: boolean;
    imported: number;
    skipped: number;
    instances: Array<{ name: string; imported: number; skipped: number; error?: string | null }>;
  }>(`/whatsapp/sync-chat/${encodeURIComponent(instance)}`, { method: 'POST', body: { days }, background: true }),
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
      const params = new URLSearchParams({
        instance,
        number,
        mediaType,
        ...(media.fileName ? { fileName: media.fileName } : {}),
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.mimeType ? { mimeType: media.mimeType } : {}),
      });

      const buildUploadOptions = async (forceRefresh = false): Promise<RequestInit> => {
        const token = await getAccessToken(forceRefresh);
        return {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': file.type || media.mimeType || 'application/octet-stream',
          },
          body: file,
        };
      };

      let response = await fetch(`${VPS_API_BASE}/whatsapp/send-media-upload?${params.toString()}`, await buildUploadOptions(false));
      if (response.status === 401) {
        response = await fetch(`${VPS_API_BASE}/whatsapp/send-media-upload?${params.toString()}`, await buildUploadOptions(true));
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (isAuthError(response.status, data?.error)) {
          handleAuthFailure(false);
          return { data: null, error: data?.error || 'Sessão expirada. Faça login novamente.' };
        }
        return { data: null, error: data.error || `HTTP ${response.status}` };
      }

      return { data, error: null };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro de rede';
      return { data: null, error: message };
    }
  },
  getMediaSendStatus: async (jobId: string) => {
    let result = await vpsApiFetch<{ status: string; result?: { key?: { id?: string } }; error?: string }>(`/whatsapp/send-media-status/${jobId}`, { background: true });
    if (result.error === 'Unauthorized') {
      result = await vpsApiFetch<{ status: string; result?: { key?: { id?: string } }; error?: string }>(`/whatsapp/send-media-status/${jobId}`, { background: true });
    }
    return result;
  },
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
  get: () => vpsApiFetch('/attendance-settings', { background: true }),
  update: (body: unknown) => vpsApiFetch('/attendance-settings', { method: 'PUT', body }),
};


// ─── Attendance Queues ──────────────────────────────────────

export const queuesApi = {
  list: () => vpsApiFetch<any[]>('/queues', { background: true }),
  create: (body: Record<string, unknown>) => vpsApiFetch<{ success: boolean; id: string }>('/queues', { method: 'POST', body }),
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
  create: (body: unknown) => vpsApiFetch('/transfers', { method: 'POST', body }),
  list: (leadId?: string) => vpsApiFetch('/transfers', { params: leadId ? { leadId } : undefined, background: true }),
};


// ─── Attendance Sessions ────────────────────────────────────

export const sessionsApi = {
  start: (body: { leadId: string; leadName?: string; leadPhone?: string; queueId?: string; queueName?: string }) =>
    vpsApiFetch<{ success: boolean; id: string; existing?: boolean }>('/sessions/start', { method: 'POST', body }),
  assign: async (body: { leadId: string }) => {
    const primary = await vpsApiFetch<{ success: boolean; id: string; waitTime?: number }>('/sessions/assign', { method: 'POST', body });
    if (!primary.error) return primary;

    console.warn('[sessionsApi.assign] VPS failed, trying Supabase fallback:', primary.error);
    return sbSessionsApi.assign(body);
  },
  firstResponse: (body: { leadId: string }) =>
    vpsApiFetch<{ success: boolean }>('/sessions/first-response', { method: 'POST', body, background: true }),
  close: (body: unknown) =>
    vpsApiFetch<{ success: boolean; sessionId?: string; duration?: number }>('/sessions/close', { method: 'POST', body }),
  checkActive: (leadId: string) =>
    vpsApiFetch<{ active: boolean; attendantId?: string; attendantName?: string; isCurrentUser?: boolean }>(`/sessions/active/${leadId}`, { background: true }),
  list: (params?: { active?: boolean }) =>
    vpsApiFetch<any[]>('/sessions/active', { params: params?.active ? { active: 'true' } : undefined, background: true }),
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
  attendance: (days?: number) => vpsApiFetch<AttendanceMetrics>('/metrics/attendance', {
    params: days ? { days: String(days) } : undefined,
    background: true,
  }),
};


// ─── Lead Tags ──────────────────────────────────────────────

export interface LeadTagApi {
  id: string;
  name: string;
  color: string;
  icon: string;
  created_at: string;
}

export { sbTagsApi as tagsApi } from './sbAdapters';


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

export { sbContatosApi as contatosApi } from './sbAdapters';


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
  list: async (leadId: string, params?: { before?: string; limit?: number }) => {
    const vpsResult = await vpsApiFetch<{ messages: ChatMessageApi[]; hasMore: boolean }>(`/messages/${leadId}`, {
      params: Object.fromEntries(Object.entries(params || {}).map(([key, value]) => [key, String(value)])),
    });
    if (vpsResult.error || (vpsResult.data?.messages?.length ?? 0) === 0) {
      const sbResult = await sbMessagesApi.list(leadId, params);
      if (!sbResult.error && (sbResult.data?.messages?.length ?? 0) > 0) return sbResult;
    }
    return vpsResult;
  },
  save: (body: {
    id: string;
    leadId: string;
    content: string;
    type: string;
    status?: string;
    fileName?: string;
    fileUrl?: string;
    mimeType?: string;
    replyTo?: { messageId: string; content: string; sender: string } | null;
    instance?: string;
    phone?: string;
  }) => vpsApiFetch<{ success: boolean; id: string; mediaUrl?: string }>('/messages', { method: 'POST', body }),
  saveBatch: (messages: Array<Record<string, unknown>>) =>
    vpsApiFetch<{ success: boolean; count: number }>('/messages/batch', { method: 'POST', body: { messages } }),
  markRead: (leadId: string) =>
    vpsApiFetch<{ success: boolean }>('/messages/mark-read', { method: 'POST', body: { leadId }, background: true }),
  updateStatus: (id: string, status: string) =>
    vpsApiFetch<{ success: boolean }>(`/messages/${id}/status`, { method: 'PUT', body: { status } }),
  delete: (id: string, hard = false) =>
    vpsApiFetch<{ success: boolean }>(`/messages/${id}`, { method: 'DELETE', params: hard ? { hard: 'true' } : undefined }),
  unreadCounts: async () => {
    const vpsResult = await vpsApiFetch<Record<string, number>>('/messages/unread', { background: true });
    if (vpsResult.error || Object.keys(vpsResult.data || {}).length === 0) {
      const sbResult = await sbMessagesApi.unreadCounts();
      if (!sbResult.error && Object.keys(sbResult.data || {}).length > 0) return sbResult;
    }
    return vpsResult;
  },
  search: async (q: string, leadId?: string) => {
    const vpsResult = await vpsApiFetch<ChatMessageApi[]>('/messages/search', {
      params: { q, ...(leadId ? { lead_id: leadId } : {}) },
      background: true,
    });
    if (vpsResult.error || (vpsResult.data?.length ?? 0) === 0) {
      const sbResult = await sbMessagesApi.search(q, leadId);
      if (!sbResult.error && (sbResult.data?.length ?? 0) > 0) return sbResult;
    }
    return vpsResult;
  },
};

// ─── Media Upload ───────────────────────────────────────────

export const mediaApi = {
  upload: async (file: File): Promise<{ url: string | null; error: string | null }> => {
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({ fileName: file.name, mimeType: file.type || 'application/octet-stream' });
      const response = await fetch(`${VPS_API_BASE}/media/upload?${params.toString()}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { url: null, error: data?.error || `HTTP ${response.status}` };
      return { url: data.url || null, error: null };
    } catch (error: unknown) {
      return { url: null, error: error instanceof Error ? error.message : 'Erro de rede' };
    }
  },
};


// ─── Queue Leads ────────────────────────────────────────────

export const queueLeadsApi = {
  list: async () => {
    const vpsResult = await vpsApiFetch<{ queue: unknown[]; active: unknown[] }>('/queue/leads', { background: true });

    // Defensive fallback: the messages are already in Supabase, but if the VPS
    // tenant/auth bridge is stale after deploy and returns an empty queue, read
    // the persisted chat tables directly so Comercial/Chat never shows a false
    // "Nenhum lead" while WhatsApp messages exist.
    if (vpsResult.error || (((vpsResult.data?.queue?.length ?? 0) + (vpsResult.data?.active?.length ?? 0)) === 0)) {
      const sbResult = await sbQueueLeadsApi.list();
      if (!sbResult.error && ((sbResult.data?.queue?.length ?? 0) + (sbResult.data?.active?.length ?? 0)) > 0) {
        return sbResult;
      }
    }

    return vpsResult;
  },
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
  patient_id?: string;
  patient_name: string;
  attendant_id?: string;
  attendant_name?: string;
  transcription: string;
  report: string;
  queixa_principal: string;
  procedimento: string;
  dente_regiao: string;
  prescricoes: Array<{ medicamento: string; dosagem: string; posologia: string; duracao: string }> | string;
  duration_seconds: number;
  created_at: string;
}

export const aiApi = {
  getSettings: () => vpsApiFetch<AISettingApi[]>('/ai/settings'),
  saveSettings: (body: { provider: string; api_key: string; model?: string; enabled?: boolean }) =>
    vpsApiFetch<{ success: boolean }>('/ai/settings', { method: 'POST', body }),

  transcribe: async (audioBlob: Blob): Promise<{ data: { transcription: string } | null; error: string | null }> => {
    try {
      const token = await getAccessToken();
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

  listReports: (filters?: {
    from?: string; to?: string; status?: 'todos' | 'com_prescricao' | 'sem_prescricao';
    patientId?: string; attendantId?: string; q?: string; limit?: number;
  }) => {
    const params: Record<string, string> = {};
    if (filters?.from) params.from = filters.from;
    if (filters?.to) params.to = filters.to;
    if (filters?.status && filters.status !== 'todos') params.status = filters.status;
    if (filters?.patientId) params.patientId = filters.patientId;
    if (filters?.attendantId) params.attendantId = filters.attendantId;
    if (filters?.q) params.q = filters.q;
    if (filters?.limit) params.limit = String(filters.limit);
    return vpsApiFetch<{
      reports: ClinicalReportApi[];
      stats: { total: number; com_prescricao: number; sem_prescricao: number; pacientes_unicos: number; duracao_total_min: number };
    }>('/ai/reports', { params });
  },

  exportReportsCsvUrl: (filters?: {
    from?: string; to?: string; status?: 'todos' | 'com_prescricao' | 'sem_prescricao';
    patientId?: string; attendantId?: string; q?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.status && filters.status !== 'todos') params.set('status', filters.status);
    if (filters?.patientId) params.set('patientId', filters.patientId);
    if (filters?.attendantId) params.set('attendantId', filters.attendantId);
    if (filters?.q) params.set('q', filters.q);
    const token = getToken();
    if (token) params.set('token', token);
    return `${VPS_API_BASE}/ai/reports/export.csv?${params.toString()}`;
  },

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

// ─── Reativação de pacientes inativos ───────────────────────

export type ReactivationOrigin =
  | 'instagram' | 'facebook' | 'google' | 'indicacao' | 'whatsapp' | 'site' | 'todos';
export type ReactivationStatus = 'ativo' | 'pausado' | 'rascunho';

export interface ReactivationRule {
  id: string;
  name: string;
  inactiveDays: number;
  origin: ReactivationOrigin;
  messageTemplate: string;
  status: ReactivationStatus;
  matchedPatients: number;
  sentCount: number;
  respondedCount: number;
  responseRate: number;
  lastRun: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReactivationPatient {
  id: string;
  leadId: string | null;
  name: string;
  initials: string;
  phone: string;
  email: string;
  origin: ReactivationOrigin;
  lastVisit: string;
  daysSince: number;
}

export interface ReactivationKpis {
  activeRules: number;
  inactivePatients: number;
  messagesSent: number;
  responseRate: number;
}

export interface ReactivationSendResult {
  success: boolean;
  sent: number;
  failed: number;
  total: number;
  errors: { pacienteId: string; error: string }[];
}

export const reativacaoApi = {
  listRules: () => vpsApiFetch<ReactivationRule[]>('/reativacao/rules'),
  kpis: () => vpsApiFetch<ReactivationKpis>('/reativacao/kpis'),
  createRule: (body: {
    name: string;
    inactiveDays: number;
    origin: ReactivationOrigin;
    messageTemplate: string;
    status?: ReactivationStatus;
  }) => vpsApiFetch<ReactivationRule>('/reativacao/rules', { method: 'POST', body }),
  updateRule: (id: string, body: Partial<{
    name: string;
    inactiveDays: number;
    origin: ReactivationOrigin;
    messageTemplate: string;
    status: ReactivationStatus;
  }>) => vpsApiFetch<ReactivationRule>(`/reativacao/rules/${id}`, { method: 'PUT', body }),
  deleteRule: (id: string) =>
    vpsApiFetch<{ success: boolean }>(`/reativacao/rules/${id}`, { method: 'DELETE' }),
  patients: (id: string) =>
    vpsApiFetch<ReactivationPatient[]>(`/reativacao/rules/${id}/patients`),
  send: (id: string, patientIds: string[] = []) =>
    vpsApiFetch<ReactivationSendResult>(`/reativacao/rules/${id}/send`, {
      method: 'POST',
      body: { patientIds },
    }),
};

// ─── Health check ───────────────────────────────────────────

export const healthCheck = () => vpsApiFetch('/health');

export { VPS_API_BASE };

// ─── Supabase-backed extras ─────────────────────────────────
export {
  sbUserPreferencesApi as userPreferencesApi,
  sbPushSubscriptionsApi as pushSubscriptionsApi,
  sbSatisfactionApi as satisfactionApi,
  sbReactivationApi as reactivationApi,
  sbReactivationSendsApi as reactivationSendsApi,
  sbSystemSettingsApi as systemSettingsApi,
} from './sbAdapters';

