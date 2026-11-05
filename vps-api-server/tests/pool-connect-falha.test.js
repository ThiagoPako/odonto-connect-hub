// Rotas com transação (pool.connect): se o banco cair, respondem 500 genérico em vez de
// deixar a requisição pendurada; login/permissão e validação vêm antes de pegar conexão.
// pool.query e pool.connect mockados (nenhuma query chega ao Postgres).
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
const leadA = 'aaaaaaaa-0000-0000-0000-0000000000c1';
const procA = 'aaaaaaaa-0000-0000-0000-0000000000d1';
const token = (extra = {}) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica.com', role: 'admin',
  tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);

let querySpy, connectSpy;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql) => {
    const text = String(sql);
    if (/FROM unnest\(\$1::text\[\]\) AS l\(lead_id\)/.test(text)) return Promise.resolve({ rows: [{ lead_id: leadA }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  connectSpy = jest.spyOn(pool, 'connect').mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5433'));
});
afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('banco fora do ar no connect: 500 genérico, sem pendurar e sem vazar o erro', () => {
  test.each([
    ['post', '/api/procedimentos-catalogo', { nome: 'Profilaxia' }],
    ['put', `/api/procedimentos-catalogo/${procA}`, { nome: 'Profilaxia' }],
    ['post', '/api/auth/signup-clinic', { clinic_name: 'C', admin_name: 'A', email: 'novo@c.com', password: 'senha-12345' }],
    ['patch', '/api/super-admin/plans/p1', { nome: 'Plano' }, { is_super_admin: true, tenant_id: null }],
  ])('%s %s', async (m, url, body, extra = {}) => {
    const res = await request(app)[m](url).set(auth(token(extra))).send(body);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|5433/);
    expect(connectSpy).toHaveBeenCalled();
  }, 4000);
});

describe('permissão e validação antes de pegar conexão', () => {
  test('super-admin/plans sem super-admin → 403 sem chamar pool.connect', async () => {
    const res = await request(app).patch('/api/super-admin/plans/p1').set(auth(token())).send({ nome: 'X' });
    expect(res.status).toBe(403);
    expect(connectSpy).not.toHaveBeenCalled();
  });
  test('super-admin/plans sem campos → 400 sem conexão', async () => {
    const res = await request(app).patch('/api/super-admin/plans/p1').set(auth(token({ is_super_admin: true, tenant_id: null }))).send({});
    expect(res.status).toBe(400);
    expect(connectSpy).not.toHaveBeenCalled();
  });
  test('signup com campos faltando → 400 sem conexão', async () => {
    const res = await request(app).post('/api/auth/signup-clinic').send({ email: 'x@c.com' });
    expect(res.status).toBe(400);
    expect(connectSpy).not.toHaveBeenCalled();
  });
  test('catálogo sem login → 401 sem conexão', async () => {
    const res = await request(app).post('/api/procedimentos-catalogo').send({ nome: 'X' });
    expect(res.status).toBe(401);
    expect(connectSpy).not.toHaveBeenCalled();
  });
});

describe('ROLLBACK que falha não mascara o erro original', () => {
  test('messages/batch: erro no INSERT com ROLLBACK quebrado ainda devolve 500 e libera o cliente', async () => {
    const release = jest.fn();
    connectSpy.mockResolvedValue({
      query: jest.fn().mockImplementation((sql) => (/^(BEGIN)$/.test(String(sql)) ? Promise.resolve({}) : Promise.reject(new Error('falha')))),
      release,
    });
    const res = await request(app).post('/api/messages/batch').set(auth(token()))
      .send({ messages: [{ id: 'm1', lead_id: leadA, content: 'oi', sender: 'lead' }] });
    expect(res.status).toBe(500);
    expect(release).toHaveBeenCalled();
  }, 4000);
});

describe('PATCH /api/super-admin/plans/:id com plano inexistente', () => {
  const superAdmin = () => auth(token({ is_super_admin: true, tenant_id: null }));
  const clienteFalso = (onUpdate) => {
    const chamadas = [];
    const client = {
      query: jest.fn(async (sql) => {
        const text = String(sql);
        chamadas.push(text);
        if (/^UPDATE plans/.test(text)) return onUpdate();
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    return { client, chamadas };
  };

  test('UPDATE sem linha: 404, com ROLLBACK e cliente liberado', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [], rowCount: 0 }));
    connectSpy.mockResolvedValue(client);
    const res = await request(app).patch('/api/super-admin/plans/99999999-9999-9999-9999-999999999999').set(superAdmin()).send({ nome: 'X' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Plano não encontrado' });
    expect(chamadas).toContain('ROLLBACK');
    expect(chamadas).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('id que não é UUID (22P02): 404, não 500', async () => {
    const { client } = clienteFalso(async () => { const e = new Error('invalid input syntax for type uuid'); e.code = '22P02'; throw e; });
    connectSpy.mockResolvedValue(client);
    const res = await request(app).patch('/api/super-admin/plans/nao-existe').set(superAdmin()).send({ nome: 'X' });
    expect(res.status).toBe(404);
    expect(client.release).toHaveBeenCalled();
  });

  test('plano existente continua 200', async () => {
    const { client, chamadas } = clienteFalso(async () => ({ rows: [{ id: 'p1', nome: 'X' }], rowCount: 1 }));
    connectSpy.mockResolvedValue(client);
    const res = await request(app).patch('/api/super-admin/plans/p1').set(superAdmin()).send({ nome: 'X' });
    expect(res.status).toBe(200);
    expect(chamadas).toContain('COMMIT');
  });
});
