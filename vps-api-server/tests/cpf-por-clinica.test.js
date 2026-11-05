// CPF único por clínica: normalização na gravação e erro neutro (sem revelar outra clínica).
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
const { __paraTestes } = await import('../clinicorp.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const pacienteDaA = '33333333-3333-3333-3333-333333333333';
const leadDaA = '66666666-6666-6666-6666-666666666666';
const token = () => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'recepcao@clinica.test', role: 'admin',
  tenant_id: tenantA, is_super_admin: false,
}, JWT_SECRET);

const erroUnico = (constraint) => Object.assign(
  new Error(`duplicate key value violates unique constraint "${constraint}"`),
  { code: '23505', constraint, detail: 'Key (cpf)=(12345678900) already exists.' });

let sqlLog;
let falhaNoInsert;
let spy;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  sqlLog = []; falhaNoInsert = null;
  spy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/^(INSERT INTO|UPDATE) pacientes/.test(text.trim())) {
      if (falhaNoInsert) throw falhaNoInsert;
      return { rows: [], rowCount: 1 };
    }
    if (/FROM crm_leads WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      return params[1] === tenantA
        ? { rows: [{ id: leadDaA, nome: 'Lead Teste', telefone: null, cpf: '123.456.789-00' }] }
        : { rows: [] };
    }
    return { rows: [], rowCount: 0 };
  });
});
afterEach(() => spy.mockRestore());
afterAll(async () => { await pool.end(); });

const gravacao = () => sqlLog.find(q => /^(INSERT INTO|UPDATE) pacientes/.test(q.text.trim()));
const naoVaza = (body) => {
  const s = JSON.stringify(body);
  expect(s).not.toMatch(/pacientes_cpf_key|uq_pacientes|duplicate|Key \(|12345678900/);
};

describe('CPF por clínica', () => {
  test('POST /api/pacientes grava o CPF só com dígitos', async () => {
    const res = await request(app).post('/api/pacientes').set('Authorization', `Bearer ${token()}`)
      .send({ nome: 'Fulana', cpf: '123.456.789-00' });
    expect(res.status).toBe(200);
    expect(gravacao().params[2]).toBe('12345678900');
  });

  test('CPF vazio vira NULL', async () => {
    await request(app).put(`/api/pacientes/${pacienteDaA}`).set('Authorization', `Bearer ${token()}`)
      .send({ nome: 'Fulana', cpf: ' . - ' });
    expect(gravacao().params[1]).toBeNull();
  });

  test.each([
    ['post', '/api/pacientes'],
    ['put', `/api/pacientes/${pacienteDaA}`],
  ])('%s %s: CPF repetido na clínica → 409 com mensagem neutra', async (method, url) => {
    falhaNoInsert = erroUnico('uq_pacientes_tenant_cpf');
    const res = await request(app)[method](url).set('Authorization', `Bearer ${token()}`)
      .send({ nome: 'Fulana', cpf: '123.456.789-00' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Já existe um paciente com este CPF nesta clínica');
    naoVaza(res.body);
  });

  test('chave global antiga: 409 sem dizer que o CPF existe em outra clínica', async () => {
    falhaNoInsert = erroUnico('pacientes_cpf_key');
    const res = await request(app).post('/api/pacientes').set('Authorization', `Bearer ${token()}`)
      .send({ nome: 'Fulana', cpf: '12345678900' });
    expect(res.status).toBe(409);
    expect(res.body.error).not.toMatch(/nesta clínica|outra clínica/);
    naoVaza(res.body);
  });

  test('outro erro de banco: 500 genérico, sem error.message', async () => {
    falhaNoInsert = Object.assign(new Error('invalid input syntax for type date: "1990-13-45"'), { code: '22007' });
    const res = await request(app).post('/api/pacientes').set('Authorization', `Bearer ${token()}`)
      .send({ nome: 'Fulana', data_nascimento: '1990-13-45' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno' });
  });

  test('convert-to-patient normaliza o CPF do lead e trata 23505 sem vazar', async () => {
    const ok = await request(app).post(`/api/crm/leads/${leadDaA}/convert-to-patient`).set('Authorization', `Bearer ${token()}`);
    expect(ok.status).toBe(200);
    expect(gravacao().params[2]).toBe('12345678900');
    sqlLog = [];
    falhaNoInsert = erroUnico('uq_pacientes_tenant_cpf');
    const dup = await request(app).post(`/api/crm/leads/${leadDaA}/convert-to-patient`).set('Authorization', `Bearer ${token()}`);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('Já existe um paciente com este CPF nesta clínica');
    naoVaza(dup.body);
  });
});

describe('importação do Clinicorp', () => {
  const mockPool = (handler) => ({ query: jest.fn(async (sql, params) => handler(String(sql), params)) });

  test('busca por CPF só com dígitos, na clínica, e 23505 no INSERT não derruba a sincronização', async () => {
    const calls = [];
    const p = mockPool((sql, params) => {
      calls.push({ sql, params });
      if (/FROM clinicorp_patients WHERE id/.test(sql)) return { rows: [{ document_id: '123.456.789-00', name: 'X' }] };
      if (/^\s*INSERT INTO pacientes/.test(sql)) throw erroUnico('uq_pacientes_tenant_cpf');
      return { rows: [] };
    });
    const id = await __paraTestes.ensureLocalPatient(p, '999', {}, tenantA);
    expect(id).toBeNull();
    const busca = calls.find(c => /regexp_replace\(COALESCE\(cpf/.test(c.sql));
    expect(busca.params).toEqual(['12345678900', tenantA]);
    const ins = calls.find(c => /INSERT INTO pacientes/.test(c.sql));
    expect(ins.params[5]).toBe('12345678900');
  });

  test('UPDATE com CPF já usado na clínica: atualiza o resto sem o CPF', async () => {
    const calls = [];
    let primeira = true;
    const p = mockPool((sql, params) => {
      calls.push({ sql, params });
      if (/SELECT id FROM pacientes WHERE clinicorp_patient_id/.test(sql)) return { rows: [{ id: pacienteDaA }] };
      if (/FROM clinicorp_patients WHERE id/.test(sql)) return { rows: [{ document_id: '12345678900', name: 'X' }] };
      if (/^\s*UPDATE pacientes/.test(sql)) {
        if (primeira) { primeira = false; throw erroUnico('uq_pacientes_tenant_cpf'); }
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });
    const id = await __paraTestes.ensureLocalPatient(p, '999', {}, tenantA);
    expect(id).toBe(pacienteDaA);
    const updates = calls.filter(c => /^\s*UPDATE pacientes/.test(c.sql));
    expect(updates).toHaveLength(2);
    expect(updates[1].sql).not.toMatch(/cpf=/);
    expect(updates[1].params.at(-1)).toBe(tenantA);
  });
});
