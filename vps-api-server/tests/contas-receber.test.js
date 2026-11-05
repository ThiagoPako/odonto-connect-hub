// Contas a receber: isolamento por clínica, parcelas em centavos (R$ 1.000 em 3x),
// baixa cancelando a régua de cobrança e geração só para orçamento aprovado.
// pool.query mockado (nenhuma query chega ao Postgres).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool, dividirEmParcelasCentavos, addMesesIso, parseDataReceber } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const orcA = 'aaaaaaaa-0000-0000-0000-00000000000a';
const contaA = 'aaaaaaaa-0000-0000-0000-000000000001';
const pacienteA = 'aaaaaaaa-0000-0000-0000-0000000000a1';

const token = (tenant_id) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica.com', role: 'admin', tenant_id, is_super_admin: false,
}, JWT_SECRET);
const chamar = (method, url, tk, body) => {
  const r = request(app)[method](url).set('Authorization', `Bearer ${tk}`);
  return body ? r.send(body) : r;
};

let sqlLog;
let querySpy;
let orcamento;
let jaTemParcelas;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  orcamento = { id: orcA, paciente_id: pacienteA, valor_total: '1000.00', desconto: '0', status: 'aprovado' };
  jaTemParcelas = false;
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/FROM orcamentos o\s+JOIN pacientes p/.test(text)) {
      return Promise.resolve({ rows: params[0] === orcA && params[1] === tenantA ? [orcamento] : [] });
    }
    if (/SELECT 1 FROM financeiro WHERE tenant_id = \$1 AND orcamento_id = \$2/.test(text)) {
      return Promise.resolve({ rows: jaTemParcelas ? [{ '?column?': 1 }] : [] });
    }
    if (/^\s*UPDATE financeiro SET status = 'pago'/.test(text) || /^\s*UPDATE financeiro SET status = 'cancelado'/.test(text)) {
      const ok = params[0] === contaA && params[1] === tenantA;
      return Promise.resolve({ rows: ok ? [{ id: contaA }] : [], rowCount: ok ? 1 : 0 });
    }
    if (/SELECT 1 FROM pacientes WHERE id = \$1 AND tenant_id = \$2 LIMIT 1/.test(text)) {
      return Promise.resolve({ rows: params[0] === pacienteA && params[1] === tenantA ? [{}] : [] });
    }
    if (/AS a_vencer/.test(text)) return Promise.resolve({ rows: [{ a_vencer: '10', vencido: '5', recebido_mes: '1' }] });
    if (/INSERT INTO financeiro/.test(text)) return Promise.resolve({ rows: [{ id: 'novo' }], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

const insertParcelas = () => sqlLog.find(q => /INSERT INTO financeiro/.test(q.text));
const valoresInseridos = (q) => {
  const out = [];
  for (let i = 0; i < q.params.length; i += 10) out.push({ valor: q.params[i + 2], venc: q.params[i + 4], parcela: q.params[i + 6], tenant: q.params[i + 9] });
  return out;
};

describe('cálculo em centavos', () => {
  test('R$ 1.000 em 3x = 333,33 + 333,33 + 333,34', () => {
    expect(dividirEmParcelasCentavos(100000, 3)).toEqual([33333, 33333, 33334]);
  });
  test('soma sempre fecha o total', () => {
    for (const [t, n] of [[100, 3], [99999, 7], [1, 1], [123456, 48]]) {
      expect(dividirEmParcelasCentavos(t, n).reduce((a, b) => a + b, 0)).toBe(t);
    }
  });
  test('meses mantêm o dia, ajustando fim de mês', () => {
    expect(addMesesIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMesesIso('2026-11-10', 2)).toBe('2027-01-10');
  });
  test('datas: aaaa-mm-dd e dd/mm/aaaa; data impossível é recusada', () => {
    expect(parseDataReceber('10/12/2026')).toBe('2026-12-10');
    expect(parseDataReceber('2026-12-10')).toBe('2026-12-10');
    expect(parseDataReceber('31/02/2026')).toBeNull();
  });
});

describe('POST /api/orcamentos/:id/parcelas', () => {
  test('R$ 1.000 em 3x: um INSERT, centavos certos, tenant da clínica, vencimentos mensais', async () => {
    const res = await chamar('post', `/api/orcamentos/${orcA}/parcelas`, token(tenantA), { parcelas: 3, primeiro_vencimento: '10/12/2026' });
    expect(res.status).toBe(200);
    const linhas = valoresInseridos(insertParcelas());
    expect(linhas.map(l => l.valor)).toEqual(['333.33', '333.33', '333.34']);
    expect(linhas.map(l => l.venc)).toEqual(['2026-12-10', '2027-01-10', '2027-02-10']);
    expect(linhas.every(l => l.tenant === tenantA)).toBe(true);
    expect(sqlLog.filter(q => /INSERT INTO financeiro/.test(q.text))).toHaveLength(1);
  });

  test('com entrada e desconto: entrada é a parcela 0 e o resto fecha o total', async () => {
    orcamento = { ...orcamento, valor_total: '1100.00', desconto: '100.00' };
    const res = await chamar('post', `/api/orcamentos/${orcA}/parcelas`, token(tenantA), { parcelas: 3, primeiro_vencimento: '2026-12-10', entrada: 100 });
    expect(res.status).toBe(200);
    const linhas = valoresInseridos(insertParcelas());
    expect(linhas.map(l => l.parcela)).toEqual([0, 1, 2, 3]);
    expect(linhas.map(l => l.valor)).toEqual(['100.00', '300.00', '300.00', '300.00']);
  });

  test('clínica B recebe 404 no orçamento da A, sem INSERT', async () => {
    const res = await chamar('post', `/api/orcamentos/${orcA}/parcelas`, token(tenantB), { parcelas: 3, primeiro_vencimento: '2026-12-10' });
    expect(res.status).toBe(404);
    expect(insertParcelas()).toBeUndefined();
  });

  test('orçamento pendente não gera parcelas', async () => {
    orcamento = { ...orcamento, status: 'pendente' };
    const res = await chamar('post', `/api/orcamentos/${orcA}/parcelas`, token(tenantA), { parcelas: 2, primeiro_vencimento: '2026-12-10' });
    expect(res.status).toBe(400);
  });

  test('já gerado → 409', async () => {
    jaTemParcelas = true;
    const res = await chamar('post', `/api/orcamentos/${orcA}/parcelas`, token(tenantA), { parcelas: 2, primeiro_vencimento: '2026-12-10' });
    expect(res.status).toBe(409);
    expect(insertParcelas()).toBeUndefined();
  });

  test.each([[{ parcelas: 0, primeiro_vencimento: '2026-12-10' }], [{ parcelas: 2, primeiro_vencimento: '31/02/2026' }], [{ parcelas: 2, primeiro_vencimento: '2026-12-10', entrada: 1000 }]])(
    'entrada inválida %p → 400', async (body) => {
      const res = await chamar('post', `/api/orcamentos/${orcA}/parcelas`, token(tenantA), body);
      expect(res.status).toBe(400);
    });
});

describe('baixa e cancelamento', () => {
  test('baixa grava pago e cancela a régua só da conta e da clínica', async () => {
    const res = await chamar('post', `/api/contas-receber/${contaA}/baixa`, token(tenantA), { pago_em: '2026-11-01', forma_pagamento: 'pix' });
    expect(res.status).toBe(200);
    const upd = sqlLog.find(q => /UPDATE financeiro SET status = 'pago'/.test(q.text));
    expect(upd.params.slice(0, 4)).toEqual([contaA, tenantA, '2026-11-01', 'pix']);
    const cancel = sqlLog.find(q => /UPDATE automation_jobs SET status = 'cancelled'/.test(q.text));
    expect(cancel.text).toMatch(/trigger_event = 'billing_reminder'/);
    expect(cancel.params).toEqual([tenantA, 'Cancelado: conta paga', contaA]);
  });

  test('clínica B não dá baixa na conta da A (404, sem cancelar fila)', async () => {
    const res = await chamar('post', `/api/contas-receber/${contaA}/baixa`, token(tenantB), { pago_em: '2026-11-01', forma_pagamento: 'pix' });
    expect(res.status).toBe(404);
    expect(sqlLog.some(q => /UPDATE automation_jobs/.test(q.text))).toBe(false);
  });

  test.each([[{ pago_em: '2099-01-01', forma_pagamento: 'pix' }], [{ pago_em: '2026-11-01', forma_pagamento: 'cheque-voador' }]])(
    'baixa com %p → 400', async (body) => {
      const res = await chamar('post', `/api/contas-receber/${contaA}/baixa`, token(tenantA), body);
      expect(res.status).toBe(400);
    });

  test('cancelar conta também tira da fila', async () => {
    const res = await chamar('post', `/api/contas-receber/${contaA}/cancelar`, token(tenantA));
    expect(res.status).toBe(200);
    expect(sqlLog.find(q => /UPDATE automation_jobs/.test(q.text)).params[2]).toBe(contaA);
  });
});

describe('GET /api/contas-receber', () => {
  test.each(['aberto', 'vencido', 'pago', 'todos'])('situação %s filtra pela clínica', async (situacao) => {
    const res = await chamar('get', `/api/contas-receber?situacao=${situacao}`, token(tenantA));
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /FROM financeiro f/.test(x.text));
    expect(q.text).toMatch(/WHERE f\.tenant_id = \$1 AND f\.tipo = 'receita'/);
    expect(q.text).toMatch(/p\.tenant_id = f\.tenant_id/);
    expect(q.params[0]).toBe(tenantA);
    expect(res.body.totais).toEqual({ aVencer: 10, vencido: 5, recebidoMes: 1 });
  });

  test('situação inválida → 400', async () => {
    const res = await chamar('get', '/api/contas-receber?situacao=xyz', token(tenantA));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/contas-receber (avulsa)', () => {
  test('paciente de outra clínica → 400 sem INSERT', async () => {
    const res = await chamar('post', '/api/contas-receber', token(tenantB), { paciente_id: pacienteA, valor: 50, vencimento: '2026-12-01' });
    expect(res.status).toBe(400);
    expect(insertParcelas()).toBeUndefined();
  });
  test('cria com valor em centavos e tenant da clínica', async () => {
    const res = await chamar('post', '/api/contas-receber', token(tenantA), { paciente_id: pacienteA, valor: '10.005', vencimento: '01/12/2026' });
    expect(res.status).toBe(200);
    const ins = insertParcelas();
    expect(ins.params[2]).toBe('10.01');
    expect(ins.params[4]).toBe('2026-12-01');
    expect(ins.params[6]).toBe(tenantA);
  });
});
