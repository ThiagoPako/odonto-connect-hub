// Régua de cobrança: configuração por clínica, job por tenant, conta paga não cobra,
// dedupe por conta+etapa, opt-out, responsável financeiro, 1 mensagem por pessoa por dia,
// feriado, validade até 20h, pausa por "já paguei" e textos do parecer jurídico.
// pool.query mockado (nenhuma query chega ao Postgres). Só o Date é falso (relógio fixo).
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
  validateBillingReminderConfig, isFeriadoNacional, isBillingContestText, pauseBillingForPhone,
  clearTenantSettingsCacheForTests,
} = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const contaA = 'aaaaaaaa-0000-0000-0000-000000000001';
const contaA2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const pacienteA = 'aaaaaaaa-0000-0000-0000-0000000000a1';

// Quarta-feira, 04/11/2026, 10h em Brasília (dia útil, sem feriado).
const QUARTA_10H = new Date('2026-11-04T13:00:00Z');
const usarRelogio = (d) => jest.useFakeTimers({
  now: d, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
});

const token = (tenant_id, role = 'admin') => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica.com', role, tenant_id, is_super_admin: false,
}, JWT_SECRET);

const TEXTO = 'Olá, {nome}! Aqui é da {clinica}. O pagamento de {valor} venceu em {vencimento}.';
const ligada = { enabled: true, etapas: [{ dias: 3, texto: TEXTO }] };

let sqlLog, querySpy, settings, contas, optOut, contaStatus, jaCobradoHoje, jobsEnviados;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  usarRelogio(QUARTA_10H);
  clearTenantSettingsCacheForTests();
  sqlLog = [];
  settings = {};
  contas = {};          // `${tenant}:${dias}` -> linhas
  optOut = new Set();
  contaStatus = { [contaA]: { id: contaA, status: 'pendente', vencimento: '2026-11-01', cobranca_pausada_em: null } };
  jaCobradoHoje = false;
  jobsEnviados = [];
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
    if (/FROM financeiro f\s+JOIN pacientes p/.test(text)) return Promise.resolve({ rows: contas[`${params[0]}:${params[2]}`] || [] });
    if (/FROM whatsapp_opt_outs WHERE tenant_id = \$1 AND phone_key = \$2/.test(text)) {
      return Promise.resolve({ rows: optOut.has(params[1]) ? [{}] : [] });
    }
    if (/AT TIME ZONE '[^']+'\)::date = \$2::date/.test(text)) return Promise.resolve({ rows: jaCobradoHoje ? [{}] : [] });
    if (/FROM financeiro WHERE id::text = ANY\(\$1::text\[\]\) AND tenant_id = \$2/.test(text)) {
      return Promise.resolve({ rows: params[1] === tenantA ? params[0].map(id => contaStatus[id]).filter(Boolean) : [] });
    }
    if (/SELECT nome FROM tenants/.test(text)) return Promise.resolve({ rows: [{ nome: 'Clínica Sorriso' }] });
    if (/INSERT INTO automation_jobs/.test(text)) return Promise.resolve({ rows: [{ id: 'job1' }] });
    if (/SELECT variables FROM automation_jobs/.test(text)) return Promise.resolve({ rows: params[0] === tenantA ? jobsEnviados : [] });
    if (/UPDATE financeiro SET cobranca_pausada_em = NOW\(\)/.test(text)) {
      return Promise.resolve({ rows: params[0] === tenantA ? params[1].map(id => ({ id })) : [] });
    }
    if (/^\s*UPDATE financeiro SET/.test(text)) return Promise.resolve({ rowCount: params.includes(tenantA) ? 1 : 0 });
    if (/SELECT \* FROM financeiro WHERE id=\$1 AND tenant_id=\$2/.test(text)) return Promise.resolve({ rows: [{ id: contaA }] });
    if (/UPDATE pacientes SET responsavel_nome/.test(text)) return Promise.resolve({ rowCount: params[3] === tenantA ? 1 : 0 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => { querySpy.mockRestore(); jest.useRealTimers(); });
afterAll(async () => { await pool.end(); });

const inserts = () => sqlLog.filter(q => /INSERT INTO automation_jobs/.test(q.text));
const conta = (extra = {}) => ({
  id: contaA, paciente_id: pacienteA, valor: '150.5', vencimento: '2026-11-01', nome: 'Maria Silva',
  telefone: '11987654321', data_nascimento: '1990-05-10', responsavel_nome: null, responsavel_telefone: null, ...extra,
});
const varsDo = (ins) => JSON.parse(ins.params[ins.params.length - 6]);

describe('job processBillingReminders', () => {
  test('só a clínica que ligou é cobrada, com tenant_id nas consultas e validade até 20h', async () => {
    settings = { [tenantA]: ligada, [tenantB]: { ...ligada, enabled: false } };
    contas = { [`${tenantA}:3`]: [conta()], [`${tenantB}:3`]: [conta({ id: 'b1' })] };
    await processBillingReminders();
    const buscas = sqlLog.filter(q => /FROM financeiro f\s+JOIN pacientes p/.test(q.text));
    expect(buscas).toHaveLength(1);
    expect(buscas[0].params[0]).toBe(tenantA);
    expect(buscas[0].text).toMatch(/p\.tenant_id = f\.tenant_id/);
    expect(buscas[0].text).toMatch(/a\.tenant_id = f\.tenant_id AND a\.paciente_id = f\.paciente_id/);
    expect(buscas[0].text).toMatch(/f\.cobranca_pausada_em IS NULL/);
    const [ins] = inserts();
    expect(ins.params).toEqual(expect.arrayContaining([tenantA, 'transactional', 'billing_reminder', `billing_${contaA}_2026-11-01_3`]));
    const expira = ins.params[ins.params.length - 1];
    expect(new Date(expira).toISOString()).toBe('2026-11-04T23:00:00.000Z'); // 20h de Brasília
  });

  test('padrão é desligado: sem configuração, nada é enfileirado', async () => {
    contas = { [`${tenantA}:3`]: [conta()] };
    await processBillingReminders();
    expect(inserts()).toHaveLength(0);
  });

  test('dedupe por conta + vencimento + etapa e só contas em aberto', async () => {
    settings = { [tenantA]: ligada };
    await processBillingReminders();
    const busca = sqlLog.find(q => /FROM financeiro f\s+JOIN pacientes p/.test(q.text));
    expect(busca.params[3]).toEqual(['pendente', 'atrasado', 'vencido']);
    expect(busca.text).toMatch(/aj\.variables->'chaves' \? \('billing_' \|\| f\.id::text \|\| '_' \|\| to_char\(f\.vencimento, 'YYYY-MM-DD'\) \|\| '_' \|\| \$3::text\)/);
  });

  test('opt-out não recebe', async () => {
    settings = { [tenantA]: ligada };
    contas = { [`${tenantA}:3`]: [conta()] };
    optOut.add('1187654321'); // chave do waPhoneKey (DDD + 8 dígitos)
    await processBillingReminders();
    expect(inserts()).toHaveLength(0);
  });

  test('responsável financeiro recebe no lugar do paciente, com o nome dele', async () => {
    settings = { [tenantA]: ligada };
    contas = { [`${tenantA}:3`]: [conta({ responsavel_nome: 'Joana Souza', responsavel_telefone: '11911112222' })] };
    await processBillingReminders();
    const [ins] = inserts();
    expect(ins.params[2]).toBe('5511911112222');
    expect(ins.params[3]).toMatch(/^Olá, Joana!/);
  });

  test('menor de 18 sem responsável não é cobrado', async () => {
    settings = { [tenantA]: ligada };
    contas = { [`${tenantA}:3`]: [conta({ data_nascimento: '2012-01-01' })] };
    await processBillingReminders();
    expect(inserts()).toHaveLength(0);
  });

  test('duas contas da mesma pessoa no dia: uma mensagem com o total', async () => {
    settings = { [tenantA]: { enabled: true, etapas: [{ dias: 3, texto: TEXTO }, { dias: 7, texto: TEXTO }] } };
    contas = {
      [`${tenantA}:3`]: [conta()],
      [`${tenantA}:7`]: [conta({ id: contaA2, valor: '49.50', vencimento: '2026-10-28' })],
    };
    await processBillingReminders();
    expect(inserts()).toHaveLength(1);
    const msg = inserts()[0].params[3];
    expect(msg).toContain('Há 2 pagamentos em aberto');
    expect(msg).toContain('R$ 200,00');
    expect(msg).toContain('28/10/2026 e 01/11/2026');
    expect(varsDo(inserts()[0]).chaves).toEqual([`billing_${contaA}_2026-11-01_3`, `billing_${contaA2}_2026-10-28_7`]);
  });

  test('pessoa já cobrada hoje não recebe outra', async () => {
    settings = { [tenantA]: ligada };
    contas = { [`${tenantA}:3`]: [conta()] };
    jaCobradoHoje = true;
    await processBillingReminders();
    expect(inserts()).toHaveLength(0);
  });

  test('feriado nacional: nada é enfileirado', async () => {
    usarRelogio(new Date('2026-11-20T13:00:00Z')); // Consciência Negra
    settings = { [tenantA]: ligada };
    contas = { [`${tenantA}:3`]: [conta()] };
    await processBillingReminders();
    expect(inserts()).toHaveLength(0);
  });

  test('depois das 20h não enfileira (a mensagem venceria no mesmo dia)', async () => {
    usarRelogio(new Date('2026-11-04T23:30:00Z')); // 20h30 em Brasília
    settings = { [tenantA]: ligada };
    contas = { [`${tenantA}:3`]: [conta()] };
    await processBillingReminders();
    expect(inserts()).toHaveLength(0);
  });

  test('mensagem só com valor e vencimento (sem a descrição da conta)', async () => {
    settings = { [tenantA]: ligada };
    contas = { [`${tenantA}:3`]: [conta({ descricao: 'Tratamento de canal' })] };
    await processBillingReminders();
    expect(inserts()[0].params[3]).toBe('Olá, Maria! Aqui é da Clínica Sorriso. O pagamento de R$ 150,50 venceu em 01/11/2026.');
  });
});

describe('conferência antes do envio', () => {
  const vars = { contaId: contaA, contas: [{ id: contaA, vencimento: '2026-11-01' }] };
  test('conta em aberto e régua ligada: pode enviar', async () => {
    settings = { [tenantA]: ligada };
    expect(await billingReminderBlockReason(tenantA, vars)).toBeNull();
  });
  test('conta paga não cobra', async () => {
    settings = { [tenantA]: ligada };
    contaStatus[contaA].status = 'pago';
    expect(await billingReminderBlockReason(tenantA, vars)).toEqual({ acao: 'fail', motivo: 'Cancelado: conta paga ou cancelada' });
  });
  test('cobrança pausada não sai', async () => {
    settings = { [tenantA]: ligada };
    contaStatus[contaA].cobranca_pausada_em = new Date();
    expect((await billingReminderBlockReason(tenantA, vars)).motivo).toMatch(/pausada/);
  });
  test('vencimento mudou: cancela', async () => {
    settings = { [tenantA]: ligada };
    contaStatus[contaA].vencimento = '2026-12-01';
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
  test('feriado no dia do envio: cancela', async () => {
    usarRelogio(new Date('2026-12-25T13:00:00Z'));
    settings = { [tenantA]: ligada };
    expect((await billingReminderBlockReason(tenantA, vars)).motivo).toMatch(/feriado/);
  });
});

describe('"já paguei" pausa a régua e avisa a recepção', () => {
  test.each(['Já paguei!', 'ja paguei ontem', 'Não reconheço essa cobrança', 'fiz o pix hoje', 'segue o comprovante'])('%p é reconhecido', (t) => {
    expect(isBillingContestText(t)).toBe(true);
  });
  test.each(['Obrigada', 'Pode me mandar o pix?', 'Que horas abre?'])('%p não é contestação', (t) => {
    expect(isBillingContestText(t)).toBe(false);
  });
  test('pausa só as contas cobradas daquele telefone, na clínica, e cancela a fila delas', async () => {
    jobsEnviados = [{ variables: { contaIds: [contaA, contaA2] } }];
    const n = await pauseBillingForPhone(tenantA, '5511987654321');
    expect(n).toBe(2);
    const pausa = sqlLog.find(q => /UPDATE financeiro SET cobranca_pausada_em = NOW\(\)/.test(q.text));
    expect(pausa.params).toEqual([tenantA, [contaA, contaA2]]);
    const cancels = sqlLog.filter(q => /UPDATE automation_jobs SET status = 'cancelled'/.test(q.text));
    expect(cancels).toHaveLength(2);
    expect(cancels.every(c => c.params[0] === tenantA)).toBe(true);
  });
  test('sem cobrança recente para o telefone: nada acontece', async () => {
    const n = await pauseBillingForPhone(tenantB, '5511987654321');
    expect(n).toBe(0);
    expect(sqlLog.some(q => /UPDATE financeiro/.test(q.text))).toBe(false);
  });
});

describe('validação dos textos e da frequência (parecer jurídico)', () => {
  const v = (etapas) => validateBillingReminderConfig({ enabled: true, etapas });
  test('textos padrão passam', async () => {
    const res = await request(app).get('/api/billing-reminder/settings').set('Authorization', `Bearer ${token(tenantA)}`);
    expect(res.body.enabled).toBe(false);
    expect(v(res.body.padrao).erro).toBeUndefined();
    for (const e of res.body.padrao) expect(e.texto).toContain('Aqui é da {clinica}');
  });
  test.each([
    ['sem identificar a clínica', 'Olá, {nome}! O pagamento de {valor} vence em {vencimento}.'],
    ['valor antes da identificação', 'Olá {valor}! Aqui é da {clinica}.'],
    ['valor na primeira linha', 'Aqui é da {clinica}: {valor}\nVence em {vencimento}.'],
    ['"parcela"', 'Olá! Aqui é da {clinica}. Sua parcela vence em {vencimento}.'],
    ['condiciona atendimento', 'Olá! Aqui é da {clinica}. Sem o pagamento não atenderemos.'],
    ['suspensão', 'Olá! Aqui é da {clinica}. Seu atendimento será suspenso.'],
    ['último aviso', 'Olá! Aqui é da {clinica}. Último aviso: {valor}.'],
    ['cartório', 'Olá! Aqui é da {clinica}. Vamos levar a cartório.'],
    ['Serasa', 'Olá! Aqui é da {clinica}. Seu nome vai para o Serasa.'],
    ['procedimento', 'Olá! Aqui é da {clinica}. Falta pagar o tratamento de canal.'],
    ['maiúsculas', 'OLÁ! AQUI É DA {clinica}. PAGUE {valor}.'],
    ['link', 'Olá! Aqui é da {clinica}. Pague em https://exemplo.com'],
  ])('recusa texto %s', (_c, texto) => {
    expect(v([{ dias: 0, texto }]).erro).toBeTruthy();
  });
  test('no máximo 3 etapas depois do vencimento', () => {
    const t = TEXTO;
    expect(v([{ dias: 3, texto: t }, { dias: 6, texto: t }, { dias: 9, texto: t }, { dias: 12, texto: t }]).erro).toMatch(/No máximo 3/);
  });
  test('pelo menos 3 dias entre as etapas depois do vencimento', () => {
    expect(v([{ dias: 1, texto: TEXTO }, { dias: 2, texto: TEXTO }]).erro).toMatch(/3 dias/);
  });
});

describe('API', () => {
  test('PUT settings grava na clínica do usuário e cancela pendentes só dela', async () => {
    const res = await request(app).put('/api/billing-reminder/settings').set('Authorization', `Bearer ${token(tenantA)}`).send(ligada);
    expect(res.status).toBe(200);
    expect(sqlLog.find(q => /INSERT INTO tenant_settings/.test(q.text)).params[0]).toBe(tenantA);
    const cancel = sqlLog.find(q => /UPDATE automation_jobs SET status = 'cancelled'/.test(q.text));
    expect(cancel.params[0]).toBe(tenantA);
  });
  test('PUT settings exige admin', async () => {
    const res = await request(app).put('/api/billing-reminder/settings').set('Authorization', `Bearer ${token(tenantA, 'atendente')}`).send(ligada);
    expect(res.status).toBe(403);
  });
  test('PUT /api/financeiro/:id status pago cancela pendentes da conta na clínica', async () => {
    const res = await request(app).put(`/api/financeiro/${contaA}`).set('Authorization', `Bearer ${token(tenantA)}`).send({ status: 'pago' });
    expect(res.status).toBe(200);
    const cancel = sqlLog.find(q => /UPDATE automation_jobs SET status = 'cancelled'/.test(q.text));
    expect(cancel.text).toMatch(/variables->>'contaId' = \$3 OR variables->'contaIds' \? \$3/);
    expect(cancel.params).toEqual([tenantA, expect.any(String), contaA]);
  });
  test('responsável financeiro: grava na clínica; outra clínica recebe 404', async () => {
    let res = await request(app).put(`/api/pacientes/${pacienteA}/responsavel-financeiro`)
      .set('Authorization', `Bearer ${token(tenantA)}`).send({ nome: 'Joana', telefone: '(11) 91111-2222' });
    expect(res.status).toBe(200);
    expect(res.body.responsavel_telefone).toBe('5511911112222');
    res = await request(app).put(`/api/pacientes/${pacienteA}/responsavel-financeiro`)
      .set('Authorization', `Bearer ${token(tenantB)}`).send({ nome: 'Joana', telefone: '11911112222' });
    expect(res.status).toBe(404);
  });
  test('responsável com telefone inválido → 400', async () => {
    const res = await request(app).put(`/api/pacientes/${pacienteA}/responsavel-financeiro`)
      .set('Authorization', `Bearer ${token(tenantA)}`).send({ nome: 'Joana', telefone: '123' });
    expect(res.status).toBe(400);
  });
});

describe('utilitários', () => {
  test('feriados nacionais, incluindo Sexta-feira Santa', () => {
    expect(isFeriadoNacional('2026-04-03')).toBe(true); // Páscoa 2026 = 05/04
    expect(isFeriadoNacional('2026-11-20')).toBe(true);
    expect(isFeriadoNacional('2026-11-04')).toBe(false);
    expect(isFeriadoNacional('2026-02-17')).toBe(false); // Carnaval é ponto facultativo
  });
  test('sem nome não deixa "Olá, !"', () => {
    expect(renderBillingMessage('Olá, {nome}! Vence {vencimento}.', { nome: '', valor: 10, vencimento: '05/11/2026' }))
      .toBe('Olá! Vence 05/11/2026.');
  });
});
