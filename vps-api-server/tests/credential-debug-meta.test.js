// Regressão: getCredentialDebugMeta foi removida mas continuava chamada em
// sendEvolutionTextMessage e em /api/debug/config (ReferenceError → 500).
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

describe('getCredentialDebugMeta', () => {
  let querySpy;
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  beforeEach(() => {
    querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 });
  });
  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });

  test('/api/debug/config responde sem expor trechos da chave', async () => {
    const tk = jwt.sign({
      sub: '77777777-7777-7777-7777-777777777777', email: 'root@plataforma.com',
      role: 'admin', tenant_id: null, is_super_admin: true,
    }, process.env.JWT_SECRET);
    const res = await request(app).get('/api/debug/config').set('Authorization', `Bearer ${tk}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.evolution_api_key).sort()).toEqual(['length', 'present']);
  });
});
