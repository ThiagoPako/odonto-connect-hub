// Adaptador Evolution API — só durante a transição (F0–F3 de docs/whatsapp/migracao-provedores.md).
// É o ÚNICO lugar que fala HTTP com a Evolution: `request` (o antigo evolutionFetch do
// server.mjs, mesmo comportamento) e `rawFetch` (para os poucos pontos que precisam da
// Response crua: multipart e sync de contatos). Os helpers puros de formato da Evolution
// também moram aqui.
import { sendResult } from '../provider.mjs';
import {
  inboundMessageEvent, messageStatusEvent, presenceEvent, channelStateEvent, unknownEvent,
} from '../events.mjs';

// ─── Helpers puros (movidos do server.mjs sem mudança) ───────────────────────────

export function extractEvolutionConnectionState(data) {
  const state = data?.instance?.state
    || data?.instance?.connectionStatus
    || data?.state
    || data?.connectionStatus
    || data?.status;
  return String(state || '').toLowerCase();
}

export function normalizeEvolutionConnectionState(inst) {
  const raw = String(inst?.connectionStatus || inst?.status || inst?.instance?.state || inst?.state || '').toLowerCase();
  if (raw === 'open') return 'open';
  if (raw === 'connecting') return 'connecting';
  return 'close';
}

export function extractEvolutionMessageId(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const id = extractEvolutionMessageId(item);
      if (id) return id;
    }
    return null;
  }

  const pick = (value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // WhatsApp/Baileys message ids are string-like and normally contain more
      // entropy than wrapper request ids. Avoid accepting plain numeric wrapper
      // ids because ACK correlation then becomes impossible.
      if (trimmed && (!/^\d+$/.test(trimmed) || trimmed.length >= 12)) return trimmed;
    }
    return null;
  };

  const candidates = [
    data?.key?.id,
    data?.message?.key?.id,
    data?.data?.key?.id,
    data?.data?.message?.key?.id,
    data?.response?.key?.id,
    data?.response?.message?.key?.id,
    data?.messageId,
    data?.data?.messageId,
    data?.response?.messageId,
    data?.data?.id,
    data?.response?.id,
    data?.id,
  ];

  for (const candidate of candidates) {
    const id = pick(candidate);
    if (id) return id;
  }
  return null;
}

export function extractEvolutionInstanceName(body) {
  const candidates = [
    body?.instanceName,
    body?.instance,
    body?.instance?.instanceName,
    body?.instance?.name,
    body?.data?.instanceName,
    body?.data?.instance,
    body?.data?.instance?.instanceName,
    body?.data?.instance?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  return '';
}

export function normalizeEvolutionEventName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\./g, '_');
}

export function isEvolutionEvent(event, ...names) {
  const normalized = normalizeEvolutionEventName(event);
  return names.some((name) => normalizeEvolutionEventName(name) === normalized);
}

export function extractEvolutionMessages(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages?.records)) return data.messages.records;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.data?.records)) return data.data.records;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result?.records)) return data.result.records;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.message)) return data.message;
  if (Array.isArray(data?.records)) return data.records;
  if (data?.message?.key) return [data.message];
  if (data?.key) return [data];
  return [];
}

export function normalizeEvolutionAckStatus(ack) {
  if (ack === null || ack === undefined) return null;

  const ackStr = String(ack).trim().toUpperCase();
  const ackNum = typeof ack === 'number' ? ack : Number.parseInt(ackStr, 10);

  if (ackStr === 'FAILED' || ackStr === 'NACK' || ackNum === -1) return 'failed';
  if (ackStr === 'PENDING' || ackStr === 'PENDING_ACK' || ackStr === 'CLOCK' || ackNum === 0 || ackNum === 1) return 'sent';
  // Evolution/Baileys versions can stringify ACK 0 as ERROR while the message is
  // still only pending. Treat webhook/store ERROR as failed only when no numeric
  // ACK is available; immediate send validation skips 201 responses above.
  if (ackStr === 'ERROR') return 'failed';
  if (ackStr === 'SERVER_ACK' || ackStr === 'SENT' || ackStr === 'SEND' || ackNum === 2) return 'sent';
  if (ackStr === 'DELIVERY_ACK' || ackStr === 'DELIVERED' || ackStr === 'RECEIVED' || ackStr === 'DEVICE_ACK' || ackNum === 3) return 'delivered';
  if (ackStr === 'READ' || ackStr === 'READ_ACK' || ackStr === 'PLAYED' || ackStr === 'PLAYED_ACK' || ackNum === 4 || ackNum === 5) return 'read';

  return null;
}

// Id da mensagem que a fila aceita como "enviada" (regra de processOneWhatsAppJob).
export function evolutionSentKeyId(data) {
  return data?.key?.id || data?.message?.key?.id || null;
}

export function evolutionJid(to) {
  const phone = String(to || '');
  return phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
}

const INTERACTIVE_ENDPOINTS = new Set(['sendButtons', 'sendList']);

function refOf(channel) {
  if (typeof channel === 'string') return channel;
  return String(channel?.externalId || channel?.external_id || channel?.instance_name || channel?.instance || '');
}

// ─── Webhook → eventos internos ─────────────────────────────────────────────────

function messageKind(m) {
  const msg = m?.message || {};
  if (msg.imageMessage) return 'image';
  if (msg.audioMessage) return 'audio';
  if (msg.videoMessage) return 'video';
  if (msg.documentMessage) return 'document';
  if (msg.stickerMessage) return 'sticker';
  if (msg.locationMessage) return 'location';
  if (msg.contactMessage) return 'contact';
  if (msg.buttonsResponseMessage) return 'button_response';
  if (msg.listResponseMessage) return 'list_response';
  if (msg.reactionMessage) return 'reaction';
  return 'text';
}

function messageText(m) {
  const msg = m?.message || {};
  return msg.conversation
    || msg.extendedTextMessage?.text
    || msg.buttonsResponseMessage?.selectedButtonId
    || msg.listResponseMessage?.singleSelectReply?.selectedRowId
    || msg.imageMessage?.caption
    || msg.videoMessage?.caption
    || '';
}

function toIsoTimestamp(value) {
  const n = Number(value?.low ?? value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

function statusUpdates(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.updates)) return data.updates;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.data)) return data.data;
  return data ? [data] : [];
}

// Tradução do webhook da Evolution para o formato interno. Pura (sem banco, sem rede).
// F0: coberta por testes de contrato; o handler /api/webhook/evolution continua com a lógica
// atual e passa a consumir estes eventos quando o processamento for extraído (F1).
export function parseEvolutionWebhook(rawBody) {
  const body = Array.isArray(rawBody) ? rawBody[0] : rawBody;
  if (!body || typeof body !== 'object') return [];
  const ref = extractEvolutionInstanceName(body);
  const event = body.event || body.type || body.eventType;

  if (isEvolutionEvent(event, 'presence.update', 'presence_update')) {
    const d = body.data || {};
    const chatId = String(d.id || d.remoteJid || '');
    let status = null;
    const presences = d.presences && typeof d.presences === 'object' ? Object.values(d.presences) : [];
    for (const p of presences) {
      status = p?.lastKnownPresence || p?.presence || status;
    }
    return [presenceEvent('evolution', ref, { chatId, status: status || null })];
  }

  if (isEvolutionEvent(event, 'messages.update', 'messages_update', 'send.message.update', 'send_message_update', 'message.update', 'message_update', 'send.message', 'send_message')) {
    const isSend = isEvolutionEvent(event, 'send.message', 'send_message');
    const out = [];
    for (const u of statusUpdates(body.data || body)) {
      const messageId = u?.keyId || u?.key?.id || u?.messageId || u?.message_id || extractEvolutionMessageId(u) || '';
      const ack = u?.status ?? u?.update?.status ?? u?.ack ?? (isSend ? 'SERVER_ACK' : null);
      const status = normalizeEvolutionAckStatus(ack);
      if (!messageId || !status) continue;
      out.push(messageStatusEvent('evolution', ref, {
        messageId: String(messageId),
        chatId: String(u?.remoteJid || u?.key?.remoteJid || ''),
        status,
      }));
    }
    return out;
  }

  if (isEvolutionEvent(event, 'messages.upsert', 'messages_upsert')) {
    return extractEvolutionMessages(body.data).map((m) => {
      const chatId = String(m?.key?.remoteJid || '');
      const evt = inboundMessageEvent('evolution', ref, {
        from: chatId.split('@')[0] || '',
        chatId,
        messageId: String(m?.key?.id || ''),
        fromMe: !!m?.key?.fromMe,
        kind: messageKind(m),
        text: messageText(m),
        buttonId: m?.message?.buttonsResponseMessage?.selectedButtonId
          || m?.message?.listResponseMessage?.singleSelectReply?.selectedRowId || null,
        media: ['image', 'audio', 'video', 'document', 'sticker'].includes(messageKind(m)) ? { ref: String(m?.key?.id || '') } : null,
        quotedId: m?.message?.extendedTextMessage?.contextInfo?.stanzaId || null,
        timestamp: toIsoTimestamp(m?.messageTimestamp),
        isGroup: chatId.endsWith('@g.us'),
      });
      evt.eventId = evt.messageId ? `evolution:${ref}:${evt.messageId}` : null;
      return evt;
    });
  }

  if (isEvolutionEvent(event, 'connection.update', 'connection_update')) {
    const state = normalizeEvolutionConnectionState(body.data || {});
    return [channelStateEvent('evolution', ref, { state })];
  }
  if (isEvolutionEvent(event, 'qrcode.updated', 'qrcode_updated')) {
    return [channelStateEvent('evolution', ref, { state: 'connecting', qr: body.data?.qrcode?.base64 || null })];
  }
  return [unknownEvent('evolution', ref, event)];
}

// ─── Adaptador ──────────────────────────────────────────────────────────────────

export function createEvolutionAdapter({ baseUrl, apiKey, redact = (d) => d, env = process.env } = {}) {
  const BASE = String(baseUrl || '').replace(/\/$/, '');
  const KEY = apiKey;
  // Sempre o fetch global do momento da chamada (os testes trocam por mock).
  const doFetch = (...args) => globalThis.fetch(...args);

  // O antigo evolutionFetch do server.mjs, sem mudança de comportamento.
  async function request(path, options = {}) {
    if (!KEY) {
      return {
        ok: false,
        status: 500,
        data: { error: 'EVOLUTION_API_KEY não configurada no VPS' },
      };
    }

    // Defesa contra "path traversal": um nome de instância como "abc/../outra"
    // seria normalizado pelo fetch para a instância de outra clínica.
    const pathOnly = String(path || '').split('?')[0];
    if (pathOnly.includes('\\') || pathOnly.split('/').some(seg => seg === '..' || seg === '.')) {
      console.warn(`[evolutionFetch] caminho recusado: ${pathOnly.slice(0, 120)}`);
      return { ok: false, status: 400, data: { error: 'Nome de instância inválido' } };
    }
    const url = `${BASE}${path}`;
    const timeoutMs = Number(options.timeoutMs || env.EVOLUTION_API_REQUEST_TIMEOUT_MS || 15000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
      const res = await doFetch(url, {
        ...fetchOptions,
        signal: fetchOptions.signal || controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: KEY,
          ...fetchOptions.headers,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn(`⚠️ Evolution API ${res.status} for ${path}:`, JSON.stringify(redact(data)).slice(0, 500));
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      console.error(`❌ Evolution fetch error (${path}):`, err.message);
      return { ok: false, status: err.name === 'AbortError' ? 504 : 500, data: { error: err.name === 'AbortError' ? 'Evolution API timeout' : err.message } };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Response crua (lança como o fetch). Só injeta a apikey; o resto do init vai como veio.
  // withKey=false: sem apikey (checagem de saúde do serviço, que nunca mandou a chave).
  function rawFetch(path, init = {}, { withKey = true } = {}) {
    if (!withKey) return doFetch(`${BASE}${path}`, init);
    return doFetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), apikey: KEY } });
  }

  function toSendResult(result) {
    return sendResult({
      ok: result.ok,
      providerMessageId: result.ok ? evolutionSentKeyId(result.data) : null,
      uncertain: result.status === 504,
      retryable: result.status >= 500,
      status: result.status,
      error: result.ok ? null : (result.data?.error || `HTTP ${result.status}`),
      raw: result,
    });
  }

  return {
    kind: 'evolution',
    capabilities: {
      qr: true, buttons: true, lists: true, polls: true, deleteForEveryone: true, archive: true,
      presence: true, typing: true, contactsSync: true, history: true, profilePicture: true,
      calls: true, numberCheck: true, requiresTemplateOutside24h: false,
    },
    request,
    rawFetch,

    async sendText(channel, to, text, { delayMs = 0, timeoutMs = 45_000 } = {}) {
      const r = await request(`/message/sendText/${encodeURIComponent(refOf(channel))}`, {
        method: 'POST',
        body: JSON.stringify({ number: evolutionJid(to), text, delay: delayMs }),
        timeoutMs,
      });
      return toSendResult(r);
    },

    // Botões/lista (endpoints sendButtons/sendList da Evolution). O `number` do payload é
    // sempre substituído pelo destinatário do job.
    async sendInteractive(channel, to, { endpoint, payload, delayMs = 0, timeoutMs = 45_000 } = {}) {
      if (!INTERACTIVE_ENDPOINTS.has(endpoint) || !payload || typeof payload !== 'object') {
        return sendResult({ ok: false, status: 400, error: 'Mensagem interativa inválida' });
      }
      const { number: _ignored, ...rest } = payload;
      const r = await request(`/message/${endpoint}/${encodeURIComponent(refOf(channel))}`, {
        method: 'POST',
        body: JSON.stringify({ ...rest, number: evolutionJid(to), delay: delayMs }),
        timeoutMs,
      });
      return toSendResult(r);
    },

    async getState(channel) {
      const r = await request(`/instance/connectionState/${refOf(channel)}`, { timeoutMs: 8000 });
      if (!r.ok) return { ok: false, state: null, status: r.status, raw: r };
      const raw = extractEvolutionConnectionState(r.data);
      const state = raw === 'open' ? 'open' : raw === 'connecting' ? 'connecting' : 'close';
      return { ok: true, state, status: r.status, raw: r };
    },

    // Estado de todos os canais do provedor. Regra de "aberto" igual à da fila
    // (getOpenEvolutionInstances): connectionStatus || status || instance.state === 'open'.
    async listStates({ timeoutMs } = {}) {
      const r = await request('/instance/fetchInstances', timeoutMs ? { timeoutMs } : {});
      const list = Array.isArray(r.data) ? r.data : [];
      const states = list.map((i) => {
        const ref = i.name || i.instanceName || i.instance?.instanceName;
        const open = (i.connectionStatus || i.status || i.instance?.state) === 'open';
        return { ref, state: open ? 'open' : normalizeEvolutionConnectionState(i) === 'connecting' ? 'connecting' : 'close' };
      }).filter(s => s.ref);
      return { ok: r.ok, status: r.status, states, raw: r };
    },

    parseWebhook(body) {
      return parseEvolutionWebhook(body);
    },
  };
}
