// GET /api/clinicorp/tenant-status — a agenda usa para mostrar "Atualizar agenda com Clinicorp"
// só a quem tem a integração. Deve: exigir login, olhar só a clínica do usuário e devolver
// apenas um booleano (nunca token ou subscriber).
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

const tenantComIntegracao = '11111111-1111-1111-1111-111111111111';
const tenantSemIntegracao = '22222222-2222-2222-2222-222222222222';

let sqlLog;
let querySpy;
const token = (extra = {}) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'recepcao@clinica-a.com',
  role: 'recepcionista', tenant_id: tenantComIntegracao, is_super_admin: false, ...extra,
}, JWT_SECRET);
const status = (tk) => {
  const r = request(app).get('/api/clinicorp/tenant-status');
  return tk ? r.set('Authorization', `Bearer ${tk}`) : r;
};
const consultasDeCredencial = () => sqlLog.filter(q => /FROM clinicorp_user_settings s/.test(q.text));

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
    if (/FROM clinicorp_user_settings s/.test(text)) {
      const tem = params[0] === tenantComIntegracao;
      return Promise.resolve({
        rows: tem ? [{ user_id: 'u1', enabled: true, api_token: 'segredo-token', subscriber_id: 'sub-123', base_url: null, tenant_id: tenantComIntegracao }] : [],
        rowCount: tem ? 1 : 0,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

describe('GET /api/clinicorp/tenant-status', () => {
  test('sem login → 401 e nenhuma consulta de credencial', async () => {
    const res = await status();
    expect(res.status).toBe(401);
    expect(consultasDeCredencial()).toHaveLength(0);
  });

  test('clínica com integração → { configured: true }, só o booleano', async () => {
    const res = await status(token());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true });
    expect(JSON.stringify(res.body)).not.toMatch(/segredo-token|sub-123/);
  });

  test('a consulta usa a clínica do usuário logado', async () => {
    await status(token());
    const q = consultasDeCredencial();
    expect(q).toHaveLength(1);
    expect(q[0].text).toMatch(/p\.tenant_id = \$1/);
    expect(q[0].params).toEqual([tenantComIntegracao]);
  });

  test('clínica sem integração → { configured: false }', async () => {
    const res = await status(token({ tenant_id: tenantSemIntegracao }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
    expect(consultasDeCredencial()[0].params).toEqual([tenantSemIntegracao]);
  });

  test('usuário sem clínica → { configured: false } sem consultar credenciais (nada de fallback global)', async () => {
    const res = await status(token({ tenant_id: null }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
    expect(consultasDeCredencial()).toHaveLength(0);
  });
});
