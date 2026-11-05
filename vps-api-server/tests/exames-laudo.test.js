// Laudo do exame: finalizar registra quem e quando; laudo finalizado não muda sem reabrir;
// duas pessoas salvando o mesmo exame → 409 para quem tem a versão velha.
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
const userA = '44444444-4444-4444-4444-444444444444';
const exameA = 'eeeeeeee-0000-4000-8000-00000000000a';
const exameB = 'eeeeeeee-0000-4000-8000-00000000000b';

let sqlLog;
let querySpy;
let estado; // exame A "no banco"
const token = (role = 'dentista') => jwt.sign({ sub: userA, email: 'dentista@clinica-a.com', role, tenant_id: tenantA, is_super_admin: false }, JWT_SECRET);
const chamar = (method, url, body = {}, role = 'dentista') => request(app)[method](url).set('Authorization', `Bearer ${token(role)}`).send(body);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  estado = { id: exameA, tenant_id: tenantA, laudo_texto: 'rascunho', laudado_em: null, status: 'aguardando_laudo', updated_at: '2026-11-05T10:00:00.000Z' };
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    const eA = params[0] === exameA && params[1] === tenantA;
    if (/SELECT laudo_texto, laudado_em, status FROM exames/.test(text)) return Promise.resolve({ rows: eA ? [estado] : [], rowCount: eA ? 1 : 0 });
    if (/SELECT status, laudado_em FROM exames/.test(text)) return Promise.resolve({ rows: eA ? [estado] : [], rowCount: eA ? 1 : 0 });
    if (/^\s*UPDATE exames SET/.test(text)) {
      // PATCH: confere a versão quando enviada (último parâmetro)
      const id = params.find(p => p === exameA || p === exameB);
      const versao = /date_trunc/.test(text) ? params.at(-1) : null;
      const travado = / AND laudado_em IS NULL/.test(text) && !!estado.laudado_em;
      const ok = id === exameA && params.includes(tenantA) && (!versao || versao === estado.updated_at) && !travado;
      return Promise.resolve({ rows: ok ? [{ ...estado }] : [], rowCount: ok ? 1 : 0 });
    }
    if (/UPDATE exames\s+SET laudo_texto = \$3, laudado_por = \$4/.test(text)) {
      const versao = params[4];
      const ok = eA && !estado.laudado_em && (!versao || versao === estado.updated_at);
      return Promise.resolve({ rows: ok ? [{ ...estado, laudado_por: params[3] }] : [], rowCount: ok ? 1 : 0 });
    }
    if (/UPDATE exames\s+SET laudado_por = NULL/.test(text)) {
      const ok = eA && !!estado.laudado_em;
      return Promise.resolve({ rows: ok ? [estado] : [], rowCount: ok ? 1 : 0 });
    }
    if (/SELECT 1 FROM exames WHERE id = \$1 AND tenant_id = \$2/.test(text)) return Promise.resolve({ rows: eA ? [{}] : [], rowCount: eA ? 1 : 0 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

describe('laudo do exame', () => {
  test('finalizar sem texto → 400', async () => {
    const res = await chamar('post', `/api/exames/${exameA}/laudo/finalizar`, { laudo_texto: '   ' });
    expect(res.status).toBe(400);
  });

  test('finalizar grava quem laudou, filtrando a clínica', async () => {
    const res = await chamar('post', `/api/exames/${exameA}/laudo/finalizar`, { laudo_texto: 'Sem alterações.' });
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /laudado_por = \$4/.test(x.text));
    expect(q.params.slice(0, 4)).toEqual([exameA, tenantA, 'Sem alterações.', userA]);
    expect(q.text).toMatch(/laudado_em IS NULL/);
  });

  test('finalizar exame de outra clínica → 404', async () => {
    const res = await chamar('post', `/api/exames/${exameB}/laudo/finalizar`, { laudo_texto: 'x' });
    expect(res.status).toBe(404);
  });

  test('finalizar com versão velha → 409', async () => {
    const res = await chamar('post', `/api/exames/${exameA}/laudo/finalizar`, { laudo_texto: 'x', updated_at_esperado: '2026-11-05T09:00:00.000Z' });
    expect(res.status).toBe(409);
  });

  test('PATCH do texto de laudo finalizado → 409 sem gravar', async () => {
    estado.laudado_em = '2026-11-05T10:00:00.000Z';
    const res = await chamar('patch', `/api/exames/${exameA}`, { laudo_texto: 'outro texto', updated_at_esperado: estado.updated_at });
    expect(res.status).toBe(409);
    expect(sqlLog.some(q => /^\s*UPDATE exames SET/.test(q.text))).toBe(false);
  });

  test('PATCH com versão velha → 409; com a versão atual → 200 e registra quem editou', async () => {
    const velho = await chamar('patch', `/api/exames/${exameA}`, { laudo_texto: 'novo', updated_at_esperado: '2026-11-05T09:00:00.000Z' });
    expect(velho.status).toBe(409);
    sqlLog = [];
    const atual = await chamar('patch', `/api/exames/${exameA}`, { laudo_texto: 'novo', updated_at_esperado: estado.updated_at });
    expect(atual.status).toBe(200);
    const q = sqlLog.find(x => /^\s*UPDATE exames SET/.test(x.text));
    expect(q.text).toMatch(/laudo_atualizado_por=/);
    expect(q.params).toContain(userA);
  });

  test('reabrir: só laudo finalizado; outra clínica → 404', async () => {
    expect((await chamar('post', `/api/exames/${exameA}/laudo/reabrir`)).status).toBe(409);
    estado.laudado_em = '2026-11-05T10:00:00.000Z';
    expect((await chamar('post', `/api/exames/${exameA}/laudo/reabrir`)).status).toBe(200);
    expect((await chamar('post', `/api/exames/${exameB}/laudo/reabrir`)).status).toBe(404);
  });

  test('PATCH com texto de laudo sem versão → 400', async () => {
    const res = await chamar('patch', `/api/exames/${exameA}`, { laudo_texto: 'novo' });
    expect(res.status).toBe(400);
  });

  test('laudo finalizado: paciente/tipo/datas → 409; status só para entregue', async () => {
    estado.laudado_em = '2026-11-05T10:00:00.000Z';
    estado.status = 'concluido';
    expect((await chamar('patch', `/api/exames/${exameA}`, { paciente_id: null })).status).toBe(409);
    expect((await chamar('patch', `/api/exames/${exameA}`, { tipo_nome: 'Outro' })).status).toBe(409);
    expect((await chamar('patch', `/api/exames/${exameA}`, { data_realizacao: '2026-11-01' })).status).toBe(409);
    expect((await chamar('patch', `/api/exames/${exameA}`, { status: 'cancelado' })).status).toBe(409);
    expect(sqlLog.some(q => /^\s*UPDATE exames SET/.test(q.text))).toBe(false);
    expect((await chamar('patch', `/api/exames/${exameA}`, { status: 'entregue' })).status).toBe(200);
  });

  test('alteração clínica vai com AND laudado_em IS NULL (finalizado no meio → 409)', async () => {
    const res = await chamar('patch', `/api/exames/${exameA}`, { tipo_nome: 'Outro' });
    expect(res.status).toBe(200);
    expect(sqlLog.find(q => /^\s*UPDATE exames SET/.test(q.text)).text).toMatch(/AND laudado_em IS NULL/);
  });

  test('finalizar e reabrir: só dentista ou admin', async () => {
    expect((await chamar('post', `/api/exames/${exameA}/laudo/finalizar`, { laudo_texto: 'x' }, 'recepcionista')).status).toBe(403);
    estado.laudado_em = '2026-11-05T10:00:00.000Z';
    expect((await chamar('post', `/api/exames/${exameA}/laudo/reabrir`, {}, 'recepcionista')).status).toBe(403);
    expect((await chamar('post', `/api/exames/${exameA}/laudo/reabrir`, {}, 'admin')).status).toBe(200);
  });

  test('finalizar e reabrir gravam o histórico na mesma instrução', async () => {
    await chamar('post', `/api/exames/${exameA}/laudo/finalizar`, { laudo_texto: 'Texto assinado' });
    expect(sqlLog.find(q => /laudado_por = \$4/.test(q.text)).text).toMatch(/INSERT INTO exame_laudo_historico[\s\S]*'finalizado'/);
    estado.laudado_em = '2026-11-05T10:00:00.000Z';
    sqlLog = [];
    await chamar('post', `/api/exames/${exameA}/laudo/reabrir`);
    expect(sqlLog.find(q => /laudado_por = NULL/.test(q.text)).text).toMatch(/INSERT INTO exame_laudo_historico[\s\S]*'reaberto'/);
  });

  test('GET /api/exames/:id filtra a clínica e junta só da mesma clínica', async () => {
    await chamar('get', `/api/exames/${exameA}`);
    const q = sqlLog.find(x => /FROM exames e/.test(x.text));
    expect(q.text).toMatch(/WHERE e\.id = \$1 AND e\.tenant_id = \$2/);
    expect(q.text).toMatch(/p\.tenant_id = e\.tenant_id/);
    expect(q.text).toMatch(/lp\.tenant_id = e\.tenant_id/);
    expect(q.params).toEqual([exameA, tenantA]);
  });
});
