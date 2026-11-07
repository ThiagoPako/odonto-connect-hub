// OpenWA de ponta a ponta no servidor, contra o OpenWA falso (tests/helpers/fake-openwa.mjs):
// criar o canal reserva por QR, webhook assinado (HMAC, dedupe, sessionId), mensagem recebida
// entrando no chat da clínica certa, fila enviando pelo canal OpenWA, ritmo do OpenWA (429)
// reagendando, envio humano do chat, e isolamento entre clínicas em cada passo.
// pool.query/pool.connect mockados (whatsapp_channels/whatsapp_instances em memória);
// a Evolution é mockada no fetch; o OpenWA falso responde de verdade.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import { randomBytes } from 'crypto';
import { startFakeOpenWa } from './helpers/fake-openwa.mjs';

const fake = await startFakeOpenWa();
process.env.EVOLUTION_API_KEY = 'chave-de-teste';
process.env.EVOLUTION_API_URL = 'http://evolution.teste.invalid';
process.env.OPENWA_URL = fake.baseUrl;
process.env.OPENWA_ADMIN_KEY = fake.adminKey;
process.env.OPENWA_WEBHOOK_BASE = 'http://172.30.50.1:8081';
process.env.WA_CREDENTIALS_KEY = randomBytes(32).toString('hex');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_12345';
delete process.env.EVOLUTION_WEBHOOK_SECRET;

const { app, pool, processAutomationJobs, resetWhatsAppQueueStateForTests, clearTenantSettingsCacheForTests } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const auth = (tenant) => ({
  Authorization: `Bearer ${jwt.sign({ sub: '44444444-4444-4444-4444-444444444444', email: 'a@a.com', role: 'admin', tenant_id: tenant, is_super_admin: false }, JWT_SECRET)}`,
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Banco em memória (só o necessário).
let channels, instances, webhookEvents, sqlLog, queueJob, jobStatus, released;
function resetDb() {
  channels = []; instances = new Map(); webhookEvents = new Set(); sqlLog = []; queueJob = null; jobStatus = null; released = null;
}
resetDb();

function mockQuery(sql, params = []) {
  const text = String(sql);
  sqlLog.push({ text, params });
  const ok = (rows, rowCount = rows.length) => Promise.resolve({ rows, rowCount });
  // whatsapp_channels
  if (/INSERT INTO whatsapp_channels/.test(text)) {
    const [id, tenant_id, role, external_id, instance_name, credentials_enc, credentials_key_version] = params;
    channels.push({ id, tenant_id, provider: 'openwa', role, status: 'active', external_id, instance_name, credentials_enc, credentials_key_version, connection_state: 'connecting', created_at: new Date() });
    return ok([], 1);
  }
  if (/FROM whatsapp_channels WHERE instance_name = \$1/.test(text)) return ok(channels.filter(c => c.instance_name === params[0] && c.status === 'active'));
  if (/FROM whatsapp_channels WHERE id = \$1 AND tenant_id = \$2/.test(text)) return ok(channels.filter(c => c.id === params[0] && c.tenant_id === params[1]));
  if (/FROM whatsapp_channels WHERE id = \$1 LIMIT 1/.test(text)) return ok(channels.filter(c => c.id === params[0]));
  if (/FROM whatsapp_channels WHERE provider = \$1/.test(text)) return ok(channels.filter(c => c.provider === params[0] && c.status === 'active'));
  if (/FROM whatsapp_channels\s+WHERE tenant_id = \$1 AND status = 'active' AND role = 'primary'/.test(text)) return ok(channels.filter(c => c.tenant_id === params[0] && c.role === 'primary'));
  if (/SELECT 1 FROM whatsapp_channels WHERE tenant_id = \$1 AND role = 'primary'/.test(text)) return ok(channels.filter(c => c.tenant_id === params[0] && c.role === 'primary').map(() => ({ x: 1 })));
  if (/FROM whatsapp_channels WHERE tenant_id = \$1 ORDER BY/.test(text)) return ok(channels.filter(c => c.tenant_id === params[0]));
  if (/UPDATE whatsapp_channels\s+SET connection_state = \$3/.test(text)) {
    const c = channels.find(x => x.id === params[0] && x.tenant_id === params[1]);
    if (c) { c.connection_state = params[2]; if (params[3]) c.display_phone = params[3]; }
    return ok([], c ? 1 : 0);
  }
  // whatsapp_instances
  if (/INSERT INTO whatsapp_instances \(instance_name, tenant_id\) VALUES/.test(text)) { instances.set(params[0], params[1]); return ok([], 1); }
  if (/SELECT tenant_id FROM whatsapp_instances WHERE instance_name = \$1/.test(text)) {
    const t = instances.get(params[0]); return ok(t ? [{ tenant_id: t }] : []);
  }
  if (/SELECT instance_name FROM whatsapp_instances WHERE tenant_id = \$1/.test(text)) {
    return ok([...instances].filter(([, t]) => t === params[0]).map(([n]) => ({ instance_name: n })));
  }
  if (/SELECT created_at, paused_until FROM whatsapp_instances/.test(text)) return ok([{ created_at: new Date('2020-01-01'), paused_until: null }]);
  // dedupe de webhook
  if (/INSERT INTO whatsapp_webhook_events/.test(text)) {
    const k = `${params[0]}:${params[1]}`;
    if (webhookEvents.has(k)) return ok([], 0);
    webhookEvents.add(k); return ok([{ '?column?': 1 }], 1);
  }
  // fila
  if (/SELECT DISTINCT ON/.test(text)) return ok(queueJob ? [queueJob] : []);
  if (/UPDATE automation_jobs SET claimed_at = NOW\(\)/.test(text)) return ok(queueJob ? [queueJob] : []);
  if (/COUNT\(\*\) FILTER/.test(text)) return ok([{ last_hour: 0, today: 0 }]);
  if (/UPDATE automation_jobs SET status = 'sent'/.test(text)) { jobStatus = 'sent'; return ok([], 1); }
  if (/UPDATE automation_jobs SET status = 'failed', error = \$2/.test(text)) { jobStatus = `failed: ${params[1]}`; return ok([], 1); }
  if (/UPDATE automation_jobs SET claimed_at = NULL, scheduled_at = COALESCE/.test(text)) { released = { at: params[1], note: params[2] }; return ok([], 1); }
  if (/INSERT INTO automation_jobs/.test(text)) return ok([{ id: 'job-x' }]);
  if (/SELECT nome FROM tenants WHERE id = \$1/.test(text)) return ok([{ nome: 'Clínica' }]);
  return ok([]);
}

const realFetch = globalThis.fetch;
let querySpy, connectSpy, fetchSpy;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  sqlLog = []; jobStatus = null; released = null; queueJob = null;
  resetWhatsAppQueueStateForTests();
  clearTenantSettingsCacheForTests();
  querySpy = jest.spyOn(pool, 'query').mockImplementation(mockQuery);
  connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => ({ query: (s, p) => mockQuery(s, p), release() {} }));
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).startsWith(fake.baseUrl)) return realFetch(url, init);
    if (/\/instance\/fetchInstances/.test(String(url))) return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 200, json: async () => ({ key: { id: 'EVO-1' } }) };
  });
});
afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); fetchSpy.mockRestore(); });
afterAll(async () => { await fake.close(); await pool.end().catch(() => {}); });

// Canal de A criado pela rota, compartilhado pelos testes seguintes.
let chA;
async function createChannelA() {
  const r = await request(app).post('/api/whatsapp/openwa/channels').set(auth(tenantA)).send({});
  expect(r.status).toBe(201);
  chA = channels.find(c => c.id === r.body.channel.id);
  return r;
}
const deliver = (event, data, opts = {}) => {
  const d = fake.signedDelivery(opts.sessionId || chA.external_id, event, data, opts);
  return request(app).post(`/api/webhook/openwa/${opts.channelId || chA.id}`).set(d.headers).send(d.body);
};

describe('Canal OpenWA: criação e QR', () => {
  test('cria sessão, chave restrita à sessão (cifrada), webhook assinado e inicia; resposta sem segredo', async () => {
    const r = await createChannelA();
    expect(JSON.stringify(r.body)).not.toMatch(/owa_k1_|apiKey|secret/i);
    expect(r.body.channel).toMatchObject({ provider: 'openwa', instance: expect.stringMatching(/^11111111-owa-/) });
    expect(chA.tenant_id).toBe(tenantA);
    expect(instances.get(chA.instance_name)).toBe(tenantA);
    const key = [...fake.keys.entries()].find(([, v]) => v.allowedSessions?.includes(chA.external_id));
    expect(key[1].role).toBe('operator');
    expect(chA.credentials_enc).toMatch(/^v1:/);
    expect(chA.credentials_enc).not.toContain(key[0]);
    const hook = [...fake.webhooks.values()].find(w => w.sessionId === chA.external_id);
    expect(hook.url).toBe(`http://172.30.50.1:8081/api/webhook/openwa/${chA.id}`);
    expect(hook.secret).toHaveLength(64);
    expect(fake.sessions.get(chA.external_id).engineLoaded).toBe(true);
  });

  test('segundo canal reserva na mesma clínica: 409', async () => {
    const r = await request(app).post('/api/whatsapp/openwa/channels').set(auth(tenantA)).send({});
    expect(r.status).toBe(409);
  });

  test('QR só para a clínica dona (B recebe 404)', async () => {
    const b = await request(app).get(`/api/whatsapp/channels/${chA.id}/qr`).set(auth(tenantB));
    expect(b.status).toBe(404);
    const a = await request(app).get(`/api/whatsapp/channels/${chA.id}/qr`).set(auth(tenantA));
    expect(a.status).toBe(200);
    expect(a.body.qr).toBe('data:image/png;base64,QRFALSO');
  });

  test('lista de canais: só os da clínica, sem credenciais', async () => {
    const a = await request(app).get('/api/whatsapp/channels').set(auth(tenantA));
    expect(a.body.channels).toHaveLength(1);
    expect(JSON.stringify(a.body)).not.toMatch(/credentials|external_id/);
    const b = await request(app).get('/api/whatsapp/channels').set(auth(tenantB));
    expect(b.body.channels).toHaveLength(0);
  });
});

describe('Webhook OpenWA', () => {
  test('assinatura errada, sem assinatura, canal inexistente ou sessionId de outra sessão → 401', async () => {
    expect((await deliver('session.status', { status: 'ready' }, { secret: 'segredo-errado-0000000' })).status).toBe(401);
    const d = fake.signedDelivery(chA.external_id, 'session.status', { status: 'ready' });
    delete d.headers['x-openwa-signature'];
    expect((await request(app).post(`/api/webhook/openwa/${chA.id}`).set(d.headers).send(d.body)).status).toBe(401);
    expect((await deliver('session.status', { status: 'ready' }, { channelId: '99999999-9999-9999-9999-999999999999' })).status).toBe(401);
    expect((await request(app).post('/api/webhook/openwa/nao-e-uuid').send({})).status).toBe(401);
    const hook = [...fake.webhooks.values()].find(w => w.sessionId === chA.external_id);
    expect((await deliver('session.status', { status: 'ready' }, { sessionId: 'outra-sessao', secret: hook.secret })).status).toBe(401);
  });

  test('session.status ready assinado: canal fica "open"; repetição (mesma Idempotency-Key) não reprocessa', async () => {
    fake.connect(chA.external_id);
    const r = await deliver('session.status', { status: 'ready' }, { idempotencyKey: 'sess_ready_1' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: true, events: 1 });
    expect(chA.connection_state).toBe('open');
    const again = await deliver('session.status', { status: 'ready' }, { idempotencyKey: 'sess_ready_1' });
    expect(again.body).toEqual({ duplicate: true });
  });

  test('mensagem recebida entra no chat da clínica do canal (A), nunca de B', async () => {
    const r = await deliver('message.received', {
      id: 'false_5511988887777@c.us_3EB0OPENWA1', from: '5511988887777@c.us', to: '5562900000000@c.us', chatId: '5511988887777@c.us',
      body: 'Olá, quero marcar', type: 'text', timestamp: Math.floor(Date.now() / 1000), isGroup: false, kind: 'individual', fromMe: false,
      contact: { pushName: 'Paciente Teste' }, tenantId: tenantB,
    });
    expect(r.status).toBe(200);
    await sleep(300);
    const leadInsert = sqlLog.find(q => /INSERT INTO crm_leads/.test(q.text));
    expect(leadInsert).toBeTruthy();
    expect(leadInsert.params).toContain(tenantA);
    const msgInsert = sqlLog.find(q => /INSERT INTO chat_messages/.test(q.text));
    expect(msgInsert.params).toContain(tenantA);
    expect(msgInsert.params).toContain(chA.instance_name);
    expect(sqlLog.some(q => q.params.includes(tenantB))).toBe(false);
  });

  test('mensagem de grupo é ignorada', async () => {
    await deliver('message.received', { id: 'g1', from: '1203@g.us', chatId: '1203@g.us', body: 'x', type: 'text', isGroup: true, kind: 'group' });
    await sleep(100);
    expect(sqlLog.some(q => /INSERT INTO crm_leads|INSERT INTO chat_messages/.test(q.text))).toBe(false);
  });
});

describe('Fila pelo canal OpenWA', () => {
  const makeJob = (extra = {}) => ({
    id: 'job-owa-1', tenant_id: tenantA, instance: chA.instance_name, patient_phone: '5511988887777', message: 'Lembrete: 1 confirmar, 2 remarcar',
    category: 'service', trigger_event: 'auto_reply', status: 'pending', channel: 'whatsapp',
    scheduled_at: new Date(), expires_at: new Date(Date.now() + 60_000), created_at: new Date(),
    variables: JSON.stringify({ kind: 'queue_menu', dedupeMinutes: 2, interactive: { endpoint: 'sendButtons', payload: { description: 'x', buttons: [] } } }),
    ...extra,
  });

  test('envia pelo OpenWA (chave da sessão, Idempotency-Key do job); botões viram o texto numerado', async () => {
    fake.connect(chA.external_id);
    queueJob = makeJob();
    const antes = fake.sent.length;
    await processAutomationJobs();
    expect(jobStatus).toBe('sent');
    expect(fake.sent.length).toBe(antes + 1);
    expect(fake.sent.at(-1)).toMatchObject({ route: 'send-text', sessionId: chA.external_id, body: { chatId: '5511988887777@c.us', text: 'Lembrete: 1 confirmar, 2 remarcar' } });
    const call = fake.calls.filter(c => c.path.endsWith('/messages/send-text')).at(-1);
    expect(call.idempotencyKey).toBe('job-job-owa-1');
    expect(call.apiKey).not.toBe(fake.adminKey);
  });

  test('job da clínica B apontando para o número da A não sai (instância reatribuída não entrega na clínica errada)', async () => {
    queueJob = makeJob({ id: 'job-owa-2', tenant_id: tenantB });
    const antes = fake.sent.length;
    await processAutomationJobs();
    expect(jobStatus).toMatch(/failed: Bloqueado: o número de envio pertence a outra clínica/);
    expect(fake.sent.length).toBe(antes);
  });

  test('canal reatribuído para B no banco: job da A com esse número falha', async () => {
    chA.tenant_id = tenantB; instances.set(chA.instance_name, tenantB);
    resetWhatsAppQueueStateForTests();
    queueJob = makeJob({ id: 'job-owa-3' });
    const antes = fake.sent.length;
    await processAutomationJobs();
    expect(jobStatus).toMatch(/failed: Bloqueado/);
    expect(fake.sent.length).toBe(antes);
    chA.tenant_id = tenantA; instances.set(chA.instance_name, tenantA);
  });

  test('429 SEND_PACING_LIMITED do OpenWA: reagenda (não falha, não conta para o disjuntor)', async () => {
    fake.fail({ status: 429, code: 'SEND_PACING_LIMITED', retryAfterSeconds: 600 });
    queueJob = makeJob({ id: 'job-owa-4' });
    await processAutomationJobs();
    expect(jobStatus).toBeNull();
    expect(released.note).toMatch(/ritmo do provedor/);
    expect(new Date(released.at).getTime()).toBeGreaterThan(Date.now() + 590_000);
  });
});

describe('Chat humano pelo canal OpenWA', () => {
  test('send-text sai pelo OpenWA para a clínica dona; outra clínica recebe 403', async () => {
    const b = await request(app).post('/api/whatsapp/send-text').set(auth(tenantB)).send({ instance: chA.instance_name, number: '5511988887777', text: 'oi' });
    expect(b.status).toBe(403);
    const antes = fake.sent.length;
    const a = await request(app).post('/api/whatsapp/send-text').set(auth(tenantA)).send({ instance: chA.instance_name, number: '5511988887777', text: 'Bom dia!' });
    expect(a.status).toBe(200);
    expect(a.body.messageId).toMatch(/^true_5511988887777@c\.us_/);
    expect(fake.sent.length).toBe(antes + 1);
    expect(fake.sent.at(-1).body.text).toBe('Bom dia!');
  });
});

describe('Desconectar e remover', () => {
  test('B não desconecta nem remove o canal da A; A remove e a sessão some do OpenWA', async () => {
    expect((await request(app).post(`/api/whatsapp/channels/${chA.id}/disconnect`).set(auth(tenantB))).status).toBe(404);
    expect((await request(app).delete(`/api/whatsapp/channels/${chA.id}`).set(auth(tenantB))).status).toBe(404);
    expect((await request(app).post(`/api/whatsapp/channels/${chA.id}/disconnect`).set(auth(tenantA))).status).toBe(200);
    const del = await request(app).delete(`/api/whatsapp/channels/${chA.id}`).set(auth(tenantA));
    expect(del.status).toBe(200);
    expect(fake.sessions.has(chA.external_id)).toBe(false);
    expect(sqlLog.some(q => /DELETE FROM whatsapp_instances WHERE instance_name = \$1 AND tenant_id = \$2/.test(q.text) && q.params[1] === tenantA)).toBe(true);
  });
});
