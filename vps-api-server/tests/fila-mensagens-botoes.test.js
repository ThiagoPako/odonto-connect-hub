// Fila central com mensagens interativas (botões/lista) e os envios que saíram do
// envio direto: menu de filas, confirmação de opt-out (exceção ao filtro de opt-out),
// pesquisa de satisfação e respostas automáticas do webhook. Também o tenant_id no
// auto-retorno do lead em recuperação.
//
// pool.query e fetch são mockados: nada chega ao Postgres nem à Evolution.
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

const { app, pool, clearTenantSettingsCacheForTests, processAutomationJobs, resetWhatsAppQueueStateForTests } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const instA = '11111111-clinica-a';
const instB = '22222222-clinica-b';
const leadA = '88888888-8888-8888-8888-888888888888';
const telefoneA = '5511988887777';
const instanceOwner = { [instA]: tenantA, [instB]: tenantB };

const auth = (tenant = tenantA) => ({
  Authorization: `Bearer ${jwt.sign({
    sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica.com', role: 'admin',
    tenant_id: tenant, is_super_admin: false,
  }, JWT_SECRET)}`,
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(20); }
  return fn();
}

describe('Fila: mensagens com botões e envios automáticos restantes', () => {
  let querySpy, fetchSpy, sqlLog, fetchLog, settings, optedOut, existingLead, queues, queueJob, buttonsReply, jobStatus;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    clearTenantSettingsCacheForTests();
    resetWhatsAppQueueStateForTests();
    sqlLog = []; fetchLog = []; settings = new Map(); optedOut = false; existingLead = null;
    queues = []; queueJob = null; jobStatus = null;
    buttonsReply = { ok: true, body: { key: { id: 'BTN-1' } } };
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const ok = (rows, rowCount = rows.length) => Promise.resolve({ rows, rowCount });
      if (/SELECT tenant_id FROM whatsapp_instances WHERE instance_name = \$1/.test(text)) {
        const t = instanceOwner[params[0]];
        return ok(t ? [{ tenant_id: t }] : []);
      }
      if (/SELECT instance_name FROM whatsapp_instances WHERE tenant_id = \$1/.test(text)) {
        return ok(Object.entries(instanceOwner).filter(([, t]) => t === params[0]).map(([n]) => ({ instance_name: n })));
      }
      if (/SELECT created_at, paused_until FROM whatsapp_instances/.test(text)) return ok([{ created_at: new Date('2020-01-01'), paused_until: null }]);
      if (/SELECT value FROM tenant_settings WHERE tenant_id = \$1 AND key = \$2/.test(text)) {
        const v = settings.get(`${params[0]}:${params[1]}`);
        return ok(v === undefined ? [] : [{ value: v }]);
      }
      if (/INSERT INTO whatsapp_opt_outs/.test(text)) { optedOut = true; return ok([], 1); }
      if (/FROM whatsapp_opt_outs/.test(text)) return ok(optedOut ? [{ x: 1 }] : []);
      if (/SELECT nome FROM tenants WHERE id = \$1/.test(text)) return ok([{ nome: params[0] === tenantA ? 'Clínica A' : 'Clínica B' }]);
      if (/FROM attendance_queues/.test(text)) return ok(params[0] === tenantA ? queues : []);
      if (/SELECT id, nome as name, avatar_url, telefone as phone/.test(text)) return ok(existingLead ? [existingLead] : []);
      if (/SELECT kanban_stage FROM crm_leads/.test(text)) return ok([{ kanban_stage: 'followup' }]);
      if (/SELECT nome, telefone FROM crm_leads WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        return ok(params[0] === leadA && params[1] === tenantA ? [{ nome: 'Lead A', telefone: telefoneA }] : []);
      }
      if (/UPDATE attendance_sessions SET/.test(text)) return ok([{ id: 'sess-1', duration_seconds: 10, attendant_id: null, attendant_name: 'Ana' }]);
      if (/INSERT INTO automation_jobs/.test(text)) return ok([{ id: 'job-1' }]);
      // Fila
      if (/SELECT DISTINCT ON/.test(text)) return ok(queueJob ? [queueJob] : []);
      if (/UPDATE automation_jobs SET claimed_at = NOW\(\)/.test(text)) return ok(queueJob ? [queueJob] : []);
      if (/COUNT\(\*\) FILTER/.test(text)) return ok([{ last_hour: 0, today: 0 }]);
      if (/UPDATE automation_jobs SET status = 'sent'/.test(text)) { jobStatus = 'sent'; return ok([], 1); }
      if (/UPDATE automation_jobs SET status = 'failed'/.test(text)) { jobStatus = `failed: ${params[1]}`; return ok([], 1); }
      return ok([]);
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      fetchLog.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      if (/\/instance\/fetchInstances/.test(String(url))) {
        return { ok: true, status: 200, json: async () => [{ name: instB, connectionStatus: 'open' }, { name: instA, connectionStatus: 'open' }] };
      }
      if (/\/message\/sendButtons\//.test(String(url))) {
        return { ok: buttonsReply.ok, status: buttonsReply.ok ? 200 : 400, json: async () => buttonsReply.body };
      }
      return { ok: true, status: 200, json: async () => ({ key: { id: 'TXT-1' } }) };
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

  const makeJob = (extra = {}) => ({
    id: 'job-q1', tenant_id: tenantA, instance: instA, patient_phone: telefoneA, message: 'Texto numerado 1 - A',
    category: 'service', trigger_event: 'auto_reply', status: 'pending', channel: 'whatsapp',
    scheduled_at: new Date(), expires_at: new Date(Date.now() + 60_000), created_at: new Date(),
    variables: JSON.stringify({ kind: 'queue_menu', dedupeMinutes: 2, interactive: { endpoint: 'sendButtons', payload: { title: '', description: 'Escolha', buttons: [{ buttonId: 'queue_1', buttonText: { displayText: 'A' }, type: 1 }] } } }),
    ...extra,
  });

  describe('processAutomationJobs com mensagem interativa', () => {
    test('botões aceitos (key.id): só sendButtons, pelo número da clínica, job enviado', async () => {
      queueJob = makeJob();
      await processAutomationJobs();
      expect(sends().map(s => s.url)).toEqual([`http://evolution.teste.invalid/message/sendButtons/${instA}`]);
      expect(sends()[0].body).toMatchObject({ number: `${telefoneA}@s.whatsapp.net`, description: 'Escolha' });
      expect(sends()[0].body.buttons).toHaveLength(1);
      expect(jobStatus).toBe('sent');
      // Dedupe com a janela do job (2 min), não 24 h.
      const dup = sqlLog.find(q => /status = 'sent' AND id <> \$2 AND message = \$3/.test(q.text));
      expect(dup.params[4]).toBe(2);
    });

    test('botões sem key.id: cai para o texto do job', async () => {
      queueJob = makeJob();
      buttonsReply = { ok: true, body: { status: 'PENDING' } };
      await processAutomationJobs();
      expect(sends().map(s => s.url.split('/message/')[1])).toEqual([`sendButtons/${instA}`, `sendText/${instA}`]);
      expect(sends()[1].body.text).toBe('Texto numerado 1 - A');
      expect(jobStatus).toBe('sent');
    });

    test('botões com erro HTTP: cai para o texto do job', async () => {
      queueJob = makeJob();
      buttonsReply = { ok: false, body: { error: 'not supported' } };
      await processAutomationJobs();
      expect(sends().map(s => s.url.split('/message/')[1])).toEqual([`sendButtons/${instA}`, `sendText/${instA}`]);
      expect(jobStatus).toBe('sent');
    });

    test('endpoint fora da lista é ignorado: sai só o texto', async () => {
      queueJob = makeJob({ variables: JSON.stringify({ interactive: { endpoint: 'sendMedia', payload: { media: 'x' } } }) });
      await processAutomationJobs();
      expect(sends().map(s => s.url.split('/message/')[1])).toEqual([`sendText/${instA}`]);
    });

    test('opt-out: confirmação do SAIR passa; qualquer outra resposta automática é barrada', async () => {
      optedOut = true;
      queueJob = makeJob({ message: 'Pronto! ...', variables: JSON.stringify({ kind: 'opt_out_confirmation' }) });
      await processAutomationJobs();
      expect(jobStatus).toBe('sent');
      expect(sends()).toHaveLength(1);

      resetWhatsAppQueueStateForTests(); fetchLog = []; jobStatus = null;
      queueJob = makeJob();
      await processAutomationJobs();
      expect(jobStatus).toMatch(/failed: Paciente pediu para não receber/);
      expect(sends()).toHaveLength(0);
    });

    test('a exceção vale só para auto_reply: campanha com kind forjado continua barrada', async () => {
      optedOut = true;
      queueJob = makeJob({ trigger_event: 'campaign', category: 'marketing', variables: JSON.stringify({ kind: 'opt_out_confirmation' }) });
      await processAutomationJobs();
      expect(jobStatus).toMatch(/failed: Paciente pediu/);
      expect(sends()).toHaveLength(0);
    });
  });

  describe('Webhook', () => {
    const webhook = (text, instance = instA) => request(app).post('/api/webhook/evolution').send({
      event: 'messages.upsert', instance,
      data: {
        key: { remoteJid: `${telefoneA}@s.whatsapp.net`, fromMe: false, id: `MSG-${Math.random()}` },
        message: { conversation: text }, pushName: 'Paciente Teste', messageTimestamp: 1,
      },
    });

    test('SAIR: confirmação enfileirada (service, kind opt_out_confirmation) mesmo já em opt-out, sem envio direto', async () => {
      existingLead = { id: leadA, name: 'Lead A', phone: telefoneA, awaiting_queue_selection: false };
      await webhook('SAIR');
      const [ins] = await waitFor(() => (jobInserts().length ? jobInserts() : null));
      expect(ins).toBeDefined();
      expect(optedOut).toBe(true);
      expect(jobCol(ins, 'tenant_id')).toBe(tenantA);
      expect(jobCol(ins, 'instance')).toBe(instA);
      expect(jobCol(ins, 'category')).toBe('service');
      expect(jobCol(ins, 'trigger_event')).toBe('auto_reply');
      expect(jobVars(ins).kind).toBe('opt_out_confirmation');
      expect(jobCol(ins, 'message')).toMatch(/Clínica A não vai mais enviar/);
      expect(sends()).toHaveLength(0);
    });

    test('lead novo sem boas-vindas: menu de filas vai para a fila com botões e fallback numerado', async () => {
      queues = [{ id: 'q1', name: 'Agendamento', icon: '📅', whatsapp_button_label: null }];
      await webhook('oi');
      const [ins] = await waitFor(() => (jobInserts().length ? jobInserts() : null));
      expect(ins).toBeDefined();
      expect(jobCol(ins, 'tenant_id')).toBe(tenantA);
      expect(jobCol(ins, 'instance')).toBe(instA);
      expect(jobCol(ins, 'trigger_event')).toBe('auto_reply');
      expect(jobCol(ins, 'message')).toMatch(/\*1\* - 📅 Agendamento/);
      const v = jobVars(ins);
      expect(v).toMatchObject({ kind: 'queue_menu', dedupeMinutes: 2 });
      expect(v.interactive.endpoint).toBe('sendButtons');
      expect(v.interactive.payload.buttons[0].buttonId).toBe('queue_q1');
      expect(v.interactive.payload.number).toBeUndefined();
      await sleep(100);
      expect(sends()).toHaveLength(0);
    });

    test('auto-retorno do lead em recuperação filtra crm_leads por tenant_id', async () => {
      existingLead = { id: leadA, name: 'Lead A', phone: telefoneA, awaiting_queue_selection: false };
      await webhook('voltei, ainda quero');
      const upd = await waitFor(() => sqlLog.find(q => /priority = true/.test(q.text)));
      expect(upd).toBeDefined();
      expect(upd.text).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
      expect(upd.params).toEqual([leadA, tenantA]);
      const sel = sqlLog.find(q => /SELECT kanban_stage FROM crm_leads/.test(q.text));
      expect(sel.params).toEqual([leadA, tenantA]);
    });
  });

  describe('POST /api/sessions/close', () => {
    test('pesquisa de satisfação vai para a fila, com botões e fallback, pelo número da clínica', async () => {
      const res = await request(app).post('/api/sessions/close').set(auth()).send({ leadId: leadA, instance: instA });
      expect(res.status).toBe(200);
      expect(res.body.surveyQueued).toBe(true); // a tela do chat usa isso para avisar o atendente
      const [ins] = jobInserts();
      expect(ins).toBeDefined();
      expect(jobCol(ins, 'tenant_id')).toBe(tenantA);
      expect(jobCol(ins, 'instance')).toBe(instA);
      expect(jobCol(ins, 'trigger_event')).toBe('satisfaction_survey');
      expect(jobCol(ins, 'category')).toBe('transactional');
      expect(jobCol(ins, 'message')).toMatch(/Responda com o número da sua avaliação/);
      const v = jobVars(ins);
      expect(v.interactive.endpoint).toBe('sendButtons');
      expect(v.interactive.payload.buttons.map(b => b.buttonId)).toEqual([`rating_${leadA}_5`, `rating_${leadA}_4`, `rating_${leadA}_3`]);
      expect(sqlLog.some(q => /INSERT INTO app_settings/.test(q.text) && q.params[0] === `awaiting_rating_${tenantA}_${telefoneA}`)).toBe(true);
      expect(sends()).toHaveLength(0);
    });

    test('instância de outra clínica: nada é enfileirado', async () => {
      const res = await request(app).post('/api/sessions/close').set(auth()).send({ leadId: leadA, instance: instB });
      expect(res.body.surveyQueued).toBe(false);
      expect(jobInserts()).toHaveLength(0);
      expect(sends()).toHaveLength(0);
    });
  });
});
