// Checagem de papel dentro da clínica (docs/seguranca/matriz-papeis.md):
// 'user' e 'recepcionista' recebem 403 nas rotas de severidade alta; admin e dentista passam
// onde devem; o papel vem do banco (rebaixamento vale na hora), não do JWT.
// pool.query mockado (nenhuma query chega ao Postgres).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { papelAtual, exigePapel, limparCachePapel, _definirPapelParaTestes } from '../papeis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const usuario = '44444444-4444-4444-4444-444444444444';
const ID = 'aaaaaaaa-0000-0000-0000-000000000001';

// O JWT diz admin de propósito: quem decide é o papel do banco.
const token = () => jwt.sign({ sub: usuario, email: 'pessoa@clinica.com', role: 'admin', tenant_id: tenantA, is_super_admin: false }, JWT_SECRET);
const chamar = (method, url, body) => {
  const r = request(app)[method](url).set('Authorization', `Bearer ${token()}`);
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
  // Rotas com transação (pool.connect): cliente falso que falha na hora, sem tentar o Postgres.
  connectSpy = jest.spyOn(pool, 'connect').mockResolvedValue({
    query: () => Promise.reject(new Error('sem banco no teste')),
    release: () => {},
  });
});
afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

// [método, url, corpo, papéis que passam]
const CLIN = ['admin', 'dentista'];
const ADM = ['admin'];
const ALTAS = [
  ['get', '/api/fin/employees', null, ADM],
  ['post', '/api/fin/employees', { nome: 'X' }, ADM],
  ['delete', `/api/fin/employees/${ID}`, null, ADM],
  ['get', '/api/fin/payrolls', null, ADM],
  ['post', '/api/fin/payrolls', {}, ADM],
  ['put', `/api/fin/payrolls/${ID}`, {}, ADM],
  ['get', '/api/prontuarios', null, CLIN],
  ['post', '/api/prontuarios', { descricao: 'x' }, CLIN],
  ['put', `/api/prontuarios/${ID}`, { descricao: 'x' }, CLIN],
  ['delete', `/api/prontuarios/${ID}`, { motivo: 'motivo qualquer' }, CLIN],
  ['get', `/api/prontuarios/${ID}/versoes`, null, CLIN],
  ['post', '/api/consultations', {}, CLIN],
  ['get', `/api/consultations/${ID}`, null, CLIN],
  ['post', '/api/ai/clinical-report', {}, CLIN],
  ['get', `/api/ai/reports/${ID}`, null, CLIN],
  ['get', '/api/ai/reports', null, CLIN],
  ['put', `/api/pacientes/${ID}/odontograma`, {}, CLIN],
  ['post', '/api/execucoes', {}, CLIN],
  ['delete', `/api/execucoes/${ID}`, null, ADM],
  ['delete', `/api/tratamentos/${ID}`, null, ADM],
  ['delete', `/api/tratamentos/etapas/${ID}`, null, ADM],
];
const MEDIAS = [
  ['get', '/api/financeiro', null, ADM],
  ['post', '/api/financeiro', {}, ADM],
  ['get', '/api/fin/movements', null, ADM],
  ['post', '/api/fin/movements', {}, ADM],
  ['get', '/api/fin/bills', null, ADM],
  ['get', '/api/fin/banks', null, ADM],
  ['get', '/api/fin/overdue', null, ADM],
  ['post', '/api/comissoes', {}, ADM],
  ['put', `/api/procedimentos-catalogo/${ID}`, {}, ADM],
  ['delete', `/api/orcamentos/${ID}`, null, ADM],
];

describe.each([['alta', ALTAS], ['média', MEDIAS]])('rotas de severidade %s', (_sev, rotas) => {
  test.each(rotas.flatMap(([m, u, b, ok]) => ['user', 'recepcionista', 'dentista', 'admin'].map(p => [p, m, u, b, ok.includes(p)])))(
    '%s %s %s', async (papel, m, u, b, passa) => {
      _definirPapelParaTestes(usuario, papel);
      const res = await chamar(m, u, b);
      if (passa) expect(res.status).not.toBe(403);
      else {
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Seu perfil não tem acesso a esta função');
      }
    });
});

describe('papel do banco, não do JWT', () => {
  test('sem perfil no banco (ou desativado) → 403 mesmo com JWT admin', async () => {
    const res = await chamar('get', '/api/prontuarios');
    expect(res.status).toBe(403);
    expect(sqlLog.some(q => /FROM profiles p\s+LEFT JOIN user_roles ur/.test(q.text))).toBe(true);
  });

  test('rebaixamento vale na hora depois de limparCachePapel', async () => {
    _definirPapelParaTestes(usuario, 'admin');
    expect((await chamar('get', '/api/fin/employees')).status).not.toBe(403);
    limparCachePapel(usuario);
    _definirPapelParaTestes(usuario, 'user');
    expect((await chamar('get', '/api/fin/employees')).status).toBe(403);
  });

  test('verifyAdmin usa o papel do banco', async () => {
    _definirPapelParaTestes(usuario, 'dentista');
    const res = await chamar('put', '/api/attendance-settings', {});
    expect(res.status).toBe(403);
  });

  test('rotas de usuários da clínica exigem admin do banco', async () => {
    _definirPapelParaTestes(usuario, 'recepcionista');
    expect((await chamar('get', '/api/my-tenant/users')).status).toBe(403);
  });
});

describe('papelAtual', () => {
  const poolCom = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });
  test('prioridade admin > dentista > recepcionista > user', async () => {
    const pool2 = poolCom([{ papel_ur: 'user', ativo: true }, { papel_ur: 'dentista', ativo: true }]);
    expect(await papelAtual(pool2, { id: 'u1', tenant_id: 'tA' })).toBe('dentista');
  });
  test('perfil inativo → sem acesso', async () => {
    expect(await papelAtual(poolCom([{ papel_ur: 'admin', ativo: false }]), { id: 'u2', tenant_id: 'tA' })).toBeNull();
  });
  test('sem user_roles usa profiles.role; papel desconhecido → sem acesso', async () => {
    expect(await papelAtual(poolCom([{ papel_ur: null, papel_perfil: 'recepcionista', ativo: true }]), { id: 'u3', tenant_id: 'tA' })).toBe('recepcionista');
    expect(await papelAtual(poolCom([{ papel_ur: 'comercial', ativo: true }]), { id: 'u4', tenant_id: 'tA' })).toBeNull();
  });
  test('cache de 60 s: segunda chamada não consulta o banco', async () => {
    const pool2 = poolCom([{ papel_ur: 'admin', ativo: true }]);
    await papelAtual(pool2, { id: 'u5', tenant_id: 'tA' });
    await papelAtual(pool2, { id: 'u5', tenant_id: 'tA' });
    expect(pool2.query).toHaveBeenCalledTimes(1);
  });
});

describe('dashboard e comissões', () => {
  test('dentista recebe os campos financeiros do dashboard como null', async () => {
    _definirPapelParaTestes(usuario, 'dentista');
    const res = await chamar('get', '/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.receitaMensal).toBeNull();
    expect(res.body.despesaMensal).toBeNull();
    expect(res.body.crm.receitaTotal).toBeNull();
  });
  test('admin recebe os números', async () => {
    _definirPapelParaTestes(usuario, 'admin');
    const res = await chamar('get', '/api/dashboard');
    expect(res.body.receitaMensal).toBe(0);
  });
  test('dentista vê só as próprias comissões', async () => {
    _definirPapelParaTestes(usuario, 'dentista');
    await chamar('get', '/api/comissoes');
    const q = sqlLog.find(x => /FROM comissoes c/.test(x.text));
    expect(q.text).toMatch(/AND LOWER\(d\.email\) = \$2/);
    expect(q.params).toEqual([tenantA, 'pessoa@clinica.com']);
  });
});

describe('perfil que não existe', () => {
  test('"comercial" é recusado com mensagem clara', async () => {
    _definirPapelParaTestes(usuario, 'admin');
    const res = await chamar('post', '/api/my-tenant/users', { name: 'X', email: 'x@c.com', password: 'senha-12345', role: 'comercial' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Perfil inválido. Use: admin, dentista, recepcionista, user');
  });
});

describe('rotas que entraram na revisão do Igor', () => {
  const EQUIPE_ROTAS = [
    ['get', '/api/exames'], ['post', '/api/exames', {}], ['patch', `/api/exames/${ID}`, {}],
    ['get', `/api/assinaturas/${ID}`], ['get', `/api/pacientes/${ID}/historico`],
    ['get', `/api/pacientes/${ID}/consentimentos`], ['post', `/api/pacientes/${ID}/consentimentos`, {}],
    ['post', `/api/consentimentos/${ID}/revogar`, {}],
    ['get', '/api/pacientes'], ['post', '/api/pacientes', {}], ['put', `/api/pacientes/${ID}`, {}],
    ['get', '/api/automations/solution-counts'],
  ];
  test.each(EQUIPE_ROTAS.map(([m, u, b]) => [m, u, b || null]))('%s %s: user 403, recepcionista passa', async (m, u, b) => {
    _definirPapelParaTestes(usuario, 'user');
    expect((await chamar(m, u, b)).status).toBe(403);
    limparCachePapel();
    _definirPapelParaTestes(usuario, 'recepcionista');
    expect((await chamar(m, u, b)).status).not.toBe(403);
  });

  test('jobs de campanha (telefone e texto): só admin', async () => {
    _definirPapelParaTestes(usuario, 'recepcionista');
    expect((await chamar('get', `/api/campaigns/${ID}/jobs`)).status).toBe(403);
    limparCachePapel();
    _definirPapelParaTestes(usuario, 'admin');
    expect((await chamar('get', `/api/campaigns/${ID}/jobs`)).status).not.toBe(403);
  });

  test('relatórios de IA: JWT admin mas papel dentista no banco → só os próprios', async () => {
    _definirPapelParaTestes(usuario, 'dentista');
    await chamar('get', '/api/ai/reports');
    const q = sqlLog.find(x => /FROM clinical_reports/.test(x.text));
    expect(q.text).toMatch(/attendant_id = \$/);
    expect(q.params).toContain(usuario);
  });

  test('painel comercial: attendantId de outro só para admin do banco', async () => {
    _definirPapelParaTestes(usuario, 'recepcionista');
    const res = await chamar('get', '/api/comercial/painel?attendantId=99999999-9999-9999-9999-999999999999');
    expect(res.body.attendantId).toBe(usuario);
  });

  test('não sobra papel do JWT nem "gerente" no servidor', () => {
    const src = readFileSync(path.join(__dirname, '../server.mjs'), 'utf8');
    expect(src).not.toMatch(/user\.role (===|!==) '(admin|gerente)'/);
    expect(src).not.toMatch(/'gerente'/);
  });

  test('GET /api/dashboard/kpis duplicado foi removido (uma única declaração)', () => {
    const src = readFileSync(path.join(__dirname, '../server.mjs'), 'utf8');
    expect(src.match(/app\.get\([^\n]*'\/api\/dashboard\/kpis'/g)).toHaveLength(1);
  });
});

describe('papel por clínica e super-admin', () => {
  test('papelAtual filtra a clínica do perfil e guarda cache por usuário + clínica', async () => {
    const q = jest.fn().mockImplementation((_sql, params) =>
      Promise.resolve({ rows: params[1] === 'tA' ? [{ papel_ur: 'admin', ativo: true }] : [] }));
    const pool2 = { query: q };
    expect(await papelAtual(pool2, { id: 'u9', tenant_id: 'tA' })).toBe('admin');
    expect(await papelAtual(pool2, { id: 'u9', tenant_id: 'tB' })).toBeNull(); // admin em A não é admin em B
    expect(q.mock.calls[0][0]).toMatch(/WHERE p\.id = \$1 AND p\.tenant_id = \$2/);
    expect(q).toHaveBeenCalledTimes(2);
  });

  test('sem clínica na requisição → sem papel', async () => {
    expect(await papelAtual({ query: jest.fn() }, { id: 'u10', tenant_id: null })).toBeNull();
  });

  const reqRes = () => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    return [{ method: 'GET', route: { path: '/x' } }, res];
  };
  test('super-admin em clínica que não é a dele → 403', async () => {
    const deps = {
      verifyUser: async () => ({ user: { id: 'sa1', tenant_id: 'tB', is_super_admin: true } }),
      pool: { query: async (_s, params) => ({ rows: params[1] === 'tA' ? [{ papel_ur: 'admin', ativo: true }] : [] }) },
    };
    const [req, res] = reqRes(); const next = jest.fn();
    await exigePapel(deps, 'admin', 'dentista')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
  test('super-admin passa só quando a rota lista super_admin', async () => {
    const deps = { verifyUser: async () => ({ user: { id: 'sa2', tenant_id: 'tB', is_super_admin: true } }), pool: { query: jest.fn() } };
    const [req, res] = reqRes(); const next = jest.fn();
    await exigePapel(deps, 'admin', 'super_admin')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.papel).toBe('super_admin');
  });
});
