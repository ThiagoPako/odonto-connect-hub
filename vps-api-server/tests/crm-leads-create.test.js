// POST /api/crm/leads — cadastro manual de lead (botão "Novo lead" do CRM).
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

describe('POST /api/crm/leads', () => {
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  const telefoneJaCadastrado = '5511988887777';
  let querySpy;
  let sqlLog;

  const token = (extra = {}) => jwt.sign({
    sub: '44444444-4444-4444-4444-444444444444', email: 'recepcao@clinica-a.com',
    role: 'recepcionista', tenant_id: tenantA, is_super_admin: false, ...extra,
  }, JWT_SECRET);

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
      if (/SELECT id FROM crm_leads/.test(text)) {
        const dup = params[0] === tenantA && telefoneJaCadastrado.endsWith(params[1]);
        return Promise.resolve({ rows: dup ? [{ id: 'lead-existente' }] : [], rowCount: dup ? 1 : 0 });
      }
      if (/INSERT INTO crm_leads/.test(text)) {
        return Promise.resolve({ rows: [{ id: params[0], nome: params[1], kanban_stage: params[5] }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });

  const criar = (body, tk = token()) =>
    request(app).post('/api/crm/leads').set('Authorization', `Bearer ${tk}`).send(body);
  const insert = () => sqlLog.find(q => /INSERT INTO crm_leads/.test(q.text));

  test('cria o lead na clínica do usuário e devolve o id', async () => {
    const res = await criar({ nome: '  Maria Souza ', telefone: '(11) 97777-6666', email: 'MARIA@ex.com', origem: 'Instagram', value: 1500 });
    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
    const ins = insert();
    expect(ins.params.slice(1, 8)).toEqual(['Maria Souza', '(11) 97777-6666', 'maria@ex.com', 'Instagram', 'lead', 1500, tenantA]);
  });

  test('ignora tenant enviado no corpo', async () => {
    const res = await criar({ nome: 'X', tenant_id: tenantB, tenantId: tenantB });
    expect(res.status).toBe(201);
    expect(insert().params[7]).toBe(tenantA);
  });

  test('telefone já cadastrado na clínica retorna 409 sem inserir', async () => {
    const res = await criar({ nome: 'Duplicado', telefone: '+55 11 98888-7777' });
    expect(res.status).toBe(409);
    expect(insert()).toBeUndefined();
  });

  test.each([
    [{}, 'sem nome'],
    [{ nome: '   ' }, 'nome vazio'],
    [{ nome: 'X', telefone: '123' }, 'telefone curto'],
    [{ nome: 'X', email: 'sem-arroba' }, 'e-mail inválido'],
    [{ nome: 'X', stage: 'etapa-inventada' }, 'etapa inválida'],
    [{ nome: 'X', value: -10 }, 'valor negativo'],
  ])('%j (%s) retorna 400', async (body) => {
    const res = await criar(body);
    expect(res.status).toBe(400);
    expect(insert()).toBeUndefined();
  });

  test('usuário sem clínica retorna 403', async () => {
    const res = await criar({ nome: 'X' }, token({ tenant_id: null }));
    expect(res.status).toBe(403);
    expect(insert()).toBeUndefined();
  });

  test('sem token retorna 401', async () => {
    const res = await request(app).post('/api/crm/leads').send({ nome: 'X' });
    expect(res.status).toBe(401);
  });
});
