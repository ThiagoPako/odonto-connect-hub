// Assinatura vencida (regra do dono, 07/11): 5 dias de carência com aviso, depois bloqueia o acesso.
// pool.query mockado: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { situacaoAssinatura, rotaLiberadaNoBloqueio, sqlTenantBloqueado } from '../assinatura.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const DIA = 86_400_000;
const agora = new Date('2026-11-07T12:00:00Z');
const antes = (dias) => new Date(agora.getTime() - dias * DIA).toISOString();

describe('situacaoAssinatura', () => {
  test('em dia: teste ou período ainda não venceu', () => {
    expect(situacaoAssinatura({ status: 'trial', trial_ends_at: antes(-3) }, agora).situacao).toBe('ok');
    expect(situacaoAssinatura({ status: 'active', current_period_end: antes(-10) }, agora).situacao).toBe('ok');
    expect(situacaoAssinatura({ status: 'active', current_period_end: null }, agora).situacao).toBe('ok');
  });
  test('venceu há menos de 5 dias: carência com dias restantes', () => {
    const s = situacaoAssinatura({ status: 'trial', trial_ends_at: antes(2) }, agora);
    expect(s).toMatchObject({ situacao: 'carencia', dias_para_bloqueio: 3, motivo: 'teste_vencido' });
    expect(s.bloqueio_em).toBe(new Date(new Date(antes(2)).getTime() + 5 * DIA).toISOString());
    expect(situacaoAssinatura({ status: 'past_due', current_period_end: antes(4.5) }, agora))
      .toMatchObject({ situacao: 'carencia', dias_para_bloqueio: 1, motivo: 'pagamento_vencido' });
  });
  test('passou dos 5 dias: bloqueado; suspensa/cancelada: bloqueada na hora', () => {
    expect(situacaoAssinatura({ status: 'active', current_period_end: antes(6) }, agora).situacao).toBe('bloqueado');
    expect(situacaoAssinatura({ status: 'suspended' }, agora)).toMatchObject({ situacao: 'bloqueado', motivo: 'suspensa' });
    expect(situacaoAssinatura({ status: 'canceled', current_period_end: antes(-30) }, agora).situacao).toBe('bloqueado');
  });
  test('rotas liberadas no bloqueio', () => {
    for (const r of ['/api/auth/me', '/api/auth/login', '/api/my-tenant', '/api/plans', '/api/super-admin/tenants', '/api/auth/me?x=1']) {
      expect(rotaLiberadaNoBloqueio(r)).toBe(true);
    }
    for (const r of ['/api/pacientes', '/api/my-tenant/users', '/api/my-tenant/change-plan', '/api/auth/users', '/api/auth/create-user']) {
      expect(rotaLiberadaNoBloqueio(r)).toBe(false);
    }
  });
  test('SQL equivalente cobre os três casos', () => {
    const sql = sqlTenantBloqueado('t');
    expect(sql).toMatch(/t\.status IN \('suspended', 'canceled'\)/);
    expect(sql).toMatch(/t\.trial_ends_at \+ INTERVAL '5 days' < NOW\(\)/);
    expect(sql).toMatch(/t\.current_period_end \+ INTERVAL '5 days' < NOW\(\)/);
  });
});

describe('rotas com clínica vencida', () => {
  // Uma clínica por cenário (o cache de 60 s é por clínica)
  const T = { ok: '11111111-1111-1111-1111-111111111111', carencia: '22222222-2222-2222-2222-222222222222', bloq: '33333333-3333-3333-3333-333333333333' };
  const ADMIN = '44444444-4444-4444-4444-444444444444';
  const tenants = {
    [T.ok]: { status: 'active', trial_ends_at: null, current_period_end: new Date(Date.now() + 10 * DIA).toISOString() },
    [T.carencia]: { status: 'trial', trial_ends_at: new Date(Date.now() - 2 * DIA).toISOString(), current_period_end: null },
    [T.bloq]: { status: 'active', trial_ends_at: null, current_period_end: new Date(Date.now() - 6 * DIA).toISOString() },
  };
  const tok = (tenant, extra = {}) => jwt.sign({ sub: ADMIN, email: 'a@x.com', role: 'admin', tenant_id: tenant, is_super_admin: false, ...extra }, JWT_SECRET);
  let querySpy, sqlLog;
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  beforeEach(() => {
    sqlLog = [];
    querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      const t = String(sql);
      sqlLog.push(t);
      if (/SELECT status, trial_ends_at, current_period_end FROM tenants WHERE id = \$1/.test(t)) {
        return { rows: tenants[params[0]] ? [tenants[params[0]]] : [] };
      }
      if (/SELECT \* FROM profiles WHERE id = \$1 LIMIT 1/.test(t)) return { rows: [{ id: ADMIN, email: 'a@x.com', tenant_id: null }] };
      return { rows: [], rowCount: 0 };
    });
  });
  afterEach(() => querySpy.mockRestore());

  test('bloqueada: rota comum → 402 com código, sem consultar pacientes', async () => {
    const r = await request(app).get('/api/pacientes').set('Authorization', `Bearer ${tok(T.bloq)}`);
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('ASSINATURA_BLOQUEADA');
    expect(r.body.assinatura.situacao).toBe('bloqueado');
    expect(sqlLog.some((s) => /FROM pacientes/.test(s))).toBe(false);
  });

  test('bloqueada: /api/auth/me continua e informa a situação', async () => {
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tok(T.bloq)}`);
    expect(r.status).toBe(200);
    expect(r.body.assinatura).toMatchObject({ situacao: 'bloqueado', motivo: 'pagamento_vencido' });
  });

  test('carência: usa normalmente e /auth/me traz o aviso', async () => {
    const r = await request(app).get('/api/pacientes').set('Authorization', `Bearer ${tok(T.carencia)}`);
    expect(r.status).not.toBe(402);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tok(T.carencia)}`);
    expect(me.body.assinatura).toMatchObject({ situacao: 'carencia', dias_para_bloqueio: 3 });
  });

  test('em dia: sem bloqueio', async () => {
    const r = await request(app).get('/api/pacientes').set('Authorization', `Bearer ${tok(T.ok)}`);
    expect(r.status).not.toBe(402);
  });

  test('super-admin dentro de clínica bloqueada não é bloqueado', async () => {
    const r = await request(app).get('/api/pacientes')
      .set('Authorization', `Bearer ${tok(null, { is_super_admin: true })}`).set('x-tenant-id', T.bloq);
    expect(r.status).not.toBe(402);
  });

  test('SSE recusa clínica bloqueada', async () => {
    const r = await request(app).get(`/api/events?token=${tok(T.bloq)}`);
    expect(r.status).toBe(402);
  });
});

describe('mensagem do 402 por motivo', () => {
  const ADMIN = '44444444-4444-4444-4444-444444444444';
  const SUSP = '55555555-5555-5555-5555-555555555555';
  let spy;
  beforeEach(() => {
    spy = jest.spyOn(pool, 'query').mockImplementation(async (sql) => (
      /SELECT status, trial_ends_at, current_period_end FROM tenants/.test(String(sql))
        ? { rows: [{ status: 'suspended', trial_ends_at: null, current_period_end: null }] } : { rows: [], rowCount: 0 }));
  });
  afterEach(() => spy.mockRestore());
  test('clínica suspensa não recebe o texto de "venceu há mais de 5 dias"', async () => {
    const tk = jwt.sign({ sub: ADMIN, email: 'a@x.com', role: 'admin', tenant_id: SUSP, is_super_admin: false }, JWT_SECRET);
    const r = await request(app).get('/api/pacientes').set('Authorization', `Bearer ${tk}`);
    expect(r.status).toBe(402);
    expect(r.body.error).toMatch(/foi suspenso/);
    expect(r.body.error).not.toMatch(/venceu/);
  });
});
