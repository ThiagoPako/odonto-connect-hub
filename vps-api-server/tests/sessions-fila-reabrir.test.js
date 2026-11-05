// POST /api/sessions/return-to-queue, POST /api/sessions/reopen e GET /api/whatsapp/primary.
// pool.query e pool.connect são mockados: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool, clearTenantSettingsCacheForTests } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const eu = '44444444-4444-4444-4444-444444444444';
const colega = '55555555-5555-5555-5555-555555555555';

const token = (extra = {}) => jwt.sign({
  sub: eu, email: 'recepcao@clinica-a.com',
  role: 'recepcionista', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);

describe('retornar à fila / reabrir atendimento', () => {
  let sqlLog;
  // sessões "no banco", por clínica
  let sessoes;
  let querySpy;
  let connectSpy;

  const handler = (sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/UPDATE attendance_sessions/.test(text) && /status = 'closed'/.test(text) && /INTERVAL '24 hours'/.test(text)) {
      const s = sessoes.find(x => x.tenant_id === params[0] && x.lead_id === params[1] && x.status === 'closed' && x.attendant_id === params[2] && x.recente);
      return Promise.resolve({ rows: s ? [{ id: s.id }] : [], rowCount: s ? 1 : 0 });
    }
    if (/FROM attendance_sessions/.test(text) && /status IN \('waiting', 'active'\)/.test(text)) {
      const rows = sessoes.filter(s => s.tenant_id === params[0] && s.lead_id === params[1] && ['waiting', 'active'].includes(s.status));
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    if (/FROM attendance_sessions/.test(text) && /status = 'closed'/.test(text)) {
      const rows = sessoes.filter(s => s.tenant_id === params[0] && s.lead_id === params[1] && s.status === 'closed');
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    if (/UPDATE attendance_sessions SET/.test(text) && /closed_at = NOW\(\), status = 'closed'/.test(text)) {
      const [leadId, tenantId, userId, isAdmin] = params;
      const rows = sessoes.filter(x => x.tenant_id === tenantId && x.lead_id === leadId && x.status === 'active' && (x.attendant_id === userId || isAdmin));
      return Promise.resolve({ rows: rows.map(r => ({ id: r.id, attendant_id: r.attendant_id })), rowCount: rows.length });
    }
    if (/SELECT attendant_name FROM attendance_sessions/.test(text)) {
      const rows = sessoes.filter(x => x.tenant_id === params[1] && x.lead_id === params[0] && x.status === 'active');
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    if (/SELECT value FROM tenant_settings/.test(text)) {
      const rows = params[0] === tenantA && params[1] === 'whatsapp_primary_instance'
        ? [{ value: { instance: 'clinica-a-recepcao', updatedAt: '2026-11-05T10:00:00.000Z' } }]
        : [];
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    sqlLog = [];
    sessoes = [];
    clearTenantSettingsCacheForTests();
    querySpy = jest.spyOn(pool, 'query').mockImplementation(handler);
    connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => ({
      query: (sql, params) => handler(sql, params),
      release: () => {},
    }));
  });

  afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });
  afterAll(async () => { await pool.end(); });

  const post = (rota, body, tk = token()) =>
    request(app).post(rota).set('Authorization', `Bearer ${tk}`).send(body);
  const achar = (re) => sqlLog.filter(q => re.test(q.text));

  test('devolve à fila o atendimento que é meu, só na minha clínica, e registra quem fez', async () => {
    sessoes.push({ id: 's1', tenant_id: tenantA, lead_id: 'lead-1', status: 'active', attendant_id: eu, attendant_name: 'Eu' });
    const res = await post('/api/sessions/return-to-queue', { leadId: 'lead-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, sessionId: 's1', status: 'waiting' });
    const update = achar(/UPDATE attendance_sessions/)[0];
    expect(update.text).toMatch(/status = 'waiting'/);
    expect(update.params).toEqual(['s1', tenantA]);
    const evento = achar(/INSERT INTO attendance_session_events/)[0];
    expect(evento.params.slice(0, 5)).toEqual([tenantA, 's1', 'lead-1', 'returned_to_queue', eu]);
    expect(achar(/COMMIT/).length).toBe(1);
  });

  test('não devolve atendimento de outro atendente: 409 com o nome de quem atende', async () => {
    sessoes.push({ id: 's2', tenant_id: tenantA, lead_id: 'lead-2', status: 'active', attendant_id: colega, attendant_name: 'Carla' });
    const res = await post('/api/sessions/return-to-queue', { leadId: 'lead-2' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TAKEN_BY_OTHER');
    expect(res.body.error).toMatch(/Carla já está atendendo/);
    expect(achar(/UPDATE attendance_sessions/)).toHaveLength(0);
  });

  test('admin pode devolver o atendimento de um colega', async () => {
    sessoes.push({ id: 's3', tenant_id: tenantA, lead_id: 'lead-3', status: 'active', attendant_id: colega, attendant_name: 'Carla' });
    const res = await post('/api/sessions/return-to-queue', { leadId: 'lead-3' }, token({ role: 'admin' }));
    expect(res.status).toBe(200);
  });

  test('sessão de outra clínica não é encontrada (404) e nada é alterado', async () => {
    sessoes.push({ id: 'sB', tenant_id: tenantB, lead_id: 'lead-b', status: 'active', attendant_id: eu, attendant_name: 'Eu' });
    const res = await post('/api/sessions/return-to-queue', { leadId: 'lead-b' });
    expect(res.status).toBe(404);
    expect(achar(/UPDATE attendance_sessions/)).toHaveLength(0);
    for (const q of achar(/FROM attendance_sessions/)) expect(q.params[0]).toBe(tenantA);
  });

  test('reabre conversa encerrada da clínica como atendimento meu e registra o evento', async () => {
    sessoes.push({ id: 'c1', tenant_id: tenantA, lead_id: 'lead-4', status: 'closed', lead_name: 'Maria', lead_phone: '5511999990000', queue_id: 'q1', queue_name: 'Agenda' });
    const res = await post('/api/sessions/reopen', { leadId: 'lead-4' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'active' });
    const insert = achar(/INSERT INTO attendance_sessions/)[0];
    expect(insert.text).toMatch(/'active'/);
    expect(insert.params[1]).toBe('lead-4');
    expect(insert.params[6]).toBe(eu);
    expect(insert.params[8]).toBe(tenantA);
    expect(achar(/INSERT INTO attendance_session_events/)[0].params[3]).toBe('reopened');
  });

  test('reabre a mesma sessão quando eu a encerrei nas últimas 24 h', async () => {
    sessoes.push({ id: 'c7', tenant_id: tenantA, lead_id: 'lead-7', status: 'closed', attendant_id: eu, recente: true });
    const res = await post('/api/sessions/reopen', { leadId: 'lead-7' });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('c7');
    expect(achar(/INSERT INTO attendance_sessions/)).toHaveLength(0);
  });

  test('reabrir quando o paciente já está na fila: 409', async () => {
    sessoes.push({ id: 'w8', tenant_id: tenantA, lead_id: 'lead-8', status: 'waiting' });
    const res = await post('/api/sessions/reopen', { leadId: 'lead-8' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_WAITING');
  });

  test('atendente da clínica B recebe 404 ao devolver o atendimento da clínica A', async () => {
    sessoes.push({ id: 'sA', tenant_id: tenantA, lead_id: 'lead-a', status: 'active', attendant_id: eu, attendant_name: 'Eu' });
    const tkB = token({ sub: colega, tenant_id: tenantB });
    expect((await post('/api/sessions/return-to-queue', { leadId: 'lead-a' }, tkB)).status).toBe(404);
    expect((await post('/api/sessions/reopen', { leadId: 'lead-a' }, tkB)).status).toBe(404);
    expect(achar(/UPDATE attendance_sessions/)).toHaveLength(0);
  });

  test('finalizar: só o atendente ou um admin encerra; colega recebe 409', async () => {
    sessoes.push({ id: 's9', tenant_id: tenantA, lead_id: 'lead-9', status: 'active', attendant_id: colega, attendant_name: 'Carla' });
    const res = await post('/api/sessions/close', { leadId: 'lead-9' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Carla está atendendo/);
    const fechar = achar(/closed_at = NOW\(\), status = 'closed'/)[0];
    expect(fechar.params).toEqual(['lead-9', tenantA, eu, false]);
    const admin = await post('/api/sessions/close', { leadId: 'lead-9' }, token({ role: 'admin' }));
    expect(admin.status).toBe(200);
  });

  test('reabrir quando outro atendente já assumiu: 409 com mensagem clara', async () => {
    sessoes.push({ id: 's5', tenant_id: tenantA, lead_id: 'lead-5', status: 'active', attendant_id: colega, attendant_name: 'Carla' });
    const res = await post('/api/sessions/reopen', { leadId: 'lead-5' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Carla já está atendendo este paciente.');
    expect(achar(/INSERT INTO attendance_sessions/)).toHaveLength(0);
  });

  test('reabrir lead de outra clínica: 404', async () => {
    sessoes.push({ id: 'cB', tenant_id: tenantB, lead_id: 'lead-6', status: 'closed' });
    const res = await post('/api/sessions/reopen', { leadId: 'lead-6' });
    expect(res.status).toBe(404);
    expect(achar(/INSERT INTO attendance_sessions/)).toHaveLength(0);
  });

  test('sem leadId: 400', async () => {
    expect((await post('/api/sessions/return-to-queue', {})).status).toBe(400);
    expect((await post('/api/sessions/reopen', {})).status).toBe(400);
  });

  test('GET /api/whatsapp/primary lê a conexão principal da clínica do usuário', async () => {
    const res = await request(app).get('/api/whatsapp/primary').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.instance).toBe('clinica-a-recepcao');
    const outra = await request(app).get('/api/whatsapp/primary').set('Authorization', `Bearer ${token({ tenant_id: tenantB })}`);
    expect(outra.body.instance).toBeNull();
  });
});
