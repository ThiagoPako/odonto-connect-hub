// Cadastros e permissões (auditoria 07/11): validação de paciente, PUT parcial, estoque sem saldo
// negativo, limite de usuários do plano, último admin e usuário desativado.
// pool.query e pool.connect mockados: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { assinarComPapel } from './helpers/papel-do-jwt.mjs';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { cpfValido, validarPaciente, quantidadeEstoque } from '../cadastros-validacao.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const TENANT = '11111111-1111-1111-1111-111111111111';
const ADMIN = '44444444-4444-4444-4444-444444444444';
const OUTRO = '55555555-5555-5555-5555-555555555555';
const PAC = '33333333-3333-3333-3333-333333333333';
const ITEM = '66666666-6666-6666-6666-666666666666';
const tok = (extra = {}) => assinarComPapel({ sub: ADMIN, email: 'a@x.com', role: 'admin', tenant_id: TENANT, is_super_admin: false, ...extra }, JWT_SECRET);

describe('funções puras', () => {
  test('cpfValido', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224726')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('123')).toBe(false);
  });
  test('validarPaciente: criação', () => {
    expect(validarPaciente({ nome: '' }).erro).toMatch(/nome/i);
    expect(validarPaciente({ nome: 'Ana', cpf: '123' }).erro).toMatch(/CPF/);
    expect(validarPaciente({ nome: 'Ana', email: 'x' }).erro).toMatch(/E-mail/);
    expect(validarPaciente({ nome: 'Ana', telefone: '1' }).erro).toMatch(/Telefone/);
    expect(validarPaciente({ nome: 'Ana', data_nascimento: '31/12/2020' }).erro).toMatch(/Data/);
    expect(validarPaciente({ nome: 'Ana', data_nascimento: '2999-01-01' }).erro).toMatch(/Data/);
    const ok = validarPaciente({ nome: ' Ana ', cpf: '529.982.247-25', email: 'A@B.com', data_nascimento: '', telefone: '5511988887777' });
    expect(ok.erro).toBeUndefined();
    expect(ok.campos).toMatchObject({ nome: 'Ana', cpf: '52998224725', email: 'a@b.com', data_nascimento: null });
  });
  test('validarPaciente: edição parcial só valida o que mudou', () => {
    const original = { cpf: '123', telefone: '1', email: 'velho', data_nascimento: null };
    const r = validarPaciente({ nome: 'Ana', cpf: '123', email: 'velho' }, { original, parcial: true });
    expect(r.erro).toBeUndefined();
    expect(Object.keys(r.campos).sort()).toEqual(['cpf', 'email', 'nome']);
    expect(validarPaciente({ cpf: '124' }, { original, parcial: true }).erro).toMatch(/CPF/);
    expect(validarPaciente({ observacoes: 'x' }, { original, parcial: true }).campos).toEqual({ observacoes: 'x' });
  });
  test('quantidadeEstoque', () => {
    expect(quantidadeEstoque(5)).toBe(5);
    expect(quantidadeEstoque('5')).toBe(5);
    expect(quantidadeEstoque(0)).toBe(0);
    expect(quantidadeEstoque(0, { positivo: true })).toBeNull();
    expect(quantidadeEstoque(-1)).toBeNull();
    expect(quantidadeEstoque(1.5)).toBeNull();
    expect(quantidadeEstoque('abc')).toBeNull();
    expect(quantidadeEstoque('')).toBeNull();
  });
});

describe('rotas', () => {
  let querySpy, connectSpy, sqlLog, estado;
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  beforeEach(() => {
    sqlLog = [];
    estado = { saldo: 3, ativos: { [ADMIN]: true, [OUTRO]: true }, admins: [ADMIN], maxUsuarios: null, ativosCount: 1 };
    const responder = (sql, params = []) => {
      const t = String(sql);
      sqlLog.push({ t, params });
      if (/COALESCE\(p\.active, true\) AS active, COALESCE\(p\.is_super_admin, false\)/.test(t)) {
        return { rows: [{ active: estado.ativos[params[0]] !== false, role: estado.papelNoBanco?.[params[0]] ?? null, is_super_admin: false }] };
      }
      if (/SELECT COALESCE\(active, true\) AS active FROM profiles WHERE id = \$1 LIMIT 1/.test(t)) {
        return { rows: [{ active: estado.ativos[params[0]] !== false }] };
      }
      if (/SELECT cpf, telefone, email, data_nascimento FROM pacientes/.test(t)) {
        return params[0] === PAC && params[1] === TENANT ? { rows: [{ cpf: '111', telefone: '5511900000001', email: null, data_nascimento: null }] } : { rows: [] };
      }
      if (/^\s*UPDATE pacientes SET/.test(t)) return { rows: [], rowCount: 1 };
      if (/SELECT quantidade FROM estoque WHERE id=\$1 AND tenant_id=\$2 FOR UPDATE/.test(t)) {
        return params[0] === ITEM && params[1] === TENANT ? { rows: [{ quantidade: estado.saldo }] } : { rows: [] };
      }
      if (/UPDATE estoque SET quantidade = quantidade \+ \$1/.test(t)) { estado.saldo += params[0]; return { rows: [], rowCount: 1 }; }
      if (/SELECT \* FROM estoque WHERE id=\$1/.test(t)) return { rows: [{ id: ITEM, quantidade: estado.saldo }] };
      if (/SELECT id, tenant_id, COALESCE\(is_super_admin, false\) AS is_super_admin FROM profiles WHERE id = \$1/.test(t)) {
        return { rows: [{ id: params[0], tenant_id: TENANT, is_super_admin: false }] };
      }
      if (/COALESCE\(ur.role::text, p.role::text\) = 'admin'/.test(t)) return { rows: estado.admins.map(id => ({ id })) };
      if (/SELECT pl.max_usuarios FROM tenants/.test(t)) return { rows: [{ max_usuarios: estado.maxUsuarios }] };
      if (/SELECT COUNT\(\*\)::int AS c FROM profiles/.test(t)) return { rows: [{ c: estado.ativosCount }] };
      if (/SELECT id FROM profiles WHERE email = \$1/.test(t)) return { rows: [] };
      return { rows: [], rowCount: 0 };
    };
    querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => responder(sql, params));
    connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => ({
      query: async (sql, params) => responder(sql, params),
      release: () => {},
    }));
  });
  afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });

  const sqlDe = (re) => sqlLog.filter(q => re.test(q.t));

  test('POST /api/pacientes recusa CPF inválido sem gravar', async () => {
    const r = await request(app).post('/api/pacientes').set('Authorization', `Bearer ${tok()}`).send({ nome: 'Ana', cpf: '123' });
    expect(r.status).toBe(400);
    expect(sqlDe(/INSERT INTO pacientes/)).toHaveLength(0);
  });

  test('PUT /api/pacientes/:id só grava os campos enviados (não apaga telefone/CPF)', async () => {
    const r = await request(app).put(`/api/pacientes/${PAC}`).set('Authorization', `Bearer ${tok()}`).send({ nome: 'Ana 2' });
    expect(r.status).toBe(200);
    const [up] = sqlDe(/^\s*UPDATE pacientes SET/);
    expect(up.t).toMatch(/SET nome=\$1, updated_at=NOW\(\) WHERE id=\$2 AND tenant_id=\$3/);
    expect(up.params).toEqual(['Ana 2', PAC, TENANT]);
  });

  test('PUT /api/pacientes/:id de outra clínica → 404 sem UPDATE', async () => {
    const r = await request(app).put(`/api/pacientes/${PAC}`).set('Authorization', `Bearer ${tok({ tenant_id: '22222222-2222-2222-2222-222222222222' })}`).send({ nome: 'x' });
    expect(r.status).toBe(404);
    expect(sqlDe(/^\s*UPDATE pacientes SET/)).toHaveLength(0);
  });

  test('DELETE /api/pacientes/:id por não-admin → 403 (antes 500)', async () => {
    const r = await request(app).delete(`/api/pacientes/${PAC}`).set('Authorization', `Bearer ${tok({ role: 'recepcionista' })}`);
    expect(r.status).toBe(403);
  });

  test.each([
    [{ tipo: 'saida', quantidade: -50 }, 400],
    [{ tipo: 'qualquer', quantidade: 1 }, 400],
    [{ tipo: 'entrada', quantidade: 'abc' }, 400],
    [{ tipo: 'saida', quantidade: 4 }, 409],
  ])('movimento de estoque %j → %i, saldo intacto', async (body, status) => {
    const r = await request(app).post(`/api/estoque/${ITEM}/movimentos`).set('Authorization', `Bearer ${tok()}`).send(body);
    expect(r.status).toBe(status);
    expect(estado.saldo).toBe(3);
    expect(sqlDe(/INSERT INTO estoque_movimentos/)).toHaveLength(0);
  });

  test('saída dentro do saldo grava movimento e baixa o saldo', async () => {
    const r = await request(app).post(`/api/estoque/${ITEM}/movimentos`).set('Authorization', `Bearer ${tok()}`).send({ tipo: 'saida', quantidade: 3 });
    expect(r.status).toBe(200);
    expect(estado.saldo).toBe(0);
    expect(sqlDe(/INSERT INTO estoque_movimentos/)).toHaveLength(1);
    expect(sqlDe(/COMMIT/)).toHaveLength(1);
  });

  test('POST /api/estoque com quantidade negativa → 400', async () => {
    const r = await request(app).post('/api/estoque').set('Authorization', `Bearer ${tok()}`).send({ nome: 'Luva', quantidade: -7 });
    expect(r.status).toBe(400);
  });

  test('POST /api/auth/create-user respeita o limite do plano', async () => {
    estado.maxUsuarios = 4; estado.ativosCount = 4;
    const r = await request(app).post('/api/auth/create-user').set('Authorization', `Bearer ${tok()}`)
      .send({ name: 'X', email: 'x@x.com', password: 'Senha1234', role: 'user' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Limite de 4/);
    expect(sqlDe(/INSERT INTO profiles/)).toHaveLength(0);
  });

  test.each([
    ['PUT', `/api/auth/users/${ADMIN}`, { role: 'user' }],
    ['PATCH', `/api/my-tenant/users/${ADMIN}`, { role: 'dentista' }],
  ])('%s %s: único admin não pode ser rebaixado', async (m, url, body) => {
    const r = await request(app)[m.toLowerCase()](url).set('Authorization', `Bearer ${tok()}`).send(body);
    expect(r.status).toBe(409);
    expect(sqlDe(/INSERT INTO user_roles/)).toHaveLength(0);
  });

  test('PUT /api/auth/users/:id: admin não se desativa (antes permitido)', async () => {
    estado.admins = [ADMIN, OUTRO];
    const r = await request(app).put(`/api/auth/users/${ADMIN}`).set('Authorization', `Bearer ${tok()}`).send({ active: false });
    expect(r.status).toBe(400);
  });

  test('rebaixar um admin quando há outro continua permitido', async () => {
    estado.admins = [ADMIN, OUTRO];
    const r = await request(app).put(`/api/auth/users/${OUTRO}`).set('Authorization', `Bearer ${tok()}`).send({ role: 'dentista' });
    expect(r.status).toBe(200);
  });

  test('usuário desativado é recusado mesmo com token válido', async () => {
    estado.ativos[OUTRO] = false;
    const r = await request(app).get('/api/pacientes').set('Authorization', `Bearer ${tok({ sub: OUTRO, role: 'recepcionista' })}`);
    expect(r.status).toBe(401);
    expect(sqlDe(/SELECT \* FROM pacientes WHERE tenant_id/)).toHaveLength(0);
  });
});
