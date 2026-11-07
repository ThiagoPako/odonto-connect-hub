// Adaptador OpenWA contra o OpenWA falso (tests/helpers/fake-openwa.mjs): mesmo contrato da
// interface que o adaptador Evolution (validateProviderShape, SendResult, eventos internos),
// mais as regras próprias: chave por sessão com allowedSessions, Idempotency-Key, 429 de ritmo
// vira reagendamento, sem botões, webhook assinado.
import { jest } from '@jest/globals';
import { createHmac } from 'crypto';
import { validateProviderShape, WA_CAPABILITY_KEYS } from '../whatsapp/provider.mjs';
import { validateInternalEvent } from '../whatsapp/events.mjs';
import { createOpenWaAdapter, OPENWA_MEDIA_MAX_BYTES, parseOpenWaWebhook, verifyOpenWaSignature, openWaSessionState, openWaChatId } from '../whatsapp/adapters/openwa.mjs';
import { startFakeOpenWa } from './helpers/fake-openwa.mjs';

let fake, adapter, channel;

beforeAll(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  fake = await startFakeOpenWa();
  adapter = createOpenWaAdapter({ baseUrl: fake.baseUrl, adminKey: fake.adminKey });
});
afterAll(async () => { await fake.close(); });

describe('OpenWA — forma e provisionamento', () => {
  test('tem a forma exigida da interface; não promete botões nem lista', () => {
    expect(validateProviderShape(adapter)).toEqual([]);
    for (const k of WA_CAPABILITY_KEYS) expect(typeof adapter.capabilities[k]).toBe('boolean');
    expect(adapter.capabilities.buttons).toBe(false);
    expect(adapter.capabilities.lists).toBe(false);
  });

  test('provisionSession cria sessão + chave operator restrita à sessão', async () => {
    const p = await adapter.provisionSession({ name: '11111111-owa-teste01' });
    expect(p.ok).toBe(true);
    expect(p.apiKey).toMatch(/^owa_k1_/);
    const rec = fake.keys.get(p.apiKey);
    expect(rec).toMatchObject({ role: 'operator', allowedSessions: [p.sessionId] });
    channel = { id: 'c1', tenant_id: 't1', external_id: p.sessionId, instance_name: '11111111-owa-teste01', credentials: { apiKey: p.apiKey, apiKeyId: p.apiKeyId, webhookSecret: 'segredo-do-webhook-123456' } };
  });

  test('a chave de uma sessão não acessa outra (403 no OpenWA)', async () => {
    const outra = await adapter.provisionSession({ name: '22222222-owa-teste02' });
    const intruso = { ...channel, external_id: outra.sessionId };
    const st = await adapter.getState(intruso);
    expect(st).toMatchObject({ ok: false, status: 403 });
  });

  test('webhook registrado com segredo e eventos; start + QR', async () => {
    const hook = await adapter.registerWebhook(channel, { url: 'http://127.0.0.1:9/api/webhook/openwa/c1', secret: channel.credentials.webhookSecret });
    expect(hook.ok).toBe(true);
    const w = [...fake.webhooks.values()].find(x => x.sessionId === channel.external_id);
    expect(w.events).toEqual(expect.arrayContaining(['message.received', 'message.ack', 'session.status', 'session.qr']));
    expect(w.secret).toBe(channel.credentials.webhookSecret);
    expect((await adapter.start(channel)).ok).toBe(true);
    expect((await adapter.start(channel)).ok).toBe(true); // "already started" não é erro
    const qr = await adapter.getQr(channel);
    expect(qr).toMatchObject({ ok: true, qr: 'data:image/png;base64,QRFALSO' });
  });

  test('estado: mapeia status do OpenWA; listStates só com a chave ADMIN', async () => {
    expect((await adapter.getState(channel)).state).toBe('connecting');
    fake.connect(channel.external_id);
    expect(await adapter.getState(channel)).toMatchObject({ ok: true, state: 'open', phone: '5562900000000' });
    const all = await adapter.listStates();
    expect(all.ok).toBe(true);
    expect(all.states.find(s => s.ref === channel.external_id)).toMatchObject({ state: 'open' });
    expect(fake.calls.filter(c => c.path === '/api/sessions' && c.method === 'GET').every(c => c.apiKey === fake.adminKey)).toBe(true);
    expect(openWaSessionState('action_required')).toBe('restricted');
    expect(openWaSessionState('failed')).toBe('close');
  });
});

describe('OpenWA — envio', () => {
  test('sendText: chatId @c.us, chave da sessão, Idempotency-Key, "digitando" antes', async () => {
    const r = await adapter.sendText(channel, '5511999990000', 'Olá', { delayMs: 10, idempotencyKey: 'job-1' });
    expect(r).toMatchObject({ ok: true, uncertain: false, error: null });
    expect(r.providerMessageId).toMatch(/^true_5511999990000@c\.us_/);
    const last = fake.sent.at(-1);
    expect(last.body).toMatchObject({ chatId: '5511999990000@c.us', text: 'Olá', linkPreview: false });
    const sendCall = fake.calls.filter(c => c.path.endsWith('/messages/send-text')).at(-1);
    expect(sendCall).toMatchObject({ apiKey: channel.credentials.apiKey, idempotencyKey: 'job-1' });
    expect(fake.calls.some(c => c.path.endsWith('/chats/typing'))).toBe(true);
  });

  test('mesma Idempotency-Key não envia de novo (devolve o mesmo id)', async () => {
    const antes = fake.sent.length;
    const a = await adapter.sendText(channel, '5511999990000', 'Repete', { idempotencyKey: 'job-2' });
    const b = await adapter.sendText(channel, '5511999990000', 'Repete', { idempotencyKey: 'job-2' });
    expect(b.providerMessageId).toBe(a.providerMessageId);
    expect(fake.sent.length).toBe(antes + 1);
  });

  test('429 SEND_PACING_LIMITED vira retryAfterMs (reagendar), não incerto', async () => {
    fake.fail({ status: 429, code: 'SEND_PACING_LIMITED', retryAfterSeconds: 120 });
    const r = await adapter.sendText(channel, '5511999990000', 'x');
    expect(r).toMatchObject({ ok: false, retryAfterMs: 120_000, uncertain: false, status: 429 });
  });

  test('desfecho desconhecido do OpenWA é "incerto" (não reenviar)', async () => {
    fake.fail({ status: 409, code: 'IDEMPOTENCY_OUTCOME_UNKNOWN' });
    expect(await adapter.sendText(channel, '5511999990000', 'x')).toMatchObject({ ok: false, uncertain: true });
  });

  test('botões/lista: 501 sem rede (a fila manda o texto numerado)', async () => {
    const antes = fake.calls.length;
    const r = await adapter.sendInteractive(channel, '5511999990000', { endpoint: 'sendButtons', payload: {} });
    expect(r).toMatchObject({ ok: false, status: 501, uncertain: false });
    expect(fake.calls.length).toBe(antes);
  });

  test('sendMedia: rota por tipo, base64 + mimetype', async () => {
    const r = await adapter.sendMedia(channel, '5511999990000', { kind: 'document', base64: Buffer.from('pdf').toString('base64'), mimetype: 'application/pdf', filename: 'a.pdf', caption: 'oi' });
    expect(r.ok).toBe(true);
    expect(fake.sent.at(-1)).toMatchObject({ route: 'send-document', body: { chatId: '5511999990000@c.us', mimetype: 'application/pdf', filename: 'a.pdf', caption: 'oi' } });
  });

  test('sem OPENWA_URL ou sem chave: não chama a rede', async () => {
    const semUrl = createOpenWaAdapter({ baseUrl: '', adminKey: 'x' });
    expect(await semUrl.sendText(channel, '1', 'x')).toMatchObject({ ok: false, status: 503 });
    expect(await adapter.sendText({ ...channel, credentials: {} }, '1', 'x')).toMatchObject({ ok: false, status: 503 });
    expect(openWaChatId('5511 99999-0000')).toBe('5511999990000@c.us');
  });

  test('downloadMedia: inline do webhook ou pela rota de mídia', async () => {
    expect(await adapter.downloadMedia(channel, { inlineBase64: 'QUJD', mimetype: 'image/png' })).toEqual({ ok: true, base64: 'QUJD', mimetype: 'image/png' });
    const r = await adapter.downloadMedia(channel, { ref: 'MSG1', chatId: '5511@c.us' });
    expect(r.ok).toBe(true);
    expect(Buffer.from(r.base64, 'base64').toString()).toBe('JPEGFALSO');
  });

  test('removeSession apaga a sessão e revoga a chave', async () => {
    const p = await adapter.provisionSession({ name: '33333333-owa-teste03' });
    const ch = { external_id: p.sessionId, credentials: { apiKey: p.apiKey, apiKeyId: p.apiKeyId } };
    expect((await adapter.removeSession(ch)).ok).toBe(true);
    expect(fake.sessions.has(p.sessionId)).toBe(false);
    expect(fake.keys.get(p.apiKey).revoked).toBe(true);
  });
});

describe('OpenWA — webhook', () => {
  const sid = '8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a';
  const env = (event, data, extra = {}) => ({ event, sessionId: sid, idempotencyKey: `k_${event}`, timestamp: new Date().toISOString(), data, ...extra });

  test('assinatura: HMAC do corpo bruto; errada, ausente ou sem corpo bruto → falso', () => {
    const raw = Buffer.from(JSON.stringify(env('message.received', {})));
    const sig = `sha256=${createHmac('sha256', 'segredo').update(raw).digest('hex')}`;
    expect(verifyOpenWaSignature(raw, sig, 'segredo')).toBe(true);
    expect(verifyOpenWaSignature(raw, sig, 'outro')).toBe(false);
    expect(verifyOpenWaSignature(raw, 'sha256=00', 'segredo')).toBe(false);
    expect(verifyOpenWaSignature(raw, undefined, 'segredo')).toBe(false);
    expect(verifyOpenWaSignature(undefined, sig, 'segredo')).toBe(false);
    expect(verifyOpenWaSignature(Buffer.from(JSON.stringify(JSON.parse(raw))), sig, 'segredo')).toBe(true); // mesmos bytes
  });

  test('message.received → message.inbound válido (eventId = idempotencyKey; sem tenant)', () => {
    const [e] = parseOpenWaWebhook(env('message.received', {
      id: 'false_5511999990000@c.us_3EB0A', from: '5511999990000@c.us', to: '5562900000000@c.us', chatId: '5511999990000@c.us',
      body: 'SAIR', type: 'text', timestamp: 1789855200, isGroup: false, kind: 'individual', fromMe: false, contact: { pushName: 'Ana' },
      tenantId: 'malicioso',
    }));
    expect(validateInternalEvent(e)).toEqual([]);
    expect(e).toMatchObject({ type: 'message.inbound', provider: 'openwa', channelRef: sid, from: '5511999990000', text: 'SAIR', kind: 'text', fromMe: false, pushName: 'Ana', eventId: 'k_message.received' });
    expect(e).not.toHaveProperty('tenantId');
  });

  test('resposta de botão, mídia inline e @lid com senderPhone', () => {
    const [b] = parseOpenWaWebhook(env('message.received', { id: 'm2', chatId: '5511@c.us', from: '5511@c.us', type: 'text', body: 'Confirmar', button: { id: 'confirmar' } }));
    expect(b).toMatchObject({ kind: 'button_response', buttonId: 'confirmar', text: 'confirmar' });
    const [m] = parseOpenWaWebhook(env('message.received', { id: 'm3', chatId: '5511@c.us', from: '5511@c.us', type: 'image', body: 'foto', media: { mimetype: 'image/jpeg', data: 'QUJD' } }));
    expect(m.media).toMatchObject({ ref: 'm3', inlineBase64: 'QUJD', mimetype: 'image/jpeg' });
    const [l] = parseOpenWaWebhook(env('message.received', { id: 'm4', chatId: '123456789012345@lid', from: '123456789012345@lid', senderPhone: '5511988887777', type: 'text', body: 'oi' }));
    expect(l.from).toBe('5511988887777');
    const [g] = parseOpenWaWebhook(env('message.received', { id: 'm5', chatId: '1203@g.us', from: '1203@g.us', type: 'text', body: 'x', isGroup: true }));
    expect(g.isGroup).toBe(true);
  });

  test('ack, falha, estado da sessão e QR', () => {
    const [a] = parseOpenWaWebhook(env('message.ack', { id: 'x', messageId: 'true_1@c.us_A', status: 'read', ack: 3 }));
    expect(a).toMatchObject({ type: 'message.status', messageId: 'true_1@c.us_A', status: 'read' });
    expect(parseOpenWaWebhook(env('message.ack', { messageId: 'y', status: 'pending' }))).toEqual([]);
    const [f] = parseOpenWaWebhook(env('message.failed', { messageId: 'z', status: 'failed' }));
    expect(f.status).toBe('failed');
    const [s] = parseOpenWaWebhook(env('session.status', { sessionId: sid, status: 'ready' }));
    expect(validateInternalEvent(s)).toEqual([]);
    expect(s).toMatchObject({ type: 'channel.state', state: 'open' });
    const [q] = parseOpenWaWebhook(env('session.qr', { sessionId: sid, qr: 'data:image/png;base64,AAA' }));
    expect(q).toMatchObject({ state: 'connecting', qr: 'data:image/png;base64,AAA' });
    const [r] = parseOpenWaWebhook(env('session.restriction', { active: true }));
    expect(r.state).toBe('restricted');
    expect(parseOpenWaWebhook(null)).toEqual([]);
  });
});

describe('OpenWA — mídia, lido e presença (F1)', () => {
  test('mídia por base64 sem mimetype: 400 sem chamar o OpenWA; ptt só no áudio', async () => {
    fake.connect(channel.external_id);
    const antes = fake.calls.length;
    const r = await adapter.sendMedia(channel, '5511988887777', { kind: 'image', base64: 'QUJD' });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(fake.calls.length).toBe(antes);
    const img = await adapter.sendMedia(channel, '5511988887777', { kind: 'image', base64: 'QUJD', mimetype: 'image/png', ptt: true });
    expect(img.ok).toBe(true);
    expect(fake.sent.at(-1).body.ptt).toBeUndefined();
    const voz = await adapter.sendMedia(channel, '5511988887777', { kind: 'audio', base64: 'T2dnUw==', mimetype: 'audio/ogg; codecs=opus', ptt: true, caption: 'não vai' });
    expect(voz.ok).toBe(true);
    expect(fake.sent.at(-1)).toMatchObject({ route: 'send-audio', body: { ptt: true, mimetype: 'audio/ogg; codecs=opus' } });
    expect(fake.sent.at(-1).body.caption).toBeUndefined();
  });

  test('"gravando" antes do áudio da fila e "digitando" antes da imagem (delayMs)', async () => {
    await adapter.sendMedia(channel, '5511988887777', { kind: 'audio', base64: 'T2dnUw==', mimetype: 'audio/ogg', ptt: true, delayMs: 1 });
    expect(fake.chatActions.at(-1)).toMatchObject({ action: 'typing', body: { state: 'recording' } });
    await adapter.sendMedia(channel, '5511988887777', { kind: 'document', base64: 'QUJD', mimetype: 'application/pdf', delayMs: 1 });
    expect(fake.chatActions.at(-1).body.state).toBe('typing');
  });

  test('markRead filtra ids (sem espaço, até 100) e omite a lista vazia', async () => {
    const ids = ['A1', 'com espaço', '', ...Array.from({ length: 120 }, (_, i) => `X${i}`)];
    expect((await adapter.markRead(channel, '5511988887777', { messageIds: ids })).ok).toBe(true);
    const body = fake.chatActions.at(-1).body;
    expect(body.messageIds[0]).toBe('A1');
    expect(body.messageIds).toHaveLength(100);
    expect(body.messageIds).not.toContain('com espaço');
    expect((await adapter.markRead(channel, '5511988887777')).ok).toBe(true);
    expect('messageIds' in fake.chatActions.at(-1).body).toBe(false);
  });

  test('sendTyping aceita typing/recording/paused; outro valor vira typing', async () => {
    for (const st of ['typing', 'recording', 'paused']) {
      expect((await adapter.sendTyping(channel, '5511988887777', { state: st })).ok).toBe(true);
      expect(fake.chatActions.at(-1).body).toEqual({ chatId: '5511988887777@c.us', state: st });
    }
    await adapter.sendTyping(channel, '5511988887777', { state: 'composing' });
    expect(fake.chatActions.at(-1).body.state).toBe('typing');
  });

  test('downloadMedia: teto padrão de 64 MB (revisão F1.1, N3)', () => {
    expect(OPENWA_MEDIA_MAX_BYTES).toBe(64 * 1024 * 1024);
  });

  test('downloadMedia recusa mídia acima do teto pelo content-length, sem ler o corpo (N3)', async () => {
    const small = createOpenWaAdapter({ baseUrl: fake.baseUrl, adminKey: fake.adminKey, env: { OPENWA_MEDIA_MAX_BYTES: '50000' } });
    fake.bigMedia({ size: 5 * 1024 * 1024 });
    const m = await small.downloadMedia(channel, { ref: 'false_1@c.us_BIG', chatId: '5511988887777@c.us' });
    expect(m).toEqual({ ok: false, status: 413 });
  });

  test('downloadMedia corta mídia sem content-length (chunked) ao passar do teto (N3)', async () => {
    const small = createOpenWaAdapter({ baseUrl: fake.baseUrl, adminKey: fake.adminKey, env: { OPENWA_MEDIA_MAX_BYTES: '50000' } });
    fake.bigMedia({ size: 2 * 1024 * 1024, chunked: true });
    const m = await small.downloadMedia(channel, { ref: 'false_1@c.us_BIG2', chatId: '5511988887777@c.us' });
    expect(m).toEqual({ ok: false, status: 413 });
  });

  test('downloadMedia aceita mídia no limite do teto (N3)', async () => {
    const small = createOpenWaAdapter({ baseUrl: fake.baseUrl, adminKey: fake.adminKey, env: { OPENWA_MEDIA_MAX_BYTES: '50000' } });
    fake.bigMedia({ size: 50000, chunked: true });
    const m = await small.downloadMedia(channel, { ref: 'false_1@c.us_OK', chatId: '5511988887777@c.us' });
    expect(m.ok).toBe(true);
    expect(Buffer.from(m.base64, 'base64')).toHaveLength(50000);
  });

  test('downloadMedia devolve o mimetype do OpenWA quando o webhook não trouxe', async () => {
    const m = await adapter.downloadMedia(channel, { ref: 'false_1@c.us_X', chatId: '5511988887777@c.us', mimetype: null });
    expect(m).toMatchObject({ ok: true, mimetype: 'image/jpeg' });
    expect(Buffer.from(m.base64, 'base64').toString()).toBe('JPEGFALSO');
  });
});
