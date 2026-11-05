// Período das campanhas: início no futuro não envia, fim passado não envia e cancela
// os pendentes, perpétua continua, disparo único respeita data e horário, e tudo por
// clínica. pool.query e fetch mockados; o relógio (Date) é fixado.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '../.env') });
process.env.EVOLUTION_API_KEY = 'chave-de-teste';
process.env.EVOLUTION_API_URL = 'http://evolution.teste.invalid';

const { app, pool, processCampaignScheduler, campaignPeriodStatus, processAutomationJobsForCampaignTests: processAutomationJobs } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const instA = '11111111-clinica-a';
const auth = (tenant = tenantA) => ({
  Authorization: `Bearer ${jwt.sign({ sub: '44444444-4444-4444-4444-444444444444', email: 'a@a.com', role: 'admin', tenant_id: tenant, is_super_admin: false }, JWT_SECRET)}`,
});
// Quarta, 05/11/2026, 10h em São Paulo.
const HOJE = '2026-11-05';
const fixarRelogio = () => jest.useFakeTimers({
  now: new Date('2026-11-05T13:00:00Z'),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
});

const camp = (extra = {}) => ({
  id: 'camp-1', tenant_id: tenantA, nome: 'Retorno', tipo: 'recorrente', ativo: true,
  template: { mensagem: 'Olá {{nome}}! Responda SAIR para não receber mais.' }, dias_semana: [],
  horario_inicio: null, horario_fim: null, data_inicio: null, data_fim: null, campanha_perpetua: false,
  publico: 'todos', capacidade_diaria: 10, intervalo_spam: 7, numero_envio: null, ...extra,
});

describe('Campanhas: período de envio', () => {
  let querySpy, fetchSpy, sqlLog, campanhas, contatos, instCreatedAt, queueJob;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    fixarRelogio();
    sqlLog = []; campanhas = [camp()]; instCreatedAt = new Date('2020-01-01'); queueJob = null;
    contatos = [{ nome: 'Maria Souza', telefone: '5511988887777' }];
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const ok = (rows, rowCount = rows.length) => Promise.resolve({ rows, rowCount });
      if (/FROM broadcast_campaigns WHERE ativo = true AND tipo = 'recorrente'/.test(text)) return ok(campanhas);
      if (/SELECT \* FROM broadcast_campaigns WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        return ok(params[1] === tenantA ? campanhas.filter(c => c.id === params[0]) : []);
      }
      if (/SELECT instance_name FROM whatsapp_instances WHERE tenant_id = \$1/.test(text)) return ok(params[0] === tenantA ? [{ instance_name: instA }] : []);
      if (/SELECT tenant_id FROM whatsapp_instances WHERE instance_name = \$1/.test(text)) return ok(params[0] === instA ? [{ tenant_id: tenantA }] : []);
      if (/FROM crm_leads cl LEFT JOIN contatos c/.test(text)) return ok(params[1] === tenantA ? contatos : []);
      if (/UPDATE automation_jobs SET status = 'cancelled'/.test(text)) return ok([], 2);
      if (/SELECT created_at FROM whatsapp_instances WHERE instance_name = \$1 AND tenant_id = \$2/.test(text)) return ok([{ created_at: instCreatedAt }]);
      if (/INSERT INTO automation_jobs/.test(text)) return ok([{ id: `job-${sqlLog.length}` }]);
      if (/SELECT DISTINCT ON/.test(text) || /UPDATE automation_jobs SET claimed_at = NOW\(\)/.test(text)) return ok(queueJob ? [queueJob] : []);
      return ok([]);
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
      ok: true, status: 200,
      json: async () => (/fetchInstances/.test(String(url)) ? [{ name: instA, connectionStatus: 'open' }] : { key: { id: 'X' } }),
    }));
  });

  afterEach(() => { querySpy.mockRestore(); fetchSpy.mockRestore(); jest.useRealTimers(); });
  afterAll(async () => { await pool.end(); });

  const q = (re) => sqlLog.filter(s => re.test(s.text));
  const inserts = () => q(/INSERT INTO automation_jobs/);
  const col = (ins, c) => {
    const cols = ins.text.match(/\(([^)]+)\) VALUES/)[1].split(',').map(x => x.trim());
    return ins.params[cols.indexOf(c)];
  };

  test('período: formatos de data e perpétua', () => {
    expect(campaignPeriodStatus(camp({ data_inicio: '2026-11-06' }), HOJE)).toBe('antes');
    expect(campaignPeriodStatus(camp({ data_inicio: '06/11/2026' }), HOJE)).toBe('antes');
    expect(campaignPeriodStatus(camp({ data_fim: '2026-11-04' }), HOJE)).toBe('encerrada');
    expect(campaignPeriodStatus(camp({ data_fim: '2026-11-05' }), HOJE)).toBe('vigente'); // o dia do fim ainda vale
    expect(campaignPeriodStatus(camp({ data_fim: '2026-11-04', campanha_perpetua: true }), HOJE)).toBe('vigente');
    expect(campaignPeriodStatus(camp({ data_inicio: '', data_fim: 'qualquer coisa' }), HOJE)).toBe('vigente');
  });

  test('agendador: início no futuro não envia', async () => {
    campanhas = [camp({ data_inicio: '2026-11-10' })];
    await processCampaignScheduler();
    expect(inserts()).toHaveLength(0);
  });

  test('agendador: fim passado não envia e cancela os pendentes da campanha, só da clínica', async () => {
    campanhas = [camp({ data_fim: '2026-11-04' })];
    await processCampaignScheduler();
    expect(inserts()).toHaveLength(0);
    const [cancel] = q(/UPDATE automation_jobs SET status = 'cancelled'/);
    expect(cancel.params.slice(0, 2)).toEqual([tenantA, 'camp-1']);
    expect(cancel.text).toMatch(/tenant_id = \$1 AND flow_id = \$2 AND trigger_event = 'campaign' AND status = 'pending'/);
    expect(q(/UPDATE broadcast_campaigns SET ativo = false/)[0].params).toEqual(['camp-1', tenantA]); // tela mostra Encerrada
  });

  test('agendador: perpétua continua mesmo com data de término antiga', async () => {
    campanhas = [camp({ data_fim: '2026-10-01', campanha_perpetua: true })];
    await processCampaignScheduler();
    expect(inserts()).toHaveLength(1);
    expect(q(/UPDATE automation_jobs SET status = 'cancelled'/)).toHaveLength(0);
  });

  test('agendador: vigente envia na clínica dona, com validade até o fim da campanha', async () => {
    campanhas = [camp({ data_inicio: '2026-11-01', data_fim: '2026-11-05' })];
    await processCampaignScheduler();
    const [ins] = inserts();
    expect(col(ins, 'tenant_id')).toBe(tenantA);
    expect(col(ins, 'category')).toBe('marketing');
    expect(new Date(col(ins, 'expires_at')).toISOString()).toBe('2026-11-06T02:59:00.000Z'); // 05/11 23:59 em SP
    const aud = q(/FROM crm_leads cl LEFT JOIN contatos c/)[0];
    expect(aud.params[1]).toBe(tenantA);
  });

  test('agendador: cada campanha é tratada na sua clínica', async () => {
    campanhas = [camp({ id: 'camp-b', tenant_id: tenantB, data_fim: '2026-11-01' })];
    await processCampaignScheduler();
    expect(q(/UPDATE automation_jobs SET status = 'cancelled'/)[0].params.slice(0, 2)).toEqual([tenantB, 'camp-b']);
  });

  test('executar recorrente com início no futuro: só ativa, não envia agora', async () => {
    campanhas = [camp({ data_inicio: '2026-11-10' })];
    const res = await request(app).post('/api/campaigns/camp-1/execute').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ queued: false, agendada: true, inicio: '2026-11-10' });
    expect(inserts()).toHaveLength(0);
    expect(q(/UPDATE broadcast_campaigns SET ativo = true/)[0].params).toEqual(['camp-1', tenantA]);
  });

  test('executar recorrente encerrada: 409', async () => {
    campanhas = [camp({ data_fim: '2026-11-01' })];
    const res = await request(app).post('/api/campaigns/camp-1/execute').set(auth());
    expect(res.status).toBe(409);
    expect(inserts()).toHaveLength(0);
  });

  test('disparo único com data futura: entra na fila para a data e o horário marcados', async () => {
    campanhas = [camp({ tipo: 'unico', data_inicio: '2026-11-07', horario_inicio: '09:30', horario_fim: '12:00' })];
    const res = await request(app).post('/api/campaigns/camp-1/execute').set(auth());
    expect(res.status).toBe(200);
    const [ins] = inserts();
    expect(new Date(col(ins, 'scheduled_at')).toISOString()).toBe('2026-11-07T12:30:00.000Z');
    const [val] = q(/UPDATE automation_jobs SET expires_at = \$3 WHERE tenant_id = \$1 AND id = ANY/);
    expect(val.params[0]).toBe(tenantA);
    expect(new Date(val.params[2]).toISOString()).toBe('2026-11-07T15:00:00.000Z');
    expect(res.body).toMatchObject({ inicio: '2026-11-07', porDia: 500, previsaoTermino: '2026-11-07', naoCabem: 0 });
  });

  test('disparo único maior que o limite do dia: escalona pelos dias seguintes e informa a previsão', async () => {
    instCreatedAt = new Date(Date.now() - 86_400_000); // número novo: 50 por dia
    contatos = Array.from({ length: 120 }, (_, i) => ({ nome: `P${i}`, telefone: `55119${String(10000000 + i)}` }));
    campanhas = [camp({ tipo: 'unico', data_inicio: '2026-11-07', horario_inicio: '09:30', horario_fim: '12:00' })];
    const res = await request(app).post('/api/campaigns/camp-1/execute').set(auth());
    expect(res.body).toMatchObject({ enqueued: 120, porDia: 50, previsaoTermino: '2026-11-09', naoCabem: 0 });
    const dias = inserts().map(i => new Date(col(i, 'scheduled_at')).toISOString());
    expect(dias.filter(d => d === '2026-11-07T12:30:00.000Z')).toHaveLength(50);
    expect(dias.filter(d => d === '2026-11-08T12:30:00.000Z')).toHaveLength(50);
    expect(dias.filter(d => d === '2026-11-09T12:30:00.000Z')).toHaveLength(20);
    const [val] = q(/UPDATE automation_jobs SET expires_at = \$3/);
    expect(new Date(val.params[2]).toISOString()).toBe('2026-11-09T15:00:00.000Z'); // dia + N
  });

  test('disparo único: o que passa de 7 dias de limite não entra na fila', async () => {
    instCreatedAt = new Date(Date.now() - 86_400_000);
    contatos = Array.from({ length: 400 }, (_, i) => ({ nome: `P${i}`, telefone: `55119${String(20000000 + i)}` }));
    campanhas = [camp({ tipo: 'unico', data_inicio: '2026-11-07' })];
    const res = await request(app).post('/api/campaigns/camp-1/execute').set(auth());
    expect(res.body).toMatchObject({ enqueued: 350, naoCabem: 50, previsaoTermino: '2026-11-13' });
  });

  test('disparo único sem data nem horário marcados: sem 409, começa agora', async () => {
    campanhas = [camp({ tipo: 'unico' })];
    const res = await request(app).post('/api/campaigns/camp-1/execute').set(auth());
    expect(res.status).toBe(200);
    expect(Math.abs(new Date(col(inserts()[0], 'scheduled_at')).getTime() - Date.now())).toBeLessThan(2000);
  });

  test('fila: envio que expira depois de esperar o limite diário diz o motivo real', async () => {
    queueJob = {
      id: 'job-x', tenant_id: tenantA, instance: instA, patient_phone: '5511988887777', message: 'Oi', category: 'marketing',
      trigger_event: 'campaign', status: 'pending', channel: 'whatsapp', scheduled_at: new Date(), created_at: new Date(),
      expires_at: new Date(Date.now() - 1000), error: 'Limite diário do número (50)',
    };
    await processAutomationJobs();
    const [f] = q(/SET status = 'failed', error = \$2/);
    expect(f.params[1]).toBe('Expirado: a mensagem não saiu a tempo (limite diário de envio do número)');
  });

  test('data impossível vira "sem limite" e avisa uma vez no log', () => {
    console.warn.mockClear();
    const c = camp({ id: 'camp-ruim', data_fim: '2026-13-45' });
    expect(campaignPeriodStatus(c, HOJE)).toBe('vigente');
    expect(campaignPeriodStatus(c, HOJE)).toBe('vigente');
    const avisos = console.warn.mock.calls.filter(a => /fora do formato/.test(String(a[0])));
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0][0])).toMatch(/camp-ruim/);
    expect(campaignPeriodStatus(camp({ data_inicio: '2026-02-30' }), HOJE)).toBe('vigente');
  });

  test('disparo único com data passada ou horário encerrado: 409, nada na fila', async () => {
    campanhas = [camp({ tipo: 'unico', data_inicio: '2026-11-04' })];
    expect((await request(app).post('/api/campaigns/camp-1/execute').set(auth())).status).toBe(409);
    campanhas = [camp({ tipo: 'unico', data_inicio: HOJE, horario_fim: '09:00' })];
    expect((await request(app).post('/api/campaigns/camp-1/execute').set(auth())).status).toBe(409);
    expect(inserts()).toHaveLength(0);
  });

  test('outra clínica não executa a campanha', async () => {
    const res = await request(app).post('/api/campaigns/camp-1/execute').set(auth(tenantB));
    expect(res.status).toBe(404);
    expect(inserts()).toHaveLength(0);
  });
});
