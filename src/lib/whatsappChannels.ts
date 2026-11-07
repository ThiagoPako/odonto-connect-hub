// Canais do WhatsApp da clínica (F1: API oficial, reserva por QR Code, sistema anterior).
// Rotas em vps-api-server/server.mjs ("OPENWA (reserva por QR) — webhook e canais").
import { vpsApiFetch } from "@/lib/vpsApi";

export type ChannelProvider = "cloud" | "openwa" | "evolution";
export type ChannelRole = "primary" | "backup";
/** open = conectado · connecting = aguardando QR · close = desconectado · restricted = WhatsApp restringiu. */
export type ChannelState = "open" | "connecting" | "close" | "restricted";

export interface WhatsAppChannel {
  id: string;
  provider: ChannelProvider;
  role: ChannelRole;
  status: "active" | "disabled";
  instance: string | null;
  displayPhone: string | null;
  state: ChannelState | null;
  connectedAt: string | null;
  createdAt: string | null;
}

export interface ChannelStateEvent {
  channelId: string;
  state: ChannelState;
  qr?: string;
}

/** Mensagens do servidor que não são para a recepção ler como estão. */
function friendlyError(error: string | null): string | null {
  if (!error) return null;
  if (error === "Admin access required") return "Só o administrador da clínica pode alterar os canais.";
  if (error === "Unauthorized") return "Sua sessão expirou. Entre de novo.";
  return error;
}

async function call<T>(path: string, options?: Parameters<typeof vpsApiFetch>[1]) {
  const r = await vpsApiFetch<T>(path, options);
  return { data: r.data, error: friendlyError(r.error) };
}

export const whatsappChannelsApi = {
  list: () => call<{ channels: WhatsAppChannel[]; openwaAvailable: boolean }>("/whatsapp/channels", { background: true }),
  createReserva: () => call<{ channel: WhatsAppChannel; webhookRegistered: boolean }>("/whatsapp/openwa/channels", { method: "POST" }),
  qr: (id: string) => call<{ qr: string | null; state: ChannelState | null }>(`/whatsapp/channels/${encodeURIComponent(id)}/qr`, { background: true }),
  state: (id: string) => call<{ channel: WhatsAppChannel; live: boolean }>(`/whatsapp/channels/${encodeURIComponent(id)}/state`, { background: true }),
  disconnect: (id: string) => call<{ ok: boolean }>(`/whatsapp/channels/${encodeURIComponent(id)}/disconnect`, { method: "POST" }),
  remove: (id: string) => call<{ ok: boolean }>(`/whatsapp/channels/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setPrimary: (id: string) => call<{ ok: boolean }>(`/whatsapp/channels/${encodeURIComponent(id)}/primary`, { method: "POST" }),
};

/** "5562912345678" → "(62) 91234-5678". Sem número: null. */
export function formatChannelPhone(raw: string | null | undefined): string | null {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  const local = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `+${d}`;
}

/** Nome do canal para títulos e diálogos: telefone ou, sem telefone, o tipo. */
export function channelLabel(c: WhatsAppChannel): string {
  return formatChannelPhone(c.displayPhone) || (c.provider === "openwa" ? "número reserva (QR Code)" : c.provider === "cloud" ? "número oficial" : "número do sistema anterior");
}

/** O QR do OpenWA vem como data URL de imagem; aceita base64 puro por segurança. */
export function qrImageSrc(qr: string | null | undefined): string | null {
  if (!qr) return null;
  if (qr.startsWith("data:image/")) return qr;
  if (/^[A-Za-z0-9+/=]+$/.test(qr) && qr.length > 100) return `data:image/png;base64,${qr}`;
  return null;
}
