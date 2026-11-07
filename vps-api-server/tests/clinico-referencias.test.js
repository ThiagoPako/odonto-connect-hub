// Módulo clínico — auditoria de 07/11/2026 (docs/modulos/clinico.md):
// 1) ids recebidos no corpo (dentista, paciente, agendamento, relatório) precisam ser da
//    clínica do usuário em prontuários, etapas de tratamento e consultas;
// 2) a consulta salva com o id do agendamento passa a apontar para o paciente real;
// 3) o CSV de relatórios clínicos não aceita mais o JWT na URL (?token=).
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
const pacienteA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const pacienteB = 'bbbbbbbb-0000-4000-8000-00000000000b';
const dentistaA = 'aaaaaaaa-0000-4000-8000-0000000000da';
const dentistaB = 'bbbbbbbb-0000-4000-8000-0000000000db';
const agendaAComPaciente = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const agendaASemPaciente = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const agendaB = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const relatorioA = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const relatorioB = 'bbbbbbbb-0000-4000-8000-0000000000c2';

const donos = {
  pacientes: { [pacienteA]: tenantA, [pacienteB]: tenantB },
  dentistas: { [dentistaA]: tenantA, [dentistaB]: tenantB },
  clinical_reports: { [relatorioA]: tenantA, [relatorioB]: tenantB },
};
const agendas = {
  [agendaAComPaciente]: { tenant: tenantA, paciente_id: pacienteA },
  [agendaASemPaciente]: { tenant: tenantA, paciente_id: null },
  [agendaB]: { tenant: tenantB, paciente_id: pacienteB },
};

let sqlLog;
let querySpy;
const token = (extra = {}) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'dentista@clinica-a.com',
  role: 'admin', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);
const chamar = (method, url, body = {}, tk = token()) =>
  request(app)[method](url).set('Authorization', `Bearer ${tk}`).send(body);
const gravou = (re) => sqlLog.some(q => re.test(q.text));
const insertConsulta = () => sqlLog.find(q => /INSERT INTO consultations/.test(q.text));

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
    const ref = text.match(/SELECT 1 FROM (pacientes|dentistas|clinical_reports) WHERE id ?= ?\$1 AND tenant_id ?= ?\$2/);
    if (ref) {
      const ok = donos[ref[1]][params[0]] === params[1];
      return Promise.resolve({ rows: ok ? [{ '?column?': 1 }] : [], rowCount: ok ? 1 : 0 });
    }
    if (/SELECT paciente_id FROM agendamentos WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      const ag = agendas[params[0]];
      const ok = ag && ag.tenant === params[1];
      return Promise.resolve({ rows: ok ? [{ paciente_id: ag.paciente_id }] : [], rowCount: ok ? 1 : 0 });
    }
    if (/SELECT 1 FROM tratamentos WHERE id=\$1 AND tenant_id=\$2/.test(text)) {
      return Promise.resolve({ rows: [{ '?column?': 1 }], rowCount: 1 });
    }
    if (/INSERT INTO consultations/.test(text)) {
      return Promise.resolve({ rows: [{ id: 'c1', finished_at: '2026-11-07T10:00:00Z' }], rowCount: 1 });
    }
    if (/^\s*UPDATE tratamento_etapas/.test(text)) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

describe('dentista de outra clínica no corpo → 400 sem gravar', () => {
  test.each([
    ['post', '/api/prontuarios', { paciente_id: pacienteA, dentista_id: dentistaB, descricao: 'Evolução' }, /INSERT INTO prontuarios/],
    ['post', '/api/tratamentos/tr1/etapas', { descricao: 'Etapa', dentista_id: dentistaB }, /INSERT INTO tratamento_etapas/],
    ['put', '/api/tratamentos/etapas/et1', { dentista_id: dentistaB }, /UPDATE tratamento_etapas/],
  ])('%s %s', async (method, url, body, escrita) => {
    const res = await chamar(method, url, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Dentista não encontrado');
    expect(gravou(escrita)).toBe(false);
  });

  test.each([
    ['post', '/api/prontuarios', { paciente_id: pacienteA, dentista_id: dentistaA, descricao: 'Evolução' }, /INSERT INTO prontuarios/],
    ['post', '/api/tratamentos/tr1/etapas', { descricao: 'Etapa', dentista_id: dentistaA }, /INSERT INTO tratamento_etapas/],
    ['post', '/api/tratamentos/tr1/etapas', { descricao: 'Etapa sem dentista' }, /INSERT INTO tratamento_etapas/],
    ['put', '/api/tratamentos/etapas/et1', { dentista_id: dentistaA }, /UPDATE tratamento_etapas/],
  ])('%s %s com dentista da própria clínica (ou sem) continua gravando', async (method, url, body, escrita) => {
    const res = await chamar(method, url, body);
    expect(res.status).toBe(200);
    expect(gravou(escrita)).toBe(true);
  });
});

describe('POST /api/consultations', () => {
  test('paciente da própria clínica grava com o id do paciente', async () => {
    const res = await chamar('post', '/api/consultations', { patient_id: pacienteA, appointment_id: agendaAComPaciente });
    expect(res.status).toBe(200);
    const ins = insertConsulta();
    expect(ins.params[0]).toBe(pacienteA);
    expect(ins.params[2]).toBe(agendaAComPaciente);
    expect(ins.params[ins.params.length - 1]).toBe(tenantA);
  });

  test.each([
    ['paciente de outra clínica', { patient_id: pacienteB }],
    ['agendamento de outra clínica', { patient_id: agendaB }],
    ['id inventado', { patient_id: 'nao-existe' }],
  ])('%s → 404 sem gravar', async (_nome, body) => {
    const res = await chamar('post', '/api/consultations', body);
    expect(res.status).toBe(404);
    expect(insertConsulta()).toBeUndefined();
  });

  test('id do agendamento com paciente vinculado grava no paciente real', async () => {
    const res = await chamar('post', '/api/consultations', { patient_id: agendaAComPaciente, appointment_id: agendaAComPaciente });
    expect(res.status).toBe(200);
    const ins = insertConsulta();
    expect(ins.params[0]).toBe(pacienteA);
    expect(ins.params[2]).toBe(agendaAComPaciente);
  });

  test('id do agendamento sem paciente vinculado continua aceito e vira o appointment_id', async () => {
    const res = await chamar('post', '/api/consultations', { patient_id: agendaASemPaciente });
    expect(res.status).toBe(200);
    const ins = insertConsulta();
    expect(ins.params[0]).toBe(agendaASemPaciente);
    expect(ins.params[2]).toBe(agendaASemPaciente);
  });

  test.each([
    ['agendamento de outra clínica', { patient_id: pacienteA, appointment_id: agendaB }, 'Agendamento não encontrado'],
    ['agendamento inválido', { patient_id: pacienteA, appointment_id: 'x' }, 'Agendamento não encontrado'],
    ['relatório de outra clínica', { patient_id: pacienteA, clinical_report_id: relatorioB }, 'Relatório clínico não encontrado'],
  ])('%s → 400 sem gravar', async (_nome, body, msg) => {
    const res = await chamar('post', '/api/consultations', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(msg);
    expect(insertConsulta()).toBeUndefined();
  });

  test('relatório da própria clínica é aceito', async () => {
    const res = await chamar('post', '/api/consultations', { patient_id: pacienteA, clinical_report_id: relatorioA });
    expect(res.status).toBe(200);
    expect(insertConsulta().params[12]).toBe(relatorioA);
  });
});

describe('GET /api/ai/reports/export.csv sem JWT na URL', () => {
  test('?token= sem cabeçalho → 401 (o token não vale mais na URL)', async () => {
    const res = await request(app).get(`/api/ai/reports/export.csv?token=${token()}`);
    expect(res.status).toBe(401);
    expect(gravou(/FROM clinical_reports/)).toBe(false);
  });

  test('com Authorization: Bearer → 200 e CSV', async () => {
    const res = await request(app).get('/api/ai/reports/export.csv').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const q = sqlLog.find(x => /FROM clinical_reports/.test(x.text));
    expect(q.params[0]).toBe(tenantA);
  });
});
