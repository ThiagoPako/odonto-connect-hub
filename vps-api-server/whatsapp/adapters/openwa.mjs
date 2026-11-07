// Adaptador OpenWA (reserva por QR, F1 de docs/whatsapp/migracao-provedores.md).
// API: OpenWA v0.29.0 (docs/06-api-specification.md). Fixar a versão no servidor
// (docs/operacao/openwa-vps.md): o adaptador segue os formatos dessa versão.
//
// Chaves:
// - ADMIN (OPENWA_ADMIN_KEY, só no .env): criar/apagar sessão, criar/revogar chave por sessão,
//   listar estados. Nunca usada para enviar mensagem.
// - Por sessão (role operator, allowedSessions=[sessionId]): envio, QR, estado, webhook. Fica
//   cifrada em whatsapp_channels.credentials_enc; quem chama passa `channel.credentials.apiKey`.
//
// Regras:
// - Nenhum método lança. `201` do OpenWA = aceito, não entregue: a entrega chega por message.ack.
// - 429 com code SEND_PACING_LIMITED → retryAfterMs (a fila reagenda; não é falha nem disjuntor).
// - O tenant nunca vem do OpenWA: o webhook chega em /api/webhook/openwa/:channelId e o canal
//   (e a clínica) vêm do nosso banco; o sessionId do corpo só é conferido contra o canal.
// - OpenWA não envia botões/lista: sendInteractive devolve 501 e a fila manda o texto numerado.
import { createHmac, timingSafeEqual } from 'crypto';
import { sendResult } from '../provider.mjs';
import {
  inboundMessageEvent, messageStatusEvent, presenceEvent, channelStateEvent, unknownEvent,
} from '../events.mjs';
import { isSafeProviderPath, maskWaIdentifiers } from './evolution.mjs';

export const OPENWA_WEBHOOK_EVENTS = Object.freeze([
  'message.received', 'message.sent', 'message.ack', 'message.failed',
  'session.status', 'session.qr', 'session.authenticated', 'session.disconnected', 'session.restriction',
]);

// Status de sessão (minúsculo no OpenWA) → estado do canal.
export function openWaSessionState(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'ready') return 'open';
  if (s === 'created' || s === 'initializing' || s === 'qr_ready' || s === 'authenticating') return 'connecting';
  if (s === 'action_required') return 'restricted';
  return 'close';
}

export function openWaChatId(to) {
  const v = String(to || '').trim();
  if (v.includes('@')) return v;
  return `${v.replace(/\D/g, '')}@c.us`;
}

// Tipo do OpenWA → kind interno.
function kindOf(data) {
  if (data?.button?.id) return 'button_response';
  const t = String(data?.type || '').toLowerCase();
  if (t === 'text' || t === 'chat') return 'text';
  if (t === 'voice' || t === 'ptt') return 'audio';
  if (['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact'].includes(t)) return t;
  if (t === 'vcard') return 'contact';
  return 'other';
}

function isoFromEpoch(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

// Assinatura do webhook: "sha256=<hex>" = HMAC-SHA256 do corpo bruto com o segredo da sessão.
export function verifyOpenWaSignature(rawBody, header, secret) {
  if (!Buffer.isBuffer(rawBody) || !rawBody.length || typeof header !== 'string' || !secret) return false;
  const expected = `sha256=${createHmac('sha256', String(secret)).update(rawBody).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Webhook do OpenWA → eventos internos. Pura. channelRef = sessionId do corpo.
export function parseOpenWaWebhook(body) {
  if (!body || typeof body !== 'object') return [];
  const event = String(body.event || '');
  const ref = String(body.sessionId || '');
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const eventId = body.idempotencyKey ? String(body.idempotencyKey) : null;
  const withId = (evt) => { evt.eventId = eventId; return evt; };

  if (event === 'message.received' || event === 'message.sent') {
    const fromMe = event === 'message.sent' || data.fromMe === true;
    const chatId = String(data.chatId || (fromMe ? data.to : data.from) || '');
    const isGroup = data.isGroup === true || chatId.endsWith('@g.us') || (data.kind && data.kind !== 'individual');
    // Remetente @lid: o OpenWA pode anexar senderPhone (RESOLVE_LID_TO_PHONE=true).
    const fromPhone = data.senderPhone || chatId.split('@')[0] || '';
    const kind = kindOf(data);
    const media = data.media && typeof data.media === 'object'
      ? {
        ref: String(data.id || ''),
        chatId,
        mimetype: data.media.mimetype || null,
        filename: data.media.filename || null,
        inlineBase64: data.media.omitted ? null : (data.media.data || null),
      }
      : (['image', 'audio', 'video', 'document', 'sticker'].includes(kind) ? { ref: String(data.id || ''), chatId, mimetype: null, filename: null, inlineBase64: null } : null);
    return [withId(inboundMessageEvent('openwa', ref, {
      from: String(fromPhone).replace(/\D/g, ''),
      chatId,
      messageId: String(data.id || ''),
      fromMe,
      kind,
      text: kind === 'button_response' ? String(data.button?.id || '') : String(data.body || ''),
      buttonId: data.button?.id ? String(data.button.id) : null,
      media,
      quotedId: data.quotedMessage?.id ? String(data.quotedMessage.id) : null,
      timestamp: isoFromEpoch(data.timestamp),
      isGroup: !!isGroup,
      pushName: data.contact?.pushName || data.contact?.name || null,
    }))];
  }

  if (event === 'message.ack' || event === 'message.failed') {
    const status = event === 'message.failed' ? 'failed' : String(data.status || '').toLowerCase();
    if (!['sent', 'delivered', 'read', 'failed'].includes(status)) return [];
    const messageId = String(data.messageId || data.id || '');
    if (!messageId) return [];
    return [withId(messageStatusEvent('openwa', ref, { messageId, chatId: String(data.chatId || ''), status }))];
  }

  if (event === 'session.status') return [withId(channelStateEvent('openwa', ref, { state: openWaSessionState(data.status) }))];
  if (event === 'session.qr') return [withId(channelStateEvent('openwa', ref, { state: 'connecting', qr: data.qr || null }))];
  if (event === 'session.authenticated') return [withId(channelStateEvent('openwa', ref, { state: 'open', phone: data.phone || null }))];
  if (event === 'session.disconnected') return [withId(channelStateEvent('openwa', ref, { state: 'close' }))];
  if (event === 'session.restriction') {
    return [withId(channelStateEvent('openwa', ref, { state: data.active ? 'restricted' : 'open' }))];
  }
  if (event === 'presence.update') {
    const p = Array.isArray(data.participants) ? data.participants[0] : null;
    return [withId(presenceEvent('openwa', ref, { chatId: String(data.chatId || ''), status: p?.state || null }))];
  }
  return [withId(unknownEvent('openwa', ref, event))];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createOpenWaAdapter({ baseUrl, adminKey, env = process.env } = {}) {
  const BASE = String(baseUrl || '').replace(/\/$/, '');
  const doFetch = (...args) => globalThis.fetch(...args);
  const configured = () => !!BASE;

  async function request(path, { method = 'GET', body, apiKey, timeoutMs, headers = {}, binary = false } = {}) {
    if (!BASE) return { ok: false, status: 503, data: { error: 'OPENWA_URL não configurada' } };
    if (!apiKey) return { ok: false, status: 503, data: { error: 'Chave do OpenWA ausente' } };
    if (!isSafeProviderPath(path)) return { ok: false, status: 400, data: { error: 'Caminho inválido' } };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(timeoutMs || env.OPENWA_REQUEST_TIMEOUT_MS || 20_000));
    try {
      const res = await doFetch(`${BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-API-Key': apiKey, ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (binary && res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { ok: true, status: res.status, data: buf, mimetype: res.headers?.get?.('content-type') || null };
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn(`⚠️ OpenWA ${res.status} em ${maskWaIdentifiers(path)}:`, maskWaIdentifiers(JSON.stringify(data)).slice(0, 300));
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      console.error(`❌ OpenWA (${maskWaIdentifiers(path)}):`, maskWaIdentifiers(err?.message));
      return { ok: false, status: aborted ? 504 : 502, data: { error: aborted ? 'OpenWA timeout' : 'OpenWA indisponível' } };
    } finally {
      clearTimeout(timeout);
    }
  }

  const sessionPath = (channel) => `/api/sessions/${encodeURIComponent(String(channel?.external_id || channel?.externalId || ''))}`;
  const keyOf = (channel) => channel?.credentials?.apiKey || '';

  function toSendResult(r) {
    const code = r.data?.code || '';
    const pacing = r.status === 429;
    const uncertain = r.status === 504 || code === 'IDEMPOTENCY_OUTCOME_UNKNOWN' || code === 'IDEMPOTENCY_KEY_IN_PROGRESS'
      || (r.status === 500 && code === 'ENGINE_PAGE_ERROR');
    return sendResult({
      ok: r.ok,
      providerMessageId: r.ok ? (r.data?.messageId || null) : null,
      uncertain,
      retryable: r.status >= 500 || r.status === 409,
      retryAfterMs: pacing ? Math.max(1, Number(r.data?.retryAfterSeconds) || 60) * 1000 : 0,
      status: r.status,
      error: r.ok ? null : (Array.isArray(r.data?.message) ? r.data.message.join('; ') : (r.data?.message || r.data?.error || `HTTP ${r.status}`)),
      raw: r,
    });
  }

  // "digitando" (texto) ou "gravando" (áudio) antes de um envio da fila. O OpenWA também
  // simula digitação no envio (SIMULATE_TYPING, até 5 s); este é o nosso ritmo, por mensagem.
  async function typing(channel, chatId, delayMs, state = 'typing') {
    if (!delayMs || delayMs <= 0) return;
    await request(`${sessionPath(channel)}/chats/typing`, { method: 'POST', apiKey: keyOf(channel), body: { chatId, state }, timeoutMs: 5000 });
    await sleep(Math.min(Number(delayMs), 8000));
  }

  async function send(channel, route, body, { idempotencyKey, timeoutMs = 45_000 } = {}) {
    const r = await request(`${sessionPath(channel)}/messages/${route}`, {
      method: 'POST', apiKey: keyOf(channel), body, timeoutMs,
      headers: idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).slice(0, 255) } : {},
    });
    return toSendResult(r);
  }

  return {
    kind: 'openwa',
    configured,
    capabilities: {
      qr: true, buttons: false, lists: false, polls: true, deleteForEveryone: true, archive: true,
      presence: true, typing: true, contactsSync: true, history: true, profilePicture: true,
      calls: false, numberCheck: true, requiresTemplateOutside24h: false,
    },
    request,

    async sendText(channel, to, text, { delayMs = 0, quotedId = null, idempotencyKey = null, timeoutMs } = {}) {
      const chatId = openWaChatId(to);
      await typing(channel, chatId, delayMs);
      return send(channel, 'send-text', { chatId, text: String(text || ''), linkPreview: false, ...(quotedId ? { quotedMessageId: String(quotedId) } : {}) }, { idempotencyKey, timeoutMs });
    },

    async sendInteractive() {
      return sendResult({ ok: false, status: 501, error: 'OpenWA não envia botões/lista (vai o texto numerado)' });
    },

    // Mídia por base64 (o servidor lê do nosso disco; nunca passa URL de terceiros ao OpenWA).
    // Áudio com ptt=true vai como mensagem de voz (o chamador já converteu para OGG/Opus).
    async sendMedia(channel, to, { kind = 'document', base64, url, mimetype, filename, caption, ptt = false, quotedId = null, idempotencyKey = null, delayMs = 0, timeoutMs = 60_000 } = {}) {
      if (!base64 && !url) return sendResult({ ok: false, status: 400, error: 'Mídia vazia' });
      if (base64 && !mimetype) return sendResult({ ok: false, status: 400, error: 'Mídia sem tipo (mimetype)' });
      const route = { image: 'send-image', video: 'send-video', audio: 'send-audio', sticker: 'send-sticker' }[kind] || 'send-document';
      const chatId = openWaChatId(to);
      await typing(channel, chatId, delayMs, kind === 'audio' ? 'recording' : 'typing');
      const body = { chatId, ...(base64 ? { base64, mimetype } : { url }) };
      if (filename) body.filename = String(filename).slice(0, 255);
      if (caption && kind !== 'audio') body.caption = String(caption).slice(0, 1024);
      if (kind === 'audio' && ptt) body.ptt = true;
      if (quotedId) body.quotedMessageId = String(quotedId);
      return send(channel, route, body, { idempotencyKey, timeoutMs });
    },

    // Marcar como lido (só por ação do atendente; a sessão nunca lê sozinha). No Baileys, sem
    // messageIds só a última mensagem recebida ganha o "lido": mandamos os ids que o chat tem.
    async markRead(channel, chatId, { messageIds = [] } = {}) {
      const ids = (Array.isArray(messageIds) ? messageIds : [])
        .map(id => String(id || '').trim()).filter(id => id && !/\s/.test(id) && id.length <= 255).slice(0, 100);
      const r = await request(`${sessionPath(channel)}/chats/read`, {
        method: 'POST', apiKey: keyOf(channel), timeoutMs: 8000,
        body: { chatId: openWaChatId(chatId), ...(ids.length ? { messageIds: ids } : {}) },
      });
      return { ok: r.ok && r.data?.success !== false, status: r.status };
    },

    // Presença no chat humano: 'typing' | 'recording' | 'paused' (paused apaga o indicador).
    async sendTyping(channel, to, { state = 'typing' } = {}) {
      const st = ['typing', 'recording', 'paused'].includes(state) ? state : 'typing';
      const r = await request(`${sessionPath(channel)}/chats/typing`, {
        method: 'POST', apiKey: keyOf(channel), body: { chatId: openWaChatId(to), state: st }, timeoutMs: 5000,
      });
      return { ok: r.ok, status: r.status };
    },

    async getState(channel) {
      const r = await request(sessionPath(channel), { apiKey: keyOf(channel), timeoutMs: 8000 });
      if (!r.ok) return { ok: false, state: null, status: r.status, raw: r };
      return { ok: true, state: openWaSessionState(r.data?.status), phone: r.data?.phone || null, status: r.status, raw: r };
    },

    // Estado de todas as sessões (chave ADMIN). ref = sessionId.
    async listStates({ timeoutMs } = {}) {
      const r = await request('/api/sessions', { apiKey: adminKey, timeoutMs: timeoutMs || 10_000 });
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : []);
      return {
        ok: r.ok, status: r.status, raw: r,
        states: list.filter(s => s?.id).map(s => ({ ref: String(s.id), name: s.name || null, state: openWaSessionState(s.status), phone: s.phone || null })),
      };
    },

    async getQr(channel) {
      const r = await request(`${sessionPath(channel)}/qr`, { apiKey: keyOf(channel), timeoutMs: 10_000 });
      return { ok: r.ok, status: r.status, qr: r.ok ? (r.data?.qrCode || null) : null, state: openWaSessionState(r.data?.status) };
    },

    async downloadMedia(channel, media) {
      if (media?.inlineBase64) return { ok: true, base64: media.inlineBase64, mimetype: media.mimetype || null };
      if (!media?.ref || !media?.chatId) return { ok: false };
      const r = await request(`${sessionPath(channel)}/messages/${encodeURIComponent(media.chatId)}/${encodeURIComponent(media.ref)}/media`, {
        apiKey: keyOf(channel), binary: true, timeoutMs: 30_000,
      });
      if (!r.ok || !Buffer.isBuffer(r.data)) return { ok: false, status: r.status };
      return { ok: true, base64: r.data.toString('base64'), mimetype: media.mimetype || r.mimetype || null };
    },

    // ─── Administração da sessão (chave ADMIN para criar; a da sessão para o resto) ───

    // Cria a sessão e a chave por sessão (operator, allowedSessions=[id]).
    async provisionSession({ name, allowedIps = null }) {
      const created = await request('/api/sessions', {
        method: 'POST', apiKey: adminKey,
        body: { name, config: { autoRejectCalls: true } },
      });
      if (!created.ok || !created.data?.id) return { ok: false, status: created.status, error: created.data?.message || 'Falha ao criar sessão no OpenWA' };
      const sessionId = String(created.data.id);
      const key = await request('/api/auth/api-keys', {
        method: 'POST', apiKey: adminKey,
        body: { name: `odonto-${name}`.slice(0, 100), role: 'operator', allowedSessions: [sessionId], ...(allowedIps?.length ? { allowedIps } : {}) },
      });
      if (!key.ok || !key.data?.apiKey) {
        await request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', apiKey: adminKey });
        return { ok: false, status: key.status, error: 'Falha ao criar a chave da sessão no OpenWA' };
      }
      return { ok: true, sessionId, apiKey: String(key.data.apiKey), apiKeyId: key.data.id ? String(key.data.id) : null };
    },

    async registerWebhook(channel, { url, secret }) {
      const r = await request(`${sessionPath(channel)}/webhooks`, {
        method: 'POST', apiKey: keyOf(channel),
        body: { url, secret, events: [...OPENWA_WEBHOOK_EVENTS], retryCount: 3 },
      });
      return { ok: r.ok, status: r.status, webhookId: r.data?.id || null };
    },

    async start(channel) {
      const r = await request(`${sessionPath(channel)}/start`, { method: 'POST', apiKey: keyOf(channel), timeoutMs: 40_000 });
      // 400 "already started" não é erro para quem só quer o QR.
      const already = r.status === 400 && /already/i.test(JSON.stringify(r.data || ''));
      return { ok: r.ok || already, status: r.status, state: openWaSessionState(r.data?.status) };
    },

    async logout(channel) {
      const r = await request(`${sessionPath(channel)}/logout`, { method: 'POST', apiKey: keyOf(channel), timeoutMs: 20_000 });
      return { ok: r.ok, status: r.status };
    },

    // Remove a sessão e revoga a chave (ADMIN).
    async removeSession(channel) {
      const del = await request(sessionPath(channel), { method: 'DELETE', apiKey: adminKey, timeoutMs: 30_000 });
      const keyId = channel?.credentials?.apiKeyId;
      if (keyId) await request(`/api/auth/api-keys/${encodeURIComponent(keyId)}/revoke`, { method: 'POST', apiKey: adminKey });
      return { ok: del.ok || del.status === 404, status: del.status };
    },

    verifyWebhook(rawBody, header, secret) {
      return verifyOpenWaSignature(rawBody, header, secret);
    },

    parseWebhook(body) {
      return parseOpenWaWebhook(body);
    },
  };
}
