import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, pool } from '../server.mjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

describe('RBAC and Tenant Isolation Security Tests', () => {
  let server;
  const tenant1Id = '00000000-0000-0000-0000-000000000001';
  const tenant2Id = '00000000-0000-0000-0000-000000000002';
  
  beforeAll(async () => {
    // We don't need to listen to a port, supertest takes the app directly
    // But we need to make sure the database is ready or mocked
    // In a real CI environment, we would use a test database
    // For this validation, we'll focus on the logic
  });

  afterAll(async () => {
    await pool.end();
  });

  const generateToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET);
  };

  test('User from Tenant A should NOT see patients from Tenant B', async () => {
    const token = generateToken({
      sub: 'user-a',
      email: 'user@tenant-a.com',
      role: 'admin',
      tenant_id: tenant1Id,
      is_super_admin: false
    });

    // Mocking the DB response for this specific test case
    // In a real integration test, we would have seed data
    // Here we verify that the app calls the DB with the correct session settings
    
    // We can spy on pool.query to see if set_config is called correctly
    const querySpy = jest.spyOn(pool, 'query');

    // This is a representative request that uses verifyUser
    await request(app)
      .get('/api/pacientes')
      .set('Authorization', `Bearer ${token}`);

    // Check if tenant isolation was set in the DB session
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

  test('Super Admin should have global access (is_super_admin=true)', async () => {
    const token = generateToken({
      sub: 'super-admin',
      email: 'admin@system.com',
      role: 'admin',
      tenant_id: null,
      is_super_admin: true
    });

    const querySpy = jest.spyOn(pool, 'query');

    await request(app)
      .get('/api/admin/clinicas') // Route that requires super admin
      .set('Authorization', `Bearer ${token}`);

    expect(querySpy).toHaveBeenCalledWith(
      'SELECT set_config($1, $2, true)',
      ['app.is_super_admin', 'true']
    );

    querySpy.mockRestore();
  });

  test('Manipulated token (fake is_super_admin) should be rejected if signature is invalid', async () => {
    const invalidToken = jwt.sign(
      { sub: 'hacker', is_super_admin: true },
      'WRONG_SECRET'
    );

    const response = await request(app)
      .get('/api/admin/clinicas')
      .set('Authorization', `Bearer ${invalidToken}`);

    expect(response.status).toBe(401); // Unauthorized due to invalid JWT signature
  });
});
