// Isolamento entre clínicas nas rotas administrativas legadas:
// /api/auth/users*, /api/auth/create-user, /api/auth/admin-reset-password,
// /api/auth/reset-requests e /api/debug/config.
//
// Requisitos do ambiente:
// - JWT_SECRET definido (env ou vps-api-server/.env). Sem ele o server.mjs encerra o
//   processo ao ser importado; o CI define em .github/workflows/backend-tests.yml.
// - verifyUser aceita token HS256 assinado com JWT_SECRET (LEGACY_JWT_ENABLED).
// - pool.query é mockado: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { limparCachePapel, _definirPapelParaTestes } from '../papeis.mjs';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

describe('Isolamento entre clínicas — rotas administrativas legadas', () => {
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  const adminA = '44444444-4444-4444-4444-444444444444';
  const usuarioA = '55555555-5555-5555-5555-555555555555';
  const usuarioB = '66666666-6666-6666-6666-666666666666';
  const superAdmin = '77777777-7777-7777-7777-777777777777';

  const perfis = {
    [adminA]: { id: adminA, tenant_id: tenantA, is_super_admin: false },
    [usuarioA]: { id: usuarioA, tenant_id: tenantA, is_super_admin: false },
    [usuarioB]: { id: usuarioB, tenant_id: tenantB, is_super_admin: false },
    [superAdmin]: { id: superAdmin, tenant_id: null, is_super_admin: true },
  };

  let querySpy;
  let sqlLog;

  const token = (extra = {}) => jwt.sign({
    sub: adminA,
    email: 'admin@clinica-a.com',
    role: 'admin',
    tenant_id: tenantA,
    is_super_admin: false,
    ...extra,
  }, JWT_SECRET);
  const tokenAdminA = () => token();
  const tokenSuper = () => token({ sub: superAdmin, email: 'root@plataforma.com', tenant_id: null, is_super_admin: true });
  const tokenAdminSemClinica = () => token({ tenant_id: null });

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    sqlLog = [];
    // Papel lido do banco (papeis.mjs): fixa no cache para o pool mockado.
    limparCachePapel();
    _definirPapelParaTestes(adminA, 'admin');
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      if (/SELECT id, tenant_id, COALESCE\(is_super_admin, false\) AS is_super_admin FROM profiles WHERE id = \$1/.test(text)) {
        const p = perfis[params[0]];
        return Promise.resolve({ rows: p ? [p] : [], rowCount: p ? 1 : 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });

  const chamar = (method, url, tk, body = {}) =>
    request(app)[method](url).set('Authorization', `Bearer ${tk}`).send(body);
  const gravouSenha = () => sqlLog.some(q => /UPDATE profiles SET password_hash/.test(q.text));
  const alterouPerfil = () => sqlLog.some(q => /UPDATE profiles SET/.test(q.text) || /user_roles/.test(q.text));

  describe('admin da clínica A', () => {
    test('GET /api/auth/users lista só a própria clínica, sem super-admin', async () => {
      const res = await chamar('get', '/api/auth/users', tokenAdminA());
      expect(res.status).toBe(200);
      const q = sqlLog.find(x => /FROM profiles p/.test(x.text) && /LEFT JOIN user_roles/.test(x.text));
      expect(q.text).toMatch(/WHERE p\.tenant_id = \$1 AND COALESCE\(p\.is_super_admin, false\) = false/);
      expect(q.params).toEqual([tenantA]);
    });

    test('GET /api/auth/reset-requests filtra pela clínica', async () => {
      const res = await chamar('get', '/api/auth/reset-requests', tokenAdminA());
      expect(res.status).toBe(200);
      const q = sqlLog.find(x => /FROM password_reset_requests r/.test(x.text));
      expect(q.text).toMatch(/WHERE p\.tenant_id = \$1/);
      expect(q.params).toEqual([tenantA]);
    });

    test.each([
      ['usuário da clínica B', usuarioB],
      ['super-admin', superAdmin],
      ['id inexistente', '99999999-9999-9999-9999-999999999999'],
    ])('POST /api/auth/admin-reset-password no %s retorna 404 sem trocar senha', async (_rotulo, alvo) => {
      const res = await chamar('post', '/api/auth/admin-reset-password', tokenAdminA(), { userId: alvo, newPassword: 'nova-senha-123' });
      expect(res.status).toBe(404);
      expect(gravouSenha()).toBe(false);
    });

    test('POST /api/auth/admin-reset-password no usuário da própria clínica funciona', async () => {
      const res = await chamar('post', '/api/auth/admin-reset-password', tokenAdminA(), { userId: usuarioA, newPassword: 'nova-senha-123' });
      expect(res.status).toBe(200);
      expect(gravouSenha()).toBe(true);
    });

    test.each([
      ['usuário da clínica B', usuarioB],
      ['super-admin', superAdmin],
    ])('PUT /api/auth/users/:id no %s retorna 404 sem alterar', async (_rotulo, alvo) => {
      const res = await chamar('put', `/api/auth/users/${alvo}`, tokenAdminA(), { email: 'meu@golpe.com', role: 'admin', active: false });
      expect(res.status).toBe(404);
      expect(alterouPerfil()).toBe(false);
    });

    test('PUT /api/auth/users/:id no usuário da própria clínica funciona', async () => {
      const res = await chamar('put', `/api/auth/users/${usuarioA}`, tokenAdminA(), { name: 'Novo nome', role: 'dentista' });
      expect(res.status).toBe(200);
      expect(alterouPerfil()).toBe(true);
    });

    test('PUT /api/auth/users/:id recusa perfil fora da lista', async () => {
      const res = await chamar('put', `/api/auth/users/${usuarioA}`, tokenAdminA(), { role: 'super_admin' });
      expect(res.status).toBe(400);
      expect(alterouPerfil()).toBe(false);
    });

    test('POST /api/auth/users/:userId/avatar no usuário da clínica B retorna 404', async () => {
      const res = await chamar('post', `/api/auth/users/${usuarioB}/avatar`, tokenAdminA(), { avatar: 'data:image/png;base64,AAAA' });
      expect(res.status).toBe(404);
      expect(alterouPerfil()).toBe(false);
    });

    test('POST /api/auth/create-user grava o usuário na clínica do admin', async () => {
      const res = await chamar('post', '/api/auth/create-user', tokenAdminA(), { name: 'Nova', email: 'nova@clinica-a.com', password: 'senha-123', role: 'recepcionista' });
      expect(res.status).toBe(200);
      const ins = sqlLog.find(x => /INSERT INTO profiles/.test(x.text));
      expect(ins.text).toMatch(/tenant_id/);
      expect(ins.params).toContain(tenantA);
    });

    test('POST /api/auth/create-user recusa perfil fora da lista', async () => {
      const res = await chamar('post', '/api/auth/create-user', tokenAdminA(), { name: 'X', email: 'x@a.com', password: 'senha-123', role: 'super_admin' });
      expect(res.status).toBe(400);
      expect(sqlLog.some(x => /INSERT INTO profiles/.test(x.text))).toBe(false);
    });

    test('GET /api/debug/config retorna 403', async () => {
      const res = await chamar('get', '/api/debug/config', tokenAdminA());
      expect(res.status).toBe(403);
      expect(res.body.db_host).toBeUndefined();
    });
  });

  describe('admin sem clínica', () => {
    test.each([
      ['/api/auth/users', /FROM profiles p/],
      ['/api/auth/reset-requests', /FROM password_reset_requests r/],
    ])('GET %s não devolve a visão global', async (url, re) => {
      const res = await chamar('get', url, tokenAdminSemClinica());
      expect([200, 403]).toContain(res.status);
      const q = sqlLog.find(x => re.test(x.text));
      if (q) {
        expect(q.text).toMatch(/WHERE p\.tenant_id = \$1/);
        expect(q.params[0]).not.toBe(tenantA);
        expect(q.params[0]).not.toBe(tenantB);
      }
    });

    test('POST /api/auth/create-user é recusado sem gravar', async () => {
      const res = await chamar('post', '/api/auth/create-user', tokenAdminSemClinica(), { name: 'X', email: 'x@a.com', password: 'senha-1234' });
      expect([400, 403]).toContain(res.status);
      expect(sqlLog.some(x => /INSERT INTO profiles/.test(x.text))).toBe(false);
    });
  });

  describe('super-admin', () => {
    test('GET /api/auth/users mantém visão global', async () => {
      const res = await chamar('get', '/api/auth/users', tokenSuper());
      expect(res.status).toBe(200);
      const q = sqlLog.find(x => /FROM profiles p/.test(x.text) && /LEFT JOIN user_roles/.test(x.text));
      expect(q.text).not.toMatch(/WHERE p\.tenant_id/);
    });

    test('pode resetar a senha de usuário de qualquer clínica', async () => {
      const res = await chamar('post', '/api/auth/admin-reset-password', tokenSuper(), { userId: usuarioB, newPassword: 'nova-senha-123' });
      expect(res.status).toBe(200);
      expect(gravouSenha()).toBe(true);
    });

    test('POST /api/auth/create-user sem clínica escolhida retorna 400', async () => {
      const res = await chamar('post', '/api/auth/create-user', tokenSuper(), { name: 'X', email: 'x@a.com', password: 'senha-123' });
      expect(res.status).toBe(400);
      expect(sqlLog.some(x => /INSERT INTO profiles/.test(x.text))).toBe(false);
    });

    test('GET /api/debug/config retorna 200', async () => {
      const res = await chamar('get', '/api/debug/config', tokenSuper());
      expect(res.status).toBe(200);
    });
  });

  test('sem token retorna 401', async () => {
    const res = await request(app).get('/api/auth/users');
    expect(res.status).toBe(401);
  });
});
