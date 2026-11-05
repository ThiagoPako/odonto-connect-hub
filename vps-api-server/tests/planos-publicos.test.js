// GET /api/plans — público, fonte única de nome, preço, teste grátis, limites e recursos.
// pool.query é mockado: nenhuma query chega ao Postgres.
import request from 'supertest';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');

describe('GET /api/plans (público)', () => {
  let querySpy;
  let sql;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    sql = [];
    querySpy = jest.spyOn(pool, 'query').mockImplementation((text) => {
      sql.push(String(text));
      if (/FROM plans WHERE ativo = true/.test(String(text))) {
        return Promise.resolve({ rows: [
          { slug: 'starter', nome: 'Starter', descricao: 'Pequenas', preco_mensal: '197.00', preco_anual: '1970.00', trial_days: 14,
            max_usuarios: 3, max_dentistas: 2, max_pacientes: 500, max_whatsapp_instances: 1, features: { clinicorp: false }, display_order: 1 },
          { slug: 'enterprise', nome: 'Enterprise', descricao: null, preco_mensal: '897.00', preco_anual: null, trial_days: 14,
            max_usuarios: null, max_dentistas: null, max_pacientes: null, max_whatsapp_instances: null, features: null, display_order: 3 },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });

  test('responde sem login, só com planos ativos e preço como número', async () => {
    const res = await request(app).get('/api/plans');
    expect(res.status).toBe(200);
    expect(sql.some((t) => /WHERE ativo = true/.test(t))).toBe(true);
    expect(res.body.data).toHaveLength(2);
    const [starter, ent] = res.body.data;
    expect(starter).toMatchObject({ slug: 'starter', nome: 'Starter', preco_mensal: 197, preco_anual: 1970, trial_days: 14, max_usuarios: 3 });
    expect(ent).toMatchObject({ preco_mensal: 897, preco_anual: null, max_usuarios: null, features: {} });
    expect(res.headers['cache-control']).toMatch(/max-age=300/);
  });

  test('não expõe dado interno (id, ativo, datas)', async () => {
    const res = await request(app).get('/api/plans');
    for (const p of res.body.data) {
      expect(Object.keys(p).sort()).toEqual([
        'descricao', 'display_order', 'features', 'max_dentistas', 'max_pacientes', 'max_usuarios',
        'max_whatsapp_instances', 'nome', 'preco_anual', 'preco_mensal', 'slug', 'trial_days',
      ]);
    }
    expect(sql.find((t) => /FROM plans/.test(t))).not.toMatch(/\bid\b,/);
  });
});
