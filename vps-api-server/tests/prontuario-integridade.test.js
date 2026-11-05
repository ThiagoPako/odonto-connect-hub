// Prontuário: edição versionada, inativação lógica (só autor ou admin, com motivo),
// isolamento por clínica; tratamento sem status vazio.
// pool.query mockado (nenhuma query chega ao Postgres).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { limparCachePapel, _definirPapelParaTestes } from '../papeis.mjs';
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
const autor = '44444444-4444-4444-4444-444444444444';
const outro = '55555555-5555-5555-5555-555555555555';
const prA = 'aaaaaaaa-0000-0000-0000-0000000000f1';
const trA = 'aaaaaaaa-0000-0000-0000-0000000000e1';

const token = (tenant_id, sub = autor, role = 'dentista') => jwt.sign({
  sub, email: 'x@clinica.com', role, tenant_id, is_super_admin: false,
}, JWT_SECRET);
const chamar = (method, url, tk, body) => {
  const r = request(app)[method](url).set('Authorization', `Bearer ${tk}`);
  return body ? r.send(body) : r;
};

let sqlLog, querySpy, registro;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  registro = { criado_por: autor, inativo_em: null };
  // Papel lido do banco (papeis.mjs): fixa no cache para o pool mockado.
  limparCachePapel();
  _definirPapelParaTestes(autor, 'dentista');
  _definirPapelParaTestes(outro, 'dentista');
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/SELECT name FROM profiles/.test(text)) return Promise.resolve({ rows: [{ name: 'Dra. Ana' }] });
    if (/SELECT criado_por, inativo_em FROM prontuarios/.test(text)) {
      return Promise.resolve({ rows: params[0] === prA && params[1] === tenantA ? [registro] : [] });
    }
    if (/WITH atual AS/.test(text)) {
      return Promise.resolve({ rows: params[0] === prA && params[1] === tenantA ? [{ id: prA, versao: 2 }] : [] });
    }
    if (/UPDATE prontuarios SET inativo_em = NOW\(\)/.test(text)) return Promise.resolve({ rowCount: params[1] === tenantA ? 1 : 0 });
    if (/SELECT 1 FROM prontuarios WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      return Promise.resolve({ rows: params[0] === prA && params[1] === tenantA ? [{}] : [] });
    }
    if (/FROM prontuario_versoes/.test(text)) return Promise.resolve({ rows: [{ versao: 1, descricao: 'original' }] });
    if (/SELECT 1 FROM (pacientes|dentistas) WHERE id = \$1 AND tenant_id = \$2 LIMIT 1/.test(text)) return Promise.resolve({ rows: [{}] });
    if (/^\s*UPDATE tratamentos/.test(text)) return Promise.resolve({ rowCount: 1 });
    if (/SELECT \* FROM tratamentos WHERE id=\$1/.test(text)) return Promise.resolve({ rows: [{ id: trA, status: 'planejado' }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

describe('nada de DELETE físico no prontuário', () => {
  test('DELETE vira inativação com motivo e autor', async () => {
    const res = await chamar('delete', `/api/prontuarios/${prA}`, token(tenantA), { motivo: 'Registrado no paciente errado' });
    expect(res.status).toBe(200);
    expect(sqlLog.some(q => /DELETE FROM prontuarios/.test(q.text))).toBe(false);
    const upd = sqlLog.find(q => /UPDATE prontuarios SET inativo_em = NOW\(\)/.test(q.text));
    expect(upd.params).toEqual([prA, tenantA, autor, 'Dra. Ana', 'Registrado no paciente errado']);
  });

  test('sem motivo → 400', async () => {
    const res = await chamar('delete', `/api/prontuarios/${prA}`, token(tenantA), {});
    expect(res.status).toBe(400);
  });

  test('outro dentista (não autor, não admin) → 403', async () => {
    const res = await chamar('delete', `/api/prontuarios/${prA}`, token(tenantA, outro), { motivo: 'Motivo qualquer' });
    expect(res.status).toBe(403);
    expect(sqlLog.some(q => /UPDATE prontuarios SET inativo_em/.test(q.text))).toBe(false);
  });

  test('admin da clínica pode inativar', async () => {
    _definirPapelParaTestes(outro, 'admin');
    const res = await chamar('delete', `/api/prontuarios/${prA}`, token(tenantA, outro, 'admin'), { motivo: 'Duplicado por engano' });
    expect(res.status).toBe(200);
  });

  test('registro antigo sem autor: só admin', async () => {
    registro = { criado_por: null, inativo_em: null };
    expect((await chamar('delete', `/api/prontuarios/${prA}`, token(tenantA), { motivo: 'Motivo qualquer' })).status).toBe(403);
  });

  test('já inativo → 409', async () => {
    registro = { criado_por: autor, inativo_em: new Date() };
    expect((await chamar('delete', `/api/prontuarios/${prA}`, token(tenantA), { motivo: 'Motivo qualquer' })).status).toBe(409);
  });

  test('clínica B recebe 404 no registro da A', async () => {
    const res = await chamar('delete', `/api/prontuarios/${prA}`, token(tenantB, autor, 'admin'), { motivo: 'Motivo qualquer' });
    expect(res.status).toBe(404);
  });
});

describe('edição gera versão', () => {
  test('PUT guarda a versão atual no histórico e grava a nova na mesma instrução, por clínica', async () => {
    const res = await chamar('put', `/api/prontuarios/${prA}`, token(tenantA), { descricao: 'texto corrigido' });
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /WITH atual AS/.test(x.text));
    expect(q.text).toMatch(/WHERE id = \$1 AND tenant_id = \$2 AND inativo_em IS NULL FOR UPDATE/);
    expect(q.text).toMatch(/INSERT INTO prontuario_versoes/);
    expect(q.text).toMatch(/versao = COALESCE\(pr\.versao, 1\) \+ 1/);
    expect(q.text).toMatch(/editado_por_nome = \$4/);
    expect(q.params.slice(0, 5)).toEqual([prA, tenantA, autor, 'Dra. Ana', 'texto corrigido']);
    expect(sqlLog.some(x => /^\s*UPDATE prontuarios SET descricao/.test(x.text))).toBe(false);
  });

  test('clínica B não edita o registro da A', async () => {
    const res = await chamar('put', `/api/prontuarios/${prA}`, token(tenantB), { descricao: 'x' });
    expect(res.status).toBe(404);
  });

  test('versões: só da própria clínica', async () => {
    expect((await chamar('get', `/api/prontuarios/${prA}/versoes`, token(tenantA))).body).toEqual([{ versao: 1, descricao: 'original' }]);
    expect((await chamar('get', `/api/prontuarios/${prA}/versoes`, token(tenantB))).status).toBe(404);
  });

  test('GET esconde inativos por padrão', async () => {
    await chamar('get', '/api/prontuarios', token(tenantA));
    expect(sqlLog.find(q => /FROM prontuarios pr/.test(q.text)).text).toMatch(/pr\.inativo_em IS NULL/);
  });

  test('POST grava o autor', async () => {
    const res = await chamar('post', '/api/prontuarios', token(tenantA), { descricao: 'evolução' });
    expect(res.status).toBe(200);
    const ins = sqlLog.find(q => /INSERT INTO prontuarios/.test(q.text));
    expect(ins.params.slice(8, 11)).toEqual([tenantA, autor, 'Dra. Ana']);
  });
});

describe('tratamento nunca fica com status vazio', () => {
  test.each([[''], ['  '], [undefined], [null]])('POST com status %p grava planejado', async (status) => {
    const res = await chamar('post', '/api/tratamentos', token(tenantA), { descricao: 'Profilaxia', status });
    expect(res.status).toBe(200);
    expect(sqlLog.find(q => /INSERT INTO tratamentos/.test(q.text)).params[6]).toBe('planejado');
  });

  test('POST com status fora da lista → 400', async () => {
    const res = await chamar('post', '/api/tratamentos', token(tenantA), { descricao: 'x', status: 'qualquer' });
    expect(res.status).toBe(400);
    expect(sqlLog.some(q => /INSERT INTO tratamentos/.test(q.text))).toBe(false);
  });

  test('PUT com status vazio não apaga o status atual', async () => {
    const res = await chamar('put', `/api/tratamentos/${trA}`, token(tenantA), { status: '', descricao: 'nova' });
    expect(res.status).toBe(200);
    const upd = sqlLog.find(q => /^\s*UPDATE tratamentos/.test(q.text));
    expect(upd.text).not.toMatch(/status=/);
  });

  test('PUT com status inválido → 400', async () => {
    expect((await chamar('put', `/api/tratamentos/${trA}`, token(tenantA), { status: 'xx' })).status).toBe(400);
  });

  test('PUT normaliza maiúsculas', async () => {
    await chamar('put', `/api/tratamentos/${trA}`, token(tenantA), { status: 'Finalizado' });
    expect(sqlLog.find(q => /^\s*UPDATE tratamentos/.test(q.text)).params[0]).toBe('finalizado');
  });
});
