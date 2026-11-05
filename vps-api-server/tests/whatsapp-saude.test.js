// Saúde do WhatsApp: job que lê o estado de cada número por clínica, grava histórico
// e avisa a clínica quando cai; endpoint de estado só com os números da clínica; fila
// segura envios de número desconectado sem falhar. pool.query e fetch mockados.
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

const { app, pool, checkWhatsAppHealth, processAutomationJobsForHealthTests: processAutomationJobs } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const instA = '11111111-clinica-a';
const instB = '22222222-clinica-b';
const auth = (tenant = tenantA) => ({
  Authorization: `Bearer ${jwt.sign({ sub: '44444444-4444-4444-4444-444444444444', email: 'a@a.com', role: 'admin', tenant_id: tenant, is_super_admin: false }, JWT_SECRET)}`,
});

describe('Saúde do WhatsApp', () => {
  let querySpy, fetchSpy, sqlLog, fetchLog, stored, evolution, evolutionOk, queueJob;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    sqlLog = []; fetchLog = []; evolutionOk = true; queueJob = null;
    stored = [
      { instance_name: instA, tenant_id: tenantA, connection_state: 'open', state_since: new Date(Date.now() - 86_400_000), last_alert_at: null },
      { instance_name: instB, tenant_id: tenantB, connection_state: 'open', state_since: new Date(Date.now() - 86_400_000), last_alert_at: null },
    ];
    evolution = [{ name: instA, connectionStatus: 'close' }, { name: instB, connectionStatus: 'open' }];
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const ok = (rows, rowCount = rows.length) => Promise.resolve({ rows, rowCount });
      if (/FROM whatsapp_instances WHERE tenant_id IS NOT NULL/.test(text)) return ok(stored);
      if (/SELECT tenant_id FROM whatsapp_instances WHERE instance_name = \$1/.test(text)) {
        const r = stored.find(x => x.instance_name === params[0]); return ok(r ? [{ tenant_id: r.tenant_id }] : []);
      }
      if (/SELECT instance_name FROM whatsapp_instances WHERE tenant_id = \$1/.test(text)) {
        return ok(stored.filter(x => x.tenant_id === params[0]).map(x => ({ instance_name: x.instance_name })));
      }
      if (/FROM whatsapp_instances w\s+WHERE w.tenant_id = \$1/.test(text)) {
        return ok(stored.filter(x => x.tenant_id === params[0]).map(x => ({
          instance_name: x.instance_name, connection_state: x.connection_state, state_since: x.state_since,
          last_checked_at: new Date(), changes_last_hour: x.changes || 0, pending_jobs: 3,
        })));
      }
      if (/SELECT DISTINCT ON/.test(text)) return ok(queueJob ? [queueJob] : []);
      if (/UPDATE automation_jobs SET claimed_at = NOW\(\)/.test(text)) return ok(queueJob ? [queueJob] : []);
      return ok([]);
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      fetchLog.push(String(url));
      if (/fetchInstances/.test(String(url))) return { ok: evolutionOk, status: evolutionOk ? 200 : 502, json: async () => (evolutionOk ? evolution : {}) };
      return { ok: true, status: 200, json: async () => ({ key: { id: 'X' } }) };
    });
  });

  afterEach(() => { querySpy.mockRestore(); fetchSpy.mockRestore(); });
  afterAll(async () => { await pool.end(); });

  const q = (re) => sqlLog.filter(s => re.test(s.text));

  test('mudança de estado grava estado e histórico só na clínica dona do número', async () => {
    await checkWhatsAppHealth();
    const upd = q(/SET connection_state = \$3, state_since = NOW\(\)/);
    expect(upd).toHaveLength(1);
    expect(upd[0].params).toEqual([instA, tenantA, 'close']);
    const log = q(/INSERT INTO whatsapp_instance_health_log/);
    expect(log).toHaveLength(1);
    expect(log[0].params).toEqual([tenantA, instA, 'close', 'open']);
  });

  test('o job só lê a Evolution: nada de connect, logout, restart nem envio', async () => {
    await checkWhatsAppHealth();
    expect(fetchLog.every(u => /\/instance\/fetchInstances$/.test(u))).toBe(true);
  });

  test('queda recente (< 10 min) não dispara aviso; queda longa avisa uma vez', async () => {
    await checkWhatsAppHealth();
    expect(q(/SET last_alert_at = NOW\(\)/)).toHaveLength(0);

    sqlLog = [];
    stored[0].connection_state = 'close';
    stored[0].state_since = new Date(Date.now() - 30 * 60_000);
    await checkWhatsAppHealth();
    const alert = q(/SET last_alert_at = NOW\(\)/);
    expect(alert).toHaveLength(1);
    expect(alert[0].params).toEqual([instA, tenantA]);

    sqlLog = [];
    stored[0].last_alert_at = new Date(Date.now() - 5 * 60_000);
    await checkWhatsAppHealth();
    expect(q(/SET last_alert_at = NOW\(\)/)).toHaveLength(0); // dentro do intervalo de 6 h
  });

  test('número sumiu da Evolution vira "ausente"', async () => {
    evolution = [{ name: instB, connectionStatus: 'open' }];
    await checkWhatsAppHealth();
    expect(q(/SET connection_state = \$3/)[0].params).toEqual([instA, tenantA, 'ausente']);
  });

  test('Evolution sem resposta: não marca nenhuma clínica como desconectada', async () => {
    evolutionOk = false;
    await checkWhatsAppHealth();
    expect(q(/SET connection_state/)).toHaveLength(0);
    expect(q(/INSERT INTO whatsapp_instance_health_log/)).toHaveLength(0);
  });

  test('GET /api/whatsapp/health devolve só os números da clínica, com tempo desconectado e loop', async () => {
    stored[0].connection_state = 'connecting';
    stored[0].state_since = new Date(Date.now() - 125 * 60_000);
    stored[0].changes = 6;
    const res = await request(app).get('/api/whatsapp/health').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.instances.map(i => i.instance)).toEqual([instA]);
    expect(res.body.anyDown).toBe(true);
    expect(res.body.instances[0]).toMatchObject({ state: 'connecting', reconnectLoop: true, pendingJobs: 3 });
    expect(res.body.instances[0].downForMinutes).toBeGreaterThanOrEqual(125);
    const sel = q(/FROM whatsapp_instances w\s+WHERE w.tenant_id = \$1/);
    expect(sel[0].params).toEqual([tenantA]);
    expect(sel[0].text).toMatch(/l\.tenant_id = w\.tenant_id/);
    expect(sel[0].text).toMatch(/j\.tenant_id = w\.tenant_id/);
  });

  test('clínica B não vê o número da clínica A', async () => {
    const res = await request(app).get('/api/whatsapp/health').set(auth(tenantB));
    expect(res.body.instances.map(i => i.instance)).toEqual([instB]);
    expect(res.body.anyDown).toBe(false);
  });

  test('fila: número da clínica desconectado segura o envio (não falha, não envia)', async () => {
    queueJob = {
      id: 'job-1', tenant_id: tenantA, instance: instA, patient_phone: '5511988887777', message: 'Lembrete',
      category: 'transactional', trigger_event: 'appointment_reminder', status: 'pending', channel: 'whatsapp',
      scheduled_at: new Date(), expires_at: new Date(Date.now() + 86_400_000), created_at: new Date(Date.now() - 5 * 86_400_000),
    };
    await processAutomationJobs();
    expect(fetchLog.filter(u => /\/message\/send/.test(u))).toHaveLength(0);
    expect(q(/SET status = 'failed', error = \$2/)).toHaveLength(0);
    const rel = q(/UPDATE automation_jobs SET claimed_at = NULL, scheduled_at = COALESCE/);
    expect(rel).toHaveLength(1);
    expect(rel[0].params[2]).toMatch(/desconectado/);
  });

  test('fila: sem número conectado há mais de 3 dias continua aguardando (só a validade encerra)', async () => {
    stored = stored.filter(x => x.tenant_id !== tenantA);
    queueJob = {
      id: 'job-2', tenant_id: tenantA, instance: null, patient_phone: '5511988887777', message: 'Lembrete',
      category: 'transactional', trigger_event: 'appointment_reminder', status: 'pending', channel: 'whatsapp',
      scheduled_at: new Date(), expires_at: new Date(Date.now() + 86_400_000), created_at: new Date(Date.now() - 5 * 86_400_000),
    };
    await processAutomationJobs();
    expect(q(/SET status = 'failed', error = \$2/)).toHaveLength(0);
    expect(q(/UPDATE automation_jobs SET claimed_at = NULL/)[0].params[2]).toMatch(/Aguardando WhatsApp da clínica conectar/);
  });
});
