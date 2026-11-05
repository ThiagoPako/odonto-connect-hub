// L7 — mídia de /uploads/media (chat, avatar) só com autorização e por clínica.
// pool.query é mockado (nenhuma query chega ao Postgres). Grava um arquivo de teste em
// uploads/media/2099-01/ e o remove no fim.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile, rm } from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
// Reivindicação de arquivo antigo é desligada por padrão; aqui ligada para testar as regras
process.env.MEDIA_REIVINDICAR_LEGADO = '1';

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const relA = '2099-01/aaaaaaaa-0000-4000-8000-00000000000a.png';
const relB = '2099-01/bbbbbbbb-0000-4000-8000-00000000000b.png';
const relLegado = '2099-01/cccccccc-0000-4000-8000-00000000000c.jpg';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const DIR = path.join(__dirname, '..', '..', 'uploads', 'media', '2099-01');

let donos; // media_files "no banco": path → tenant
let citacoes; // referências antigas: path → [{ tenant, em }]
let citacaoFalha; // código de erro simulado na leitura das citações
const CORTE = '2026-11-05T12:00:00.000Z';
const ANTES = '2026-01-10T10:00:00.000Z';
let sqlLog;
let querySpy;
const token = (tenant = tenantA) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'u@clinica.com', role: 'admin', tenant_id: tenant, is_super_admin: false,
}, JWT_SECRET);

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await mkdir(DIR, { recursive: true });
  for (const r of [relA, relB, relLegado]) await writeFile(path.join(DIR, r.split('/')[1]), PNG);
});

beforeEach(() => {
  sqlLog = [];
  donos = { [relA]: tenantA, [relB]: tenantB };
  citacoes = { [relLegado]: [{ tenant: tenantA, em: ANTES }] };
  citacaoFalha = null;
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/SELECT tenant_id, mime_type FROM media_files WHERE path = \$1/.test(text)) {
      const t = donos[params[0]];
      return Promise.resolve({ rows: t ? [{ tenant_id: t, mime_type: 'image/png' }] : [], rowCount: t ? 1 : 0 });
    }
    if (/SELECT tenant_id FROM media_files WHERE path = \$1/.test(text)) {
      const t = donos[params[0]];
      return Promise.resolve({ rows: t ? [{ tenant_id: t }] : [], rowCount: t ? 1 : 0 });
    }
    if (/SELECT path, tenant_id FROM media_files WHERE path = ANY/.test(text)) {
      const rows = params[0].filter(p => donos[p]).map(p => ({ path: p, tenant_id: donos[p] }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    if (/FROM app_settings WHERE key = 'l7_media_backfill'/.test(text)) return Promise.resolve({ rows: [{ em: CORTE }], rowCount: 1 });
    if (/AS em FROM chat_messages WHERE lower\(media_url\) LIKE/.test(text)) {
      if (citacaoFalha) return Promise.reject(Object.assign(new Error('falha'), { code: citacaoFalha }));
      const rel = String(params[0]).replace(/^%\/uploads\/media\//, '').replace(/%$/, '');
      const rows = (citacoes[rel] || []).map(c => ({ tenant_id: c.tenant, em: c.em }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    if (/AS em FROM (profiles|exames|prontuarios)/.test(text)) return Promise.reject(Object.assign(new Error('no column'), { code: '42703' }));
    if (/INSERT INTO media_files/.test(text)) {
      if (!donos[params[1]]) donos[params[1]] = params[0];
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  await pool.end();
});

const assinar = async (paths, tk = token()) => (await request(app).post('/api/media/sign')
  .set('Authorization', `Bearer ${tk}`).send({ paths })).body.links || {};

describe('mídia autenticada (L7)', () => {
  test('sem login e sem assinatura → 401 (não é mais público)', async () => {
    expect((await request(app).get(`/uploads/media/${relA}`)).status).toBe(401);
  });

  test('caminho fora do formato → 404', async () => {
    expect((await request(app).get('/uploads/media/2099-01/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await request(app).get('/uploads/media/2099-01/nao-uuid.png')).status).toBe(404);
  });

  test('Bearer da clínica dona → 200; de outra clínica → 404', async () => {
    const ok = await request(app).get(`/uploads/media/${relA}`).set('Authorization', `Bearer ${token()}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toMatch(/private/);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    const outra = await request(app).get(`/uploads/media/${relA}`).set('Authorization', `Bearer ${token(tenantB)}`);
    expect(outra.status).toBe(404);
  });

  test('POST /api/media/sign assina só o que é da clínica; link abre sem login', async () => {
    const links = await assinar([`/uploads/media/${relA}`, `/uploads/media/${relB}`]);
    expect(Object.keys(links)).toEqual([`/uploads/media/${relA}`]);
    const url = links[`/uploads/media/${relA}`];
    expect(url).toMatch(/\?exp=\d+&sig=[0-9a-f]{64}$/);
    expect((await request(app).get(url)).status).toBe(200);
    // adulterado / vencido → 403
    expect((await request(app).get(url.replace(/sig=([0-9a-f])/, (_, c) => `sig=${c === 'a' ? 'b' : 'a'}`))).status).toBe(403);
    expect((await request(app).get(url.replace(/exp=\d+/, 'exp=1000'))).status).toBe(403);
    // a assinatura de um arquivo não abre outro
    expect((await request(app).get(url.replace(relA, relB))).status).toBe(403);
  });

  test('arquivo antigo sem dono: só abre para a clínica que o cita no banco, e passa a ter dono', async () => {
    expect((await request(app).get(`/uploads/media/${relLegado}`).set('Authorization', `Bearer ${token(tenantB)}`)).status).toBe(404);
    expect(donos[relLegado]).toBeUndefined();
    const ok = await request(app).get(`/uploads/media/${relLegado}`).set('Authorization', `Bearer ${token()}`);
    expect(ok.status).toBe(200);
    expect(donos[relLegado]).toBe(tenantA);
  });

  test.each([
    ['citado por duas clínicas', () => { citacoes[relLegado] = [{ tenant: tenantA, em: ANTES }, { tenant: tenantB, em: ANTES }]; }],
    ['citação sem clínica (NULL) conta como conflito', () => { citacoes[relLegado] = [{ tenant: tenantA, em: ANTES }, { tenant: null, em: ANTES }]; }],
    ['citação posterior ao backfill do L7', () => { citacoes[relLegado] = [{ tenant: tenantA, em: '2026-11-06T10:00:00.000Z' }]; }],
    ['erro ao ler citações (falha fechada)', () => { citacaoFalha = '57014'; }],
  ])('arquivo antigo não é reivindicado: %s', async (_, preparar) => {
    preparar();
    expect((await request(app).get(`/uploads/media/${relLegado}`).set('Authorization', `Bearer ${token()}`)).status).toBe(404);
    expect(donos[relLegado]).toBeUndefined();
  });

  test('tabela/coluna ausente (42P01/42703) não impede reivindicar', async () => {
    citacaoFalha = null;
    const ok = await request(app).get(`/uploads/media/${relLegado}`).set('Authorization', `Bearer ${token()}`);
    expect(ok.status).toBe(200);
  });

  test('resposta inline traz CSP restritiva; PDF sem sandbox', async () => {
    const ok = await request(app).get(`/uploads/media/${relA}`).set('Authorization', `Bearer ${token()}`);
    expect(ok.headers['content-security-policy']).toBe("default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  });

  test('POST /api/messages não sobrescreve mensagem de outra clínica com o mesmo id', async () => {
    await request(app).post('/api/messages').set('Authorization', `Bearer ${token()}`)
      .send({ id: 'm2', leadId: 'l1', content: 'oi', type: 'text' });
    const ins = sqlLog.find(q => /INSERT INTO chat_messages/.test(q.text));
    expect(ins.text).toMatch(/WHERE chat_messages\.tenant_id = EXCLUDED\.tenant_id/);
  });

  test('resposta JSON troca URL de mídia da clínica por link assinado e deixa a de outra clínica sem assinatura', async () => {
    // /api/media/upload responde { url } com o caminho recém-gravado (registrado para a clínica A)
    const up = await request(app).post('/api/media/upload?fileName=x.png&mimeType=image/png')
      .set('Authorization', `Bearer ${token()}`).set('Content-Type', 'image/png').send(PNG);
    expect(up.status).toBe(200);
    expect(up.body.url).toMatch(/^\/uploads\/media\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png\?exp=\d+&sig=[0-9a-f]{64}$/);
    const ins = sqlLog.find(q => /INSERT INTO media_files/.test(q.text));
    expect(ins.params[0]).toBe(tenantA);
    expect(ins.params[2]).toBe('image/png'); // tipo detectado pelo conteúdo
    await rm(path.join(__dirname, '..', '..', 'uploads', 'media', up.body.url.split('/')[3], up.body.url.split('/')[4].split('?')[0]), { force: true });
  });

  test('POST /api/messages grava a URL limpa (sem exp/sig)', async () => {
    const links = await assinar([`/uploads/media/${relA}`]);
    sqlLog = [];
    await request(app).post('/api/messages').set('Authorization', `Bearer ${token()}`)
      .send({ id: 'm1', leadId: 'l1', content: '', type: 'image', fileUrl: links[`/uploads/media/${relA}`] });
    const ins = sqlLog.find(q => /INSERT INTO chat_messages/.test(q.text));
    expect(ins.params).toContain(`/uploads/media/${relA}`);
    expect(JSON.stringify(ins.params)).not.toMatch(/sig=/);
  });
});
