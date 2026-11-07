// Entrada de mensagens de WhatsApp: do evento interno (whatsapp/events.mjs) para a "mensagem
// recebida" que o processamento do chat consome (handleInboundWhatsAppMessage no server.mjs:
// lead, chat, SAIR, confirmação de consulta, encaixe, menu de filas, avaliação, automações).
// Os dois webhooks (Evolution e OpenWA) passam por aqui; o processamento é um só.
import { validateInternalEvent } from './events.mjs';

// Kind interno → msgType que o chat grava hoje (chat_messages.type).
const CHAT_TYPES = new Set(['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'button_response', 'list_response']);
export function chatMessageType(kind) {
  return CHAT_TYPES.has(kind) ? kind : 'text';
}

const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document', 'sticker']);

// Mensagem recebida normalizada. `overrides` deixa o adaptador corrigir o que só ele sabe
// (ex.: Evolution resolve o JID real de um @lid e o nome do arquivo pelo payload cru).
// fetchMediaBase64 / fetchAvatarUrl: funções do adaptador (nunca lançam; null quando falha).
export function inboundMessageFromEvent(evt, overrides = {}) {
  const msgType = chatMessageType(evt.kind);
  return {
    remoteJid: evt.chatId,
    isFromMe: !!evt.fromMe,
    msgContent: evt.text || '',
    msgType,
    hasMedia: MEDIA_TYPES.has(msgType),
    mediaMimeType: evt.media?.mimetype || null,
    mediaFileName: evt.media?.filename || null,
    pushName: evt.pushName || null,
    providerMsgId: evt.messageId || null,
    rawType: evt.kind || null,
    messageTimestamp: evt.timestamp || null,
    fetchMediaBase64: async () => null,
    fetchAvatarUrl: async () => null,
    ...overrides,
  };
}

// Eventos válidos pelo contrato (os inválidos são descartados com aviso, nunca processados).
export function validEvents(events, log = console) {
  const out = [];
  for (const evt of events || []) {
    const problems = validateInternalEvent(evt);
    if (problems.length) {
      log.warn?.(`[whatsapp] evento descartado (${evt?.provider || '?'}/${evt?.type || '?'}): ${problems.join('; ')}`);
      continue;
    }
    out.push(evt);
  }
  return out;
}

// Dedupe de webhook: true = primeira vez (processar); false = repetido. Sem chave: processa
// (o processamento de mensagem já é idempotente pelo id em chat_messages). Erro de banco:
// processa (perder mensagem é pior que repetir; o insert da mensagem tem ON CONFLICT).
export async function claimWebhookEvent(pool, provider, eventId) {
  const key = String(eventId || '').slice(0, 300);
  if (!key) return true;
  try {
    const r = await pool.query(
      `INSERT INTO whatsapp_webhook_events (provider, event_id) VALUES ($1, $2)
       ON CONFLICT (provider, event_id) DO NOTHING RETURNING 1`,
      [provider, key]
    );
    return !!(r?.rowCount || r?.rows?.length);
  } catch {
    return true;
  }
}

export async function pruneWebhookEvents(pool, days = 8) {
  try {
    await pool.query(`DELETE FROM whatsapp_webhook_events WHERE received_at < NOW() - make_interval(days => $1::int)`, [days]);
  } catch { /* tabela ainda não criada: ignora */ }
}

// "res" para quem processa depois de já ter respondido ao provedor (OpenWA responde 200
// antes do processamento). Mesma interface que o handler usa do Express.
export function detachedResponse() {
  const r = { headersSent: true, statusCode: 200 };
  r.status = () => r;
  r.json = () => r;
  return r;
}
