// GET /api/search (busca global) e /api/clinic-location (localização da clínica).
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

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const token = (extra = {}) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'recepcao@clinica-a.com',
  role: 'recepcionista', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);

let querySpy;
let sqlLog;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    sqlLog.push({ text: String(sql), params });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

describe('GET /api/search', () => {
  const buscar = (q, tk = token()) =>
    request(app).get('/api/search').query({ q }).set('Authorization', `Bearer ${tk}`);
  const buscas = () => sqlLog.filter(q => /FROM (pacientes|crm_leads|agendamentos)/.test(q.text));

  test('as três buscas filtram pela clínica do usuário, com limite total de 20', async () => {
    const res = await buscar('Maria');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pacientes: [], leads: [], agendamentos: [] });
    const qs = buscas();
    expect(qs).toHaveLength(3);
    for (const q of qs) {
      expect(q.text).toMatch(/tenant_id = \$1/);
      expect(q.params[0]).toBe(tenantA);
    }
    const total = qs.reduce((n, q) => n + Number(q.text.match(/LIMIT (\d+)/)[1]), 0);
    expect(total).toBeLessThanOrEqual(20);
  });

  test('agendamento só junta paciente e dentista da mesma clínica', async () => {
    await buscar('Maria');
    const ag = buscas().find(q => /FROM agendamentos/.test(q.text));
    expect(ag.text).toMatch(/p\.tenant_id = a\.tenant_id/);
    expect(ag.text).toMatch(/d\.tenant_id = a\.tenant_id/);
  });

  test('não devolve dado de saúde nem CPF', async () => {
    await buscar('Maria');
    for (const q of buscas()) {
      const select = q.text.split(/\bFROM\b/)[0];
      expect(select).not.toMatch(/procedimento|observac|convenio|anamnese|cpf|\*/i);
    }
  });

  test('ignora tenant enviado na query string', async () => {
    const res = await request(app).get('/api/search').query({ q: 'Maria', tenant_id: tenantB })
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    for (const q of buscas()) expect(q.params).not.toContain(tenantB);
  });

  test('escapa curingas do LIKE', async () => {
    await buscar('50%_x');
    expect(buscas()[0].params[1]).toBe('%50\\%\\_x%');
  });

  test('menos de 2 caracteres → 400 sem consultar', async () => {
    const res = await buscar('a');
    expect(res.status).toBe(400);
    expect(buscas()).toHaveLength(0);
  });

  test('sem login → 401', async () => {
    const res = await request(app).get('/api/search').query({ q: 'Maria' });
    expect(res.status).toBe(401);
  });
});

describe('/api/clinic-location', () => {
  const admin = () => token({ role: 'admin' });
  const local = { name: 'Clínica Sorriso', address: 'Rua A, 10', city: 'Campinas', state: 'sp', zip: '13000-000', phone: '', googleMapsUrl: 'https://maps.app.goo.gl/x' };
  const upsert = () => sqlLog.find(q => /INSERT INTO tenant_settings/.test(q.text));

  test('admin grava na própria clínica, com chave clinic_location', async () => {
    const res = await request(app).put('/api/clinic-location').set('Authorization', `Bearer ${admin()}`)
      .send({ ...local, tenant_id: tenantB });
    expect(res.status).toBe(200);
    const up = upsert();
    expect(up.params[0]).toBe(tenantA);
    expect(up.params[1]).toBe('clinic_location');
    const saved = JSON.parse(up.params[2]);
    expect(saved.state).toBe('SP');
    expect(saved).not.toHaveProperty('tenant_id');
  });

  test('não-admin não grava (403)', async () => {
    querySpy.mockImplementation((sql, params = []) => {
      sqlLog.push({ text: String(sql), params });
      return Promise.resolve({ rows: [], rowCount: 0 }); // user_roles sem admin
    });
    const res = await request(app).put('/api/clinic-location').set('Authorization', `Bearer ${token()}`).send(local);
    expect(res.status).toBe(403);
    expect(upsert()).toBeUndefined();
  });

  test.each([
    [{ ...local, name: ' ' }, 'sem nome'],
    [{ ...local, googleMapsUrl: 'javascript:alert(1)' }, 'link que não é https'],
  ])('valida a entrada: %#', async (body) => {
    const res = await request(app).put('/api/clinic-location').set('Authorization', `Bearer ${admin()}`).send(body);
    expect(res.status).toBe(400);
    expect(upsert()).toBeUndefined();
  });

  test('leitura usa só a clínica do usuário', async () => {
    const res = await request(app).get('/api/clinic-location').set('Authorization', `Bearer ${token({ tenant_id: tenantB })}`);
    expect(res.status).toBe(200);
    const sel = sqlLog.find(q => /FROM tenant_settings/.test(q.text));
    expect(sel.params).toEqual([tenantB, 'clinic_location']);
  });
});
