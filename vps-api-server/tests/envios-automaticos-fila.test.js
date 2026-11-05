// Envios automáticos pela fila central (enqueueWhatsAppJob), pelo número da clínica dona:
// boas-vindas e "fora do horário" do webhook, aviso de reagendamento da agenda e
// telefone do lead em /api/sessions/close lido do banco.
//
// Requisitos do ambiente: os mesmos de pacientes-isolamento.test.js. pool.query e fetch
// são mockados: nenhuma query chega ao Postgres e nada chega à Evolution.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });
process.env.EVOLUTION_API_KEY = 'chave-de-teste';
process.env.EVOLUTION_API_URL = 'http://evolution.teste.invalid';
delete process.env.EVOLUTION_WEBHOOK_SECRET;

const { app, pool, clearTenantSettingsCacheForTests } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const instA = '11111111-clinica-a';
const instB = '22222222-clinica-b';
const pacienteA = '33333333-3333-3333-3333-333333333333';
const pacienteB = '55555555-5555-5555-5555-555555555555';
const agendamento = '77777777-7777-7777-7777-777777777777';
const leadA = '88888888-8888-8888-8888-888888888888';
const telefoneA = '5511988887777';

const token = (tenant = tenantA) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica.com', role: 'admin',
  tenant_id: tenant, is_super_admin: false,
}, JWT_SECRET);
const auth = (tenant) => ({ Authorization: `Bearer ${token(tenant)}` });

const instanceOwner = { [instA]: tenantA, [instB]: tenantB };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(20); }
  return fn();
}

describe('Envios automáticos pela fila central', () => {
  let querySpy, fetchSpy, sqlLog, fetchLog, settings, optedOut, agendaBefore, agendaAfter;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    clearTenantSettingsCacheForTests();
    sqlLog = []; fetchLog = []; settings = new Map(); optedOut = false;
    agendaBefore = { data: new Date(2099, 0, 10), hora: '09:00' };
    agendaAfter = {
      id: agendamento, paciente_id: pacienteA, paciente_nome: 'Maria Souza', data: new Date(2099, 0, 12),
      hora: '14:30', dentista_nome: 'Dra. Ana', status: 'agendado', tenant_id: tenantA,
    };
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const ok = (rows) => Promise.resolve({ rows, rowCount: rows.length });
      if (/SELECT tenant_id FROM whatsapp_instances WHERE instance_name = \$1/.test(text)) {
        const t = instanceOwner[params[0]];
        return ok(t ? [{ tenant_id: t }] : []);
      }
      if (/SELECT instance_name FROM whatsapp_instances WHERE tenant_id = \$1/.test(text)) {
        return ok(Object.entries(instanceOwner).filter(([, t]) => t === params[0]).map(([n]) => ({ instance_name: n })));
      }
      if (/SELECT value FROM tenant_settings WHERE tenant_id = \$1 AND key = \$2/.test(text)) {
        const v = settings.get(`${params[0]}:${params[1]}`);
        return ok(v === undefined ? [] : [{ value: v }]);
      }
      if (/FROM whatsapp_opt_outs/.test(text)) return ok(optedOut ? [{ '?column?': 1 }] : []);
      if (/SELECT nome FROM tenants WHERE id = \$1/.test(text)) return ok([{ nome: params[0] === tenantA ? 'Clínica A' : 'Clínica B' }]);
      if (/SELECT data, hora FROM agendamentos WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        return ok(params[1] === tenantA ? [agendaBefore] : []);
      }
      if (/^\s*UPDATE agendamentos SET/.test(text)) {
        return ok(params[params.length - 1] === tenantA ? [agendaAfter] : []);
      }
      if (/SELECT nome, telefone FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        if (params[0] === pacienteA && params[1] === tenantA) return ok([{ nome: 'Maria Souza', telefone: '(11) 98888-7777' }]);
        if (params[0] === pacienteB && params[1] === tenantB) return ok([{ nome: 'João B', telefone: '5521977776666' }]);
        return ok([]);
      }
      if (/SELECT nome, telefone FROM crm_leads WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        return ok(params[0] === leadA && params[1] === tenantA ? [{ nome: 'Lead A', telefone: telefoneA }] : []);
      }
      if (/INSERT INTO automation_jobs/.test(text)) return ok([{ id: 'job-1' }]);
      return ok([]);
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      fetchLog.push(String(url));
      const body = /\/instance\/fetchInstances/.test(String(url))
        ? [{ name: instB, connectionStatus: 'open' }, { name: instA, connectionStatus: 'open' }]
        : { key: { id: 'NAO-DEVERIA-ENVIAR' } };
      return { ok: true, status: 200, json: async () => body };
    });
  });

  afterEach(() => { querySpy.mockRestore(); fetchSpy.mockRestore(); });
  afterAll(async () => { await pool.end(); });

  const jobInserts = () => sqlLog.filter(q => /INSERT INTO automation_jobs/.test(q.text));
  const jobCol = (q, col) => {
    const cols = q.text.match(/\(([^)]+)\) VALUES/)[1].split(',').map(c => c.trim());
    return q.params[cols.indexOf(col)];
  };
  const directSends = () => fetchLog.filter(u => /\/message\/send/.test(u));

  describe('PUT /api/agenda/:id — aviso de reagendamento', () => {
    test('enfileira na clínica A, pelo número da A, com telefone do cadastro do paciente', async () => {
      const res = await request(app).put(`/api/agenda/${agendamento}`).set(auth()).send({ data: '2099-01-12', hora: '14:30' });
      expect(res.status).toBe(200);
      const [ins] = await waitFor(() => (jobInserts().length ? jobInserts() : null));
      expect(ins).toBeDefined();
      expect(jobCol(ins, 'tenant_id')).toBe(tenantA);
      expect(jobCol(ins, 'instance')).toBe(instA);
      expect(jobCol(ins, 'category')).toBe('transactional');
      expect(jobCol(ins, 'trigger_event')).toBe('reschedule_notice');
      expect(String(jobCol(ins, 'patient_phone'))).toMatch(/988887777$/);
      expect(jobCol(ins, 'message')).toMatch(/12\/01\/2099/);
      expect(jobCol(ins, 'message')).toMatch(/Clínica A/);
      // Validade: até o horário da consulta.
      expect(new Date(jobCol(ins, 'expires_at')).toISOString()).toBe('2099-01-12T17:30:00.000Z');
      const pacQuery = sqlLog.find(q => /FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(q.text));
      expect(pacQuery.params).toEqual([pacienteA, tenantA]);
      expect(directSends()).toHaveLength(0);
    });

    test('clínica A nunca usa a instância da B, mesmo com a B aberta primeiro na Evolution', async () => {
      await request(app).put(`/api/agenda/${agendamento}`).set(auth()).send({ hora: '14:30' });
      const [ins] = await waitFor(() => (jobInserts().length ? jobInserts() : null));
      expect(jobCol(ins, 'instance')).not.toBe(instB);
      expect(directSends()).toHaveLength(0);
    });

    test('sem mudança real de data/hora não avisa', async () => {
      agendaBefore = { data: agendaAfter.data, hora: agendaAfter.hora };
      await request(app).put(`/api/agenda/${agendamento}`).set(auth()).send({ data: '2099-01-12', hora: '14:30' });
      await sleep(150);
      expect(jobInserts()).toHaveLength(0);
    });

    test('paciente em opt-out não recebe aviso', async () => {
      optedOut = true;
      await request(app).put(`/api/agenda/${agendamento}`).set(auth()).send({ hora: '14:30' });
      await sleep(150);
      expect(jobInserts()).toHaveLength(0);
      expect(directSends()).toHaveLength(0);
    });

    test('paciente de outra clínica no agendamento: telefone não é lido e nada é enfileirado', async () => {
      agendaAfter.paciente_id = pacienteB;
      await request(app).put(`/api/agenda/${agendamento}`).set(auth()).send({ hora: '14:30' });
      await sleep(150);
      expect(jobInserts()).toHaveLength(0);
      const warns = console.warn.mock.calls.map(c => c.join(' ')).filter(t => /\[reschedule\]/.test(t));
      expect(warns.some(t => t.includes(agendamento))).toBe(true);
      expect(warns.join(' ')).not.toMatch(/Maria|João|977776666|988887777/);
    });
  });

  describe('Webhook Evolution — boas-vindas e fora do horário', () => {
    const webhook = (instance = instA) => request(app).post('/api/webhook/evolution').send({
      event: 'messages.upsert', instance,
      data: {
        key: { remoteJid: `${telefoneA}@s.whatsapp.net`, fromMe: false, id: `MSG-${Math.random()}` },
        message: { conversation: 'oi, quero marcar' }, pushName: 'Paciente Teste', messageTimestamp: 1,
      },
    });
    const allClosed = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
      .map(d => [d, { enabled: false, openTime: '08:00', closeTime: '18:00' }]));

    test('fora do horário: enfileira como service na clínica dona, sem envio direto', async () => {
      settings.set(`${tenantA}:attendance_settings`, { businessHours: allClosed, offHoursMessage: 'Estamos fechados agora.' });
      await webhook();
      const [ins] = await waitFor(() => (jobInserts().length ? jobInserts() : null));
      expect(ins).toBeDefined();
      expect(jobCol(ins, 'tenant_id')).toBe(tenantA);
      expect(jobCol(ins, 'instance')).toBe(instA);
      expect(jobCol(ins, 'category')).toBe('service');
      expect(jobCol(ins, 'trigger_event')).toBe('auto_reply');
      expect(jobCol(ins, 'message')).toBe('Estamos fechados agora.');
      // Imediata e com validade curta.
      expect(Math.abs(new Date(jobCol(ins, 'scheduled_at')).getTime() - Date.now())).toBeLessThan(5000);
      expect(new Date(jobCol(ins, 'expires_at')).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
      await sleep(100);
      expect(directSends()).toHaveLength(0);
    });

    // Só o relógio (Date) é fixado; timers reais para o supertest funcionar.
    const atSaoPauloTime = (iso) => jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval',
        'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
    afterEach(() => jest.useRealTimers());

    test('boas-vindas dentro da janela: transactional na fila, menu de filas não sai antes dela', async () => {
      atSaoPauloTime('2026-11-04T13:00:00Z'); // quarta, 10h em São Paulo
      settings.set(`${tenantA}:attendance_settings`, { autoGreetingEnabled: true, welcomeMessage: 'Bem-vindo à Clínica A!' });
      await webhook();
      const [ins] = await waitFor(() => (jobInserts().length ? jobInserts() : null));
      expect(ins).toBeDefined();
      expect(jobCol(ins, 'tenant_id')).toBe(tenantA);
      expect(jobCol(ins, 'instance')).toBe(instA);
      expect(jobCol(ins, 'category')).toBe('transactional');
      expect(JSON.parse(jobCol(ins, 'variables'))).toMatchObject({ kind: 'welcome', thenQueueMenu: true });
      await sleep(100);
      expect(directSends()).toHaveLength(0);
    });

    test('boas-vindas fora da janela de envio (domingo): não enfileira e o menu sai como antes', async () => {
      atSaoPauloTime('2026-11-08T13:00:00Z'); // domingo
      settings.set(`${tenantA}:attendance_settings`, { autoGreetingEnabled: true, welcomeMessage: 'Bem-vindo à Clínica A!' });
      await webhook();
      await sleep(200);
      expect(jobInserts()).toHaveLength(0);
      // Sem filas configuradas no mock, o menu não chega a chamar a Evolution.
      expect(sqlLog.some(q => /FROM attendance_queues/.test(q.text) && q.params[0] === tenantA)).toBe(true);
    });

    test('fora do horário com paciente em opt-out: nada é enfileirado', async () => {
      settings.set(`${tenantA}:attendance_settings`, { businessHours: allClosed, offHoursMessage: 'Estamos fechados agora.' });
      optedOut = true;
      await webhook();
      await sleep(200);
      expect(jobInserts()).toHaveLength(0);
      expect(directSends()).toHaveLength(0);
    });

    test('mensagem chegando no número da B vira job da B, nunca da A', async () => {
      settings.set(`${tenantB}:attendance_settings`, { businessHours: allClosed, offHoursMessage: 'Fechado (B).' });
      await webhook(instB);
      const [ins] = await waitFor(() => (jobInserts().length ? jobInserts() : null));
      expect(jobCol(ins, 'tenant_id')).toBe(tenantB);
      expect(jobCol(ins, 'instance')).toBe(instB);
      expect(directSends()).toHaveLength(0);
    });

    test('dedupe: a mesma resposta já na fila não é enfileirada de novo', async () => {
      settings.set(`${tenantA}:attendance_settings`, { businessHours: allClosed, offHoursMessage: 'Estamos fechados agora.' });
      const base = querySpy.getMockImplementation();
      querySpy.mockImplementation((sql, params) => (/trigger_event = 'auto_reply' AND message = \$2/.test(String(sql))
        ? (sqlLog.push({ text: String(sql), params }), Promise.resolve({ rows: [{ '?column?': 1 }], rowCount: 1 }))
        : base(sql, params)));
      await webhook();
      await sleep(200);
      expect(sqlLog.some(q => /trigger_event = 'auto_reply' AND message = \$2/.test(q.text))).toBe(true);
      expect(jobInserts()).toHaveLength(0);
    });
  });

  describe('POST /api/sessions/close — telefone do banco', () => {
    test('ignora leadPhone do corpo e lê de crm_leads da clínica', async () => {
      await request(app).post('/api/sessions/close').set(auth())
        .send({ leadId: leadA, leadPhone: '5599900001111', instance: instA });
      const q = sqlLog.find(s => /SELECT nome, telefone FROM crm_leads WHERE id = \$1 AND tenant_id = \$2/.test(s.text));
      expect(q.params).toEqual([leadA, tenantA]);
      const optOutQ = sqlLog.find(s => /FROM whatsapp_opt_outs/.test(s.text));
      expect(optOutQ.params[1]).toMatch(/88887777$/);
      expect(JSON.stringify(sqlLog.map(s => s.params))).not.toContain('5599900001111');
    });

    test('lead de outra clínica: nenhum telefone, nenhum envio', async () => {
      await request(app).post('/api/sessions/close').set(auth(tenantB))
        .send({ leadId: leadA, leadPhone: telefoneA, instance: instB });
      expect(sqlLog.some(s => /FROM whatsapp_opt_outs/.test(s.text))).toBe(false);
      expect(directSends()).toHaveLength(0);
    });
  });
});
