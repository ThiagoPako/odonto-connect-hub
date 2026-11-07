// Correções da revisão de segurança do merge das auditorias (07/11): "active" só booleano,
// papel lido do banco (token de 7 dias não mantém admin rebaixado), SSE recusa usuário
// desativado, comissão com tratamento de outra clínica e CSV sem fórmula.
// pool.query e pool.connect mockados: nenhuma query chega ao Postgres.
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

const TENANT = '11111111-1111-1111-1111-111111111111';
const ADMIN = '44444444-4444-4444-4444-444444444444';
const OUTRO = '55555555-5555-5555-5555-555555555555';
const REBAIXADO = '66666666-6666-6666-6666-666666666666';
const DESATIVADO = '77777777-7777-7777-7777-777777777777';
const TRAT_BETA = '88888888-8888-8888-8888-888888888888';
const tok = (extra = {}) => jwt.sign({ sub: ADMIN, email: 'a@x.com', role: 'admin', tenant_id: TENANT, is_super_admin: false, ...extra }, JWT_SECRET);

let querySpy, connectSpy, sqlLog;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  sqlLog = [];
  const responder = (sql, params = []) => {
    const t = String(sql);
    sqlLog.push({ t, params });
    if (/COALESCE\(p\.active, true\) AS active, COALESCE\(p\.is_super_admin, false\)/.test(t)) {
      const papel = { [ADMIN]: 'admin', [OUTRO]: 'user', [REBAIXADO]: 'recepcionista', [DESATIVADO]: 'user' }[params[0]];
      return { rows: papel ? [{ active: params[0] !== DESATIVADO, role: papel, is_super_admin: false }] : [] };
    }
    if (/SELECT id, tenant_id, COALESCE\(is_super_admin, false\) AS is_super_admin FROM profiles WHERE id = \$1/.test(t)) {
      return { rows: [{ id: params[0], tenant_id: TENANT, is_super_admin: false }] };
    }
    if (/COALESCE\(ur.role::text, p.role::text\) = 'admin'/.test(t)) return { rows: [{ id: ADMIN }, { id: OUTRO }] };
    if (/SELECT COALESCE\(active, true\) AS active FROM profiles WHERE id = \$1/.test(t)) return { rows: [{ active: false }] };
    if (/SELECT 1 FROM tratamentos WHERE id::text = \$1 AND tenant_id = \$2/.test(t)) return { rows: [] };
    if (/FROM clinical_reports/.test(t)) {
      return { rows: [{ created_at: '2026-11-07T12:00:00Z', patient_name: '=HYPERLINK("http://x")', attendant_name: '@Dra', queixa_principal: '+1', procedimento: '-2', dente_regiao: 'ok', duration_seconds: 60, prescricoes: [] }] };
    }
    return { rows: [], rowCount: 0 };
  };
  querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => responder(sql, params));
  connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => ({ query: async (sql, params) => responder(sql, params), release: () => {} }));
});
afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });
const sqlDe = (re) => sqlLog.filter(q => re.test(q.t));

test.each([
  ['PUT', `/api/auth/users/${OUTRO}`, 'false'],
  ['PUT', `/api/auth/users/${OUTRO}`, 1],
  ['PATCH', `/api/my-tenant/users/${OUTRO}`, 'true'],
  ['PATCH', `/api/my-tenant/users/${OUTRO}`, 0],
])('%s %s com active=%p (não booleano) → 400 sem UPDATE', async (m, url, active) => {
  const r = await request(app)[m.toLowerCase()](url).set('Authorization', `Bearer ${tok()}`).send({ active });
  expect(r.status).toBe(400);
  expect(sqlDe(/UPDATE profiles SET/)).toHaveLength(0);
});

test('admin rebaixado no banco perde o admin mesmo com token antigo de admin', async () => {
  const r = await request(app).post('/api/auth/create-user').set('Authorization', `Bearer ${tok({ sub: REBAIXADO, role: 'admin' })}`)
    .send({ name: 'X', email: 'x@x.com', password: 'Senha1234', role: 'user' });
  expect(r.status).toBe(403);
  expect(sqlDe(/INSERT INTO profiles/)).toHaveLength(0);
});

test('SSE /api/events recusa usuário desativado', async () => {
  const r = await request(app).get(`/api/events?token=${tok({ sub: DESATIVADO, role: 'user' })}`);
  expect(r.status).toBe(401);
});

test('POST /api/comissoes com tratamento de outra clínica → 400 sem INSERT', async () => {
  const r = await request(app).post('/api/comissoes').set('Authorization', `Bearer ${tok()}`)
    .send({ tratamento_id: TRAT_BETA, valor: 100, percentual: 10 });
  expect(r.status).toBe(400);
  expect(sqlDe(/INSERT INTO comissoes/)).toHaveLength(0);
});

test('CSV de relatórios neutraliza células que começam com = + - @', async () => {
  const r = await request(app).get('/api/ai/reports/export.csv').set('Authorization', `Bearer ${tok()}`);
  expect(r.status).toBe(200);
  const linha = r.text.split('\n')[1];
  expect(linha).toContain(`"'=HYPERLINK(""http://x"")"`);
  expect(linha).toContain(`"'@Dra"`);
  expect(linha).toContain(`"'+1"`);
  expect(linha).toContain(`"'-2"`);
  expect(linha).toContain('"ok"');
});

test("PUT /api/comissoes/:id com percentual '' grava null (antes 500)", async () => {
  const r = await request(app).put('/api/comissoes/c1').set('Authorization', `Bearer ${tok()}`).send({ percentual: '' });
  // UPDATE mockado devolve rowCount 0 → 404; o importante é não dar 500 e mandar null
  expect(r.status).toBe(404);
  const [up] = sqlDe(/UPDATE comissoes SET/);
  expect(up.params[0]).toBeNull();
});
