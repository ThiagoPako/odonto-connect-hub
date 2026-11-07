// Escada da assinatura vencida (docs/produto/decisoes-saas.md §3): carência D+1..7 → somente
// leitura D+8 → bloqueio D+30 → cancelamento D+60; nada é apagado. Teste por etapa.
// pool.query mockado: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  situacaoAssinatura, permitidoNaEtapa, sqlTenantSemMarketing, celulaCsv, linhasParaCsv, EXPORTACAO_TABELAS,
} from '../assinatura.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const DIA = 86_400_000;
const agora = new Date('2026-11-07T12:00:00Z');
const venceuHa = (dias) => new Date(agora.getTime() - dias * DIA).toISOString();
const paga = (dias) => situacaoAssinatura({ status: 'active', current_period_end: venceuHa(dias) }, agora);
const teste = (dias) => situacaoAssinatura({ status: 'trial', trial_ends_at: venceuHa(dias) }, agora);

describe('etapas da escada (assinatura paga)', () => {
  test('em dia', () => {
    expect(paga(-3).situacao).toBe('ok');
    expect(situacaoAssinatura({ status: 'active', current_period_end: null }, agora).situacao).toBe('ok');
  });
  test('D+1 a D+7: carência, próxima etapa = somente leitura', () => {
    expect(paga(0.5)).toMatchObject({ situacao: 'carencia', proxima_etapa: 'somente_leitura', dias_para_proxima: 7 });
    expect(paga(6.9).situacao).toBe('carencia');
  });
  test('D+8 a D+29: somente leitura', () => {
    expect(paga(7.1)).toMatchObject({ situacao: 'somente_leitura', proxima_etapa: 'bloqueado' });
    expect(paga(28.9).situacao).toBe('somente_leitura');
  });
  test('D+30 a D+59: bloqueado', () => {
    expect(paga(29.1)).toMatchObject({ situacao: 'bloqueado', proxima_etapa: 'cancelado' });
    expect(paga(58.9).situacao).toBe('bloqueado');
  });
  test('D+60: cancelado, com data de exclusão 91 dias depois (nada apagado antes)', () => {
    const s = paga(59.1);
    expect(s).toMatchObject({ situacao: 'cancelado', proxima_etapa: null });
    expect(new Date(s.exclusao_em).getTime() - new Date(s.cancelamento_em).getTime()).toBe(91 * DIA);
  });
  test('datas de cada degrau a partir do vencimento', () => {
    const s = paga(1);
    const v = new Date(s.vence_em).getTime();
    expect(new Date(s.somente_leitura_em).getTime() - v).toBe(7 * DIA);
    expect(new Date(s.bloqueio_em).getTime() - v).toBe(29 * DIA);
    expect(new Date(s.cancelamento_em).getTime() - v).toBe(59 * DIA);
  });
  test('suspensa → bloqueado na hora; cancelada → cancelado na hora', () => {
    expect(situacaoAssinatura({ status: 'suspended' }, agora)).toMatchObject({ situacao: 'bloqueado', motivo: 'suspensa' });
    expect(situacaoAssinatura({ status: 'canceled', current_period_end: venceuHa(-30) }, agora)).toMatchObject({ situacao: 'cancelado', motivo: 'cancelada' });
  });
});

describe('etapas da escada (teste encerrado sem contratar)', () => {
  test('vence → somente leitura direto (sem carência) por 30 dias', () => {
    expect(teste(-1).situacao).toBe('ok');
    expect(teste(0.1)).toMatchObject({ situacao: 'somente_leitura', motivo: 'teste_vencido' });
    expect(teste(29.9).situacao).toBe('somente_leitura');
  });
  test('depois segue a escada: bloqueio no dia 30, cancelamento no dia 60', () => {
    expect(teste(30.1).situacao).toBe('bloqueado');
    expect(teste(60.1).situacao).toBe('cancelado');
  });
});

describe('o que cada etapa permite', () => {
  const pode = (etapa, m, p) => permitidoNaEtapa(etapa, m, p);
  test('carência: tudo', () => {
    expect(pode('carencia', 'POST', '/api/pacientes')).toBe(true);
    expect(pode('carencia', 'POST', '/api/campaigns/x/execute')).toBe(true);
  });
  test('somente leitura: lê tudo, responde paciente, remarca/cancela; não cria nem edita', () => {
    expect(pode('somente_leitura', 'GET', '/api/financeiro')).toBe(true);
    expect(pode('somente_leitura', 'GET', '/api/exportacao/pacientes.csv')).toBe(true);
    expect(pode('somente_leitura', 'POST', '/api/whatsapp/send-text')).toBe(true);
    expect(pode('somente_leitura', 'POST', '/api/messages')).toBe(true);
    expect(pode('somente_leitura', 'PUT', '/api/agenda/123')).toBe(true);
    expect(pode('somente_leitura', 'POST', '/api/agenda/123/liberar-horario')).toBe(true);
    expect(pode('somente_leitura', 'POST', '/api/agenda')).toBe(false);
    expect(pode('somente_leitura', 'POST', '/api/agenda/serie')).toBe(false);
    expect(pode('somente_leitura', 'DELETE', '/api/agenda/123')).toBe(false);
    expect(pode('somente_leitura', 'PUT', '/api/pacientes/1')).toBe(false);
    expect(pode('somente_leitura', 'POST', '/api/prontuarios')).toBe(false);
    expect(pode('somente_leitura', 'POST', '/api/fin/bills')).toBe(false);
    expect(pode('somente_leitura', 'POST', '/api/campaigns/x/execute')).toBe(false);
    expect(pode('somente_leitura', 'POST', '/api/reativacao/rules/x/send')).toBe(false);
    expect(pode('somente_leitura', 'POST', '/api/ai/clinical-report')).toBe(false);
  });
  test('bloqueado/cancelado: login, assinatura, exportação e prontuário em leitura', () => {
    for (const etapa of ['bloqueado', 'cancelado']) {
      expect(pode(etapa, 'GET', '/api/auth/me')).toBe(true);
      expect(pode(etapa, 'GET', '/api/my-tenant')).toBe(true);
      expect(pode(etapa, 'GET', '/api/exportacao')).toBe(true);
      expect(pode(etapa, 'GET', '/api/pacientes/abc')).toBe(true);
      expect(pode(etapa, 'GET', '/api/prontuarios')).toBe(true);
      expect(pode(etapa, 'GET', '/api/generic/anamneses')).toBe(true);
      expect(pode(etapa, 'POST', '/api/consentimentos/c1/revogar')).toBe(true);
      expect(pode(etapa, 'PUT', '/api/pacientes/abc')).toBe(false);
      expect(pode(etapa, 'GET', '/api/financeiro')).toBe(false);
      expect(pode(etapa, 'GET', '/api/generic/fin_movements')).toBe(false);
      expect(pode(etapa, 'POST', '/api/whatsapp/send-text')).toBe(false);
      expect(pode(etapa, 'PUT', '/api/agenda/123')).toBe(false);
      expect(pode(etapa, 'GET', '/api/exportacao/qualquer/coisa')).toBe(false);
      expect(pode(etapa, 'POST', '/api/my-tenant/change-plan')).toBe(false);
    }
  });
  test('SQL do marketing parado cobre somente leitura em diante', () => {
    const sql = sqlTenantSemMarketing('t');
    expect(sql).toMatch(/t\.status IN \('suspended', 'canceled'\)/);
    expect(sql).toMatch(/t\.trial_ends_at \+ INTERVAL '0 days' < NOW\(\)/);
    expect(sql).toMatch(/t\.current_period_end \+ INTERVAL '7 days' < NOW\(\)/);
  });
});

describe('rotas por etapa (API)', () => {
  const ADMIN = '44444444-4444-4444-4444-444444444444';
  const T = {
    ok: '11111111-1111-1111-1111-111111111111',
    carencia: '22222222-2222-2222-2222-222222222222',
    leitura: '33333333-3333-3333-3333-333333333333',
    bloq: '55555555-5555-5555-5555-555555555555',
    cancel: '99999999-9999-9999-9999-999999999999',
  };
  const em = (dias) => ({ status: 'active', trial_ends_at: null, current_period_end: new Date(Date.now() - dias * DIA).toISOString() });
  const tenants = { [T.ok]: em(-10), [T.carencia]: em(2), [T.leitura]: em(10), [T.bloq]: em(35), [T.cancel]: em(70) };
  const tok = (tenant, extra = {}) => jwt.sign({ sub: ADMIN, email: 'a@x.com', role: 'admin', tenant_id: tenant, is_super_admin: false, ...extra }, JWT_SECRET);
  let spy, sqlLog;
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  beforeEach(() => {
    sqlLog = [];
    spy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      const t = String(sql);
      sqlLog.push(t);
      if (/SELECT status, trial_ends_at, current_period_end FROM tenants WHERE id = \$1/.test(t)) return { rows: tenants[params[0]] ? [tenants[params[0]]] : [] };
      if (/SELECT \* FROM profiles WHERE id = \$1 LIMIT 1/.test(t)) return { rows: [{ id: ADMIN, email: 'a@x.com', tenant_id: null }] };
      return { rows: [], rowCount: 0 };
    });
  });
  afterEach(() => spy.mockRestore());
  const get = (u, tenant, extra) => request(app).get(u).set('Authorization', `Bearer ${tok(tenant, extra)}`);
  const post = (u, tenant, body = {}) => request(app).post(u).set('Authorization', `Bearer ${tok(tenant)}`).send(body);

  test('em dia e carência: criar paciente não é barrado', async () => {
    for (const k of ['ok', 'carencia']) expect((await post('/api/pacientes', T[k], { nome: 'Ana' })).status).not.toBe(402);
  });
  test('somente leitura: GET passa; criar paciente → 402 modo consulta, sem INSERT', async () => {
    expect((await get('/api/pacientes', T.leitura)).status).not.toBe(402);
    const r = await post('/api/pacientes', T.leitura, { nome: 'Ana' });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('ASSINATURA_SOMENTE_LEITURA');
    expect(r.body.error).not.toMatch(/venc|pagamento|atras/i); // texto neutro para a equipe (CDC 42)
    expect(sqlLog.some((s) => /INSERT INTO pacientes/.test(s))).toBe(false);
  });
  test('somente leitura: responder paciente não é barrado', async () => {
    expect((await post('/api/whatsapp/send-text', T.leitura, { number: '5511999999999', text: 'oi' })).status).not.toBe(402);
  });
  test('bloqueado: prontuário em leitura passa; financeiro → 402 bloqueada', async () => {
    expect((await get('/api/pacientes', T.bloq)).status).not.toBe(402);
    const r = await get('/api/financeiro', T.bloq);
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('ASSINATURA_BLOQUEADA');
  });
  test('cancelado: igual ao bloqueio e /auth/me traz a data de exclusão', async () => {
    expect((await get('/api/financeiro', T.cancel)).status).toBe(402);
    const me = await get('/api/auth/me', T.cancel);
    expect(me.status).toBe(200);
    expect(me.body.assinatura).toMatchObject({ situacao: 'cancelado' });
    expect(me.body.assinatura.exclusao_em).toBeTruthy();
  });
  test('super-admin dentro de clínica bloqueada não é barrado', async () => {
    const r = await request(app).get('/api/financeiro')
      .set('Authorization', `Bearer ${tok(null, { is_super_admin: true })}`).set('x-tenant-id', T.bloq);
    expect(r.status).not.toBe(402);
  });
  test('SSE: clínica bloqueada é recusada', async () => {
    const r = await request(app).get(`/api/events?token=${tok(T.bloq)}`);
    expect(r.status).toBe(402);
  });
});

describe('exportação (liberada em todas as etapas; só admin da própria clínica)', () => {
  const ADMIN = '44444444-4444-4444-4444-444444444444';
  const T = { ok: '66666666-6666-6666-6666-666666666666', leitura: '77777777-7777-7777-7777-777777777777', cancel: '88888888-8888-8888-8888-888888888888' };
  const tenants = {
    [T.ok]: { status: 'active', trial_ends_at: null, current_period_end: new Date(Date.now() + 10 * DIA).toISOString() },
    [T.leitura]: { status: 'active', trial_ends_at: null, current_period_end: new Date(Date.now() - 10 * DIA).toISOString() },
    [T.cancel]: { status: 'canceled', trial_ends_at: null, current_period_end: null },
  };
  const OUTRA = 'abababab-abab-abab-abab-abababababab';
  const tok = (tenant, role = 'admin', extra = {}) => jwt.sign({ sub: ADMIN, email: 'a@x.com', role, tenant_id: tenant, is_super_admin: false, ...extra }, JWT_SECRET);
  let spy, sqlLog;
  beforeEach(() => {
    sqlLog = [];
    spy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      const t = String(sql);
      sqlLog.push({ t, params });
      if (/SELECT status, trial_ends_at, current_period_end FROM tenants/.test(t)) return { rows: tenants[params[0]] ? [tenants[params[0]]] : [] };
      if (/SELECT 1 FROM profiles WHERE id = \$1 AND tenant_id = \$2/.test(t)) return { rows: params[1] === OUTRA ? [] : [{}] };
      if (/FROM information_schema\.columns/.test(t)) return { rows: params[0].filter((n) => n !== 'consultations').map((table_name) => ({ table_name })) };
      if (/SELECT COUNT\(\*\)::int AS c FROM public\."pacientes" WHERE tenant_id = \$1/.test(t)) return { rows: [{ c: 2 }] };
      if (/SELECT COUNT\(\*\)::int AS c FROM public\."\w+" WHERE tenant_id = \$1/.test(t)) return { rows: [{ c: 0 }] };
      if (/SELECT \* FROM public\."pacientes" WHERE tenant_id = \$1 ORDER BY ctid LIMIT 5000 OFFSET \$2/.test(t)) {
        return params[1] === 0
          ? { rows: [{ id: 'p1', nome: 'Ana', telefone: '=1+1', saldo: -150.5, tenant_id: params[0] }], fields: ['id', 'nome', 'telefone', 'saldo', 'tenant_id'].map((name) => ({ name })) }
          : { rows: [], fields: [] };
      }
      return { rows: [], rowCount: 0 };
    });
  });
  afterEach(() => spy.mockRestore());

  test.each(['ok', 'leitura', 'cancel'])('etapa "%s": lista e baixa o CSV de pacientes da própria clínica', async (k) => {
    const lista = await request(app).get('/api/exportacao').set('Authorization', `Bearer ${tok(T[k])}`);
    expect(lista.status).toBe(200);
    const pac = lista.body.grupos.find((g) => g.grupo === 'Pacientes').tabelas.find((x) => x.tabela === 'pacientes');
    expect(pac.registros).toBe(2);
    expect(lista.body.grupos.flatMap((g) => g.tabelas).some((x) => x.tabela === 'consultations')).toBe(false);
    const csv = await request(app).get('/api/exportacao/pacientes.csv').set('Authorization', `Bearer ${tok(T[k])}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('"nome"');
    expect(csv.text).toContain(`"'=1+1"`);
    expect(csv.text).toContain('"-150.5"');
    const sel = sqlLog.find((q) => /SELECT \* FROM public\."pacientes"/.test(q.t));
    expect(sel.params[0]).toBe(T[k]);
  });

  test('não-admin não exporta (403)', async () => {
    const r = await request(app).get('/api/exportacao/pacientes.csv').set('Authorization', `Bearer ${tok(T.ok, 'recepcionista')}`);
    expect(r.status).toBe(403);
    expect(sqlLog.some((q) => /SELECT \* FROM public/.test(q.t))).toBe(false);
  });

  test('super-admin não exporta clínica alheia (403)', async () => {
    const r = await request(app).get('/api/exportacao/pacientes.csv')
      .set('Authorization', `Bearer ${tok(null, 'admin', { is_super_admin: true })}`).set('x-tenant-id', T.ok);
    expect(r.status).toBe(403);
    expect(sqlLog.some((q) => /SELECT \* FROM public/.test(q.t))).toBe(false);
  });

  test('admin sem vínculo com a clínica do token → 403', async () => {
    const r = await request(app).get('/api/exportacao').set('Authorization', `Bearer ${tok(OUTRA)}`);
    expect(r.status).toBe(403);
  });

  test('tabela fora da lista → 404 sem consultar (nome nunca vai do usuário para o SQL)', async () => {
    for (const nome of ['profiles', 'pacientes;DROP', 'consultations']) {
      const r = await request(app).get(`/api/exportacao/${encodeURIComponent(nome)}.csv`).set('Authorization', `Bearer ${tok(T.ok)}`);
      expect(r.status).toBe(404);
    }
    expect(sqlLog.some((q) => /SELECT \* FROM/.test(q.t))).toBe(false);
  });

  test('CSV: BOM, aspas, quebra de linha, JSON, fórmula e número negativo', () => {
    expect(celulaCsv('a"b\nc')).toBe('"a""b c"');
    expect(celulaCsv({ x: 1 })).toBe('"{""x"":1}"');
    expect(celulaCsv('@SOMA')).toBe(`"'@SOMA"`);
    expect(celulaCsv('-12.5')).toBe('"-12.5"');
    expect(celulaCsv('-abc')).toBe(`"'-abc"`);
    expect(celulaCsv(null)).toBe('');
    expect(linhasParaCsv(['a'], [{ a: 1 }]).startsWith('﻿"a"\n"1"')).toBe(true);
    expect(EXPORTACAO_TABELAS.has('profiles')).toBe(false);
  });
});
