// Financeiro: quem acessa, pagamento duplo de conta/folha, valores inválidos, desconto no
// "Valor Aprovado", orçamento aprovado travado, comissão validada e o gatilho de cobrança
// desligado. pool.query e pool.connect mockados (nenhuma query chega ao Postgres).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { assinarComPapel } from './helpers/papel-do-jwt.mjs';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '../.env') });

const { app, pool, processSolutionTriggers } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const banco = '33333333-3333-3333-3333-333333333333';
const conta = '55555555-5555-5555-5555-555555555555';
const contaDaB = '66666666-6666-6666-6666-666666666666';
const pacienteA = 'aa100000-0000-0000-0000-000000000001';
const pacienteB = 'bb100000-0000-0000-0000-000000000001';
const dentistaB = 'db000000-0000-0000-0000-000000000001';
const orcAprovado = '77777777-7777-7777-7777-777777777777';
const orcPendente = '88888888-8888-8888-8888-888888888888';

const auth = (role = 'admin', tenant_id = tenantA) => ({
  Authorization: `Bearer ${assinarComPapel({ sub: '44444444-4444-4444-4444-444444444444', email: 'u@clinica.com', role, tenant_id, is_super_admin: false }, JWT_SECRET)}`,
});

let sqlLog, querySpy, connectSpy, movimentos, saldo, orcamentos;

// Responde como o Postgres para as tabelas que estes testes usam.
function responder(sql, params = []) {
  const text = String(sql);
  sqlLog.push({ text, params });
  const ok = (rows, rowCount = rows.length) => Promise.resolve({ rows, rowCount });
  if (/FROM user_roles WHERE user_id/.test(text)) return ok([]); // ninguém tem papel admin extra
  if (/SELECT 1 FROM fin_bank_accounts WHERE id=\$1 AND tenant_id=\$2/.test(text)) return ok(params[0] === banco && params[1] === tenantA ? [{}] : []);
  if (/SELECT id FROM fin_bills WHERE id=\$1 AND tenant_id=\$2 FOR UPDATE/.test(text)) {
    const dono = { [conta]: tenantA, [contaDaB]: tenantB }[params[0]];
    return ok(dono === params[1] ? [{ id: params[0] }] : []);
  }
  if (/SELECT 1 FROM fin_movements WHERE bill_id=\$1 AND tenant_id=\$2/.test(text)) return ok(movimentos.some(m => m.bill_id === params[0]) ? [{}] : []);
  if (/INSERT INTO fin_movements/.test(text)) {
    movimentos.push({ id: params[0], type: params[1], value: params[4], bill_id: params[9] });
    return ok([], 1);
  }
  if (/UPDATE fin_bank_accounts SET balance = balance ([+-]) \$1/.test(text)) {
    const op = /balance \+ \$1/.test(text) ? 1 : -1;
    saldo = Math.round((saldo + op * Number(params[0])) * 100) / 100;
    return ok([], 1);
  }
  if (/SELECT \* FROM fin_movements WHERE id=\$1/.test(text)) return ok(movimentos.filter(m => m.id === params[0]));
  if (/FROM fin_employees WHERE active=true AND tenant_id=\$1/.test(text)) return ok([{ id: 'e1', name: 'Fulana', salary: '3000.00', cpf: '000.000.000-00' }]);
  if (/SELECT status, valor_total, desconto FROM orcamentos WHERE id=\$1 AND tenant_id=\$2/.test(text)) {
    const o = orcamentos[params[0]];
    return ok(o && params[1] === tenantA ? [o] : []);
  }
  if (/SELECT 1 FROM (pacientes|dentistas) WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
    const donos = { [pacienteA]: tenantA, [pacienteB]: tenantB, [dentistaB]: tenantB };
    return ok(donos[params[0]] === params[1] ? [{}] : []);
  }
  if (/UPDATE orcamentos SET/.test(text)) return ok([], 1);
  if (/SELECT \* FROM orcamentos WHERE id=\$1 AND tenant_id=\$2/.test(text)) return ok([{ id: params[0] }]);
  if (/FROM orcamentos WHERE tenant_id = \$1 GROUP BY status/.test(text)) {
    // Banco de mentira: aplica a expressão de soma que o servidor pediu.
    const liquido = /SUM\(valor_total - COALESCE\(desconto, 0\)\)/.test(text);
    return ok([{ status: 'aprovado', qtd: 1, soma: liquido ? '900.00' : '1000.00' }]);
  }
  if (/FROM automation_flows\s+WHERE active = true AND trigger_event = \$1/.test(text)) return ok([{ tenant_id: tenantA }]);
  return ok([]);
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = []; movimentos = []; saldo = 1000;
  orcamentos = {
    [orcAprovado]: { status: 'aprovado', valor_total: '1000.00', desconto: '100.00' },
    [orcPendente]: { status: 'pendente', valor_total: '1000.00', desconto: '0.00' },
  };
  querySpy = jest.spyOn(pool, 'query').mockImplementation(responder);
  connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => ({ query: responder, release: () => {} }));
});

afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

const pagar = (extra = {}) => request(app).post('/api/fin/movements').set(auth()).send({
  type: 'saida', description: 'Aluguel', category: 'aluguel', value: 300.1, date: '07/11/2026', bank_account_id: banco, bill_id: conta, ...extra,
});

describe('Financeiro: acesso só do administrador', () => {
  test.each(['recepcionista', 'dentista', 'comercial'])('%s não lê salários nem lança saída', async (role) => {
    expect((await request(app).get('/api/fin/employees').set(auth(role))).status).toBe(403);
    expect((await request(app).get('/api/comissoes').set(auth(role))).status).toBe(403);
    expect((await request(app).get('/api/financeiro').set(auth(role))).status).toBe(403);
    const r = await request(app).post('/api/fin/movements').set(auth(role)).send({ type: 'saida', value: 1, bank_account_id: banco });
    expect(r.status).toBe(403);
    expect(movimentos).toHaveLength(0);
  });

  test('admin lê; sem token é 401', async () => {
    expect((await request(app).get('/api/fin/employees').set(auth())).status).toBe(200);
    expect((await request(app).get('/api/fin/employees')).status).toBe(401);
  });
});

describe('Financeiro: lançamento e pagamento de conta', () => {
  test('pagar a mesma conta duas vezes debita uma vez só (segundo recebe 409)', async () => {
    expect((await pagar()).status).toBe(201);
    const segundo = await pagar();
    expect(segundo.status).toBe(409);
    expect(segundo.body.error).toMatch(/já foi paga/);
    expect(movimentos).toHaveLength(1);
    expect(saldo).toBe(699.9); // 1000 − 300,10, e não 399,80
    // a conta é travada na transação antes de checar a duplicidade
    expect(sqlLog.some(s => /FOR UPDATE/.test(s.text))).toBe(true);
    expect(sqlLog.filter(s => s.text === 'COMMIT')).toHaveLength(1);
  });

  test('conta de outra clínica: 404 e nada lançado', async () => {
    const r = await pagar({ bill_id: contaDaB });
    expect(r.status).toBe(404);
    expect(movimentos).toHaveLength(0);
    expect(saldo).toBe(1000);
  });

  test.each([[-50], [0], ['abc'], [null], [Number.NaN]])('valor %p é recusado', async (value) => {
    const r = await pagar({ value, bill_id: undefined });
    expect(r.status).toBe(400);
    expect(saldo).toBe(1000);
  });

  test('tipo desconhecido é recusado (antes virava saída)', async () => {
    expect((await pagar({ type: 'estorno', bill_id: undefined })).status).toBe(400);
    expect(saldo).toBe(1000);
  });

  test('valor com mais de 2 casas é arredondado a centavos no lançamento e no saldo', async () => {
    expect((await pagar({ type: 'entrada', value: '10.005', bill_id: undefined })).status).toBe(201);
    expect(movimentos[0].value).toBe(10.01);
    expect(saldo).toBe(1010.01);
  });
});

describe('Dashboard: Valor Aprovado é líquido do desconto', () => {
  test('orçamento de 1.000 com 100 de desconto conta 900', async () => {
    const r = await request(app).get('/api/dashboard').set(auth());
    expect(r.status).toBe(200);
    expect(r.body.orcamentos.valorAprovado).toBe(900);
    expect(r.body.orcamentos.ticketMedio).toBe(900);
  });
});

describe('Orçamentos: valores e travas', () => {
  test('aprovado não muda preço/desconto/parcelas (409); título muda', async () => {
    const r = await request(app).put(`/api/orcamentos/${orcAprovado}`).set(auth()).send({ valor_total: 50 });
    expect(r.status).toBe(409);
    expect(sqlLog.some(s => /UPDATE orcamentos SET/.test(s.text))).toBe(false);
    expect((await request(app).put(`/api/orcamentos/${orcAprovado}`).set(auth()).send({ titulo: 'Novo título' })).status).toBe(200);
  });

  test('pendente: desconto maior que o subtotal gravado é recusado', async () => {
    expect((await request(app).put(`/api/orcamentos/${orcPendente}`).set(auth()).send({ desconto: 1500 })).status).toBe(400);
    expect((await request(app).put(`/api/orcamentos/${orcPendente}`).set(auth()).send({ desconto: 100 })).status).toBe(200);
  });

  test('status fora da lista e parcelas quebradas são recusados', async () => {
    expect((await request(app).put(`/api/orcamentos/${orcPendente}`).set(auth()).send({ status: 'qualquer' })).status).toBe(400);
    expect((await request(app).put(`/api/orcamentos/${orcPendente}`).set(auth()).send({ parcelas: 2.5 })).status).toBe(400);
  });

  test('criar: desconto > total e paciente de outra clínica são recusados', async () => {
    const base = { paciente_id: pacienteA, itens: [], valor_total: 100, desconto: 0 };
    expect((await request(app).post('/api/orcamentos').set(auth()).send({ ...base, desconto: 500 })).status).toBe(400);
    expect((await request(app).post('/api/orcamentos').set(auth()).send({ ...base, paciente_id: pacienteB })).status).toBe(400);
    expect(sqlLog.some(s => /INSERT INTO orcamentos/.test(s.text))).toBe(false);
  });
});

describe('Comissões: valores e referências', () => {
  test('percentual acima de 100, valor negativo e dentista de outra clínica são recusados', async () => {
    const base = { valor: 30, percentual: 10, paciente_id: pacienteA };
    expect((await request(app).post('/api/comissoes').set(auth()).send({ ...base, percentual: 150 })).status).toBe(400);
    expect((await request(app).post('/api/comissoes').set(auth()).send({ ...base, valor: -1 })).status).toBe(400);
    expect((await request(app).post('/api/comissoes').set(auth()).send({ ...base, dentista_id: dentistaB })).status).toBe(400);
    expect(sqlLog.some(s => /INSERT INTO comissoes/.test(s.text))).toBe(false);
    expect((await request(app).post('/api/comissoes').set(auth()).send(base)).status).toBe(200);
  });
});

describe('Automação de cobrança "Parcela ou pagamento em atraso"', () => {
  test('não procura pacientes nem enfileira mensagem, mesmo com fluxo ligado', async () => {
    await processSolutionTriggers();
    const consultas = sqlLog.filter(s => /trigger_event = \$1/.test(s.text)).map(s => s.params[0]);
    expect(consultas).not.toContain('Parcela ou pagamento em atraso');
    expect(sqlLog.some(s => /FROM financeiro f/.test(s.text))).toBe(false);
  });
});
