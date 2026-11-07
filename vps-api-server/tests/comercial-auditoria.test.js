// Auditoria do módulo comercial (docs/modulos/crm.md): permissões por perfil nas rotas
// de marketing, público de campanha só com conversa prévia, "personalizado" não vira
// "todos", 1 marketing por intervalo entre campanhas, fila sem cancelamento em massa,
// fluxo de marketing manual com rodapé SAIR e painel comercial com etapas reais.
// pool.query e fetch mockados.
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

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const instA = '11111111-clinica-a';
const userId = '44444444-4444-4444-4444-444444444444';
const auth = (role = 'admin') => ({
  Authorization: `Bearer ${jwt.sign({ sub: userId, email: 'a@a.com', role, tenant_id: tenantA, is_super_admin: false }, JWT_SECRET)}`,
});

const camp = (extra = {}) => ({
  id: 'camp-1', tenant_id: tenantA, nome: 'Novidades', tipo: 'unico', ativo: false,
  template: { mensagem: 'Olá {{nome}}!' }, dias_semana: [], horario_inicio: null, horario_fim: null,
  data_inicio: null, data_fim: null, campanha_perpetua: false, publico: 'todos',
  capacidade_diaria: 10, intervalo_spam: 7, numero_envio: null, ...extra,
});

describe('Comercial: permissões, público e métricas', () => {
  let querySpy, fetchSpy, sqlLog, campanhas, flows, userRoles;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    sqlLog = []; campanhas = [camp()]; userRoles = [];
    flows = [{ id: 'af1', tenant_id: tenantA, name: 'Inativos', active: true, trigger_event: 'Paciente inativo há 90+ dias',
      steps: [{ message: 'Oi {{nome}}, sentimos sua falta. {{procedimento}}', delayMinutes: 0 }] }];
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const ok = (rows, rowCount = rows.length) => Promise.resolve({ rows, rowCount });
      if (/FROM user_roles WHERE user_id = \$1 AND role::text = ANY/.test(text)) return ok(userRoles);
      if (/SELECT \* FROM broadcast_campaigns WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        return ok(params[1] === tenantA ? campanhas.filter(c => c.id === params[0]) : []);
      }
      if (/SELECT \* FROM automation_flows WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        return ok(params[1] === tenantA ? flows.filter(f => f.id === params[0]) : []);
      }
      if (/SELECT instance_name FROM whatsapp_instances WHERE tenant_id = \$1/.test(text)) return ok([{ instance_name: instA }]);
      if (/SELECT tenant_id FROM whatsapp_instances WHERE instance_name = \$1/.test(text)) return ok(params[0] === instA ? [{ tenant_id: tenantA }] : []);
      if (/SELECT created_at FROM whatsapp_instances/.test(text)) return ok([{ created_at: new Date('2020-01-01') }]);
      if (/FROM crm_leads cl LEFT JOIN contatos c/.test(text)) return ok([{ nome: 'Maria Souza', telefone: '5511988887777' }]);
      if (/INSERT INTO automation_jobs/.test(text)) return ok([{ id: `job-${sqlLog.length}` }]);
      if (/INSERT INTO broadcast_campaigns/.test(text)) return ok([], 1);
      if (/INSERT INTO reactivation_rules/.test(text)) return ok([{ id: 'r1' }]);
      if (/UPDATE automation_jobs SET status = 'cancelled'/.test(text)) return ok([], 3);
      return ok([]);
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
      ok: true, status: 200,
      json: async () => (/fetchInstances/.test(String(url)) ? [{ name: instA, connectionStatus: 'open' }] : {}),
    }));
  });

  afterEach(() => { querySpy.mockRestore(); fetchSpy.mockRestore(); });
  afterAll(async () => { await pool.end(); });

  const q = (re) => sqlLog.filter(s => re.test(s.text));

  describe('permissão por perfil (igual a src/lib/routeAccess.ts)', () => {
    test('dentista não cria nem dispara campanha; nada entra na fila', async () => {
      const c = await request(app).post('/api/campaigns').set(auth('dentista')).send({ nome: 'X', template: { mensagem: 'oi' } });
      expect(c.status).toBe(403);
      const e = await request(app).post('/api/campaigns/camp-1/execute').set(auth('dentista'));
      expect(e.status).toBe(403);
      expect(q(/INSERT INTO (broadcast_campaigns|automation_jobs)/)).toHaveLength(0);
    });

    test('comercial e recepção também não mexem em campanhas nem em fluxos', async () => {
      for (const role of ['comercial', 'recepcionista']) {
        expect((await request(app).delete('/api/campaigns/camp-1').set(auth(role))).status).toBe(403);
        expect((await request(app).patch('/api/automations/flows/af1/toggle').set(auth(role))).status).toBe(403);
        expect((await request(app).post('/api/automations/flows').set(auth(role)).send({ name: 'F' })).status).toBe(403);
      }
    });

    test('admin cria campanha', async () => {
      const r = await request(app).post('/api/campaigns').set(auth('admin')).send({ nome: 'X', template: { mensagem: 'oi' } });
      expect(r.status).toBe(200);
    });

    test('papel admin só em user_roles também vale', async () => {
      userRoles = [{ '?column?': 1 }];
      const r = await request(app).post('/api/campaigns').set(auth('user')).send({ nome: 'X', template: { mensagem: 'oi' } });
      expect(r.status).toBe(200);
    });

    test('reativação: recepção e comercial podem, dentista não', async () => {
      const body = { name: 'Inativos 6m', inactiveDays: 180, messageTemplate: 'Oi {nome}' };
      expect((await request(app).post('/api/reativacao/rules').set(auth('recepcionista')).send(body)).status).toBe(201);
      expect((await request(app).post('/api/reativacao/rules').set(auth('comercial')).send(body)).status).toBe(201);
      expect((await request(app).post('/api/reativacao/rules').set(auth('dentista')).send(body)).status).toBe(403);
      expect((await request(app).post('/api/reativacao/rules/r1/send').set(auth('dentista')).send({})).status).toBe(403);
    });
  });

  describe('público da campanha', () => {
    test('"todos" exige conversa prévia (mensagem recebida do contato nesta clínica)', async () => {
      const r = await request(app).post('/api/campaigns/camp-1/execute').set(auth());
      expect(r.status).toBe(200);
      const aud = q(/FROM crm_leads cl LEFT JOIN contatos c/);
      expect(aud).toHaveLength(1);
      expect(aud[0].text).toMatch(/FROM chat_messages cm\s+WHERE cm\.tenant_id = \$2 AND cm\.sender = 'lead'/);
      expect(aud[0].params[1]).toBe(tenantA);
      expect(q(/INSERT INTO automation_jobs/)).toHaveLength(1);
    });

    test.each(['ativos', 'inativos', 'aniversariantes'])('"%s" também exige conversa prévia', async (publico) => {
      campanhas = [camp({ publico })];
      await request(app).post('/api/campaigns/camp-1/execute').set(auth());
      const aud = q(/FROM (crm_leads cl|contatos c)\b/).filter(s => /LIMIT \$1/.test(s.text));
      expect(aud).toHaveLength(1);
      expect(aud[0].text).toMatch(/cm\.sender = 'lead'/);
    });

    test('"custom" (sem filtro no servidor) é recusado e não vira "todos"', async () => {
      campanhas = [camp({ publico: 'custom' })];
      const r = await request(app).post('/api/campaigns/camp-1/execute').set(auth());
      expect(r.status).toBe(400);
      expect(q(/FROM crm_leads cl/)).toHaveLength(0);
      expect(q(/INSERT INTO automation_jobs/)).toHaveLength(0);
    });

    test('intervalo anti-spam vale para qualquer marketing, não só para a mesma campanha', async () => {
      await request(app).post('/api/campaigns/camp-1/execute').set(auth());
      const dedupe = q(/SELECT DISTINCT patient_phone FROM automation_jobs/);
      expect(dedupe).toHaveLength(1);
      expect(dedupe[0].text).toMatch(/OR category = 'marketing'/);
      expect(dedupe[0].params).toEqual([7, 'camp-1', tenantA]);
    });

    test('público tira quem recebeu marketing no intervalo ANTES do LIMIT (recorrente não trava nos mesmos)', async () => {
      await request(app).post('/api/campaigns/camp-1/execute').set(auth());
      const [aud] = q(/FROM crm_leads cl LEFT JOIN contatos c/);
      expect(aud.text).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM automation_jobs aj[\s\S]*OR aj\.category = 'marketing'[\s\S]*LIMIT \$1/);
      expect(aud.params).toEqual([10, tenantA, 7, 'camp-1']);
    });

    test('"inativos" casa a conversa por lead/telefone normalizado, não por telefone exato', async () => {
      campanhas = [camp({ publico: 'inativos' })];
      await request(app).post('/api/campaigns/camp-1/execute').set(auth());
      const [aud] = q(/FROM crm_leads cl\b/).filter(s => /LIMIT \$1/.test(s.text));
      expect(aud.text).not.toMatch(/LEFT JOIN chat_messages/);
      expect(aud.text).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM chat_messages cm[\s\S]*INTERVAL '90 days'/);
    });
  });

  describe('fila', () => {
    test('cancelar sem flowId/patientPhone é recusado (não zera a fila da clínica)', async () => {
      const r = await request(app).delete('/api/automations/jobs/cancel').set(auth()).send({});
      expect(r.status).toBe(400);
      expect(q(/UPDATE automation_jobs SET status = 'cancelled'/)).toHaveLength(0);
      const ok = await request(app).delete('/api/automations/jobs/cancel').set(auth()).send({ flowId: 'af1' });
      expect(ok.status).toBe(200);
      expect(q(/UPDATE automation_jobs SET status = 'cancelled'/)[0].params).toEqual([tenantA, 'af1']);
    });

    test('fluxo de marketing enfileirado à mão sai como marketing, com SAIR e sem {{procedimento}}', async () => {
      const r = await request(app).post('/api/automations/enqueue').set(auth()).send({ flowId: 'af1', patientName: 'Ana', patientPhone: '11988887777' });
      expect(r.status).toBe(200);
      const ins = q(/INSERT INTO automation_jobs/)[0];
      expect(ins.params[11]).toBe('marketing');
      expect(ins.params[8]).toMatch(/Responda SAIR para não receber mais\.$/);
      expect(ins.params[8]).not.toMatch(/procedimento/i);
      // stats.sent só conta no envio real (gancho pós-envio), não no enfileiramento.
      expect(q(/UPDATE automation_flows SET stats/)).toHaveLength(0);
    });
  });

  describe('painel comercial', () => {
    test('usa etapas que existem no funil e o dia de São Paulo', async () => {
      const r = await request(app).get('/api/comercial/painel').set(auth('comercial'));
      expect(r.status).toBe(200);
      const all = sqlLog.map(s => s.text).join('\n');
      expect(all).not.toMatch(/primeiro_contato|em_negociacao|paciente_agendado|pos_consulta/);
      expect(all).toMatch(/kanban_stage IN \('lead','followup','followup_2','followup_3','sem_resposta'\)/);
      expect(all).toMatch(/paciente_id IS NOT NULL OR status = 'paciente' OR kanban_stage = 'orcamento_aprovado'/);
      const hoje = q(/FROM attendance_sessions/)[0];
      expect(hoje.text).toMatch(/AT TIME ZONE 'America\/Sao_Paulo'/);
      const spDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      expect(hoje.params[1]).toBe(spDay);
    });
  });
});
