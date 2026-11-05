// Isolamento entre clínicas nos jobs de automação e estatísticas pelo envio real (lote L8).
//
// Requisitos do ambiente: os mesmos de pacientes-isolamento.test.js — JWT_SECRET definido
// (env ou vps-api-server/.env). pool.query é mockado: nenhuma query chega ao Postgres.
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool, processSolutionTriggers, runWhatsAppJobHooks } = await import('../server.mjs');

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const BIRTHDAY = 'Data de aniversário do paciente';

describe('Jobs e métricas — isolamento por clínica', () => {
  let querySpy;
  let sqlLog;
  let handler;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    sqlLog = [];
    handler = () => null;
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const custom = handler(text, params);
      if (custom) return Promise.resolve(custom);
      // Horário de envio aberto o dia todo, para o teste não depender do relógio.
      if (/FROM app_settings WHERE key = 'solution_hours'/.test(text)) {
        return Promise.resolve({ rows: [{ value: { inicio: '00:00', fim: '23:59', diasSemana: [] } }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });

  describe('processSolutionTriggers', () => {
    test('busca pacientes separadamente para cada clínica com fluxo ativo', async () => {
      handler = (text, params) => {
        if (/SELECT DISTINCT tenant_id FROM automation_flows/.test(text)) {
          return params[0] === BIRTHDAY
            ? { rows: [{ tenant_id: tenantA }, { tenant_id: tenantB }], rowCount: 2 }
            : { rows: [], rowCount: 0 };
        }
        return null;
      };

      await processSolutionTriggers();

      const patientQueries = sqlLog.filter(q => /FROM pacientes\s+WHERE tenant_id = \$1/.test(q.text));
      expect(patientQueries.map(q => q.params[0])).toEqual([tenantA, tenantB]);
    });

    test('todas as queries de gatilho filtram por clínica em $1', async () => {
      const triggersWithTenant = new Set();
      handler = (text, params) => {
        if (/SELECT DISTINCT tenant_id FROM automation_flows/.test(text)) {
          triggersWithTenant.add(params[0]);
          return { rows: [{ tenant_id: tenantA }], rowCount: 1 };
        }
        return null;
      };

      await processSolutionTriggers();

      const triggerQueries = sqlLog.filter(q => /LIMIT 100/.test(q.text));
      expect(triggerQueries.length).toBe(triggersWithTenant.size);
      for (const q of triggerQueries) {
        expect(q.params[0]).toBe(tenantA);
        expect(q.text).toMatch(/\b(a|p)?\.?tenant_id = \$1/);
      }
      // Agendamento e paciente precisam ser da mesma clínica.
      for (const q of triggerQueries.filter(t => /FROM agendamentos a\s+JOIN pacientes p/.test(t.text))) {
        expect(q.text).toMatch(/JOIN pacientes p ON a\.paciente_id = p\.id AND p\.tenant_id = a\.tenant_id/);
      }
    });

    test('paciente de outra clínica devolvido pela query não dispara o fluxo', async () => {
      handler = (text, params) => {
        if (/SELECT DISTINCT tenant_id FROM automation_flows/.test(text)) {
          return params[0] === BIRTHDAY ? { rows: [{ tenant_id: tenantA }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/FROM pacientes\s+WHERE tenant_id = \$1/.test(text)) {
          return { rows: [{ id: 'p1', tenant_id: tenantB, nome: 'Ana', telefone: '5511999990000' }], rowCount: 1 };
        }
        return null;
      };

      await processSolutionTriggers();

      const flowLookups = sqlLog.filter(q => /FROM automation_flows WHERE active = true AND trigger_event = \$1 AND tenant_id = \$2/.test(q.text));
      expect(flowLookups).toHaveLength(0);
    });
  });

  describe('runWhatsAppJobHooks — estatísticas pelo envio real', () => {
    const campaignJob = { id: 'j1', trigger_event: 'campaign', flow_id: 'camp-1', tenant_id: tenantA, patient_phone: '5511999990000', message: 'Oi' };

    test('campanha enviada soma em "enviadas" só na clínica dona', async () => {
      await runWhatsAppJobHooks(campaignJob, true);
      const upd = sqlLog.find(q => /UPDATE broadcast_campaigns SET/.test(q.text));
      expect(upd).toBeDefined();
      expect(upd.text).toMatch(/WHERE id::text = \$1 AND tenant_id = \$2/);
      expect(upd.params).toEqual(['camp-1', tenantA, 'enviadas']);
    });

    test('campanha que falhou soma em "erros", não em "enviadas"', async () => {
      await runWhatsAppJobHooks(campaignJob, false, 'Falha');
      const upd = sqlLog.find(q => /UPDATE broadcast_campaigns SET/.test(q.text));
      expect(upd.params).toEqual(['camp-1', tenantA, 'erros']);
    });

    test('fluxo de automação soma "sent" quando sai, filtrando por clínica', async () => {
      await runWhatsAppJobHooks({ id: 'j2', trigger_event: BIRTHDAY, flow_id: 'af1', tenant_id: tenantB }, true);
      const upd = sqlLog.find(q => /UPDATE automation_flows SET stats/.test(q.text));
      expect(upd.text).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
      expect(upd.params).toEqual(['af1', tenantB]);
    });

    test('fluxo de automação que falhou não soma "sent"', async () => {
      await runWhatsAppJobHooks({ id: 'j3', trigger_event: BIRTHDAY, flow_id: 'af1', tenant_id: tenantB }, false, 'Falha');
      expect(sqlLog.find(q => /UPDATE automation_flows SET stats/.test(q.text))).toBeUndefined();
    });
  });
});
