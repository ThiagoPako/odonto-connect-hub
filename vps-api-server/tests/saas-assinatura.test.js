// Camada SaaS: limite de usuários do plano no backend, troca de plano, rotas do super-admin
// (status/erros/registro), acesso do super-admin a outra clínica com rastro, base_url da
// Clinicorp só para a API oficial (SSRF) e migrações que rodam a cada deploy.
//
// pool.query é mockado: nenhuma query chega ao Postgres. JWT_SECRET vem do env/.env (CI define).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const { clinicorpBaseUrlPermitida, clinicorpBaseUrlSegura } = await import('../clinicorp.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const adminA = '44444444-4444-4444-4444-444444444444';
const inativoA = '55555555-5555-5555-5555-555555555555';
const superAdmin = '77777777-7777-7777-7777-777777777777';

const token = (extra = {}) => jwt.sign({
  sub: adminA, email: 'admin@clinica-a.com', role: 'admin', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);
const tkAdminA = () => token();
const tkRecepA = () => token({ role: 'recepcionista' });
const tkSuper = () => token({ sub: superAdmin, email: 'root@plataforma.com', tenant_id: null, is_super_admin: true });

// Estado do "banco" de cada teste.
let db;
let sqlLog;
let querySpy;
let logSpy;
let warnSpy;

function resposta(text, params) {
  if (/SELECT id, tenant_id, COALESCE\(is_super_admin, false\) AS is_super_admin FROM profiles WHERE id = \$1/.test(text)) {
    const p = { [adminA]: { id: adminA, tenant_id: tenantA, is_super_admin: false }, [inativoA]: { id: inativoA, tenant_id: tenantA, is_super_admin: false } }[params[0]];
    return { rows: p ? [p] : [] };
  }
  if (/SELECT pl\.max_usuarios FROM tenants t/.test(text)) return { rows: [{ max_usuarios: db.maxUsuarios }] };
  if (/SELECT COUNT\(\*\)::int AS c FROM profiles/.test(text)) return { rows: [{ c: db.ativos }] };
  if (/SELECT COALESCE\(active, true\) AS active FROM profiles WHERE id = \$1/.test(text)) return { rows: [{ active: params[0] !== inativoA }] };
  if (/SELECT \* FROM plans WHERE slug = \$1 AND ativo = true/.test(text)) {
    const plano = db.planos[params[0]];
    return { rows: plano ? [plano] : [] };
  }
  if (/UPDATE tenants SET/.test(text)) {
    if (db.erroUpdate) { const e = new Error('new row for relation "tenants" violates check constraint'); e.code = db.erroUpdate; throw e; }
    return db.tenantExiste ? { rows: [{ id: params[params.length - 1] }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => {
  db = {
    maxUsuarios: 3, ativos: 3, tenantExiste: true, erroUpdate: null,
    planos: {
      starter: { id: 'p1', slug: 'starter', nome: 'Starter', max_usuarios: 3 },
      enterprise: { id: 'p3', slug: 'enterprise', nome: 'Enterprise', max_usuarios: null },
    },
  };
  sqlLog = [];
  querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    return resposta(text, params);
  });
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => { querySpy.mockRestore(); logSpy.mockRestore(); warnSpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

const chamar = (method, url, tk, body = {}, headers = {}) => {
  let r = request(app)[method](url);
  if (tk) r = r.set('Authorization', `Bearer ${tk}`);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(body);
};
const houve = (re) => sqlLog.some(q => re.test(q.text));
const logou = (spy, re) => spy.mock.calls.some(args => re.test(args.map(String).join(' ')));

describe('limite de usuários do plano (backend)', () => {
  test('POST /api/auth/create-user recusa acima do limite e não grava', async () => {
    const res = await chamar('post', '/api/auth/create-user', tkAdminA(), { name: 'X', email: 'x@a.com', password: 'Senha@1234' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Limite de 3 usuários/);
    expect(houve(/INSERT INTO profiles/)).toBe(false);
  });

  test('POST /api/auth/create-user passa abaixo do limite', async () => {
    db.ativos = 2;
    const res = await chamar('post', '/api/auth/create-user', tkAdminA(), { name: 'X', email: 'x@a.com', password: 'Senha@1234' });
    expect(res.status).toBe(200);
    expect(houve(/INSERT INTO profiles/)).toBe(true);
  });

  test('POST /api/my-tenant/users continua recusando acima do limite', async () => {
    const res = await chamar('post', '/api/my-tenant/users', tkAdminA(), { name: 'X', email: 'x@a.com', password: 'Senha@1234' });
    expect(res.status).toBe(403);
    expect(houve(/INSERT INTO profiles/)).toBe(false);
  });

  test.each([
    ['PATCH /api/my-tenant/users/:id', 'patch', `/api/my-tenant/users/${inativoA}`],
    ['PUT /api/auth/users/:id', 'put', `/api/auth/users/${inativoA}`],
  ])('%s: reativar usuário acima do limite é recusado', async (_n, method, url) => {
    const res = await chamar(method, url, tkAdminA(), { active: true });
    expect(res.status).toBe(403);
    expect(houve(/UPDATE profiles SET/)).toBe(false);
  });

  test('ilimitado (max_usuarios NULL) não bloqueia', async () => {
    db.maxUsuarios = null; db.ativos = 99;
    const res = await chamar('post', '/api/auth/create-user', tkAdminA(), { name: 'X', email: 'x@a.com', password: 'Senha@1234' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/my-tenant/change-plan', () => {
  test('rebaixar com mais usuários ativos que o novo plano permite → 409 sem UPDATE', async () => {
    db.ativos = 5;
    const res = await chamar('post', '/api/my-tenant/change-plan', tkAdminA(), { plan_slug: 'starter' });
    expect(res.status).toBe(409);
    expect(houve(/UPDATE tenants SET plan_id/)).toBe(false);
  });

  test('troca válida grava na clínica do token e deixa registro', async () => {
    const res = await chamar('post', '/api/my-tenant/change-plan', tkAdminA(), { plan_slug: 'enterprise' });
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /UPDATE tenants SET plan_id/.test(x.text));
    expect(q.params).toEqual(['p3', tenantA]);
    expect(logou(logSpy, /\[AUDIT saas\] troca de plano clinica=11111111/)).toBe(true);
  });

  test('não admin → 403; admin sem clínica → 404', async () => {
    expect((await chamar('post', '/api/my-tenant/change-plan', tkRecepA(), { plan_slug: 'enterprise' })).status).toBe(403);
    expect((await chamar('post', '/api/my-tenant/change-plan', token({ tenant_id: null }), { plan_slug: 'enterprise' })).status).toBe(404);
  });
});

describe('super-admin', () => {
  const url = `/api/super-admin/tenants/${tenantB}`;

  test('PATCH com status fora da lista → 400 sem UPDATE', async () => {
    const res = await chamar('patch', url, tkSuper(), { status: 'xyz' });
    expect(res.status).toBe(400);
    expect(houve(/UPDATE tenants SET/)).toBe(false);
  });

  test('PATCH com id inválido ou inexistente → 404', async () => {
    expect((await chamar('patch', '/api/super-admin/tenants/nao-e-uuid', tkSuper(), { status: 'active' })).status).toBe(404);
    db.tenantExiste = false;
    expect((await chamar('patch', url, tkSuper(), { status: 'active' })).status).toBe(404);
  });

  test('erro do banco não vaza texto do Postgres', async () => {
    db.erroUpdate = '23514';
    const res = await chamar('patch', url, tkSuper(), { trial_ends_at: '2026-12-01' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/relation|constraint/);
  });

  test('PATCH válido deixa registro com quem alterou', async () => {
    const res = await chamar('patch', url, tkSuper(), { status: 'suspended' });
    expect(res.status).toBe(200);
    expect(logou(logSpy, new RegExp(`\\[AUDIT super-admin\\] alterou clinica=${tenantB} actor=${superAdmin} status=suspended`))).toBe(true);
  });

  test.each([
    ['get', '/api/super-admin/stats'],
    ['get', '/api/super-admin/tenants'],
    ['get', '/api/super-admin/plans'],
    ['patch', url],
  ])('%s %s: admin de clínica → 403 (não 500)', async (method, u) => {
    const res = await chamar(method, u, tkAdminA(), { status: 'active' });
    expect(res.status).toBe(403);
  });

  test('sem token → 401', async () => {
    expect((await chamar('get', '/api/super-admin/tenants')).status).toBe(401);
  });

  test('super-admin entrando em outra clínica pelo X-Tenant-Id deixa rastro sem query string', async () => {
    await chamar('get', '/api/my-tenant?x=paciente', tkSuper(), {}, { 'x-tenant-id': tenantB });
    expect(logou(warnSpy, new RegExp(`\\[AUDIT super-admin\\] user=${superAdmin} clinica=${tenantB} GET /api/my-tenant$`))).toBe(true);
  });

  test('admin da própria clínica não gera esse rastro', async () => {
    await chamar('get', '/api/my-tenant', tkAdminA(), {}, { 'x-tenant-id': tenantA });
    expect(logou(warnSpy, /\[AUDIT super-admin\]/)).toBe(false);
  });
});

describe('Clinicorp: base_url só da API oficial (SSRF)', () => {
  test.each([
    ['https://api.clinicorp.com/rest/v1', true],
    ['https://API.clinicorp.com/rest/v1/', true],
    ['http://api.clinicorp.com/rest/v1', false],
    ['https://169.254.169.254/latest', false],
    ['https://localhost:3002/api', false],
    ['https://api.clinicorp.com.evil.test/rest/v1', false],
    ['https://user:pw@api.clinicorp.com/rest/v1', false],
    ['https://api.clinicorp.com:8443/rest/v1', false],
    ['não é url', false],
  ])('%s → %s', (u, ok) => {
    expect(clinicorpBaseUrlPermitida(u)).toBe(ok);
  });

  test('base_url antiga fora da lista cai no padrão em vez de ser usada', () => {
    expect(clinicorpBaseUrlSegura('http://127.0.0.1:6379')).toBe('https://api.clinicorp.com/rest/v1');
    expect(clinicorpBaseUrlSegura(null)).toBe('https://api.clinicorp.com/rest/v1');
  });

  test('PUT my-settings e teste de conexão recusam host interno', async () => {
    const put = await chamar('put', '/api/clinicorp/my-settings', tkAdminA(), { base_url: 'http://127.0.0.1:6379/' });
    expect(put.status).toBe(400);
    expect(houve(/INSERT INTO clinicorp_user_settings/)).toBe(false);
    const t = await chamar('post', '/api/clinicorp/my-settings/test', tkAdminA(), { api_token: 't', subscriber_id: 's', base_url: 'https://169.254.169.254/' });
    expect(t.status).toBe(400);
  });
});

describe('migrações que rodam a cada deploy/boot', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--') && !l.trim().startsWith('//')).join('\n');

  test('migration.sql não cria usuário com senha padrão', () => {
    expect(ler('migration.sql')).not.toMatch(/admin@odontoconnect\.tech/);
  });

  test('migration-saas.sql não promove super-admin nem joga NULL na clínica placeholder', () => {
    const s = ler('migration-saas.sql');
    expect(s).not.toMatch(/is_super_admin\s*=\s*true/i);
    expect(s).not.toMatch(/UPDATE[^;]*SET tenant_id\s*=[^;]*0001[^;]*WHERE tenant_id IS NULL/i);
  });

  test('boot do server.mjs não dá financeiro sem dono para a clínica do admin mais antigo', () => {
    expect(ler('server.mjs')).not.toMatch(/role = 'admin' ORDER BY created_at ASC LIMIT 1\) WHERE tenant_id IS NULL/);
  });
});
