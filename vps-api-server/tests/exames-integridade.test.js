// Módulo de exames: validação do que o cliente envia e proteção do prontuário.
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
const exameA = 'eeeeeeee-0000-4000-8000-00000000000a';
const tipoA = 'cccccccc-0000-4000-8000-00000000000a';
const tipoB = 'cccccccc-0000-4000-8000-00000000000b';
const donoTipo = { [tipoA]: tenantA, [tipoB]: tenantB };

let sqlLog;
let querySpy;
let connectSpy;
let exameTemResultado;
let deleteAfeta;
const token = () => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica-a.com',
  role: 'admin', tenant_id: tenantA, is_super_admin: false,
}, JWT_SECRET);
const chamar = (method, url, body = {}) =>
  request(app)[method](url).set('Authorization', `Bearer ${token()}`).send(body);
const gravou = (re) => sqlLog.some(q => re.test(q.text));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  exameTemResultado = false;
  deleteAfeta = 1;
  // Transação manual (pool.connect) usa o mesmo mock
  connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => ({ query: (q, p) => pool.query(q, p), release: () => {} }));
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/SELECT 1 FROM exame_tipos WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      const ok = donoTipo[params[0]] === params[1];
      return Promise.resolve({ rows: ok ? [{}] : [], rowCount: ok ? 1 : 0 });
    }
    if (/next_code/.test(text)) return Promise.resolve({ rows: [{ next_code: 'EX-000001' }], rowCount: 1 });
    if (/^\s*INSERT INTO exames/.test(text)) return Promise.resolve({ rows: [{ id: exameA }], rowCount: 1 });
    if (/^\s*UPDATE exames/.test(text)) return Promise.resolve({ rows: params.at(-1) === tenantA ? [{ id: exameA }] : [], rowCount: 1 });
    if (/^\s*DELETE FROM exame_arquivos a USING/.test(text)) return Promise.resolve({ rows: [], rowCount: 0 });
    if (/^\s*DELETE FROM exames/.test(text)) return Promise.resolve({ rows: [], rowCount: deleteAfeta });
    if (/AS tem_resultado/.test(text)) {
      const ok = params[0] === exameA && params[1] === tenantA;
      return Promise.resolve({ rows: ok ? [{ tem_resultado: exameTemResultado }] : [], rowCount: ok ? 1 : 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

describe('exames: entrada inválida vira 400 sem gravar', () => {
  test.each([
    ['post', '/api/exames', { tipo_nome: 'Panorâmica', tipo_exame_id: tipoB }, /INSERT INTO exames/],
    ['post', '/api/exames', { tipo_nome: 'Panorâmica', status: 'qualquer' }, /INSERT INTO exames/],
    ['post', '/api/exames', { tipo_nome: 'Panorâmica', prioridade: 'maxima' }, /INSERT INTO exames/],
    ['post', '/api/exames', { tipo_nome: 'Panorâmica', valor: 'abc' }, /INSERT INTO exames/],
    ['post', '/api/exames', { tipo_nome: 'Panorâmica', valor: -5 }, /INSERT INTO exames/],
    ['patch', `/api/exames/${exameA}`, { valor: -0.01 }, /UPDATE exames/],
    ['post', '/api/exame-tipos', { nome: 'Panorâmica', preco: -1 }, /INSERT INTO exame_tipos/],
    ['patch', `/api/exames/${exameA}`, { tipo_exame_id: tipoB }, /UPDATE exames/],
    ['patch', `/api/exames/${exameA}`, { status: 'apagado' }, /UPDATE exames/],
    ['patch', `/api/exames/${exameA}`, { status: null }, /UPDATE exames/],
    ['patch', `/api/exames/${exameA}`, { tipo_nome: '  ' }, /UPDATE exames/],
    ['patch', `/api/exames/${exameA}`, { data_realizacao: 'ontem' }, /UPDATE exames/],
  ])('%s %s %j → 400', async (method, url, body, escrita) => {
    const res = await chamar(method, url, body);
    expect(res.status).toBe(400);
    expect(gravou(escrita)).toBe(false);
  });

  test('tipo de exame da própria clínica grava', async () => {
    const res = await chamar('post', '/api/exames', { tipo_nome: 'Panorâmica', tipo_exame_id: tipoA });
    expect(res.status).toBe(200);
    expect(gravou(/INSERT INTO exames/)).toBe(true);
  });

  test('id que não é UUID → 404 sem consultar o banco', async () => {
    const res = await chamar('patch', '/api/exames/abc', { status: 'novo' });
    expect(res.status).toBe(404);
    expect(sqlLog.length).toBe(0);
  });

  test('erro do banco não vaza a mensagem', async () => {
    querySpy.mockImplementation(() => Promise.reject(new Error('relation "exames" does not exist')));
    const res = await chamar('get', '/api/exames');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/relation/);
  });
});

describe('exames: exclusão protege o prontuário', () => {
  test('pedido sem laudo/imagem pode ser excluído (filtrando a clínica)', async () => {
    const res = await chamar('delete', `/api/exames/${exameA}`);
    expect(res.status).toBe(200);
    const del = sqlLog.find(q => /^\s*DELETE FROM exames/.test(q.text));
    expect(del.params).toEqual([exameA, tenantA]);
  });

  test('anexo do pedido não conta como resultado; arquivo retirado conta', async () => {
    await chamar('delete', `/api/exames/${exameA}`);
    const q = sqlLog.find(x => /AS tem_resultado/.test(x.text));
    expect(q.text).toMatch(/NOT a\.anexo_do_pedido/);
    expect(q.text).not.toMatch(/removido_em IS NULL/);
  });

  test('exclusão apaga os anexos do pedido na mesma transação', async () => {
    await chamar('delete', `/api/exames/${exameA}`);
    const i = sqlLog.findIndex(x => /DELETE FROM exame_arquivos a USING exames e/.test(x.text));
    const j = sqlLog.findIndex(x => /^\s*DELETE FROM exames e/.test(x.text));
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(sqlLog[i].text).toMatch(/RETURNING a\.caminho/);
  });

  test('histórico de laudo ou qualquer arquivo impede excluir', async () => {
    await chamar('delete', `/api/exames/${exameA}`);
    const q = sqlLog.find(x => /AS tem_resultado/.test(x.text));
    expect(q.text).toMatch(/exame_laudo_historico/);
    expect(q.text).not.toMatch(/removido_em IS NULL/);
  });

  test('exclusão que não apagou nada (mudou no meio) → 409', async () => {
    deleteAfeta = 0;
    const res = await chamar('delete', `/api/exames/${exameA}`);
    expect(res.status).toBe(409);
  });

  test('exame com laudo ou imagem → 409 sem apagar', async () => {
    exameTemResultado = true;
    const res = await chamar('delete', `/api/exames/${exameA}`);
    expect(res.status).toBe(409);
    expect(gravou(/^\s*DELETE FROM exames/)).toBe(false);
  });

  test('exame de outra clínica (ou inexistente) → 404', async () => {
    const res = await chamar('delete', '/api/exames/eeeeeeee-0000-4000-8000-00000000000b');
    expect(res.status).toBe(404);
    expect(gravou(/^\s*DELETE FROM exames/)).toBe(false);
  });
});
