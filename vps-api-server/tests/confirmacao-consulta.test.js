// Confirmação de consulta pelo WhatsApp: pedido com botões pela fila (fallback 1/2),
// resposta do paciente no webhook atualizando o agendamento da clínica certa, e o
// estado do pedido na agenda. pool.query e fetch são mockados: nada sai para a Evolution.
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

const {
  app, pool, clearTenantSettingsCacheForTests, processAppointmentReminders, parseAppointmentReminderReply,
  processAutomationJobs, resetWhatsAppQueueStateForTests,
} = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const instA = '11111111-clinica-a';
const instB = '22222222-clinica-b';
const agendA = 'aaaaaaaa-0000-4000-8000-000000000001';
const telefoneA = '5511988887777';
const instanceOwner = { [instA]: tenantA, [instB]: tenantB };
const auth = (tenant = tenantA) => ({
  Authorization: `Bearer ${jwt.sign({ sub: '44444444-4444-4444-4444-444444444444', email: 'a@a.com', role: 'admin', tenant_id: tenant, is_super_admin: false }, JWT_SECRET)}`,
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(20); }
  return fn();
}

describe('Confirmação de consulta pelo WhatsApp', () => {
  let querySpy, fetchSpy, sqlLog, fetchLog, optedOut, reminderRows, sentReminder, apptRow, existingLead, queues;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    clearTenantSettingsCacheForTests();
    resetWhatsAppQueueStateForTests();
    sqlLog = []; fetchLog = []; optedOut = false; existingLead = null; queues = [];
    reminderRows = [{
      id: agendA, tenant_id: tenantA, paciente_id: 'p1', data: '2099-03-10', hora: '14:30', confirmacao_quando: null,
      paciente_nome: 'Maria Souza', telefone: '(11) 98888-7777', dentista_nome: 'Dra. Ana', procedimento: 'Canal no dente 36',
    }];
    sentReminder = { id: 'job-rem-1', flow_id: `reminder_${agendA}`, variables: { agendamentoId: agendA } };
    apptRow = { id: agendA, status: 'agendado', data: '2099-03-10', hora: '14:30', telefone: '11988887777' };
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const ok = (rows, rowCount = rows.length) => Promise.resolve({ rows, rowCount });
      if (/SELECT tenant_id FROM whatsapp_instances WHERE instance_name = \$1/.test(text)) {
        const t = instanceOwner[params[0]]; return ok(t ? [{ tenant_id: t }] : []);
      }
      if (/SELECT instance_name FROM whatsapp_instances WHERE tenant_id = \$1/.test(text)) {
        return ok(Object.entries(instanceOwner).filter(([, t]) => t === params[0]).map(([n]) => ({ instance_name: n })));
      }
      if (/FROM whatsapp_opt_outs/.test(text)) return ok(optedOut ? [{ x: 1 }] : []);
      if (/SELECT nome FROM tenants WHERE id = \$1/.test(text)) return ok([{ nome: params[0] === tenantA ? 'Clínica A' : 'Clínica B' }]);
      if (/FROM agendamentos a\s+JOIN pacientes p ON p.id = a.paciente_id AND p.tenant_id = a.tenant_id\s+LEFT JOIN dentistas/.test(text)) return ok(reminderRows);
      if (/trigger_event = 'appointment_reminder' AND aj.status = 'sent'/.test(text)) {
        // Pedido enviado pela clínica A a este telefone.
        if (params[0] !== tenantA || !String(telefoneA).endsWith(String(params[1]).slice(-8))) return ok([]);
        if (params[2] && params[2] !== sentReminder.flow_id) return ok([]);
        return ok(sentReminder ? [sentReminder] : []);
      }
      if (/FROM agendamentos a JOIN pacientes p ON p.id = a.paciente_id AND p.tenant_id = a.tenant_id\s+WHERE a.id::text = \$1 AND a.tenant_id = \$2/.test(text)) {
        return ok(params[0] === agendA && params[1] === tenantA ? [apptRow] : []);
      }
      if (/UPDATE agendamentos SET status = \$3/.test(text)) return ok([], params[0] === agendA && params[1] === tenantA ? 1 : 0);
      if (/SELECT id, nome as name, avatar_url, telefone as phone/.test(text)) return ok(existingLead ? [existingLead] : []);
      if (/FROM attendance_queues/.test(text)) return ok(queues);
      if (/INSERT INTO automation_jobs/.test(text)) return ok([{ id: `job-${sqlLog.length}` }]);
      return ok([]);
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      fetchLog.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      if (/fetchInstances/.test(String(url))) return { ok: true, status: 200, json: async () => [{ name: instB, connectionStatus: 'open' }, { name: instA, connectionStatus: 'open' }] };
      return { ok: true, status: 200, json: async () => ({ key: { id: 'X' } }) };
    });
  });

  afterEach(() => { querySpy.mockRestore(); fetchSpy.mockRestore(); });
  afterAll(async () => { await pool.end(); });

  const jobInserts = () => sqlLog.filter(q => /INSERT INTO automation_jobs/.test(q.text));
  const jobCol = (q, col) => {
    const cols = q.text.match(/\(([^)]+)\) VALUES/)[1].split(',').map(c => c.trim());
    return q.params[cols.indexOf(col)];
  };
  const jobVars = (q) => JSON.parse(jobCol(q, 'variables') || '{}');
  const sends = () => fetchLog.filter(f => /\/message\/send/.test(f.url));
  const statusUpdates = () => sqlLog.filter(q => /UPDATE agendamentos SET status = \$3/.test(q.text));

  describe('pedido de confirmação (processAppointmentReminders)', () => {
    test('vai para a fila da clínica com botões, fallback 1/2 e sem procedimento', async () => {
      await processAppointmentReminders();
      const [ins] = jobInserts();
      expect(ins).toBeDefined();
      expect(jobCol(ins, 'tenant_id')).toBe(tenantA);
      expect(jobCol(ins, 'instance')).toBe(instA);
      expect(jobCol(ins, 'category')).toBe('transactional');
      expect(jobCol(ins, 'trigger_event')).toBe('appointment_reminder');
      expect(jobCol(ins, 'flow_id')).toBe(`reminder_${agendA}`);
      const msg = jobCol(ins, 'message');
      expect(msg).toMatch(/Clínica A/);
      expect(msg).toMatch(/10\/03\/2099/);
      expect(msg).toMatch(/14:30/);
      expect(msg).toMatch(/Dra\. Ana/);
      expect(msg).toMatch(/Responda \*1\* para confirmar ou \*2\* para remarcar/);
      expect(msg).not.toMatch(/Canal|dente/i);
      const v = jobVars(ins);
      expect(v).toMatchObject({ agendamentoId: agendA, apptDate: '2099-03-10' });
      expect(v.interactive.endpoint).toBe('sendButtons');
      expect(v.interactive.payload.buttons.map(b => b.buttonId)).toEqual([`appt_confirm_${agendA}`, `appt_reschedule_${agendA}`]);
      expect(v.interactive.payload.buttons.map(b => b.buttonText.displayText)).toEqual(['Confirmar', 'Preciso remarcar']);
      expect(JSON.stringify(v.interactive.payload)).not.toMatch(/Canal|dente/i);
      expect(new Date(jobCol(ins, 'expires_at')).toISOString()).toBe('2099-03-10T17:30:00.000Z');
      expect(sends()).toHaveLength(0);
    });

    test('consulta e dedupe filtram tenant e status; nomes vêm dos cadastros da clínica', async () => {
      await processAppointmentReminders();
      const q = sqlLog.find(s => /FROM agendamentos a\s+JOIN pacientes p/.test(s.text));
      expect(q.text).toMatch(/p\.tenant_id = a\.tenant_id/);
      expect(q.text).toMatch(/d\.tenant_id = a\.tenant_id/);
      expect(q.text).toMatch(/aj\.tenant_id = a\.tenant_id/);
      expect(q.text).toMatch(/apptDate/);
      expect(q.params[0]).toEqual(expect.arrayContaining(['confirmado', 'remarcar', 'cancelado']));
    });

    test('paciente em opt-out não recebe pedido', async () => {
      optedOut = true;
      await processAppointmentReminders();
      expect(jobInserts()).toHaveLength(0);
    });

    test('na fila, o lembrete sai com botões (job interno)', async () => {
      await processAppointmentReminders();
      const [ins] = jobInserts();
      const job = {
        id: 'job-x', tenant_id: tenantA, instance: instA, patient_phone: telefoneA, message: jobCol(ins, 'message'),
        category: 'service', trigger_event: 'appointment_reminder', status: 'pending', channel: 'whatsapp',
        scheduled_at: new Date(), expires_at: new Date(Date.now() + 60_000), created_at: new Date(),
        variables: jobCol(ins, 'variables'),
      };
      const base = querySpy.getMockImplementation();
      querySpy.mockImplementation((sql, params) => {
        const t = String(sql);
        if (/SELECT DISTINCT ON/.test(t) || /UPDATE automation_jobs SET claimed_at = NOW\(\)/.test(t)) return Promise.resolve({ rows: [job], rowCount: 1 });
        if (/SELECT created_at, paused_until/.test(t)) return Promise.resolve({ rows: [{ created_at: new Date('2020-01-01') }], rowCount: 1 });
        if (/COUNT\(\*\) FILTER/.test(t)) return Promise.resolve({ rows: [{ last_hour: 0, today: 0 }], rowCount: 1 });
        return base(sql, params);
      });
      fetchLog = [];
      await processAutomationJobs();
      expect(sends().map(s => s.url.split('/message/')[1])).toEqual([`sendButtons/${instA}`]);
    });
  });

  describe('parse da resposta', () => {
    test.each([
      ['1', 'confirmado'], ['Sim', 'confirmado'], ['confirmar!', 'confirmado'], ['2', 'remarcar'],
      ['Preciso remarcar', 'remarcar'], [`appt_confirm_${agendA}`, 'confirmado'], [`appt_reschedule_${agendA}`, 'remarcar'],
    ])('%s → %s', (txt, action) => expect(parseAppointmentReminderReply(txt).action).toBe(action));
    test.each(['quero cancelar a consulta', '3', 'oi', ''])('"%s" não é resposta', (txt) => expect(parseAppointmentReminderReply(txt)).toBeNull());
  });

  describe('webhook', () => {
    const webhook = (content, { instance = instA, button = false } = {}) => request(app).post('/api/webhook/evolution').send({
      event: 'messages.upsert', instance,
      data: {
        key: { remoteJid: `${telefoneA}@s.whatsapp.net`, fromMe: false, id: `MSG-${Math.random()}` },
        message: button ? { buttonsResponseMessage: { selectedButtonId: content, selectedDisplayText: 'Confirmar' } } : { conversation: content },
        pushName: 'Paciente', messageTimestamp: 1,
      },
    });
    const replyJobs = () => jobInserts().filter(q => jobCol(q, 'trigger_event') === 'auto_reply');

    test('"1" confirma o agendamento da clínica A e responde pela fila', async () => {
      existingLead = { id: 'lead-1', name: 'Maria', phone: telefoneA, awaiting_queue_selection: false };
      await webhook('1');
      const [upd] = await waitFor(() => (statusUpdates().length ? statusUpdates() : null));
      expect(upd.params).toEqual([agendA, tenantA, 'confirmado']);
      const [rep] = await waitFor(() => (replyJobs().length ? replyJobs() : null));
      expect(jobCol(rep, 'tenant_id')).toBe(tenantA);
      expect(jobCol(rep, 'message')).toMatch(/Presença confirmada/);
      const mark = sqlLog.find(q => /confirmationReply/.test(q.text) && /^\s*UPDATE automation_jobs/.test(q.text));
      expect(mark.params).toEqual(['job-rem-1', 'confirmado', tenantA]);
      expect(sends()).toHaveLength(0);
    });

    test('botão "Preciso remarcar" marca remarcar e responde', async () => {
      existingLead = { id: 'lead-1', name: 'Maria', phone: telefoneA, awaiting_queue_selection: false };
      await webhook(`appt_reschedule_${agendA}`, { button: true });
      const [upd] = await waitFor(() => (statusUpdates().length ? statusUpdates() : null));
      expect(upd.params).toEqual([agendA, tenantA, 'remarcar']);
      const [rep] = await waitFor(() => (replyJobs().length ? replyJobs() : null));
      expect(jobCol(rep, 'message')).toMatch(/pedido para remarcar/);
      const q = sqlLog.find(s => /trigger_event = 'appointment_reminder' AND aj.status = 'sent'/.test(s.text));
      expect(q.params[2]).toBe(`reminder_${agendA}`);
    });

    test('paciente sem conversa: "1" não vira escolha de setor nem dispara menu', async () => {
      queues = [{ id: 'q1', name: 'Agendamento', icon: '📅', whatsapp_button_label: null }];
      await webhook('1');
      await waitFor(() => statusUpdates().length);
      await sleep(150);
      expect(statusUpdates()[0].params[2]).toBe('confirmado');
      const leadIns = sqlLog.find(q => /INSERT INTO crm_leads/.test(q.text));
      expect(leadIns.params[4]).toBe(false); // awaiting_queue_selection
      expect(jobInserts().some(q => jobVars(q).kind === 'queue_menu')).toBe(false);
    });

    test('telefone diferente do cadastro do paciente: não altera nada', async () => {
      existingLead = { id: 'lead-1', name: 'Maria', phone: telefoneA, awaiting_queue_selection: false };
      apptRow.telefone = '11977776666';
      await webhook('1');
      await sleep(200);
      expect(statusUpdates()).toHaveLength(0);
      expect(replyJobs()).toHaveLength(0);
    });

    test('mensagem no número da clínica B não confirma consulta da clínica A', async () => {
      existingLead = { id: 'lead-1', name: 'Maria', phone: telefoneA, awaiting_queue_selection: false };
      await webhook('1', { instance: instB });
      await sleep(200);
      expect(statusUpdates()).toHaveLength(0);
      const q = sqlLog.find(s => /trigger_event = 'appointment_reminder' AND aj.status = 'sent'/.test(s.text));
      expect(q.params[0]).toBe(tenantB);
    });

    test('sem pedido no prazo (já respondido ou após a consulta): não altera nada', async () => {
      existingLead = { id: 'lead-1', name: 'Maria', phone: telefoneA, awaiting_queue_selection: false };
      sentReminder = null;
      await webhook('2');
      await sleep(200);
      expect(statusUpdates()).toHaveLength(0);
      const q = sqlLog.find(s => /trigger_event = 'appointment_reminder' AND aj.status = 'sent'/.test(s.text));
      expect(q.text).toMatch(/expires_at > NOW\(\)/);
      expect(q.text).toMatch(/confirmationReply/);
    });
  });

  test('GET /api/agenda traz lembrete_status com filtro da clínica', async () => {
    await request(app).get('/api/agenda').set(auth());
    const q = sqlLog.find(s => /lembrete_status/.test(s.text));
    expect(q).toBeDefined();
    expect(q.text).toMatch(/aj\.tenant_id = a\.tenant_id/);
    expect(q.params[0]).toBe(tenantA);
  });
});
