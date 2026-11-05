// Segredo do webhook da Clinicorp (gerado no servidor, guardado só como hash) e
// payload do push do chat sem conteúdo.
//
// pool.query é mockado com uma tabela clinicorp_user_settings em memória que imita
// o índice único em webhook_secret_hash e o prazo do segredo anterior. A semântica
// SQL real (índice único, NOW()) é conferida à parte num Postgres local.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool, buildChatPushPayload } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const sha = (v) => createHash('sha256').update(v, 'utf8').digest('hex');

describe('Clinicorp — segredo do webhook', () => {
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  const adminA = '44444444-4444-4444-4444-444444444444';
  const adminB = '66666666-6666-6666-6666-666666666666';
  const atendenteA = '55555555-5555-5555-5555-555555555555';
  const tenantDe = { [adminA]: tenantA, [atendenteA]: tenantA, [adminB]: tenantB };

  const token = (sub, extra = {}) => jwt.sign({
    sub, email: `${sub.slice(0, 4)}@clinica.com`, role: 'admin',
    tenant_id: tenantDe[sub], is_super_admin: false, ...extra,
  }, JWT_SECRET);

  let tabela; // user_id -> linha
  let sqlLog;
  let colisoesForcadas;
  let agora;
  let querySpy;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    tabela = new Map();
    sqlLog = [];
    colisoesForcadas = 0;
    agora = Date.now();
    querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });

      if (/INSERT INTO clinicorp_user_settings \(user_id, enabled, base_url, webhook_secret_hash/.test(text)) {
        const [userId, hash, , horas] = params;
        const outro = [...tabela.entries()].some(([uid, r]) => uid !== userId && r.hash === hash);
        if (outro || colisoesForcadas > 0) {
          colisoesForcadas = Math.max(0, colisoesForcadas - 1);
          const e = new Error('duplicate key value violates unique constraint'); e.code = '23505'; throw e;
        }
        const atual = tabela.get(userId);
        if (!atual) {
          tabela.set(userId, { hash, prevHash: null, prevExp: null, enabled: true, plain: null });
        } else {
          atual.prevHash = atual.hash || (atual.plain ? sha(atual.plain) : null);
          atual.prevExp = agora + horas * 3600_000;
          atual.hash = hash;
          atual.plain = null;
        }
        return { rows: [], rowCount: 1 };
      }

      if (/FROM clinicorp_user_settings s\s+JOIN profiles p/.test(text)) {
        const h = params[0];
        const achados = [...tabela.entries()].filter(([, r]) => r.enabled
          && (r.hash === h || (r.prevHash === h && r.prevExp > agora)));
        achados.sort((a, b) => Number(b[1].hash === h) - Number(a[1].hash === h));
        const [uid] = achados[0] || [];
        return { rows: uid ? [{ user_id: uid, tenant_id: tenantDe[uid], api_token: 't', subscriber_id: 's', base_url: 'x' }] : [] };
      }

      if (/INSERT INTO clinicorp_webhook_events/.test(text)) return { rows: [{ id: 1 }], rowCount: 1 };
      if (/SELECT role FROM user_roles/.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
  });

  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });

  const rotacionar = (sub, extra) => request(app)
    .post('/api/clinicorp/my-settings/rotate-secret')
    .set('Authorization', `Bearer ${token(sub, extra)}`).send({});
  const webhook = (secret, via = 'header') => {
    const r = request(app).post(via === 'query' ? `/api/webhook/clinicorp?user_api=${encodeURIComponent(secret)}` : '/api/webhook/clinicorp');
    return (via === 'header' ? r.set('x-user-api', secret) : r).send({ event: 'desconhecido', Id: 'x' });
  };

  test('rotate gera segredo no servidor e grava só o hash', async () => {
    const res = await rotacionar(adminA);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const secret = res.body.webhook_secret;
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThanOrEqual(40); // 32 bytes em base64url = 43 chars
    const ins = sqlLog.find(q => /INSERT INTO clinicorp_user_settings/.test(q.text));
    expect(ins.params[1]).toBe(sha(secret));
    expect(ins.params).not.toContain(secret);
    expect(ins.text).toMatch(/webhook_secret = NULL/);
  });

  test('dois usuários não ficam com o mesmo hash: colisão (23505) gera outro segredo', async () => {
    const a = await rotacionar(adminA);
    colisoesForcadas = 1;
    const b = await rotacionar(adminB);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const insertsB = sqlLog.filter(q => /INSERT INTO clinicorp_user_settings/.test(q.text) && q.params[0] === adminB);
    expect(insertsB).toHaveLength(2);
    expect(insertsB[0].params[1]).not.toBe(insertsB[1].params[1]);
    expect(tabela.get(adminA).hash).not.toBe(tabela.get(adminB).hash);
    expect(a.body.webhook_secret).not.toBe(b.body.webhook_secret);
  });

  test('o segredo de uma clínica não autentica webhook como outra', async () => {
    const a = (await rotacionar(adminA)).body.webhook_secret;
    const b = (await rotacionar(adminB)).body.webhook_secret;
    await webhook(a);
    await webhook(b);
    const eventos = sqlLog.filter(q => /INSERT INTO clinicorp_webhook_events/.test(q.text));
    expect(eventos.map(e => e.params[5])).toEqual([tenantA, tenantB]);
  });

  test('o segredo anterior vale até expirar; depois, 401', async () => {
    const antigo = (await rotacionar(adminA)).body.webhook_secret;
    const novo = (await rotacionar(adminA)).body.webhook_secret;
    expect((await webhook(novo)).status).toBe(200);
    expect((await webhook(antigo)).status).toBe(200);
    agora += 25 * 3600_000; // passa o prazo de 24 h
    const expirado = await webhook(antigo);
    expect(expirado.status).toBe(401);
    expect(expirado.body).toEqual({ error: 'Unauthorized' });
    expect((await webhook(novo)).status).toBe(200);
  });

  test('segredo legado (em claro, sem hash) vira o anterior na primeira rotação', async () => {
    tabela.set(adminA, { hash: null, prevHash: null, prevExp: null, enabled: true, plain: 'segredo-legado-1234567890abcd' });
    await rotacionar(adminA);
    expect(tabela.get(adminA).prevHash).toBe(sha('segredo-legado-1234567890abcd'));
    expect(tabela.get(adminA).plain).toBeNull();
  });

  test('webhook com segredo inválido devolve 401 genérico e não grava evento', async () => {
    await rotacionar(adminA);
    const res = await webhook('segredo-que-nao-existe-123456');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(sqlLog.some(q => /INSERT INTO clinicorp_webhook_events/.test(q.text))).toBe(false);
    expect((await request(app).post('/api/webhook/clinicorp').send({})).status).toBe(401);
  });

  test('query ?user_api= ainda é aceita, com aviso no log sem o valor', async () => {
    const secret = (await rotacionar(adminA)).body.webhook_secret;
    console.warn.mockClear();
    const res = await webhook(secret, 'query');
    expect(res.status).toBe(200);
    const avisos = console.warn.mock.calls.map(c => c.join(' '));
    expect(avisos.some(a => /user_api/.test(a))).toBe(true);
    expect(avisos.some(a => a.includes(secret))).toBe(false);
  });

  test('erro no processamento: 200 sem err.message; erro fatal: 500 genérico', async () => {
    const secret = (await rotacionar(adminA)).body.webhook_secret;
    querySpy.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (/FROM clinicorp_user_settings s\s+JOIN profiles p/.test(text)) {
        return { rows: [{ user_id: adminA, tenant_id: tenantA }] };
      }
      if (/INSERT INTO clinicorp_webhook_events/.test(text)) return { rows: [{ id: 1 }] };
      if (/INSERT INTO clinicorp_patients|clinicorp_patients/.test(text)) throw new Error('detalhe interno do banco XYZ');
      return { rows: [], rowCount: 0 };
    });
    const proc = await request(app).post('/api/webhook/clinicorp').set('x-user-api', secret)
      .send({ event: 'patient.created', Patient_PersonId: 1, Name: 'Fulano' });
    expect(proc.status).toBe(200);
    expect(JSON.stringify(proc.body)).not.toMatch(/XYZ/);

    querySpy.mockImplementation(async () => { throw new Error('conexão caiu ABC'); });
    const fatal = await request(app).post('/api/webhook/clinicorp').set('x-user-api', secret).send({});
    expect(fatal.status).toBe(500);
    expect(fatal.body).toEqual({ error: 'Erro interno' });
  });

  test('PUT recusa webhook_secret com 400', async () => {
    const res = await request(app).put('/api/clinicorp/my-settings')
      .set('Authorization', `Bearer ${token(adminA)}`).send({ webhook_secret: 'escolhido-pelo-usuario-123' });
    expect(res.status).toBe(400);
    expect(sqlLog.some(q => /INSERT INTO clinicorp_user_settings/.test(q.text))).toBe(false);
  });

  test.each([
    ['put', '/api/clinicorp/my-settings'],
    ['delete', '/api/clinicorp/my-settings'],
    ['post', '/api/clinicorp/my-settings/rotate-secret'],
  ])('%s %s é só para admin (atendente recebe 403)', async (method, url) => {
    const res = await request(app)[method](url)
      .set('Authorization', `Bearer ${token(atendenteA, { role: 'atendente' })}`).send({ enabled: true });
    expect(res.status).toBe(403);
    expect(sqlLog.some(q => /(INSERT INTO|DELETE FROM) clinicorp_user_settings/.test(q.text))).toBe(false);
  });

  test('GET não devolve o segredo nem pedaço dele', async () => {
    await rotacionar(adminA);
    querySpy.mockImplementation(async (sql) => {
      if (/FROM clinicorp_user_settings WHERE user_id/.test(String(sql))) {
        return { rows: [{ enabled: true, has_webhook_secret: true, previous_secret_expires_at: null }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).get('/api/clinicorp/my-settings').set('Authorization', `Bearer ${token(adminA)}`);
    expect(res.status).toBe(200);
    expect(res.body.has_webhook_secret).toBe(true);
    expect(res.body.webhook_secret_preview).toBe('••••••••');
    expect(res.body.can_manage).toBe(true);
  });
});

describe('Push do chat sem conteúdo', () => {
  const telefone = '5511987654321';
  const texto = 'Doutor, estou com dor no dente após a extração do siso';

  test('padrão: título genérico, sem nome, texto ou telefone', () => {
    const p = buildChatPushPayload({ leadId: 'lead-1', name: 'Maria Souza' });
    expect(p.title).toBe('Nova mensagem');
    expect(p.body).toBe('Abra o Odonto Connect para ler');
    const json = JSON.stringify(p);
    expect(json).not.toContain('Maria');
    expect(json).not.toContain(texto);
    expect(json.replace(/\D/g, '')).not.toContain(telefone.slice(-8));
  });

  test('mostrarNome: só o primeiro nome', () => {
    const p = buildChatPushPayload({ leadId: 'lead-1', name: 'Maria Souza', mostrarNome: true });
    expect(p.title).toBe('Nova mensagem de Maria');
    expect(JSON.stringify(p)).not.toContain('Souza');
  });

  test('mostrarNome com nome que é o telefone: não mostra os dígitos', () => {
    const p = buildChatPushPayload({ leadId: 'lead-1', name: telefone, mostrarNome: true });
    expect(p.title).toBe('Nova mensagem');
    expect(JSON.stringify(p).replace(/\D/g, '')).not.toContain(telefone.slice(-8));
  });
});
