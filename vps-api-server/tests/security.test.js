import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import { app, pool } from '../server.mjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

describe('RBAC and Tenant Isolation Security Tests', () => {
  // 00000000-…-0000 e …-0001 são placeholders recusados por isValidTenantId (server.mjs):
  // o teste usa um tenant real para exercitar o contexto de clínica.
  const tenant1Id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  
  beforeAll(async () => {
    // Silence console logs during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(async () => {
    await pool.end();
  });

  const generateToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET);
  };

  // O contexto de RLS não passa mais por pool.query('SELECT set_config($1, $2, true)', ...):
  // o wrapper de pool.query abre uma conexão, faz BEGIN, grava TENANT_SET_SQL
  // [tenant, is_super_admin, is_local=true] e roda a query na MESMA conexão
  // (server.mjs, "pool.query = async"). Por isso o teste troca o Client do pool por
  // um falso que registra o que cada conexão executou; nada chega ao Postgres.
  const TENANT_SET_PREFIX = "SELECT set_config('app.tenant_id', $1, $3)";

  const withFakeClient = async (respond, fn) => {
    const calls = [];
    let nextId = 0;
    class FakeClient extends EventEmitter {
      constructor() { super(); this.connId = ++nextId; }
      connect(cb) { setImmediate(() => cb()); }
      query(text, params, cb) {
        // pg-pool.query (fora de requisição) usa o estilo callback; o wrapper usa promise.
        const sql = typeof text === 'string' ? text : text?.text;
        const values = typeof params === 'function' ? undefined : params;
        const callback = typeof params === 'function' ? params : cb;
        calls.push({ conn: this.connId, text: sql, params: values });
        const result = respond(sql, values) || { rows: [], rowCount: 0 };
        if (callback) { setImmediate(() => callback(null, result)); return undefined; }
        return Promise.resolve(result);
      }
      end(cb) { this.emit('end'); if (cb) cb(); return Promise.resolve(); }
    }
    const originalClient = pool.Client;
    pool.Client = FakeClient;
    try {
      await fn();
    } finally {
      pool.Client = originalClient;
      await Promise.all(pool._idle.map((item) => item.client.end()));
    }
    return calls;
  };

  // A query `sqlPart` tem de rodar numa conexão que, antes dela e dentro do mesmo
  // BEGIN, gravou o contexto informado.
  const expectQueryRanWithContext = (calls, sqlPart, expectedParams) => {
    const idx = calls.findIndex((c) => c.text.includes(sqlPart));
    expect(idx).toBeGreaterThan(-1);
    const conn = calls[idx].conn;
    const before = calls.slice(0, idx).filter((c) => c.conn === conn);
    const lastBegin = before.map((c) => c.text).lastIndexOf('BEGIN');
    expect(lastBegin).toBeGreaterThan(-1);
    const ctxCall = before.slice(lastBegin).find((c) => c.text.startsWith(TENANT_SET_PREFIX));
    expect(ctxCall).toBeDefined();
    expect(ctxCall.params).toEqual(expectedParams);
  };

  test('User from Tenant A should set correct DB session variables', async () => {
    const token = generateToken({
      sub: '00000000-0000-0000-0000-000000000000',
      email: 'user@tenant-a.com',
      role: 'admin',
      tenant_id: tenant1Id,
      is_super_admin: false
    });

    let response;
    const calls = await withFakeClient((sql) => {
      if (sql.includes('FROM profiles')) return { rows: [{ id: '00000000-0000-0000-0000-000000000000', tenant_id: tenant1Id }] };
      return null;
    }, async () => {
      response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
    });

    expect(response.status).toBe(200);
    // Cada query da requisição roda com app.tenant_id/app.current_tenant_id = clínica A e
    // app.is_super_admin = 'false', transação local.
    expectQueryRanWithContext(calls, 'FROM profiles', [tenant1Id, 'false', true]);
    expectQueryRanWithContext(calls, 'FROM user_roles', [tenant1Id, 'false', true]);
    // Nenhum contexto gravado com outra clínica ou com super-admin.
    const contexts = calls.filter((c) => c.text.startsWith(TENANT_SET_PREFIX));
    expect(contexts.length).toBeGreaterThan(0);
    for (const c of contexts) expect(c.params).toEqual([tenant1Id, 'false', true]);
  });

  test('Super Admin should set global access flag (is_super_admin=true) in DB session', async () => {
    const token = generateToken({
      sub: '00000000-0000-0000-0000-000000000001',
      email: 'admin@system.com',
      role: 'admin',
      tenant_id: null,
      is_super_admin: true
    });

    let response;
    const calls = await withFakeClient((sql) => {
      if (sql.includes('FROM profiles')) return { rows: [{ id: '00000000-0000-0000-0000-000000000001', is_super_admin: true }] };
      return null;
    }, async () => {
      response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
    });

    expect(response.status).toBe(200);
    expectQueryRanWithContext(calls, 'FROM profiles', ['', 'true', true]);
  });

  test('Request with invalid JWT signature should return 401', async () => {
    const invalidToken = jwt.sign(
      { sub: 'hacker', is_super_admin: true },
      'WRONG_SECRET'
    );

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${invalidToken}`);

    expect(response.status).toBe(401);
  });
});
