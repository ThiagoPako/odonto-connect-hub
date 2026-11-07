// Agenda: nomes de paciente/profissional vindos do cadastro da própria clínica,
// GET /api/pacientes/:id isolado por clínica e saudação do lembrete nunca vazia.
//
// Mesmos requisitos de pacientes-isolamento.test.js: JWT_SECRET definido e pool.query
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

const { app, pool, processAppointmentReminders } = await import('../server.mjs');
// Papel lido do banco (papeis.mjs, #86): fixa no cache para o pool mockado.
const { limparCachePapel, _definirPapelParaTestes } = await import('../papeis.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const pacienteDaB = '33333333-3333-3333-3333-333333333333';
const dentistaDaB = '66666666-6666-6666-6666-666666666666';
const agendamentoDaB = '55555555-5555-5555-5555-555555555555';

const token = (tenant_id) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444',
  email: 'admin@clinica.com',
  role: 'admin',
  tenant_id,
  is_super_admin: false,
}, JWT_SECRET);

let sqlLog;
let reminderRows;
let querySpy;
let failUpdate;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  limparCachePapel();
  _definirPapelParaTestes('44444444-4444-4444-4444-444444444444', 'admin');
  sqlLog = [];
  reminderRows = [];
  failUpdate = false;
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    const daB = (id) => params[0] === id && params[1] === tenantB;
    if (/SELECT 1 FROM (pacientes|dentistas) WHERE id = \$1 AND tenant_id = \$2 LIMIT 1/.test(text)) {
      const ok = daB(pacienteDaB) || daB(dentistaDaB);
      return Promise.resolve({ rows: ok ? [{ '?column?': 1 }] : [] });
    }
    if (failUpdate && /^\s*UPDATE agendamentos SET/.test(text)) {
      return Promise.reject(new Error('relation "agendamentos" detalhe interno do banco'));
    }
    if (/^\s*UPDATE crm_leads/.test(text)) return Promise.resolve({ rows: [], rowCount: 1 });
    if (/SELECT \* FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      return Promise.resolve({ rows: daB(pacienteDaB) ? [{ id: pacienteDaB, nome: 'Maria Silva' }] : [] });
    }
    if (/SELECT nome FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      return Promise.resolve({ rows: daB(pacienteDaB) ? [{ nome: 'Maria Silva' }] : [] });
    }
    if (/SELECT nome FROM dentistas WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      return Promise.resolve({ rows: daB(dentistaDaB) ? [{ nome: 'Dra. Ana' }] : [] });
    }
    if (/^\s*UPDATE agendamentos SET/.test(text)) {
      const ok = params.includes(agendamentoDaB) && params.includes(tenantB);
      return Promise.resolve({ rows: ok ? [{ id: agendamentoDaB, data: '2026-11-10', paciente_id: pacienteDaB }] : [] });
    }
    if (/FROM agendamentos a/.test(text) && /WHERE a\.tenant_id = \$1/.test(text)) {
      return Promise.resolve({ rows: [] });
    }
    if (/trigger_event = 'appointment_reminder'/.test(text) && /FROM agendamentos a/.test(text)) {
      return Promise.resolve({ rows: reminderRows });
    }
    if (/INSERT INTO automation_jobs/.test(text)) {
      return Promise.resolve({ rows: [{ id: 'job1' }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

const chamar = (method, url, tk, body = {}) =>
  request(app)[method](url).set('Authorization', `Bearer ${tk}`).send(body);
const inserts = () => sqlLog.filter(q => /INSERT INTO agendamentos/.test(q.text));

describe('GET /api/pacientes/:id', () => {
  test('clínica A recebe 404 no paciente da clínica B', async () => {
    const res = await chamar('get', `/api/pacientes/${pacienteDaB}`, token(tenantA));
    expect(res.status).toBe(404);
    const q = sqlLog.find(x => /FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(x.text));
    expect(q.params).toEqual([pacienteDaB, tenantA]);
  });

  test('clínica B recebe o próprio paciente', async () => {
    const res = await chamar('get', `/api/pacientes/${pacienteDaB}`, token(tenantB));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: pacienteDaB, nome: 'Maria Silva' });
  });

  test('id inválido retorna 404 sem query', async () => {
    const res = await chamar('get', '/api/pacientes/nao-uuid', token(tenantB));
    expect(res.status).toBe(404);
    expect(sqlLog.some(q => /FROM pacientes/.test(q.text))).toBe(false);
  });

  test('sem token retorna 401', async () => {
    const res = await request(app).get(`/api/pacientes/${pacienteDaB}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/agenda e /api/agenda/serie', () => {
  const corpo = {
    paciente_id: pacienteDaB, dentista_id: dentistaDaB, data: '2026-11-10', hora: '09:00',
    // nomes enviados pelo cliente são ignorados
    paciente_nome: 'Nome falso', dentista_nome: 'Dentista falso',
  };

  test('grava paciente_nome e dentista_nome do cadastro da própria clínica', async () => {
    const res = await chamar('post', '/api/agenda', token(tenantB), corpo);
    expect(res.status).toBe(200);
    const [ins] = inserts();
    expect(ins.text).toMatch(/paciente_nome, dentista_nome/);
    expect(ins.params.slice(-3)).toEqual([tenantB, 'Maria Silva', 'Dra. Ana']);
  });

  test('clínica A recebe 400 com paciente ou profissional da clínica B, sem INSERT', async () => {
    let res = await chamar('post', '/api/agenda', token(tenantA), corpo);
    expect(res.status).toBe(400);
    res = await chamar('post', '/api/agenda', token(tenantA), { ...corpo, paciente_id: undefined });
    expect(res.status).toBe(400);
    expect(inserts()).toHaveLength(0);
  });

  test('evento sem paciente/profissional grava nomes nulos', async () => {
    const res = await chamar('post', '/api/agenda', token(tenantB),
      { data: '2026-11-10', hora: '00:00', tipo: 'evento', escopo: 'clinica', dentista_nome: 'Clínica' });
    expect(res.status).toBe(200);
    expect(inserts()[0].params.slice(-2)).toEqual([null, null]);
  });

  test('série grava os nomes em todas as sessões', async () => {
    const res = await chamar('post', '/api/agenda/serie', token(tenantB), {
      paciente_id: pacienteDaB, dentista_id: dentistaDaB, data_inicio: '2026-11-10', hora: '09:00',
      quantidade: 3, intervalo_dias: 7,
    });
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(3);
    for (const ins of inserts()) expect(ins.params.slice(-2)).toEqual(['Maria Silva', 'Dra. Ana']);
  });

  test('série: clínica A recebe 400 com paciente da clínica B, sem INSERT', async () => {
    const res = await chamar('post', '/api/agenda/serie', token(tenantA), {
      paciente_id: pacienteDaB, dentista_id: dentistaDaB, data_inicio: '2026-11-10', hora: '09:00', quantidade: 2,
    });
    expect(res.status).toBe(400);
    expect(inserts()).toHaveLength(0);
  });
});

describe('PUT /api/agenda/:id', () => {
  test('troca de profissional grava o nome do cadastro, não o do corpo', async () => {
    const res = await chamar('put', `/api/agenda/${agendamentoDaB}`, token(tenantB),
      { dentista_id: dentistaDaB, dentista_nome: 'Dentista falso' });
    expect(res.status).toBe(200);
    const upd = sqlLog.find(q => /^\s*UPDATE agendamentos SET/.test(q.text));
    expect(upd.params).toContain('Dra. Ana');
    expect(upd.params).not.toContain('Dentista falso');
  });

  test('clínica A não consegue apontar profissional da clínica B', async () => {
    const res = await chamar('put', `/api/agenda/${agendamentoDaB}`, token(tenantA), { dentista_id: dentistaDaB });
    expect(res.status).toBe(400);
    expect(sqlLog.some(q => /^\s*UPDATE agendamentos SET/.test(q.text))).toBe(false);
  });

  test.each(['em_atendimento', 'realizado'])('status %s atualiza o lead só da própria clínica', async (status) => {
    const res = await chamar('put', `/api/agenda/${agendamentoDaB}`, token(tenantB), { status });
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    const upd = sqlLog.find(q => /^\s*UPDATE crm_leads/.test(q.text));
    expect(upd.text).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
    expect(upd.params).toEqual([pacienteDaB, tenantB]);
  });

  test('erro interno devolve 500 genérico, sem a mensagem do banco', async () => {
    failUpdate = true;
    const res = await chamar('put', `/api/agenda/${agendamentoDaB}`, token(tenantB), { status: 'confirmado' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno' });
  });
});

describe('GET /api/agenda', () => {
  test('paciente_nome/dentista_nome: cadastro primeiro, coluna como fallback', async () => {
    const res = await chamar('get', '/api/agenda', token(tenantB));
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /FROM agendamentos a/.test(x.text));
    expect(q.text).toMatch(/COALESCE\(NULLIF\(TRIM\(p\.nome\), ''\), a\.paciente_nome\) AS paciente_nome/);
    expect(q.text).toMatch(/COALESCE\(NULLIF\(TRIM\(d\.nome\), ''\), a\.dentista_nome\) AS dentista_nome/);
    // a última coluna com o mesmo nome é a que vale no objeto do node-pg
    expect(q.text.lastIndexOf('AS paciente_nome')).toBeGreaterThan(q.text.indexOf('a.*'));
    expect(q.params).toEqual([tenantB]);
  });
});

describe('lembrete de consulta 24h', () => {
  const base = {
    id: agendamentoDaB, tenant_id: tenantB, paciente_id: pacienteDaB, data: '2026-11-10', hora: '09:00',
    dentista_nome: 'Dra. Ana', telefone: '11987654321',
  };
  const mensagem = () => {
    const ins = sqlLog.find(q => /INSERT INTO automation_jobs/.test(q.text));
    return ins.params[3];
  };

  test('busca o nome pelo paciente_id e dentista_id com tenant_id', async () => {
    reminderRows = [{ ...base, paciente_nome: 'Maria Silva' }];
    await processAppointmentReminders();
    const q = sqlLog.find(x => /trigger_event = 'appointment_reminder'/.test(x.text));
    expect(q.text).toMatch(/LEFT JOIN pacientes p ON p\.id = a\.paciente_id AND p\.tenant_id = a\.tenant_id/);
    expect(q.text).toMatch(/LEFT JOIN dentistas d ON d\.id = a\.dentista_id AND d\.tenant_id = a\.tenant_id/);
    expect(mensagem()).toContain('Olá, Maria!');
  });

  test.each([null, '', '   '])('sem nome (%p) usa "Olá!" e nunca "Olá, !"', async (nome) => {
    reminderRows = [{ ...base, paciente_nome: nome }];
    await processAppointmentReminders();
    expect(mensagem()).toContain('Olá!');
    expect(mensagem()).not.toMatch(/Olá,\s*!/);
  });
});
