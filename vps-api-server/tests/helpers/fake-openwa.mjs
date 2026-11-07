// OpenWA FALSO para testes (nunca produção, nunca número real). Mesmos caminhos e formatos da
// API do OpenWA v0.29.0 que o adaptador usa (docs/06-api-specification.md): X-API-Key, chave
// ADMIN × chave por sessão com allowedSessions (403 fora do escopo), sessões, QR, webhooks
// assinados (X-OpenWA-Signature: sha256=<hex>, X-OpenWA-Idempotency-Key), envio com
// Idempotency-Key e 429 SEND_PACING_LIMITED. Ideia do fake-openwa.mjs da Silveira (feat/wa-back).
import http from 'node:http';
import crypto from 'node:crypto';

export async function startFakeOpenWa({ adminKey = 'fake-admin-key' } = {}) {
  const sessions = new Map(); // id -> session
  const keys = new Map(); // apiKey -> { id, role, allowedSessions, revoked }
  const webhooks = new Map(); // id -> { sessionId, url, secret, events }
  const idem = new Map();
  const sent = [];
  const calls = [];
  const chatActions = []; // "lido" e "digitando" recebidos (corpo), para os testes conferirem
  let failPlan = null;
  keys.set(adminKey, { id: 'admin', role: 'admin', allowedSessions: null, revoked: false });

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const readBody = async (req) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {}; try { return JSON.parse(raw); } catch { return null; }
  };
  const pub = (s) => ({ id: s.id, name: s.name, status: s.status, phone: s.phone, engineLoaded: s.engineLoaded });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    calls.push({ method: req.method, path: url.pathname, apiKey: req.headers['x-api-key'] || null, idempotencyKey: req.headers['idempotency-key'] || null });
    if (parts[0] !== 'api') return json(res, 404, { statusCode: 404 });
    const key = keys.get(req.headers['x-api-key']);
    if (!key || key.revoked) return json(res, 401, { statusCode: 401, message: 'Unauthorized' });
    const isAdmin = key.role === 'admin';
    const inScope = (sid) => isAdmin || !key.allowedSessions || key.allowedSessions.includes(sid);

    if (parts[1] === 'auth' && parts[2] === 'api-keys') {
      if (!isAdmin) return json(res, 403, { statusCode: 403 });
      if (req.method === 'POST' && parts.length === 3) {
        const body = await readBody(req);
        const apiKey = `owa_k1_${crypto.randomBytes(32).toString('hex')}`;
        const rec = { id: crypto.randomUUID(), role: body.role || 'operator', allowedSessions: body.allowedSessions || null, revoked: false, name: body.name };
        keys.set(apiKey, rec);
        return json(res, 201, { id: rec.id, name: rec.name, role: rec.role, allowedSessions: rec.allowedSessions, isActive: true, apiKey });
      }
      if (req.method === 'POST' && parts[4] === 'revoke') {
        for (const r of keys.values()) if (r.id === parts[3]) r.revoked = true;
        return json(res, 200, { ok: true });
      }
    }

    if (parts[1] !== 'sessions') return json(res, 404, { statusCode: 404 });
    if (parts.length === 2) {
      if (req.method === 'GET') return json(res, 200, [...sessions.values()].filter(s => inScope(s.id)).map(pub));
      if (req.method === 'POST') {
        if (!isAdmin && key.allowedSessions) return json(res, 403, { statusCode: 403 });
        const body = await readBody(req);
        if (!body?.name || !/^[a-zA-Z0-9-]{3,50}$/.test(body.name)) return json(res, 400, { statusCode: 400, message: ['name inválido'] });
        const s = { id: crypto.randomUUID(), name: body.name, status: 'created', phone: null, engineLoaded: false, config: body.config || {} };
        sessions.set(s.id, s);
        return json(res, 201, pub(s));
      }
    }
    const s = sessions.get(parts[2]);
    if (!s) return json(res, 404, { statusCode: 404, message: 'Session not found' });
    if (!inScope(s.id)) return json(res, 403, { statusCode: 403, message: 'outside allowedSessions' });
    const rest = parts.slice(3).join('/');

    if (req.method === 'GET' && rest === '') return json(res, 200, pub(s));
    if (req.method === 'DELETE' && rest === '') { sessions.delete(s.id); return json(res, 200, { ok: true }); }
    if (req.method === 'POST' && rest === 'start') {
      if (s.engineLoaded) return json(res, 400, { statusCode: 400, message: 'Session already started' });
      s.engineLoaded = true; s.status = 'qr_ready';
      return json(res, 200, pub(s));
    }
    if (req.method === 'POST' && rest === 'logout') { s.engineLoaded = false; s.status = 'disconnected'; s.phone = null; return json(res, 200, pub(s)); }
    if (req.method === 'GET' && rest === 'qr') {
      if (s.status !== 'qr_ready') return json(res, 400, { statusCode: 400, message: 'QR not ready' });
      return json(res, 200, { qrCode: 'data:image/png;base64,QRFALSO', status: s.status });
    }
    if (req.method === 'POST' && rest === 'webhooks') {
      const body = await readBody(req);
      const w = { id: crypto.randomUUID(), sessionId: s.id, url: body.url, secret: body.secret || null, events: body.events || ['message.received'] };
      webhooks.set(w.id, w);
      return json(res, 201, { id: w.id, url: w.url, events: w.events });
    }
    if (req.method === 'POST' && rest === 'chats/typing') {
      const body = await readBody(req);
      if (!['typing', 'recording', 'paused'].includes(body?.state)) return json(res, 400, { statusCode: 400, message: ['state inválido'] });
      chatActions.push({ action: 'typing', sessionId: s.id, body });
      return json(res, 200, { success: true });
    }
    if (req.method === 'POST' && rest === 'chats/read') {
      const body = await readBody(req);
      if (Array.isArray(body?.messageIds) && !body.messageIds.length) return json(res, 400, { statusCode: 400, message: ['messageIds vazio'] });
      chatActions.push({ action: 'read', sessionId: s.id, body });
      return json(res, 200, { success: true });
    }
    if (req.method === 'POST' && parts[3] === 'messages' && /^send-/.test(parts[4] || '')) {
      if (s.status !== 'ready') return json(res, 400, { statusCode: 400, message: 'session not active' });
      const k = req.headers['idempotency-key'];
      if (k && idem.has(`${s.id}:${k}`)) { res.setHeader('Idempotent-Replayed', 'true'); return json(res, 201, idem.get(`${s.id}:${k}`)); }
      if (failPlan && failPlan.count > 0) {
        failPlan.count -= 1;
        if (failPlan.retryAfterHeader) res.setHeader('retry-after', String(failPlan.retryAfterHeader));
        return json(res, failPlan.status, { statusCode: failPlan.status, message: 'falha simulada', ...(failPlan.code ? { code: failPlan.code } : {}), ...(failPlan.retryAfterSeconds ? { retryAfterSeconds: failPlan.retryAfterSeconds } : {}) });
      }
      const body = await readBody(req);
      if (!body?.chatId || !/^[^\s@]+@[^\s@]+$/.test(body.chatId)) return json(res, 400, { statusCode: 400, message: ['chatId inválido'] });
      // Regras do SendMediaMessageDto: url ou base64; base64 exige mimetype (exceto voz com ptt).
      if (/^send-(image|video|audio|document|sticker)$/.test(parts[4])) {
        if (!body.base64 && !body.url) return json(res, 400, { statusCode: 400, message: ['url ou base64'] });
        if (body.base64 && !body.mimetype && !(parts[4] === 'send-audio' && body.ptt === true)) return json(res, 400, { statusCode: 400, message: ['mimetype obrigatório com base64'] });
        if ('ptt' in body && parts[4] !== 'send-audio') return json(res, 400, { statusCode: 400, message: ['property ptt should not exist'] });
      }
      const out = { messageId: `true_${body.chatId}_FAKE${crypto.randomBytes(6).toString('hex').toUpperCase()}`, timestamp: Math.floor(Date.now() / 1000) };
      sent.push({ route: parts[4], sessionId: s.id, body, messageId: out.messageId });
      if (k) idem.set(`${s.id}:${k}`, out);
      return json(res, 201, out);
    }
    if (req.method === 'GET' && parts[3] === 'messages' && parts[6] === 'media') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(Buffer.from('JPEGFALSO'));
    }
    return json(res, 404, { statusCode: 404 });
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Corpo + cabeçalhos de um webhook assinado como o OpenWA (para postar no nosso servidor).
  function signedDelivery(sessionId, event, data, { secret, idempotencyKey } = {}) {
    const w = [...webhooks.values()].find(x => x.sessionId === sessionId);
    const sec = secret ?? w?.secret;
    const ik = idempotencyKey || `${event.replace('.', '_')}_${sessionId}_${crypto.randomUUID()}`;
    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), sessionId, idempotencyKey: ik, deliveryId: `dlv_${crypto.randomUUID()}`, data });
    const headers = { 'content-type': 'application/json', 'x-openwa-event': event, 'x-openwa-idempotency-key': ik };
    if (sec) headers['x-openwa-signature'] = `sha256=${crypto.createHmac('sha256', sec).update(body).digest('hex')}`;
    return { body, headers, url: w?.url || null };
  }

  return {
    baseUrl, adminKey, sessions, keys, webhooks, sent, calls, chatActions, signedDelivery,
    connect(sessionId, phone = '5562900000000') { const s = sessions.get(sessionId); s.status = 'ready'; s.phone = phone; },
    fail(plan) { failPlan = { count: 1, ...plan }; },
    async close() { await new Promise(r => server.close(r)); },
  };
}
