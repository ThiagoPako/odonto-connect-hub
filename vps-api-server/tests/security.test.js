import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import { app, pool } from '../server.mjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

describe('RBAC and Tenant Isolation Security Tests', () => {
  const tenant1Id = '00000000-0000-0000-0000-000000000001';
  
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

  test('User from Tenant A should set correct DB session variables', async () => {
    const token = generateToken({
      sub: '00000000-0000-0000-0000-000000000000',
      email: 'user@tenant-a.com',
      role: 'admin',
      tenant_id: tenant1Id,
      is_super_admin: false
    });

    const querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params) => {
      // Simulate success for verifyUser and the endpoint logic
      if (sql.includes('set_config')) return Promise.resolve({ rows: [] });
      if (sql.includes('profiles')) return Promise.resolve({ rows: [{ id: '123' }] });
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    // Verify correct tenant isolation session variables
    expect(querySpy).toHaveBeenCalledWith(
      'SELECT set_config($1, $2, true)',
      ['app.current_tenant_id', tenant1Id]
    );
    expect(querySpy).toHaveBeenCalledWith(
      'SELECT set_config($1, $2, true)',
      ['app.is_super_admin', 'false']
    );

    querySpy.mockRestore();
  });

  test('Super Admin should set global access flag (is_super_admin=true) in DB session', async () => {
    const token = generateToken({
      sub: '00000000-0000-0000-0000-000000000001',
      email: 'admin@system.com',
      role: 'admin',
      tenant_id: null,
      is_super_admin: true
    });

    const querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params) => {
      if (sql.includes('set_config')) return Promise.resolve({ rows: [] });
      if (sql.includes('profiles')) return Promise.resolve({ rows: [{ id: '1', is_super_admin: true }] });
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .get('/api/auth/me') 
      .set('Authorization', `Bearer ${token}`);

    expect(querySpy).toHaveBeenCalledWith(
      'SELECT set_config($1, $2, true)',
      ['app.is_super_admin', 'true']
    );

    querySpy.mockRestore();
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
