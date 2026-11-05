// Clinicorp com mais de uma clínica: regras de conflito por clínica e upsert pelos índices novos.
// pool.query é mockado; nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const { __paraTestesMultiClinica } = await import('../clinicorp.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(async () => { await pool.end(); });

describe('resolveConflictPolicy por clínica', () => {
  const { resolveConflictPolicy } = __paraTestesMultiClinica;

  test('lê só regras da plataforma e da própria clínica; a da clínica vence no mesmo escopo', async () => {
    const calls = [];
    const p = { query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [
        { scope_type: 'global', scope_id: null, keep_local: false, conflict_strategy: 'local_wins', tenant_id: tenantA },
        { scope_type: 'global', scope_id: null, keep_local: false, conflict_strategy: 'clinicorp_wins', tenant_id: null },
      ] };
    }) };
    const r = await resolveConflictPolicy(p, { clinicId: 10, professionalId: 20, tenantId: tenantA });
    expect(calls[0].sql).toMatch(/tenant_id IS NULL OR tenant_id = \$3/);
    expect(calls[0].params).toEqual(['10', '20', tenantA]);
    expect(r.strategy).toBe('local_wins');
  });

  test('regra de escopo mais específico (profissional) vence a global da clínica', async () => {
    const p = { query: jest.fn(async () => ({ rows: [
      { scope_type: 'professional', scope_id: '20', keep_local: false, conflict_strategy: 'newest_wins', tenant_id: null },
      { scope_type: 'global', scope_id: null, keep_local: false, conflict_strategy: 'local_wins', tenant_id: tenantA },
    ] })) };
    const r = await resolveConflictPolicy(p, { professionalId: 20, tenantId: tenantA });
    expect(r.strategy).toBe('newest_wins');
    expect(r.scopeType).toBe('professional');
  });

  test('banco sem a coluna tenant_id (antes da migração): cai para as regras da plataforma', async () => {
    let n = 0;
    const p = { query: jest.fn(async (sql, params) => {
      n++;
      if (n === 1) throw Object.assign(new Error('column "tenant_id" does not exist'), { code: '42703' });
      expect(sql).not.toMatch(/tenant_id = \$3/);
      expect(params).toHaveLength(2);
      return { rows: [] };
    }) };
    const r = await resolveConflictPolicy(p, { tenantId: tenantA });
    expect(r.strategy).toBe('newest_wins');
    expect(n).toBe(2);
  });
});

describe('PUT /api/clinicorp/overrides', () => {
  const tokenSuper = () => jwt.sign({ sub: '99999999-9999-9999-9999-999999999999', email: 's@x.test', role: 'admin', tenant_id: null, is_super_admin: true }, JWT_SECRET);
  const tokenAdminA = () => jwt.sign({ sub: '44444444-4444-4444-4444-444444444444', email: 'a@x.test', role: 'admin', tenant_id: tenantA, is_super_admin: false }, JWT_SECRET);
  let sqlLog, spy;
  beforeEach(() => {
    sqlLog = [];
    spy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      if (/SELECT 1 FROM tenants WHERE id = \$1/.test(text)) return { rows: params[0] === tenantB ? [{ '?column?': 1 }] : [] };
      if (/INSERT INTO clinicorp_local_overrides/.test(text)) return { rows: [{ id: 1, tenant_id: params[5], scope_type: params[0] }] };
      return { rows: [] };
    });
  });
  afterEach(() => spy.mockRestore());

  test('super-admin grava regra de uma clínica, com ON CONFLICT no índice por clínica', async () => {
    const res = await request(app).put('/api/clinicorp/overrides').set('Authorization', `Bearer ${tokenSuper()}`)
      .send({ scope_type: 'global', conflict_strategy: 'local_wins', tenant_id: tenantB });
    expect(res.status).toBe(200);
    const ins = sqlLog.find(q => /INSERT INTO clinicorp_local_overrides/.test(q.text));
    expect(ins.text).toMatch(/ON CONFLICT \(\(COALESCE\(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid\)\), scope_type, \(COALESCE\(scope_id,''\)\)\)/);
    expect(ins.params[5]).toBe(tenantB);
    const prev = sqlLog.find(q => /SELECT \* FROM clinicorp_local_overrides/.test(q.text));
    expect(prev.text).toMatch(/tenant_id IS NOT DISTINCT FROM \$3/);
    const hist = sqlLog.find(q => /INSERT INTO clinicorp_override_history/.test(q.text));
    expect(hist.params[10]).toBe(tenantB);
  });

  test('sem tenant_id vira regra da plataforma (NULL), como hoje', async () => {
    const res = await request(app).put('/api/clinicorp/overrides').set('Authorization', `Bearer ${tokenSuper()}`)
      .send({ scope_type: 'global', conflict_strategy: 'newest_wins' });
    expect(res.status).toBe(200);
    expect(sqlLog.find(q => /INSERT INTO clinicorp_local_overrides/.test(q.text)).params[5]).toBeNull();
  });

  test('clínica inexistente: 404 sem gravar; tenant_id inválido: 400', async () => {
    const r1 = await request(app).put('/api/clinicorp/overrides').set('Authorization', `Bearer ${tokenSuper()}`)
      .send({ scope_type: 'global', conflict_strategy: 'newest_wins', tenant_id: tenantA });
    expect(r1.status).toBe(404);
    const r2 = await request(app).put('/api/clinicorp/overrides').set('Authorization', `Bearer ${tokenSuper()}`)
      .send({ scope_type: 'global', conflict_strategy: 'newest_wins', tenant_id: 'x' });
    expect(r2.status).toBe(400);
    expect(sqlLog.some(q => /INSERT INTO clinicorp_local_overrides/.test(q.text))).toBe(false);
  });

  test('sem o índice por clínica (42P10): regra da plataforma usa o ON CONFLICT antigo; regra de clínica dá 503', async () => {
    spy.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      if (/SELECT 1 FROM tenants WHERE id = \$1/.test(text)) return { rows: [{ '?column?': 1 }] };
      if (/INSERT INTO clinicorp_local_overrides/.test(text)) {
        if (/COALESCE\(tenant_id/.test(text)) throw Object.assign(new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'), { code: '42P10' });
        return { rows: [{ id: 1, tenant_id: null, scope_type: params[0] }] };
      }
      return { rows: [] };
    });
    const plat = await request(app).put('/api/clinicorp/overrides').set('Authorization', `Bearer ${tokenSuper()}`)
      .send({ scope_type: 'global', conflict_strategy: 'newest_wins' });
    expect(plat.status).toBe(200);
    const ins = sqlLog.filter(q => /INSERT INTO clinicorp_local_overrides/.test(q.text));
    expect(ins[1].text).toMatch(/ON CONFLICT \(scope_type, COALESCE\(scope_id,''\)\)/);
    sqlLog = [];
    const cli = await request(app).put('/api/clinicorp/overrides').set('Authorization', `Bearer ${tokenSuper()}`)
      .send({ scope_type: 'global', conflict_strategy: 'local_wins', tenant_id: tenantB });
    expect(cli.status).toBe(503);
    expect(sqlLog.filter(q => /INSERT INTO clinicorp_local_overrides/.test(q.text))).toHaveLength(1);
  });

  test('admin de clínica não altera regras (403)', async () => {
    const res = await request(app).put('/api/clinicorp/overrides').set('Authorization', `Bearer ${tokenAdminA()}`)
      .send({ scope_type: 'global', conflict_strategy: 'local_wins', tenant_id: tenantA });
    expect(res.status).toBe(403);
    expect(sqlLog.some(q => /INSERT INTO clinicorp_local_overrides/.test(q.text))).toBe(false);
  });

  test('GET com tenant_id lista só a clínica e a plataforma', async () => {
    const res = await request(app).get(`/api/clinicorp/overrides?tenant_id=${tenantB}`).set('Authorization', `Bearer ${tokenSuper()}`);
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /FROM clinicorp_local_overrides/.test(x.text));
    expect(q.text).toMatch(/WHERE tenant_id IS NULL OR tenant_id = \$1/);
    expect(q.params).toEqual([tenantB]);
  });
});
