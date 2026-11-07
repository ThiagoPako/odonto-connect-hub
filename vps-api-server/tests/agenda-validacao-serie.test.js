// Agenda: validação de data/hora (antes "07/11/2026" virava 11 de julho e "25:99" dava 500),
// filtros do GET com formato inválido e exclusão de série que preserva o histórico.
//
// Mesmos requisitos de agenda-nomes-isolamento.test.js: JWT_SECRET definido e pool.query
// mockado (nenhuma query chega ao Postgres).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const agendamentoDaA = '55555555-5555-5555-5555-555555555555';
const serieDaA = '77777777-7777-7777-7777-777777777777';

const auth = () => `Bearer ${jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'recepcao@clinica.com', role: 'recepcionista',
  tenant_id: tenantA, is_super_admin: false,
}, JWT_SECRET)}`;

let sqlLog;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  sqlLog = [];
  jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/SELECT serie_id, data FROM agendamentos WHERE id=\$1 AND tenant_id=\$2/.test(text)) {
      const ok = params[0] === agendamentoDaA && params[1] === tenantA;
      return Promise.resolve({ rows: ok ? [{ serie_id: serieDaA, data: '2026-11-14' }] : [] });
    }
    if (/^\s*DELETE FROM agendamentos/.test(text)) return Promise.resolve({ rows: [], rowCount: 2 });
    if (/^\s*UPDATE agendamentos SET/.test(text)) {
      return Promise.resolve({ rows: [{ id: agendamentoDaA, data: '2026-11-14', paciente_id: null, status: 'agendado' }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});
afterEach(() => jest.restoreAllMocks());

const insertsAgenda = () => sqlLog.filter((q) => /INSERT INTO agendamentos/.test(q.text));
const updatesAgenda = () => sqlLog.filter((q) => /^\s*UPDATE agendamentos SET/.test(q.text));

describe('POST /api/agenda valida data e hora', () => {
  test.each([
    ['07/11/2026', '10:00'],
    ['2026-02-30', '10:00'],
    ['2026-11-12', '25:99'],
    ['2026-11-12', ''],
    ['', '10:00'],
  ])('data=%s hora=%s → 400 sem gravar', async (data, hora) => {
    const res = await request(app).post('/api/agenda').set('Authorization', auth()).send({ data, hora });
    expect(res.status).toBe(400);
    expect(insertsAgenda()).toHaveLength(0);
  });

  test('data e hora válidas gravam', async () => {
    const res = await request(app).post('/api/agenda').set('Authorization', auth())
      .send({ data: '2026-11-12', hora: '09:30', evento_titulo: 'Reunião', tipo: 'evento', escopo: 'clinica' });
    expect(res.status).toBe(200);
    expect(insertsAgenda()).toHaveLength(1);
  });
});

describe('PUT /api/agenda/:id valida data e hora e grava a categoria', () => {
  test('hora inválida → 400 sem UPDATE', async () => {
    const res = await request(app).put(`/api/agenda/${agendamentoDaA}`).set('Authorization', auth()).send({ hora: '25:99' });
    expect(res.status).toBe(400);
    expect(updatesAgenda()).toHaveLength(0);
  });
  test('data em formato brasileiro → 400', async () => {
    const res = await request(app).put(`/api/agenda/${agendamentoDaA}`).set('Authorization', auth()).send({ data: '14/11/2026' });
    expect(res.status).toBe(400);
    expect(updatesAgenda()).toHaveLength(0);
  });
  test('categoria e cor da categoria entram no UPDATE (antes eram ignoradas)', async () => {
    const res = await request(app).put(`/api/agenda/${agendamentoDaA}`).set('Authorization', auth())
      .send({ categoria: 'Cirurgia', categoria_cor: '#ff0000' });
    expect(res.status).toBe(200);
    const [up] = updatesAgenda();
    expect(up.text).toMatch(/categoria = \$\d+/);
    expect(up.text).toMatch(/categoria_cor = \$\d+/);
    expect(up.params).toEqual(expect.arrayContaining(['Cirurgia', '#ff0000', agendamentoDaA, tenantA]));
  });
});

describe('GET /api/agenda com filtro inválido', () => {
  test.each([
    ['data_inicio=abc'],
    ['data_fim=2026-13-01'],
    ['dentista_id=__sem_dentista__'],
  ])('%s → 400 (antes 500 com erro do banco)', async (qs) => {
    const res = await request(app).get(`/api/agenda?${qs}`).set('Authorization', auth());
    expect(res.status).toBe(400);
    expect(sqlLog.filter((q) => /FROM agendamentos a/.test(q.text))).toHaveLength(0);
  });
});

describe('DELETE /api/agenda/:id?serie=true preserva o histórico', () => {
  test('apaga só desta data em diante, sem tocar nas sessões atendidas, e na clínica do usuário', async () => {
    const res = await request(app).delete(`/api/agenda/${agendamentoDaA}?serie=true`).set('Authorization', auth());
    expect(res.status).toBe(200);
    const del = sqlLog.find((q) => /^\s*DELETE FROM agendamentos/.test(q.text));
    expect(del.text).toMatch(/serie_id\s*=\s*\$1/);
    expect(del.text).toMatch(/tenant_id\s*=\s*\$2/);
    expect(del.text).toMatch(/data\s*>=\s*\$3/);
    expect(del.text).toMatch(/NOT IN \('finalizado', 'realizado', 'em_atendimento', 'faltou'\)/);
    expect(del.params).toEqual([serieDaA, tenantA, '2026-11-14']);
  });
  test('agendamento de outra clínica → 404 e nada apagado', async () => {
    const res = await request(app).delete(`/api/agenda/99999999-9999-9999-9999-999999999999?serie=true`).set('Authorization', auth());
    expect(res.status).toBe(404);
    expect(sqlLog.filter((q) => /^\s*DELETE FROM agendamentos/.test(q.text))).toHaveLength(0);
  });
});
