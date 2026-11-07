// Correções da revisão do Igor e da Beatriz no #86 (docs/seguranca/prs-abertos-2026-11-07.md,
// docs/revisoes/lote-b-2026-11-07.md): /api/generic sem prontuário/comissão e com papel; rotas da
// lista de espera, DELETE de exame e disparo de campanha na matriz; papel de outra clínica não
// vale; CSV sem token na URL; motivo da inativação só no corpo; papel padrão 'recepcionista'.
// pool.query mockado, exceto o bloco "Postgres", que usa um schema temporário (pulado sem banco).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { papelAtual, limparCachePapel, _definirPapelParaTestes } from '../papeis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const usuario = '44444444-4444-4444-4444-444444444444';
const ID = 'aaaaaaaa-0000-0000-0000-000000000001';

const tokenDe = () => jwt.sign({ sub: usuario, email: 'pessoa@clinica.com', role: 'admin', tenant_id: tenantA, is_super_admin: false }, JWT_SECRET);
const chamar = (method, url, body) => {
  const r = request(app)[method](url).set('Authorization', `Bearer ${tokenDe()}`);
  return body ? r.send(body) : r;
};

let sqlLog, querySpy, connectSpy;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  limparCachePapel();
  sqlLog = [];
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    sqlLog.push({ text: String(sql), params });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  connectSpy = jest.spyOn(pool, 'connect').mockResolvedValue({
    query: () => Promise.reject(new Error('sem banco no teste')),
    release: () => {},
  });
});
afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

const PAPEIS = ['user', 'recepcionista', 'dentista', 'admin'];
const EQUIPE = ['recepcionista', 'dentista', 'admin'];
const ADM = ['admin'];
// [método, url, corpo, papéis que passam, tabelas que a rota lê/grava]
const ROTAS = [
  ['get', '/api/generic/estoque', null, EQUIPE, ['estoque']],
  ['get', '/api/lista-espera', null, EQUIPE, ['lista_espera']],
  ['post', '/api/lista-espera', { paciente_nome: 'X' }, EQUIPE, ['lista_espera', 'pacientes']],
  ['delete', `/api/lista-espera/${ID}`, null, EQUIPE, ['lista_espera']],
  ['post', `/api/agenda/${ID}/liberar-horario`, null, EQUIPE, ['agendamentos', 'lista_espera']],
  ['get', `/api/agenda/${ID}/encaixe`, null, EQUIPE, ['agendamentos', 'lista_espera']],
  ['post', `/api/agenda/${ID}/oferecer-horario`, {}, EQUIPE, ['agendamentos', 'lista_espera', 'lista_espera_ofertas', 'automation_jobs']],
  ['delete', `/api/exames/${ID}`, null, ADM, ['exames']],
  ['post', `/api/campaigns/${ID}/execute`, null, ADM, ['broadcast_campaigns', 'automation_jobs']],
];

describe('rotas que estavam fora da matriz', () => {
  test.each(ROTAS.flatMap(([m, u, b, ok, tabelas]) => PAPEIS.map(p => [p, m, u, b, ok.includes(p), tabelas])))(
    '%s %s %s', async (papel, m, u, b, passa, tabelas) => {
      _definirPapelParaTestes(usuario, papel);
      const res = await chamar(m, u, b);
      if (passa) expect(res.status).not.toBe(403);
      else {
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Seu perfil não tem acesso a esta função');
        // Barrado antes de qualquer leitura/escrita nas tabelas da rota. Só essas contam: rotinas
        // do boot (auto-migração, segredo da Clinicorp) e a checagem global da assinatura rodam
        // em paralelo e caem no registro conforme o tempo — não são da rota.
        const daRota = new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+(${tabelas.join('|')})\\b`, 'i');
        expect(sqlLog.filter(q => daRota.test(q.text)).map(q => q.text)).toEqual([]);
      }
    });
});

describe('/api/generic', () => {
  test.each(['prontuarios', 'comissoes'])('%s não é mais lida, nem por admin', async (tabela) => {
    _definirPapelParaTestes(usuario, 'admin');
    const res = await chamar('get', `/api/generic/${tabela}`);
    expect(res.status).toBe(403);
    expect(sqlLog.some(q => new RegExp(`FROM ${tabela}`).test(q.text))).toBe(false);
  });
  test('tabela permitida filtra a clínica do token', async () => {
    _definirPapelParaTestes(usuario, 'recepcionista');
    const res = await chamar('get', '/api/generic/estoque');
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /FROM estoque/.test(x.text));
    expect(q.text).toMatch(/WHERE tenant_id = \$1/);
    expect(q.params).toEqual([tenantA]);
  });
});

describe('papel de outra clínica', () => {
  test('a query do papelAtual só aceita user_roles da clínica do perfil (ou sem clínica)', async () => {
    const pool2 = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await papelAtual(pool2, { id: 'u-sql', tenant_id: tenantA });
    expect(pool2.query.mock.calls[0][0]).toMatch(/ur\.tenant_id IS NULL OR ur\.tenant_id = p\.tenant_id/);
  });
  test('novos vínculos em user_roles gravam a clínica', () => {
    const src = readFileSync(path.join(__dirname, '../server.mjs'), 'utf8');
    expect(src).not.toMatch(/INSERT INTO user_roles \(user_id, role\) VALUES/);
  });
});

describe('Postgres: papel em duas clínicas', () => {
  let client = null;
  const SCHEMA = 'teste_papeis_revisao';
  const tB = '22222222-2222-2222-2222-222222222222';
  const pessoa = '55555555-5555-5555-5555-555555555555';
  const antiga = '66666666-6666-6666-6666-666666666666';
  beforeAll(async () => {
    const c = new pg.Client({
      host: process.env.PG_HOST || 'localhost', port: Number(process.env.PG_PORT) || 5432,
      database: process.env.PG_DATABASE || 'postgres', user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '', connectionTimeoutMillis: 3000,
    });
    try { await c.connect(); client = c; } catch (e) {
      console.warn(`[papeis-revisao] sem Postgres acessível (${e.code || e.message}): teste de SQL não rodado`);
      return;
    }
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}`);
    await client.query(`CREATE TABLE profiles (id UUID PRIMARY KEY, role TEXT, active BOOLEAN DEFAULT true, tenant_id UUID)`);
    await client.query(`CREATE TABLE user_roles (user_id UUID, role TEXT NOT NULL, tenant_id UUID, UNIQUE (user_id, role))`);
    // pessoa: recepcionista na clínica A (perfil), admin na clínica B (vínculo extra).
    await client.query(`INSERT INTO profiles VALUES ($1, 'recepcionista', true, $2), ($3, 'dentista', true, $2)`, [pessoa, tenantA, antiga]);
    await client.query(`INSERT INTO user_roles VALUES ($1, 'recepcionista', $2), ($1, 'admin', $3), ($4, 'dentista', NULL)`, [pessoa, tenantA, tB, antiga]);
  });
  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.end();
  });
  test('admin na clínica B não vira admin na clínica A do perfil', async () => {
    if (!client) return;
    limparCachePapel();
    expect(await papelAtual(client, { id: pessoa, tenant_id: tenantA })).toBe('recepcionista');
    expect(await papelAtual(client, { id: pessoa, tenant_id: tB })).toBeNull();
  });
  test('linha antiga de user_roles sem clínica continua valendo', async () => {
    if (!client) return;
    limparCachePapel();
    expect(await papelAtual(client, { id: antiga, tenant_id: tenantA })).toBe('dentista');
  });
});

describe('CSV dos relatórios e motivo da inativação', () => {
  test('?token= na URL não autentica mais (só cabeçalho)', async () => {
    const res = await request(app).get(`/api/ai/reports/export.csv?token=${encodeURIComponent(tokenDe())}`);
    expect(res.status).toBe(401);
  });
  test('com cabeçalho e papel de admin baixa o CSV (exportação é só do admin desde o #79)', async () => {
    _definirPapelParaTestes(usuario, 'admin');
    const res = await chamar('get', '/api/ai/reports/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });
  test('motivo só na query é ignorado (400)', async () => {
    _definirPapelParaTestes(usuario, 'dentista');
    const res = await chamar('delete', `/api/prontuarios/${ID}?motivo=${encodeURIComponent('motivo pela url')}`);
    expect(res.status).toBe(400);
    expect(sqlLog.some(q => /UPDATE prontuarios/.test(q.text))).toBe(false);
  });
});

describe("papel padrão de usuário novo é 'recepcionista'", () => {
  test('POST /api/my-tenant/users sem role grava recepcionista em profiles e user_roles (com a clínica)', async () => {
    _definirPapelParaTestes(usuario, 'admin');
    querySpy.mockImplementation((sql, params = []) => {
      sqlLog.push({ text: String(sql), params });
      if (/max_usuarios/.test(sql)) return Promise.resolve({ rows: [{ max_usuarios: 99 }] });
      if (/COUNT\(\*\)/i.test(sql)) return Promise.resolve({ rows: [{ total: 0, count: 0 }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await chamar('post', '/api/my-tenant/users', { name: 'Nova', email: 'nova@clinica.com', password: 'senha-12345' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('recepcionista');
    const perfil = sqlLog.find(q => /INSERT INTO profiles/.test(q.text));
    expect(perfil.params).toContain('recepcionista');
    const vinculo = sqlLog.find(q => /INSERT INTO user_roles/.test(q.text));
    expect(vinculo.text).toMatch(/tenant_id/);
    expect(vinculo.params[1]).toBe('recepcionista');
  });
});

describe('expurgo LGPD (#76) e aviso de Termos (#70) usam o papel do banco', () => {
  test('JWT de admin com papel recepcionista no banco não lista expurgo', async () => {
    _definirPapelParaTestes(usuario, 'recepcionista');
    const res = await chamar('get', '/api/lgpd/expurgo/listas');
    expect(res.status).toBe(403);
    expect(sqlLog.some(q => /FROM user_roles WHERE user_id/.test(q.text))).toBe(false);
  });
  test('admin pelo banco lista expurgo', async () => {
    _definirPapelParaTestes(usuario, 'admin');
    expect((await chamar('get', '/api/lgpd/expurgo/listas')).status).not.toBe(403);
  });
  test('pendências de Termos: pode_aceitar só com papel admin no banco', async () => {
    _definirPapelParaTestes(usuario, 'recepcionista');
    const r1 = await chamar('get', '/api/legal/pendencias');
    expect(r1.status).toBe(200);
    expect(r1.body.pode_aceitar).toBe(false);
    limparCachePapel();
    _definirPapelParaTestes(usuario, 'admin');
    expect((await chamar('get', '/api/legal/pendencias')).body.pode_aceitar).toBe(true);
  });
});
