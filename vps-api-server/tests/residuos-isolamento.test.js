// Isolamento entre clínicas — resíduos L2/L3/L9 da reauditoria:
// ids de paciente/dentista recebidos no corpo (exames, agenda, tratamentos),
// follow-ups do painel comercial e rotas do Clinicorp (conflitos e webhook).
// pool.query é mockado: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const pacienteA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const pacienteB = 'bbbbbbbb-0000-4000-8000-00000000000b';
const dentistaA = 'aaaaaaaa-0000-4000-8000-0000000000da';
const dentistaB = 'bbbbbbbb-0000-4000-8000-0000000000db';
const donos = { [pacienteA]: tenantA, [pacienteB]: tenantB, [dentistaA]: tenantA, [dentistaB]: tenantB };

let sqlLog;
let querySpy;
const token = (extra = {}) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica-a.com',
  role: 'admin', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);
const chamar = (method, url, body = {}, tk = token()) =>
  request(app)[method](url).set('Authorization', `Bearer ${tk}`).send(body);
const gravou = (re) => sqlLog.some(q => re.test(q.text));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    const ref = text.match(/SELECT 1 FROM (pacientes|dentistas) WHERE id = \$1 AND tenant_id = \$2 LIMIT 1/);
    if (ref) {
      const ok = donos[params[0]] === params[1];
      return Promise.resolve({ rows: ok ? [{ '?column?': 1 }] : [], rowCount: ok ? 1 : 0 });
    }
    if (/next_code/.test(text)) return Promise.resolve({ rows: [{ next_code: 'EX-000001' }], rowCount: 1 });
    if (/^\s*INSERT INTO exames/.test(text)) return Promise.resolve({ rows: [{ id: 'ex1' }], rowCount: 1 });
    if (/^\s*UPDATE (exames|agendamentos)/.test(text)) return Promise.resolve({ rows: [{ id: 'x1', data: '2026-11-10' }], rowCount: 1 });
    if (/^\s*UPDATE tratamentos/.test(text)) return Promise.resolve({ rows: [], rowCount: 1 });
    if (/FROM clinicorp_user_settings s/.test(text)) {
      return Promise.resolve({ rows: [{ user_id: 'u1', api_token: 't', subscriber_id: 's', tenant_id: tenantA }], rowCount: 1 });
    }
    if (/INSERT INTO clinicorp_webhook_events/.test(text)) return Promise.resolve({ rows: [{ id: 'ev1' }], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

describe('ids do corpo precisam ser da clínica do usuário', () => {
  test.each([
    ['post', '/api/exames', { tipo_nome: 'Panorâmica', paciente_id: pacienteB }, /INSERT INTO exames/],
    ['post', '/api/exames', { tipo_nome: 'Panorâmica', dentista_solicitante_id: dentistaB }, /INSERT INTO exames/],
    ['patch', '/api/exames/ex1', { paciente_id: pacienteB }, /UPDATE exames/],
    ['post', '/api/agenda', { paciente_id: pacienteB, data: '2026-11-10', hora: '09:00' }, /INSERT INTO agendamentos/],
    ['post', '/api/agenda', { dentista_id: dentistaB, data: '2026-11-10', hora: '09:00' }, /INSERT INTO agendamentos/],
    ['post', '/api/agenda/serie', { paciente_id: pacienteB, dentista_id: dentistaA, data_inicio: '2026-11-10', hora: '09:00' }, /INSERT INTO agendamentos/],
    ['put', '/api/agenda/ag1', { dentista_id: dentistaB }, /UPDATE agendamentos/],
    ['post', '/api/tratamentos', { paciente_id: pacienteB, descricao: 'Canal' }, /INSERT INTO tratamentos/],
    ['put', '/api/tratamentos/tr1', { dentista_id: dentistaB }, /UPDATE tratamentos/],
    ['post', '/api/exames', { tipo_nome: 'X', paciente_id: 'nao-uuid' }, /INSERT INTO exames/],
  ])('%s %s com referência de outra clínica → 400 sem gravar', async (method, url, body, escrita) => {
    const res = await chamar(method, url, body);
    expect(res.status).toBe(400);
    expect(gravou(escrita)).toBe(false);
  });

  test.each([
    ['post', '/api/exames', { tipo_nome: 'Panorâmica', paciente_id: pacienteA, dentista_solicitante_id: dentistaA }, /INSERT INTO exames/],
    ['post', '/api/agenda', { paciente_id: pacienteA, dentista_id: dentistaA, data: '2026-11-10', hora: '09:00' }, /INSERT INTO agendamentos/],
    ['post', '/api/tratamentos', { paciente_id: pacienteA, dentista_id: dentistaA, descricao: 'Canal' }, /INSERT INTO tratamentos/],
    ['put', '/api/tratamentos/tr1', { dentista_id: dentistaA }, /UPDATE tratamentos/],
  ])('%s %s com referências da própria clínica grava', async (method, url, body, escrita) => {
    const res = await chamar(method, url, body);
    expect(res.status).toBe(200);
    expect(gravou(escrita)).toBe(true);
  });

  test('GET /api/exames junta paciente e dentista só da mesma clínica', async () => {
    await chamar('get', '/api/exames');
    const q = sqlLog.find(x => /FROM exames e/.test(x.text));
    expect(q.text).toMatch(/LEFT JOIN pacientes p ON p\.id = e\.paciente_id AND p\.tenant_id = e\.tenant_id/);
    expect(q.text).toMatch(/LEFT JOIN dentistas d ON d\.id = e\.dentista_solicitante_id AND d\.tenant_id = e\.tenant_id/);
  });
});

describe('painel comercial', () => {
  test('follow-ups de um attendantId qualquer ficam na clínica do admin', async () => {
    const res = await chamar('get', '/api/comercial/painel?attendantId=99999999-9999-9999-9999-999999999999');
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /follow_up_at IS NOT NULL/.test(x.text));
    expect(q.text).toMatch(/AND tenant_id = \$2/);
    expect(q.params[1]).toBe(tenantA);
  });
});

describe('Clinicorp', () => {
  test('conflitos juntam lead e paciente só da clínica do conflito', async () => {
    const res = await chamar('get', '/api/clinicorp/conflicts');
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /FROM clinicorp_conflicts c/.test(x.text));
    expect(q.text).toMatch(/AND l\.tenant_id = COALESCE\(c\.tenant_id, p\.tenant_id\)/);
    expect(q.text).toMatch(/p\.tenant_id = c\.tenant_id/);
  });

  test('webhook não grava o segredo nem credenciais nos cabeçalhos', async () => {
    const res = await request(app)
      .post('/api/webhook/clinicorp')
      .set('x-user-api', 'segredo-do-webhook-123')
      .set('Authorization', 'Bearer abc')
      .set('Cookie', 'sid=1')
      .send({ event: 'ping' });
    expect(res.status).toBeLessThan(500);
    const ins = sqlLog.find(x => /INSERT INTO clinicorp_webhook_events/.test(x.text));
    const headers = JSON.parse(ins.params[3]);
    expect(Object.keys(headers)).not.toEqual(expect.arrayContaining(['x-user-api']));
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain('segredo-do-webhook-123');
  });
});
