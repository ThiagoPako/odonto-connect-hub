// Régua de cobrança: configuração por clínica, job por tenant, conta paga não cobra,
// dedupe por conta+etapa, opt-out e textos sem dado de saúde.
// pool.query mockado (nenhuma query chega ao Postgres).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const {
  app, pool, processBillingReminders, billingReminderBlockReason, renderBillingMessage,
  clearTenantSettingsCacheForTests,
} = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const contaA = 'aaaaaaaa-0000-0000-0000-000000000001';

const token = (tenant_id, role = 'admin') => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica.com', role, tenant_id, is_super_admin: false,
}, JWT_SECRET);

const ligada = { enabled: true, etapas: [{ dias: 3, texto: 'Olá, {nome}! Parcela de {valor} venceu em {vencimento}. {clinica}' }] };

let sqlLog;
let querySpy;
let settings;   // tenantId -> config
let contas;     // linhas devolvidas pela busca de contas (por tenant)
let optOut;     // telefones em opt-out
let contaStatus;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  clearTenantSettingsCacheForTests();
  sqlLog = [];
  settings = {};
  contas = {};
  optOut = new Set();
  contaStatus = { status: 'pendente', vencimento: '2026-11-02' };
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/SELECT tenant_id, value FROM tenant_settings WHERE key = \$1/.test(text)) {
      return Promise.resolve({ rows: Object.entries(settings).map(([tenant_id, value]) => ({ tenant_id, value })) });
    }
    if (/SELECT value FROM tenant_settings WHERE tenant_id = \$1 AND key = \$2/.test(text)) {
      const v = settings[params[0]];
      return Promise.resolve({ rows: v ? [{ value: v }] : [] });
    }
    if (/FROM financeiro f\s+JOIN pacientes p/.test(text)) return Promise.resolve({ rows: contas[params[0]] || [] });
    if (/FROM whatsapp_opt_outs WHERE tenant_id = \$1 AND phone_key = \$2/.test(text)) {
      return Promise.resolve({ rows: optOut.has(params[1]) ? [{ '?column?': 1 }] : [] });
    }
    if (/SELECT status, to_char\(vencimento/.test(text)) {
      return Promise.resolve({ rows: params[1] === tenantA && params[0] === contaA ? [contaStatus] : [] });
    }
    if (/SELECT nome FROM tenants/.test(text)) return Promise.resolve({ rows: [{ nome: 'Clínica Sorriso' }] });
    if (/INSERT INTO automation_jobs/.test(text)) return Promise.resolve({ rows: [{ id: 'job1' }] });
    if (/^\s*UPDATE financeiro SET/.test(text)) return Promise.resolve({ rowCount: params.includes(tenantA) ? 1 : 0 });
    if (/SELECT \* FROM financeiro WHERE id=\$1 AND tenant_id=\$2/.test(text)) return Promise.resolve({ rows: [{ id: contaA }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

const inserts = () => sqlLog.filter(q => /INSERT INTO automation_jobs/.test(q.text));
const contaPadrao = { id: contaA, valor: '150.5', vencimento: '2026-11-02', nome: 'Maria Silva', telefone: '11987654321' };

describe('job processBillingReminders', () => {
  test('só a clínica que ligou é cobrada, com tenant_id em todas as consultas', async () => {
    settings = { [tenantA]: ligada, [tenantB]: { ...ligada, enabled: false } };
    contas = { [tenantA]: [contaPadrao], [tenantB]: [{ ...contaPadrao, id: 'b1' }] };
    await processBillingReminders();
    const buscas = sqlLog.filter(q => /FROM financeiro f\s+JOIN pacientes p/.test(q.text));
    expect(buscas).toHaveLength(1);
    expect(buscas[0].params[0]).toBe(tenantA);
    expect(buscas[0].text).toMatch(/p\.tenant_id = f\.tenant_id/);
    expect(buscas[0].text).toMatch(/aj\.tenant_id = f\.tenant_id/);
    const [ins] = inserts();
    expect(ins.params).toContain(tenantA);
    expect(ins.params).toContain('transactional');
    expect(ins.params).toContain('billing_reminder');
    expect(ins.params).toContain(`billing_${contaA}_2026-11-02_3`);
  });

  test('padrão é desligado: sem configuração, nada é enfileirado', async () => {
    contas = { [tenantA]: [contaPadrao] };
    await processBillingReminders();
    expect(inserts()).toHaveLength(0);
  });

  test('só contas em aberto e dedupe por conta + vencimento + etapa', async () => {
    settings = { [tenantA]: ligada };
    await processBillingReminders();
    const busca = sqlLog.find(q => /FROM financeiro f\s+JOIN pacientes p/.test(q.text));
    expect(busca.text).toMatch(/LOWER\(COALESCE\(f\.status, ''\)\) = ANY\(\$4::text\[\]\)/);
    expect(busca.params[3]).toEqual(['pendente', 'atrasado', 'vencido']);
    expect(busca.text).toMatch(/aj\.flow_id = 'billing_' \|\| f\.id::text \|\| '_' \|\| to_char\(f\.vencimento, 'YYYY-MM-DD'\) \|\| '_' \|\| \$3::text/);
  });

  test('paciente em opt-out não recebe', async () => {
    settings = { [tenantA]: ligada };
    contas = { [tenantA]: [contaPadrao] };
    optOut.add('1187654321'); // chave do waPhoneKey (DDD + 8 dígitos)
    await processBillingReminders();
    expect(inserts()).toHaveLength(0);
  });

  test('mensagem fala só de valor e vencimento (sem a descrição da conta)', async () => {
    settings = { [tenantA]: ligada };
    contas = { [tenantA]: [{ ...contaPadrao, descricao: 'Tratamento de canal' }] };
    await processBillingReminders();
    const msg = inserts()[0].params[3];
    expect(msg).toBe('Olá, Maria! Parcela de R$ 150,50 venceu em 02/11/2026. Clínica Sorriso');
    expect(msg).not.toMatch(/canal|tratamento/i);
  });
});

describe('conferência antes do envio', () => {
  const vars = { contaId: contaA, etapa: 3, vencimento: '2026-11-02' };
  test('conta em aberto e régua ligada: pode enviar', async () => {
    settings = { [tenantA]: ligada };
    expect(await billingReminderBlockReason(tenantA, vars)).toBeNull();
  });
  test('conta paga não cobra', async () => {
    settings = { [tenantA]: ligada };
    contaStatus = { status: 'pago', vencimento: '2026-11-02' };
    expect(await billingReminderBlockReason(tenantA, vars)).toEqual({ acao: 'fail', motivo: 'Cancelado: conta paga ou cancelada' });
  });
  test('vencimento mudou: cancela', async () => {
    settings = { [tenantA]: ligada };
    contaStatus = { status: 'pendente', vencimento: '2026-12-02' };
    expect((await billingReminderBlockReason(tenantA, vars)).acao).toBe('fail');
  });
  test('régua desligada depois de enfileirar: cancela', async () => {
    settings = { [tenantA]: { ...ligada, enabled: false } };
    expect((await billingReminderBlockReason(tenantA, vars)).motivo).toMatch(/desligada/);
  });
  test('conta de outra clínica: não encontrada', async () => {
    settings = { [tenantB]: ligada };
    expect((await billingReminderBlockReason(tenantB, vars)).motivo).toMatch(/não encontrada/);
  });
});

describe('API /api/billing-reminder/settings', () => {
  test('GET sem configuração devolve desligado', async () => {
    const res = await request(app).get('/api/billing-reminder/settings').set('Authorization', `Bearer ${token(tenantA)}`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.etapas.length).toBeGreaterThan(0);
  });

  test('PUT grava na clínica do usuário e cancela pendentes só dela', async () => {
    const res = await request(app).put('/api/billing-reminder/settings')
      .set('Authorization', `Bearer ${token(tenantA)}`).send(ligada);
    expect(res.status).toBe(200);
    const save = sqlLog.find(q => /INSERT INTO tenant_settings/.test(q.text));
    expect(save.params[0]).toBe(tenantA);
    const cancel = sqlLog.find(q => /UPDATE automation_jobs SET status = 'cancelled'/.test(q.text));
    expect(cancel.text).toMatch(/tenant_id = \$1 AND trigger_event = 'billing_reminder'/);
    expect(cancel.params[0]).toBe(tenantA);
  });

  test.each([
    ['procedimento', 'Olá {nome}, falta pagar o tratamento de canal'],
    ['constrangimento', 'Olá {nome}, seu nome vai para o Serasa'],
    ['variável desconhecida', 'Olá {nome}, {procedimento}'],
    ['link', 'Pague em https://exemplo.com'],
  ])('PUT recusa texto com %s → 400', async (_caso, texto) => {
    const res = await request(app).put('/api/billing-reminder/settings')
      .set('Authorization', `Bearer ${token(tenantA)}`).send({ enabled: true, etapas: [{ dias: 0, texto }] });
    expect(res.status).toBe(400);
    expect(sqlLog.some(q => /INSERT INTO tenant_settings/.test(q.text))).toBe(false);
  });

  test('PUT exige admin', async () => {
    const res = await request(app).put('/api/billing-reminder/settings')
      .set('Authorization', `Bearer ${token(tenantA, 'atendente')}`).send(ligada);
    expect(res.status).toBe(403);
  });
});

describe('conta paga pela API tira a cobrança da fila', () => {
  test('PUT /api/financeiro/:id com status pago cancela pendentes da conta na clínica', async () => {
    const res = await request(app).put(`/api/financeiro/${contaA}`)
      .set('Authorization', `Bearer ${token(tenantA)}`).send({ status: 'pago' });
    expect(res.status).toBe(200);
    const cancel = sqlLog.find(q => /UPDATE automation_jobs SET status = 'cancelled'/.test(q.text));
    expect(cancel.text).toMatch(/variables->>'contaId' = \$3/);
    expect(cancel.params).toEqual([tenantA, expect.any(String), contaA]);
  });
});

describe('renderBillingMessage', () => {
  test('sem nome não deixa "Olá, !"', () => {
    expect(renderBillingMessage('Olá, {nome}! Vence {vencimento}.', { nome: '', valor: 10, vencimento: '05/11/2026' }))
      .toBe('Olá! Vence 05/11/2026.');
  });
});
