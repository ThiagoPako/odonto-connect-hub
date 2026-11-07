// OpenWA de ponta a ponta no servidor, contra o OpenWA falso (tests/helpers/fake-openwa.mjs):
// criar o canal reserva por QR, webhook assinado (HMAC, dedupe, sessionId), mensagem recebida
// entrando no chat da clínica certa, fila enviando pelo canal OpenWA, ritmo do OpenWA (429)
// reagendando, envio humano do chat, e isolamento entre clínicas em cada passo.
// pool.query/pool.connect mockados (whatsapp_channels/whatsapp_instances em memória);
// a Evolution é mockada no fetch; o OpenWA falso responde de verdade.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { assinarComPapel } from './helpers/papel-do-jwt.mjs';
import { jest } from '@jest/globals';
import { randomBytes, randomUUID } from 'crypto';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import path from 'path';
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

const { app, pool, processAutomationJobs, resetWhatsAppQueueStateForTests, clearTenantSettingsCacheForTests, signWaJobMedia, WA_UPLOADS_DIR_FOR_TESTS } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const auth = (tenant) => ({
  Authorization: `Bearer ${assinarComPapel({ sub: '44444444-4444-4444-4444-444444444444', email: 'a@a.com', role: 'admin', tenant_id: tenant, is_super_admin: false }, JWT_SECRET)}`,
});
const authRole = (tenant, role) => ({
  Authorization: `Bearer ${assinarComPapel({ sub: '55555555-5555-5555-5555-555555555555', email: 'r@a.com', role, tenant_id: tenant, is_super_admin: false }, JWT_SECRET)}`,
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

  test('clique duplo (índice de um reserva por clínica): 409 e a sessão criada é apagada (revisão F1, I4)', async () => {
    const tenantC = '33333333-3333-3333-3333-333333333333';
    const sessoesAntes = fake.sessions.size;
    connectSpy.mockImplementation(async () => ({
      query: (sql, p) => /INSERT INTO whatsapp_channels/.test(String(sql))
        ? Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint "uq_wa_channels_one_openwa"'), { code: '23505' }))
        : mockQuery(sql, p),
      release() {},
    }));
    const r = await request(app).post('/api/whatsapp/openwa/channels').set(auth(tenantC)).send({});
    expect(r.status).toBe(409);
    expect(fake.sessions.size).toBe(sessoesAntes);
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

  test('QR só para o administrador: recepção recebe 403 (revisão F1, I1)', async () => {
    const r = await request(app).get(`/api/whatsapp/channels/${chA.id}/qr`).set(authRole(tenantA, 'recepcao'));
    expect(r.status).toBe(403);
  });

  test('consulta de estado pela tela não troca o principal (revisão F1, I1)', async () => {
    fake.connect(chA.external_id);
    const before = sqlLog.length;
    const r = await request(app).get(`/api/whatsapp/channels/${chA.id}/state`).set(authRole(tenantA, 'recepcao'));
    expect(r.status).toBe(200);
    expect(sqlLog.slice(before).some(q => /SET role = 'primary'|SET role = 'backup'/.test(q.text))).toBe(false);
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

  test('dedupe pelo idempotencyKey do corpo assinado: trocar o cabeçalho não reprocessa (revisão F1, I2)', async () => {
    const d1 = fake.signedDelivery(chA.external_id, 'session.status', { status: 'ready' }, { idempotencyKey: 'replay_1' });
    expect((await request(app).post(`/api/webhook/openwa/${chA.id}`).set(d1.headers).send(d1.body)).body).toMatchObject({ accepted: true });
    const replay = { ...d1.headers, 'x-openwa-idempotency-key': 'cabecalho-trocado' };
    expect((await request(app).post(`/api/webhook/openwa/${chA.id}`).set(replay).send(d1.body)).body).toEqual({ duplicate: true });
    const key = [...webhookEvents].find(k => k.endsWith('replay_1'));
    expect(key).toBe(`openwa:${chA.id}:replay_1`);
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

  test('Evolution fora do ar (500) e OpenWA pronto: o job sai pelo OpenWA (revisão F1, B1)', async () => {
    fake.connect(chA.external_id);
    resetWhatsAppQueueStateForTests();
    fetchSpy.mockImplementation(async (url, init) => {
      if (String(url).startsWith(fake.baseUrl)) return realFetch(url, init);
      return { ok: false, status: 500, json: async () => ({ error: 'evolution fora' }) };
    });
    queueJob = makeJob({ id: 'job-owa-evo-fora' });
    const antes = fake.sent.length;
    await processAutomationJobs();
    expect({ jobStatus, released }).toEqual({ jobStatus: 'sent', released: null });
    expect(released).toBeNull();
    expect(fake.sent.length).toBe(antes + 1);
  });

  test('429 com prazo só no cabeçalho Retry-After: respeita o cabeçalho (revisão F1, B6)', async () => {
    fake.connect(chA.external_id);
    fake.fail({ status: 429, code: 'SEND_PACING_LIMITED', retryAfterHeader: 900 });
    queueJob = makeJob({ id: 'job-owa-ra' });
    await processAutomationJobs();
    expect(jobStatus).toBeNull();
    expect(new Date(released.at).getTime()).toBeGreaterThan(Date.now() + 890_000);
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

  test('429 no chat humano: mensagem de limite de ritmo, não "confira a conexão" (revisão F1, B6)', async () => {
    fake.fail({ status: 429, code: 'SEND_PACING_LIMITED', retryAfterSeconds: 120 });
    const r = await request(app).post('/api/whatsapp/send-text').set(auth(tenantA)).send({ instance: chA.instance_name, number: '5511988887777', text: 'oi' });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/Aguarde 2 min/);
  });
});

describe('Lista de números do chat (/api/whatsapp/instances) com o canal OpenWA', () => {
  test('A vê o canal OpenWA no formato que o chat lê (sem credenciais); B não vê', async () => {
    fake.connect(chA.external_id);
    const a = await request(app).get('/api/whatsapp/instances').set(auth(tenantA));
    expect(a.status).toBe(200);
    const item = a.body.find(i => i.name === chA.instance_name);
    expect(item).toMatchObject({ name: chA.instance_name, id: chA.id, integration: 'OPENWA', connectionStatus: 'open', provider: 'openwa' });
    expect(JSON.stringify(a.body)).not.toMatch(/credentials|external_id|apiKey|owa_k1_|webhookSecret/);
    expect(JSON.stringify(a.body)).not.toContain(chA.external_id);
    const b = await request(app).get('/api/whatsapp/instances').set(auth(tenantB));
    expect(b.status).toBe(200);
    expect(b.body.some(i => i.name === chA.instance_name)).toBe(false);
  });

  test('OpenWA fora do ar: usa o último estado gravado no canal', async () => {
    chA.connection_state = 'close';
    const real = fake.baseUrl;
    fetchSpy.mockImplementation(async (url, init) => {
      if (String(url).startsWith(real)) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => [] };
    });
    const a = await request(app).get('/api/whatsapp/instances').set(auth(tenantA));
    expect(a.body.find(i => i.name === chA.instance_name)).toMatchObject({ connectionStatus: 'close' });
    chA.connection_state = 'open';
  });
});

describe('Mídia e áudio pelo canal OpenWA (chat humano)', () => {
  const IMG = Buffer.from('imagem-de-teste-jpeg').toString('base64');

  test('imagem por base64: send-image com mimetype e legenda; B recebe 403', async () => {
    fake.connect(chA.external_id);
    const body = { instance: chA.instance_name, number: '5511988887777', mediaType: 'image', media: { base64: `data:image/jpeg;base64,${IMG}`, mimeType: 'image/jpeg', caption: 'Seu raio-x', fileName: 'rx.jpg' } };
    expect((await request(app).post('/api/whatsapp/send-media').set(auth(tenantB)).send(body)).status).toBe(403);
    const antes = fake.sent.length;
    const a = await request(app).post('/api/whatsapp/send-media').set(auth(tenantA)).send(body);
    expect(a.status).toBe(200);
    expect(a.body.key.id).toMatch(/^true_5511988887777@c\.us_/);
    expect(fake.sent.length).toBe(antes + 1);
    expect(fake.sent.at(-1)).toMatchObject({ route: 'send-image', sessionId: chA.external_id, body: { chatId: '5511988887777@c.us', base64: IMG, mimetype: 'image/jpeg', caption: 'Seu raio-x', filename: 'rx.jpg' } });
  });

  test('áudio gravado no chat vai como mensagem de voz (OGG/Opus, ptt) pelo send-audio', async () => {
    // WAV de 0,2 s (silêncio) para o ffmpeg converter de verdade quando existir na máquina.
    const n = 1600; const wav = Buffer.alloc(44 + n * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
    const a = await request(app).post('/api/whatsapp/send-media').set(auth(tenantA))
      .send({ instance: chA.instance_name, number: '5511988887777', mediaType: 'audio', media: { base64: wav.toString('base64'), mimeType: 'audio/wav', fileName: 'gravacao.wav' } });
    expect(a.status).toBe(200);
    const last = fake.sent.at(-1);
    expect(last.route).toBe('send-audio');
    expect(last.body.caption).toBeUndefined();
    if (last.body.ptt) {
      expect(last.body.mimetype).toBe('audio/ogg; codecs=opus');
      expect(Buffer.from(last.body.base64, 'base64').subarray(0, 4).toString()).toBe('OggS');
    } else {
      expect(last.body.mimetype).toBe('audio/wav'); // sem ffmpeg: vai como arquivo de áudio
    }
  });

  test('documento pelo upload em segundo plano: job "sent" com o id do OpenWA', async () => {
    const pdf = Buffer.from('%PDF-1.4 orçamento de teste');
    const r = await request(app)
      .post(`/api/whatsapp/send-media-upload?instance=${encodeURIComponent(chA.instance_name)}&number=5511988887777&mediaType=document&fileName=orcamento.pdf&mimeType=application/pdf&caption=Seu%20or%C3%A7amento`)
      .set(auth(tenantA)).set('content-type', 'application/octet-stream').send(pdf);
    expect(r.status).toBe(202);
    let job;
    for (let i = 0; i < 40; i++) {
      job = (await request(app).get(`/api/whatsapp/send-media-status/${r.body.jobId}`).set(auth(tenantA))).body;
      if (job.status !== 'processing') break;
      await sleep(50);
    }
    expect(job.status).toBe('sent');
    expect(job.result.key.id).toMatch(/^true_5511988887777@c\.us_/);
    expect(fake.sent.at(-1)).toMatchObject({ route: 'send-document', body: { base64: pdf.toString('base64'), mimetype: 'application/pdf', filename: 'orcamento.pdf', caption: 'Seu orçamento' } });
    expect((await request(app).get(`/api/whatsapp/send-media-status/${r.body.jobId}`).set(auth(tenantB))).status).toBe(404);
    if (job.mediaUrl) await rm(path.join(WA_UPLOADS_DIR_FOR_TESTS, job.mediaUrl.replace('/uploads/media/', '')), { force: true });
  });

  test('upload de B no número da A: 403 e nada sai', async () => {
    const antes = fake.sent.length;
    const r = await request(app)
      .post(`/api/whatsapp/send-media-upload?instance=${encodeURIComponent(chA.instance_name)}&number=5511988887777&mediaType=image&mimeType=image/png`)
      .set(auth(tenantB)).set('content-type', 'application/octet-stream').send(Buffer.from('png'));
    expect(r.status).toBe(403);
    expect(fake.sent.length).toBe(antes);
  });

  test('arquivo grande demais (413 do OpenWA): mensagem clara para a tela', async () => {
    fake.fail({ status: 413 });
    const r = await request(app).post('/api/whatsapp/send-media').set(auth(tenantA))
      .send({ instance: chA.instance_name, number: '5511988887777', mediaType: 'video', media: { base64: IMG, mimeType: 'video/mp4' } });
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/grande demais/);
  });
});

describe('Lido e "digitando" pelo canal OpenWA', () => {
  test('marcar como lido manda os ids da conversa; B recebe 403', async () => {
    expect((await request(app).post('/api/whatsapp/mark-read').set(auth(tenantB)).send({ instance: chA.instance_name, number: '5511988887777', messageIds: ['ABC'] })).status).toBe(403);
    const a = await request(app).post('/api/whatsapp/mark-read').set(auth(tenantA)).send({ instance: chA.instance_name, number: '5511988887777', messageIds: ['3EB0A', '3EB0B'] });
    expect(a.body).toMatchObject({ success: true, marked: 2 });
    expect(fake.chatActions.at(-1)).toMatchObject({ action: 'read', sessionId: chA.external_id, body: { chatId: '5511988887777@c.us', messageIds: ['3EB0A', '3EB0B'] } });
    const vazio = await request(app).post('/api/whatsapp/mark-read').set(auth(tenantA)).send({ instance: chA.instance_name, number: '5511988887777', messageIds: [] });
    expect(vazio.body).toMatchObject({ success: true, marked: 0 });
  });

  test('presença: composing → typing, recording e paused; B recebe 403', async () => {
    const send = (t, presence) => request(app).post('/api/whatsapp/send-presence').set(auth(t)).send({ instance: chA.instance_name, number: '5511988887777', presence });
    expect((await send(tenantB, 'composing')).status).toBe(403);
    expect((await send(tenantA, 'composing')).body).toMatchObject({ success: true });
    expect(fake.chatActions.at(-1)).toMatchObject({ action: 'typing', body: { chatId: '5511988887777@c.us', state: 'typing' } });
    await send(tenantA, 'recording');
    expect(fake.chatActions.at(-1).body.state).toBe('recording');
    await send(tenantA, 'paused');
    expect(fake.chatActions.at(-1).body.state).toBe('paused');
  });

  test('recurso que o número reserva não tem (localização): 501 claro, sem chamar a Evolution', async () => {
    const evoCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).includes('evolution.teste.invalid')).length;
    const antes = evoCalls();
    const r = await request(app).post('/api/whatsapp/send-location').set(auth(tenantA)).send({ instance: chA.instance_name, number: '5511988887777', latitude: 1, longitude: 2 });
    expect(r.status).toBe(501);
    expect(evoCalls()).toBe(antes);
    expect((await request(app).post('/api/whatsapp/send-location').send({ instance: chA.instance_name })).status).toBe(401);
  });
});

describe('Mídia na fila pelo canal OpenWA', () => {
  const sub = '2099-01';
  const created = [];
  async function storeFile(ext, content) {
    const name = `${randomUUID()}.${ext}`;
    await mkdir(path.join(WA_UPLOADS_DIR_FOR_TESTS, sub), { recursive: true });
    await writeFile(path.join(WA_UPLOADS_DIR_FOR_TESTS, sub, name), content);
    created.push(name);
    return `/uploads/media/${sub}/${name}`;
  }
  afterAll(async () => { await rm(path.join(WA_UPLOADS_DIR_FOR_TESTS, sub), { recursive: true, force: true }); });
  const mediaJob = (id, media, extra = {}) => ({
    id, tenant_id: tenantA, instance: chA.instance_name, patient_phone: '5511988887777', message: 'Segue o seu orçamento',
    category: 'transactional', trigger_event: 'manual', status: 'pending', channel: 'whatsapp',
    scheduled_at: new Date(), expires_at: new Date(Date.now() + 60_000), created_at: new Date(),
    variables: JSON.stringify({ media }), ...extra,
  });

  test('documento assinado pelo servidor: sai pelo send-document com legenda e Idempotency-Key do job', async () => {
    fake.connect(chA.external_id);
    const p = await storeFile('pdf', Buffer.from('%PDF-1.4 fila'));
    queueJob = mediaJob('job-midia-1', signWaJobMedia(tenantA, { kind: 'document', path: p, mimetype: 'application/pdf', filename: 'orcamento.pdf' }));
    await processAutomationJobs();
    expect(jobStatus).toBe('sent');
    expect(fake.sent.at(-1)).toMatchObject({ route: 'send-document', body: { chatId: '5511988887777@c.us', base64: Buffer.from('%PDF-1.4 fila').toString('base64'), mimetype: 'application/pdf', filename: 'orcamento.pdf', caption: 'Segue o seu orçamento' } });
    expect(fake.calls.filter(c => c.path.endsWith('/messages/send-document')).at(-1).idempotencyKey).toBe('job-job-midia-1');
  });

  test('áudio na fila vai como voz (send-audio, sem legenda) com "gravando" antes', async () => {
    const p = await storeFile('ogg', Buffer.from('OggS-falso'));
    queueJob = mediaJob('job-midia-2', signWaJobMedia(tenantA, { kind: 'audio', path: p, mimetype: 'audio/ogg', filename: 'recado.ogg' }), { message: '[áudio] recado da clínica' });
    await processAutomationJobs();
    expect(jobStatus).toBe('sent');
    expect(fake.sent.at(-1).route).toBe('send-audio');
    expect(fake.sent.at(-1).body.caption).toBeUndefined();
    expect(fake.chatActions.filter(a => a.action === 'typing').at(-1).body.state).toBe('recording');
  });

  test('assinatura de outra clínica, adulterada ou caminho fora da pasta de mídia: falha sem enviar', async () => {
    const p = await storeFile('pdf', Buffer.from('%PDF b'));
    const antes = fake.sent.length;
    const deB = signWaJobMedia(tenantB, { kind: 'document', path: p, mimetype: 'application/pdf' });
    queueJob = mediaJob('job-midia-3', deB);
    await processAutomationJobs();
    expect(jobStatus).toMatch(/failed: Mídia do envio inválida/);
    const outra = signWaJobMedia(tenantA, { kind: 'document', path: p, mimetype: 'application/pdf' });
    queueJob = mediaJob('job-midia-4', { ...outra, path: '/uploads/media/../../server.mjs' });
    await processAutomationJobs();
    expect(jobStatus).toMatch(/failed: Mídia do envio inválida/);
    queueJob = mediaJob('job-midia-5', { ...outra, mimetype: 'image/png' });
    await processAutomationJobs();
    expect(jobStatus).toMatch(/failed: Mídia do envio inválida/);
    expect(signWaJobMedia(tenantA, { kind: 'document', path: '/etc/passwd' })).toBeNull();
    expect(fake.sent.length).toBe(antes);
  });

  test('arquivo apagado do disco: falha clara', async () => {
    const p = `/uploads/media/${sub}/${randomUUID()}.pdf`;
    queueJob = mediaJob('job-midia-6', signWaJobMedia(tenantA, { kind: 'document', path: p, mimetype: 'application/pdf' }));
    await processAutomationJobs();
    expect(jobStatus).toMatch(/failed: Arquivo da mídia não encontrado/);
  });
});

describe('Mídia recebida pelo canal OpenWA', () => {
  test('imagem sem bytes no webhook: baixada na hora do OpenWA, gravada em disco e no chat da A; sem telefone nem caminho no log', async () => {
    console.log.mockClear(); console.warn.mockClear(); console.error.mockClear();
    const r = await deliver('message.received', {
      id: 'false_5511988887777@c.us_3EB0IMG1', from: '5511988887777@c.us', chatId: '5511988887777@c.us',
      body: '', type: 'image', timestamp: Math.floor(Date.now() / 1000), isGroup: false, kind: 'individual', fromMe: false,
      media: { omitted: true, sizeBytes: 9 },
    });
    expect(r.status).toBe(200);
    await sleep(400);
    expect(fake.calls.some(c => c.method === 'GET' && /\/messages\/5511988887777%40c\.us\/.+\/media$/.test(c.path))).toBe(true);
    const msgInsert = sqlLog.find(q => /INSERT INTO chat_messages/.test(q.text));
    expect(msgInsert.params).toContain(tenantA);
    const mediaUrl = msgInsert.params.find(v => typeof v === 'string' && v.startsWith('/uploads/media/'));
    expect(mediaUrl).toMatch(/^\/uploads\/media\/\d{4}-\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(msgInsert.params).toContain('image/jpeg');
    const file = path.join(WA_UPLOADS_DIR_FOR_TESTS, mediaUrl.replace('/uploads/media/', ''));
    expect((await readFile(file)).toString()).toBe('JPEGFALSO');
    await rm(file, { force: true });
    const logs = [...console.log.mock.calls, ...console.warn.mock.calls, ...console.error.mock.calls].map(c => c.map(String).join(' ')).join('\n');
    expect(logs).not.toContain('5511988887777');
    expect(logs).not.toContain(mediaUrl);
  });

  test('download falhou: a mensagem entra sem mídia (não se perde)', async () => {
    fetchSpy.mockImplementation(async (url, init) => {
      if (String(url).startsWith(fake.baseUrl) && /\/media$/.test(String(url))) return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } };
      if (String(url).startsWith(fake.baseUrl)) return realFetch(url, init);
      return { ok: true, status: 200, json: async () => ({ key: { id: 'EVO-1' } }) };
    });
    const r = await deliver('message.received', {
      id: 'false_5511988887777@c.us_3EB0DOC1', from: '5511988887777@c.us', chatId: '5511988887777@c.us',
      body: 'exame.pdf', type: 'document', timestamp: Math.floor(Date.now() / 1000), isGroup: false, kind: 'individual', fromMe: false,
      media: { mimetype: 'application/pdf', filename: 'exame.pdf', omitted: true },
    });
    expect(r.status).toBe(200);
    await sleep(400);
    expect(fetchSpy.mock.calls.some(([u]) => /\/media$/.test(String(u)))).toBe(true);
    const msgInsert = sqlLog.filter(q => /INSERT INTO chat_messages/.test(q.text)).at(-1);
    expect(msgInsert.params).toContain(tenantA);
    expect(msgInsert.params.some(v => typeof v === 'string' && v.startsWith('/uploads/media/'))).toBe(false);
  });
});

describe('Chat humano na Evolution: número de outra clínica', () => {
  test('mídia, lido e presença num número mapeado para B: A recebe 403 e a Evolution não é chamada', async () => {
    instances.set('evo-clinica-b', tenantB);
    const evoCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).includes('evolution.teste.invalid') && !/fetchInstances|webhook/.test(String(u))).length;
    const antes = evoCalls();
    const base = { instance: 'evo-clinica-b', number: '5511977776666' };
    expect((await request(app).post('/api/whatsapp/send-media').set(auth(tenantA)).send({ ...base, mediaType: 'image', media: { base64: 'QUJDREVGR0hJSg==', mimeType: 'image/png' } })).status).toBe(403);
    expect((await request(app).post('/api/whatsapp/mark-read').set(auth(tenantA)).send({ ...base, messageIds: ['X'] })).status).toBe(403);
    expect((await request(app).post('/api/whatsapp/send-presence').set(auth(tenantA)).send({ ...base, presence: 'composing' })).status).toBe(403);
    expect(evoCalls()).toBe(antes);
    instances.delete('evo-clinica-b');
  });
});

describe('Webhook da Evolution: contrato dos eventos internos', () => {
  const evo = (data) => request(app).post('/api/webhook/evolution').send({ event: 'messages.upsert', instance: 'evo-clinica-a', data });

  test('mensagem sem id (evento interno inválido) é descartada; com id é processada', async () => {
    instances.set('evo-clinica-a', tenantA);
    const r = await evo({ key: { remoteJid: '5511977776666@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' }, messageTimestamp: Math.floor(Date.now() / 1000) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ignored: true, reason: 'invalid_event' });
    expect(sqlLog.some(q => /INSERT INTO chat_messages/.test(q.text))).toBe(false);
    const ok = await evo({ key: { remoteJid: '5511977776666@s.whatsapp.net', fromMe: false, id: '3EB0EVO1' }, message: { conversation: 'oi' }, messageTimestamp: Math.floor(Date.now() / 1000) });
    expect(ok.status).toBe(200);
    expect(ok.body.reason).not.toBe('invalid_event');
    await sleep(200);
    expect(sqlLog.some(q => /INSERT INTO chat_messages/.test(q.text))).toBe(true);
    instances.delete('evo-clinica-a');
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
