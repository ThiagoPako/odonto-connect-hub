// GET /api/onboarding/status — checklist "Primeiros passos" do dashboard.
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
const token = (extra = {}) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica-a.com',
  role: 'admin', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);

let querySpy;
let sqlLog;
const contagens = { dentistas: 2, pacientes: 0, agendamentos: 0, clinica_config: 1, whatsapp_instances: 0 };

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
    const m = text.match(/COUNT\(\*\)::int AS n FROM (\w+)/);
    if (m) return Promise.resolve({ rows: [{ n: contagens[m[1]] ?? 0 }], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

const status = (tk = token()) => request(app).get('/api/onboarding/status').set('Authorization', `Bearer ${tk}`);
const contas = () => sqlLog.filter(q => /COUNT\(\*\)::int AS n FROM/.test(q.text));

test('devolve as contagens da própria clínica', async () => {
  const res = await status();
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ dentistas: 2, pacientes: 0, agendamentos: 0, horarios_configurados: true, whatsapp_instancias: 0 });
});

test('todas as contagens filtram por tenant_id do token, nunca do cliente', async () => {
  await request(app).get('/api/onboarding/status').query({ tenant_id: tenantB }).set('Authorization', `Bearer ${token()}`);
  const qs = contas();
  expect(qs).toHaveLength(5);
  for (const q of qs) {
    expect(q.text).toMatch(/WHERE tenant_id = \$1/);
    expect(q.params).toEqual([tenantA]);
  }
});

test('horário só conta a linha da clínica (não a id=1 legada)', async () => {
  await status();
  const q = contas().find(x => /FROM clinica_config/.test(x.text));
  expect(q.text).not.toMatch(/id\s*=\s*1/);
});

test('tabela ausente conta como zero', async () => {
  querySpy.mockImplementation((sql) => {
    if (/FROM whatsapp_instances/.test(String(sql))) return Promise.reject(Object.assign(new Error('no table'), { code: '42P01' }));
    return Promise.resolve({ rows: [{ n: 0 }], rowCount: 1 });
  });
  const res = await status();
  expect(res.status).toBe(200);
  expect(res.body.whatsapp_instancias).toBe(0);
});

test('erro do banco → 500 genérico', async () => {
  querySpy.mockImplementation(() => Promise.reject(Object.assign(new Error('detalhe interno'), { code: 'XX000' })));
  const res = await status();
  expect(res.status).toBe(500);
  expect(JSON.stringify(res.body)).not.toMatch(/detalhe interno/);
});

test('sem clínica → 403; sem login → 401', async () => {
  expect((await status(token({ tenant_id: null }))).status).toBe(403);
  expect((await request(app).get('/api/onboarding/status')).status).toBe(401);
});
