// Comparação de telefone que usa o índice RIGHT(REGEXP_REPLACE(col,'\D','','g'),11):
// mesmo resultado do LIKE '%'||... antigo para telefones em formatos diferentes
// (com e sem 55, com máscara), conferido num Postgres real (o do CI). Sem Postgres,
// os testes de SQL só avisam e passam; os de JS e das rotas rodam sempre.
import pg from 'pg';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import http from 'http';
import { jest } from '@jest/globals';
import { sqlFoneIgual, foneIndexado, candidatosFone } from '../telefone-sql.mjs';

http.globalAgent = new http.Agent({ keepAlive: false });

// Mesmo número em formatos diferentes.
const CELULAR = ['11987654321', '5511987654321', '+55 (11) 98765-4321', '(11) 98765-4321', '55 11 98765 4321', '011987654321'.slice(1)];
const FIXO = ['1133334444', '551133334444', '+55 (11) 3333-4444', '(11) 3333-4444'];
const OUTROS = ['21987654321', '5521987654321', '11912345678', '1144445555'];
const TODOS = [...CELULAR, ...FIXO, ...OUTROS];
const digitos = (t) => t.replace(/\D/g, '');
const mesmoNumero = (a, b) => {
  const n = (t) => { const d = digitos(t); return d.startsWith('55') && d.length >= 12 ? d.slice(2) : d; };
  return n(a) === n(b);
};

describe('candidatosFone', () => {
  test('máscara e 55 não mudam os candidatos do celular', () => {
    expect(candidatosFone('+55 (11) 98765-4321')).toEqual(['11987654321']);
    expect(candidatosFone('11987654321')).toEqual(['11987654321']);
  });
  test('fixo de 10 dígitos: também o candidato com 55', () => {
    expect(candidatosFone('(11) 3333-4444')).toEqual(['1133334444', '51133334444']);
  });
  test('vazio ou sem dígitos: nenhum candidato (não casa com tudo)', () => {
    expect(candidatosFone('')).toEqual([]);
    expect(candidatosFone(null)).toEqual([]);
    expect(candidatosFone('sem número')).toEqual([]);
  });
  test('semDdd: número sem o 55 e os 9 e 8 últimos dígitos (fixo não ganha o 9)', () => {
    expect(candidatosFone('551133334444', { semDdd: true })).toEqual(['51133334444', '1133334444', '133334444', '33334444']);
  });
  test('semDdd: celular com e sem o 9º dígito', () => {
    expect(candidatosFone('(11) 98765-4321', { semDdd: true })).toEqual(expect.arrayContaining(['11987654321', '1187654321', '51187654321']));
    expect(candidatosFone('1187654321', { semDdd: true })).toEqual(expect.arrayContaining(['1187654321', '11987654321']));
    expect(candidatosFone('551187654321', { semDdd: true })).toEqual(expect.arrayContaining(['51187654321', '1187654321', '11987654321']));
  });
  test('semDdd: celular com 9 seguido de 2–5 também volta para 10 dígitos (paridade com o LIKE antigo)', () => {
    // Em produção há celulares assim (9 + 2..5). Exigir 6–9 aqui faria esses perderem o
    // cadastro antigo sem o 9. O casamento com o fixo de outro paciente com os mesmos
    // 8 últimos dígitos já existia no LIKE antigo.
    expect(candidatosFone('(11) 93333-4444', { semDdd: true })).toEqual(expect.arrayContaining(['1133334444', '51133334444']));
  });
});

describe('Postgres: resultado igual ao LIKE antigo e uso do índice', () => {
  let client = null;
  const SCHEMA = 'teste_telefone_sql';

  beforeAll(async () => {
    const c = new pg.Client({
      host: process.env.PG_HOST || 'localhost', port: Number(process.env.PG_PORT) || 5432,
      database: process.env.PG_DATABASE || 'postgres', user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '', connectionTimeoutMillis: 3000,
    });
    try { await c.connect(); client = c; } catch (e) {
      console.warn(`[telefone-sql] sem Postgres acessível (${e.code || e.message}): testes de SQL não rodados`);
      return;
    }
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}`);
  });
  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.end();
  });

  // Predicado antigo da fila (server.mjs, GET /api/queue/leads).
  const antigoFila = `REGEXP_REPLACE(COALESCE($1::text, ''), '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE($2::text, '\\D', '', 'g'), 11)`;
  const novoFila = sqlFoneIgual('$1::text', '$2::text');

  test('fila: para números com DDD, o novo casa exatamente quando o antigo casava', async () => {
    if (!client) return;
    const diferencas = [];
    for (const col of TODOS) for (const outro of TODOS) {
      const { rows } = await client.query(`SELECT (${antigoFila}) AS antigo, (${novoFila}) AS novo`, [col, outro]);
      if (rows[0].antigo !== rows[0].novo) diferencas.push([col, outro, rows[0]]);
    }
    expect(diferencas).toEqual([]);
  });

  test('fila: o mesmo número em formatos diferentes casa nos dois sentidos quando o antigo casava', async () => {
    if (!client) return;
    for (const a of CELULAR) for (const b of CELULAR) {
      const { rows } = await client.query(`SELECT (${novoFila}) AS novo`, [a, b]);
      expect(rows[0].novo).toBe(true);
    }
  });

  test('fila: telefone sem dígitos não casa com tudo (o LIKE antigo casava)', async () => {
    if (!client) return;
    const { rows } = await client.query(`SELECT (${antigoFila}) AS antigo, (${novoFila}) AS novo`, ['11987654321', '---']);
    expect(rows[0]).toEqual({ antigo: true, novo: false });
  });

  test('pacientes: acha o mesmo número em qualquer formato, inclusive cadastro sem DDD ou sem 55', async () => {
    if (!client) return;
    const novo = (paciente, lead) => client.query(
      `SELECT ${foneIndexado("COALESCE($1::text, '')")} = ANY($2::text[]) AS ok`, [paciente, candidatosFone(lead, { semDdd: true })]
    ).then(r => r.rows[0].ok);
    for (const grupo of [CELULAR, FIXO]) {
      for (const p of grupo) for (const l of grupo) expect(await novo(p, l)).toBe(true);
    }
    expect(await novo('98765-4321', '+55 (11) 98765-4321')).toBe(true); // paciente salvo sem DDD
    expect(await novo('3333-4444', '551133334444')).toBe(true);
    // 9º dígito: lead vindo do WhatsApp sem o 9, ou cadastro antigo sem o 9 (casos da revisão).
    expect(await novo('551187654321', '(11) 98765-4321')).toBe(true);
    expect(await novo('553187654321', '(31) 98765-4321')).toBe(true);
    expect(await novo('5511987654321', '1187654321')).toBe(true);
    // e nos dois sentidos
    expect(await novo('(11) 98765-4321', '551187654321')).toBe(true);
    expect(await novo('(31) 98765-4321', '553187654321')).toBe(true);
    expect(await novo('1187654321', '5511987654321')).toBe(true);
    // Fixo (começa em 2 a 5) não ganha o 9; outro DDD continua não casando.
    expect(await novo('11933334444', '1133334444')).toBe(false);
    // Celular 9 + 2..5 contra o cadastro de 10 dígitos: casa, como o LIKE antigo (8 últimos).
    const likeAntigo = async (paciente, lead) => (await client.query(
      `SELECT REPLACE(REPLACE(REPLACE($1::text, ' ', ''), '-', ''), '+', '') LIKE '%' || $2 AS ok`,
      [paciente, String(lead).replace(/\D/g, '').slice(-8)])).rows[0].ok;
    for (const [paciente, lead] of [['1133334444', '(11) 93333-4444'], ['551133334444', '11933334444']]) {
      expect(await novo(paciente, lead)).toBe(true);
      expect(await likeAntigo(paciente, lead)).toBe(true);
    }
    expect(await novo('551187654321', '(21) 98765-4321')).toBe(false);
    // Outro DDD com os mesmos 8 últimos dígitos: o antigo dava conflito falso; o novo não.
    expect(await novo('21987654321', '11987654321')).toBe(false);
    for (const p of TODOS) for (const l of TODOS) {
      if (!mesmoNumero(p, l)) expect(await novo(p, l)).toBe(false);
    }
  });

  test('o planner usa o índice de expressão de chat_messages (índices iguais aos do #84)', async () => {
    if (!client) return;
    await client.query(`CREATE TABLE chat_messages (id serial, tenant_id uuid, phone text, lead_id text, sender text, "timestamp" timestamptz DEFAULT now())`);
    await client.query(`INSERT INTO chat_messages (tenant_id, phone, lead_id, sender)
      SELECT (ARRAY['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'])[1 + g % 2]::uuid,
             '55' || (11000000000 + g)::text, 'lead-' || g, 'lead'
        FROM generate_series(1, 30000) g`);
    await client.query(`CREATE INDEX idx_chat_messages_tenant_fone11 ON chat_messages (tenant_id, (RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 11))) WHERE phone IS NOT NULL`);
    await client.query(`CREATE INDEX idx_chat_messages_tenant_lead_ts ON chat_messages (tenant_id, lead_id, "timestamp" DESC)`);
    await client.query('ANALYZE chat_messages');
    const { rows } = await client.query(
      `EXPLAIN SELECT COUNT(*) FROM chat_messages cm
        WHERE cm.tenant_id = '11111111-1111-1111-1111-111111111111'
          AND (cm.lead_id = 'x' OR (cm.phone IS NOT NULL AND ${sqlFoneIgual('cm.phone', "'+55 (11) 0000-1234'")}))`);
    const plano = rows.map(r => r['QUERY PLAN']).join('\n');
    expect(plano).toMatch(/idx_chat_messages_tenant_fone11/);
  });
});

describe('rotas: tenant_id mantido e sem LIKE com curinga no início', () => {
  const tenantA = '11111111-1111-1111-1111-111111111111';
  let app, pool, sqlLog, spy;
  const token = () => jwt.sign({ sub: '44444444-4444-4444-4444-444444444444', role: 'admin', tenant_id: tenantA }, process.env.JWT_SECRET);

  beforeAll(async () => {
    ({ app, pool } = await import('../server.mjs'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  beforeEach(() => {
    sqlLog = [];
    spy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      if (/FROM crm_leads WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        return { rows: [{ id: 'lead-1', nome: 'Maria', telefone: '+55 (11) 98765-4321', paciente_id: null }] };
      }
      if (/FROM pacientes\s+WHERE tenant_id = \$2 AND RIGHT/.test(text)) {
        return { rows: [{ id: 'pac-1', nome: 'Maria', telefone: '11987654321' }] };
      }
      return { rows: [], rowCount: 0 };
    });
  });
  afterEach(() => spy.mockRestore());
  afterAll(async () => { await pool.end(); });

  test('convert-to-patient: busca o paciente pelos candidatos e pelo tenant', async () => {
    const res = await request(app).post('/api/crm/leads/lead-1/convert-to-patient').set('Authorization', `Bearer ${token()}`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conflict: true, paciente_id: 'pac-1' });
    const q = sqlLog.find(x => /FROM pacientes\s+WHERE tenant_id = \$2/.test(x.text));
    expect(q.text).not.toMatch(/LIKE '%'/);
    expect(q.params).toEqual([candidatosFone('+55 (11) 98765-4321', { semDdd: true }), tenantA]);
  });

  test('history: casa pelo telefone com tenant e sem LIKE', async () => {
    const res = await request(app).get('/api/crm/leads/lead-1/history').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /FROM agendamentos a/.test(x.text));
    expect(q.text).not.toMatch(/LIKE '%'/);
    expect(q.text).toMatch(/a\.tenant_id = \$2/);
    expect(q.params[1]).toBe(tenantA);
  });

  test('queue/leads: nenhuma comparação de telefone com LIKE e a expressão do índice nas mensagens', async () => {
    const res = await request(app).get('/api/queue/leads').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    const q = sqlLog.find(x => /WITH open_sessions AS/.test(x.text));
    expect(q.text).not.toMatch(/LIKE '%'/);
    expect(q.text).toContain("RIGHT(REGEXP_REPLACE(cm_unread.phone, '\\D', '', 'g'), 11) = ANY");
    expect(q.text).toContain("RIGHT(REGEXP_REPLACE(cm.phone, '\\D', '', 'g'), 11) = ANY");
    expect(q.text).toContain("RIGHT(REGEXP_REPLACE(COALESCE(l.telefone, ''), '\\D', '', 'g'), 11) = ANY");
    expect(q.params).toEqual(['44444444-4444-4444-4444-444444444444', tenantA]);
  });
});
