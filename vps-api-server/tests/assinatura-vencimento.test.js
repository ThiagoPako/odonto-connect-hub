// Assinatura vencida (regra do dono, 07/11): 5 dias de carência com aviso, depois bloqueia o acesso.
// pool.query mockado: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { situacaoAssinatura, rotaLiberadaNoBloqueio, sqlTenantBloqueado, celulaCsv, linhasParaCsv, EXPORTACAO_TABELAS } from '../assinatura.mjs';

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

describe('exportação dos dados (liberada em todas as etapas, só admin)', () => {
  const ADMIN = '44444444-4444-4444-4444-444444444444';
  const T = { ok: '66666666-6666-6666-6666-666666666666', carencia: '77777777-7777-7777-7777-777777777777', bloq: '88888888-8888-8888-8888-888888888888' };
  const tenants = {
    [T.ok]: { status: 'active', trial_ends_at: null, current_period_end: new Date(Date.now() + 10 * DIA).toISOString() },
    [T.carencia]: { status: 'active', trial_ends_at: null, current_period_end: new Date(Date.now() - 2 * DIA).toISOString() },
    [T.bloq]: { status: 'canceled', trial_ends_at: null, current_period_end: null },
  };
  const tok = (tenant, role = 'admin') => jwt.sign({ sub: ADMIN, email: 'a@x.com', role, tenant_id: tenant, is_super_admin: false }, JWT_SECRET);
  let spy, sqlLog;
  beforeEach(() => {
    sqlLog = [];
    spy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      const t = String(sql);
      sqlLog.push({ t, params });
      if (/SELECT status, trial_ends_at, current_period_end FROM tenants/.test(t)) return { rows: tenants[params[0]] ? [tenants[params[0]]] : [] };
      if (/FROM information_schema\.columns/.test(t)) return { rows: params[0].filter((n) => n !== 'consultations').map((table_name) => ({ table_name })) };
      if (/SELECT COUNT\(\*\)::int AS c FROM pacientes WHERE tenant_id = \$1/.test(t)) return { rows: [{ c: 2 }] };
      if (/SELECT COUNT\(\*\)::int AS c FROM \w+ WHERE tenant_id = \$1/.test(t)) return { rows: [{ c: 0 }] };
      if (/SELECT \* FROM pacientes WHERE tenant_id = \$1/.test(t)) {
        return { rows: [{ id: 'p1', nome: 'Ana', telefone: '=1+1', tenant_id: params[0] }], fields: [{ name: 'id' }, { name: 'nome' }, { name: 'telefone' }, { name: 'tenant_id' }] };
      }
      if (/FROM user_roles WHERE user_id = \$1 AND role = \$2/.test(t)) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
  });
  afterEach(() => spy.mockRestore());

  test.each(['ok', 'carencia', 'bloq'])('etapa "%s": lista e baixa o CSV de pacientes da própria clínica', async (etapa) => {
    const lista = await request(app).get('/api/exportacao').set('Authorization', `Bearer ${tok(T[etapa])}`);
    expect(lista.status).toBe(200);
    const pac = lista.body.grupos.find((g) => g.grupo === 'Pacientes').tabelas.find((x) => x.tabela === 'pacientes');
    expect(pac.registros).toBe(2);
    expect(lista.body.grupos.flatMap((g) => g.tabelas).some((x) => x.tabela === 'consultations')).toBe(false);
    const csv = await request(app).get('/api/exportacao/pacientes.csv').set('Authorization', `Bearer ${tok(T[etapa])}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('"nome"');
    expect(csv.text).toContain(`"'=1+1"`);
    const sel = sqlLog.find((q) => /SELECT \* FROM pacientes/.test(q.t));
    expect(sel.params).toEqual([T[etapa]]);
  });

  test('bloqueada: o resto da API continua 402', async () => {
    const r = await request(app).get('/api/pacientes').set('Authorization', `Bearer ${tok(T.bloq)}`);
    expect(r.status).toBe(402);
  });

  test('não-admin não exporta (403)', async () => {
    const r = await request(app).get('/api/exportacao/pacientes.csv').set('Authorization', `Bearer ${tok(T.ok, 'recepcionista')}`);
    expect(r.status).toBe(403);
    expect(sqlLog.some((q) => /SELECT \* FROM pacientes/.test(q.t))).toBe(false);
  });

  test('tabela fora da lista → 404 sem consultar (nome nunca vai do usuário para o SQL)', async () => {
    for (const nome of ['profiles', 'pacientes;DROP', 'consultations']) {
      const r = await request(app).get(`/api/exportacao/${encodeURIComponent(nome)}.csv`).set('Authorization', `Bearer ${tok(T.ok)}`);
      expect(r.status).toBe(404);
    }
    expect(sqlLog.some((q) => /SELECT \* FROM/.test(q.t))).toBe(false);
  });

  test('CSV: BOM, aspas, quebra de linha, JSON e fórmula', () => {
    expect(celulaCsv('a"b\nc')).toBe('"a""b c"');
    expect(celulaCsv({ x: 1 })).toBe('"{""x"":1}"');
    expect(celulaCsv('@SOMA')).toBe(`"'@SOMA"`);
    expect(celulaCsv(null)).toBe('');
    expect(linhasParaCsv(['a'], [{ a: 1 }]).startsWith('\uFEFF"a"\n"1"')).toBe(true);
    expect(EXPORTACAO_TABELAS.has('profiles')).toBe(false);
  });
});
