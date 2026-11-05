// Desfazer o opt-out a pedido do paciente: só admin, só na própria clínica, com registro
// de como o paciente pediu, quem desfez e quando. pool.query mockado.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '../.env') });
const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const leadA = '88888888-8888-8888-8888-888888888888';
const adminId = '44444444-4444-4444-4444-444444444444';
const token = (extra = {}) => jwt.sign({ sub: adminId, email: 'admin@clinica-a.com', role: 'admin', tenant_id: tenantA, is_super_admin: false, ...extra }, JWT_SECRET);
const auth = (extra) => ({ Authorization: `Bearer ${token(extra)}` });

describe('Opt-out: ver e desfazer a pedido do paciente', () => {
  let querySpy, sqlLog, optedOut;
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  beforeEach(() => {
    sqlLog = []; optedOut = true;
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const ok = (rows) => Promise.resolve({ rows, rowCount: rows.length });
      if (/SELECT telefone FROM crm_leads WHERE id::text = \$1 AND tenant_id = \$2/.test(text)) {
        return ok(params[0] === leadA && params[1] === tenantA ? [{ telefone: '(11) 98888-7777' }] : []);
      }
      if (/SELECT created_at, keyword FROM whatsapp_opt_outs/.test(text)) return ok(optedOut ? [{ created_at: new Date('2026-11-01'), keyword: 'SAIR' }] : []);
      if (/DELETE FROM whatsapp_opt_outs/.test(text)) return ok(optedOut ? [{ phone: '11988887777', keyword: 'SAIR', created_at: new Date('2026-11-01') }] : []);
      if (/SELECT role FROM user_roles/.test(text)) return ok([]);
      return ok([]);
    });
  });
  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });
  const q = (re) => sqlLog.filter(s => re.test(s.text));

  test('status mostra o descadastro da própria clínica', async () => {
    const res = await request(app).get('/api/whatsapp/opt-out').query({ leadId: leadA }).set(auth());
    expect(res.body).toMatchObject({ optedOut: true, keyword: 'SAIR' });
    expect(q(/FROM whatsapp_opt_outs/)[0].params[0]).toBe(tenantA);
  });

  test('admin desfaz registrando como o paciente pediu, quem e quando', async () => {
    const res = await request(app).post('/api/whatsapp/opt-out/revogar').set(auth()).send({ leadId: leadA, solicitacao: 'Pediu por telefone' });
    expect(res.status).toBe(200);
    const del = q(/DELETE FROM whatsapp_opt_outs/)[0];
    expect(del.params[0]).toBe(tenantA);
    const ins = q(/INSERT INTO whatsapp_opt_out_reversals/)[0];
    expect(ins.params[0]).toBe(tenantA);
    expect(ins.params[6]).toBe('Pediu por telefone');
    expect(ins.params[7]).toBe(adminId);
    expect(ins.params[8]).toBe('admin@clinica-a.com');
  });

  test('sem dizer como o paciente pediu: 400, nada muda', async () => {
    const res = await request(app).post('/api/whatsapp/opt-out/revogar').set(auth()).send({ leadId: leadA, solicitacao: '' });
    expect(res.status).toBe(400);
    expect(q(/DELETE FROM whatsapp_opt_outs/)).toHaveLength(0);
  });

  test('quem não é admin não desfaz', async () => {
    const res = await request(app).post('/api/whatsapp/opt-out/revogar').set(auth({ role: 'recepcionista' })).send({ leadId: leadA, solicitacao: 'Pediu no balcão' });
    expect(res.status).toBe(403);
    expect(q(/DELETE FROM whatsapp_opt_outs/)).toHaveLength(0);
  });

  test('admin da clínica B não desfaz o opt-out de conversa da clínica A', async () => {
    const res = await request(app).post('/api/whatsapp/opt-out/revogar').set(auth({ tenant_id: tenantB })).send({ leadId: leadA, solicitacao: 'Pediu por telefone' });
    expect(res.status).toBe(404);
    expect(q(/DELETE FROM whatsapp_opt_outs/)).toHaveLength(0);
  });

  test('paciente que não está descadastrado: 409 sem registro', async () => {
    optedOut = false;
    const res = await request(app).post('/api/whatsapp/opt-out/revogar').set(auth()).send({ leadId: leadA, solicitacao: 'Pediu por telefone' });
    expect(res.status).toBe(409);
    expect(q(/INSERT INTO whatsapp_opt_out_reversals/)).toHaveLength(0);
  });
});
