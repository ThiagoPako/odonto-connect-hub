// Configurações de atendimento por clínica (lote L4): boas-vindas/fora de horário,
// follow-up, horário dos gatilhos, filas e chave da avaliação.
//
// Requisitos do ambiente: os mesmos de pacientes-isolamento.test.js — JWT_SECRET definido
// (env ou vps-api-server/.env); token HS256 aceito por LEGACY_JWT_ENABLED. pool.query é
// mockado: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool, processSolutionTriggers, clearTenantSettingsCacheForTests, ensureTenantConfigSchema } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const filaDaB = '66666666-6666-6666-6666-666666666666';

const token = (extra = {}) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444',
  email: 'admin@clinica.com',
  role: 'admin',
  tenant_id: tenantA,
  is_super_admin: false,
  ...extra,
}, JWT_SECRET);
const auth = (extra) => ({ Authorization: `Bearer ${token(extra)}` });

describe('Configurações por clínica (L4)', () => {
  let querySpy;
  let sqlLog;
  let settings; // `${tenant}:${key}` -> value
  let missingTable;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    clearTenantSettingsCacheForTests();
    sqlLog = [];
    settings = new Map();
    missingTable = false;
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      if (/tenant_settings/.test(text) && missingTable) {
        return Promise.reject(Object.assign(new Error('relation "tenant_settings" does not exist'), { code: '42P01' }));
      }
      if (/SELECT value FROM tenant_settings WHERE tenant_id = \$1 AND key = \$2/.test(text)) {
        const v = settings.get(`${params[0]}:${params[1]}`);
        return Promise.resolve({ rows: v === undefined ? [] : [{ value: v }], rowCount: v === undefined ? 0 : 1 });
      }
      if (/INSERT INTO tenant_settings/.test(text)) {
        settings.set(`${params[0]}:${params[1]}`, JSON.parse(params[2]));
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (/^\s*(UPDATE|DELETE FROM) attendance_queues/.test(text)) {
        const ok = params.includes(filaDaB) && params.includes(tenantB);
        return Promise.resolve({ rows: [], rowCount: ok ? 1 : 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });

  const noGlobalSettingsWrite = () =>
    expect(sqlLog.filter(q => /INSERT INTO (app_settings|system_settings)/.test(q.text)
      && !/awaiting_rating_/.test(JSON.stringify(q.params)))).toHaveLength(0);

  describe('boas-vindas e fora de horário (/api/attendance-settings)', () => {
    test('o admin da clínica A grava só na configuração de A', async () => {
      const res = await request(app).put('/api/attendance-settings').set(auth())
        .send({ welcomeMessage: 'Olá da A', autoGreetingEnabled: true });
      expect(res.status).toBe(200);
      expect(settings.get(`${tenantA}:attendance_settings`)).toMatchObject({ welcomeMessage: 'Olá da A' });
      expect(settings.has(`${tenantB}:attendance_settings`)).toBe(false);
      noGlobalSettingsWrite();
    });

    test('a clínica B não vê a configuração de A', async () => {
      settings.set(`${tenantA}:attendance_settings`, { welcomeMessage: 'Olá da A' });
      const res = await request(app).get('/api/attendance-settings').set(auth({ tenant_id: tenantB }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    test('sem a tabela (migração M0 não aplicada): leitura volta ao padrão, gravação responde 503', async () => {
      missingTable = true;
      const get = await request(app).get('/api/attendance-settings').set(auth());
      expect(get.status).toBe(200);
      expect(get.body).toEqual({});
      const put = await request(app).put('/api/attendance-settings').set(auth()).send({ welcomeMessage: 'x' });
      expect(put.status).toBe(503);
    });
  });

  describe('follow-up (/api/automations/followup)', () => {
    test('a mudança de A não aparece para B', async () => {
      const put = await request(app).put('/api/automations/followup').set(auth()).send({ enabled: false });
      expect(put.status).toBe(200);
      expect(settings.get(`${tenantA}:followup_automation`).enabled).toBe(false);

      const getB = await request(app).get('/api/automations/followup').set(auth({ tenant_id: tenantB }));
      expect(getB.status).toBe(200);
      expect(getB.body.enabled).toBe(true); // padrão do sistema
      expect(getB.body.messages).toHaveProperty('followup');
      noGlobalSettingsWrite();
    });

    test.each([-1, 86401, '30', Infinity, null])('delaySeconds fora de 0–86400 (%p) → 400 sem gravar', async (delaySeconds) => {
      const res = await request(app).put('/api/automations/followup').set(auth()).send({ delaySeconds });
      expect(res.status).toBe(400);
      expect(settings.has(`${tenantA}:followup_automation`)).toBe(false);
    });

    test.each([0, 86400, 45])('delaySeconds válido (%p) é gravado', async (delaySeconds) => {
      const res = await request(app).put('/api/automations/followup').set(auth()).send({ delaySeconds });
      expect(res.status).toBe(200);
      expect(settings.get(`${tenantA}:followup_automation`).delaySeconds).toBe(delaySeconds);
    });
  });

  describe('cache de getTenantSetting', () => {
    test('falha de leitura (não 42P01) não fica no cache', async () => {
      settings.set(`${tenantA}:followup_automation`, { enabled: false });
      let falhar = true;
      querySpy.mockImplementation((sql, params = []) => {
        const text = String(sql);
        if (/SELECT value FROM tenant_settings/.test(text)) {
          if (falhar) return Promise.reject(Object.assign(new Error('timeout'), { code: '57014' }));
          const v = settings.get(`${params[0]}:${params[1]}`);
          return Promise.resolve({ rows: v === undefined ? [] : [{ value: v }], rowCount: v === undefined ? 0 : 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      const durante = await request(app).get('/api/automations/followup').set(auth());
      expect(durante.body.enabled).toBe(true); // padrão só nesta leitura
      falhar = false;
      const depois = await request(app).get('/api/automations/followup').set(auth());
      expect(depois.body.enabled).toBe(false); // relê do banco, não do cache
    });

    test('tabela ausente (42P01) fica no cache como padrão', async () => {
      missingTable = true;
      await request(app).get('/api/automations/followup').set(auth());
      const leituras = () => sqlLog.filter(q => /SELECT value FROM tenant_settings/.test(q.text)).length;
      const antes = leituras();
      await request(app).get('/api/automations/followup').set(auth());
      expect(leituras()).toBe(antes);
    });
  });

  describe('boot: tenant_settings e cópia da configuração global', () => {
    const queries = () => sqlLog.map(q => q.text);

    test('cria tenant_settings com a definição da M0', async () => {
      await ensureTenantConfigSchema();
      const create = queries().find(t => /CREATE TABLE IF NOT EXISTS tenant_settings/.test(t));
      expect(create).toBeDefined();
      expect(create).toMatch(/PRIMARY KEY \(tenant_id, key\)/);
      expect(create).toMatch(/REFERENCES tenants\(id\) ON DELETE CASCADE/);
    });

    test('copia app_settings e system_settings para todas as clínicas, uma vez, sem sobrescrever', async () => {
      await ensureTenantConfigSchema();
      const copias = sqlLog.filter(q => /INSERT INTO tenant_settings/.test(q.text) && /FROM tenants t/.test(q.text));
      expect(copias).toHaveLength(2);
      const porTabela = Object.fromEntries(copias.map(q => [q.text.match(/JOIN (\w+) s/)[1], q]));
      expect(porTabela.app_settings.params[1]).toEqual(['attendance_settings', 'solution_hours']);
      expect(porTabela.system_settings.params[1]).toEqual(['followup_automation']);
      for (const q of copias) {
        expect(q.text).toMatch(/ON CONFLICT \(tenant_id, key\) DO NOTHING/); // não sobrescreve
        expect(q.text).toMatch(/INSERT INTO app_settings[\s\S]*ON CONFLICT \(key\) DO NOTHING[\s\S]*RETURNING/); // marcador
        expect(q.text).toMatch(/WHERE EXISTS \(SELECT 1 FROM marcador\)/); // só na primeira vez
        expect(q.text).not.toMatch(/tenant_id\s*=/); // todas as clínicas, não só uma
        expect(q.params[2]).toEqual(expect.arrayContaining(['00000000-0000-0000-0000-000000000001']));
      }
    });

    test('sem permissão de DDL ou sem tabela de origem: o boot segue', async () => {
      querySpy.mockImplementation((sql) => {
        const text = String(sql);
        sqlLog.push({ text, params: [] });
        if (/CREATE TABLE IF NOT EXISTS tenant_settings/.test(text)) {
          return Promise.reject(Object.assign(new Error('permission denied for schema public'), { code: '42501' }));
        }
        if (/INSERT INTO tenant_settings/.test(text)) {
          return Promise.reject(Object.assign(new Error('relation "system_settings" does not exist'), { code: '42P01' }));
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      await expect(ensureTenantConfigSchema()).resolves.toBeUndefined();
      expect(sqlLog.filter(q => /INSERT INTO tenant_settings/.test(q.text))).toHaveLength(2);
    });
  });

  describe('horário dos gatilhos (/api/automations/solution-hours)', () => {
    test('só admin altera', async () => {
      const res = await request(app).put('/api/automations/solution-hours')
        .set(auth({ role: 'recepcao' })).send({ inicio: '07:00', fim: '19:00' });
      expect(res.status).toBe(403);
      expect(settings.size).toBe(0);
    });

    test('horário inválido é recusado', async () => {
      const res = await request(app).put('/api/automations/solution-hours').set(auth()).send({ inicio: '7h', fim: '19:00' });
      expect(res.status).toBe(400);
    });

    test('grava por clínica', async () => {
      const res = await request(app).put('/api/automations/solution-hours').set(auth())
        .send({ inicio: '07:00', fim: '19:00', diasSemana: ['SEG', 'XXX'] });
      expect(res.status).toBe(200);
      expect(settings.get(`${tenantA}:solution_hours`)).toEqual({ inicio: '07:00', fim: '19:00', diasSemana: ['SEG'] });
      const getB = await request(app).get('/api/automations/solution-hours').set(auth({ tenant_id: tenantB }));
      expect(getB.body.inicio).toBe('08:00');
    });

    test('cada clínica usa o próprio horário nos gatilhos', async () => {
      settings.set(`${tenantA}:solution_hours`, { inicio: '00:00', fim: '23:59', diasSemana: [] });
      settings.set(`${tenantB}:solution_hours`, { inicio: '23:59', fim: '00:00', diasSemana: [] }); // nunca abre
      querySpy.mockImplementation((sql, params = []) => {
        const text = String(sql);
        sqlLog.push({ text, params });
        if (/SELECT value FROM tenant_settings/.test(text)) {
          const v = settings.get(`${params[0]}:${params[1]}`);
          return Promise.resolve({ rows: v ? [{ value: v }] : [], rowCount: v ? 1 : 0 });
        }
        if (/SELECT DISTINCT tenant_id FROM automation_flows/.test(text)) {
          return Promise.resolve({ rows: [{ tenant_id: tenantA }, { tenant_id: tenantB }], rowCount: 2 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await processSolutionTriggers();

      const triggerQueries = sqlLog.filter(q => /LIMIT 100/.test(q.text));
      expect(triggerQueries.length).toBeGreaterThan(0);
      expect(new Set(triggerQueries.map(q => q.params[0]))).toEqual(new Set([tenantA]));
    });
  });

  describe('filas (/api/queues)', () => {
    test('lista só as filas da clínica, sem as filas sem clínica', async () => {
      await request(app).get('/api/queues').set(auth());
      const q = sqlLog.find(x => /FROM attendance_queues/.test(x.text));
      expect(q.text).toMatch(/WHERE tenant_id = \$1/);
      expect(q.text).not.toMatch(/IS NULL/);
      expect(q.params).toEqual([tenantA]);
    });

    test('usuário sem clínica recebe lista vazia', async () => {
      const res = await request(app).get('/api/queues').set(auth({ tenant_id: null }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(sqlLog.find(x => /FROM attendance_queues/.test(x.text))).toBeUndefined();
    });

    test('A não edita nem apaga a fila de B (404)', async () => {
      const put = await request(app).put(`/api/queues/${filaDaB}`).set(auth()).send({ name: 'x' });
      expect(put.status).toBe(404);
      const del = await request(app).delete(`/api/queues/${filaDaB}`).set(auth());
      expect(del.status).toBe(404);
      const delB = await request(app).delete(`/api/queues/${filaDaB}`).set(auth({ tenant_id: tenantB }));
      expect(delB.status).toBe(200);
    });
  });
});
