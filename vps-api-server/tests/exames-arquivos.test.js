// Imagens/arquivos de exame: só a clínica dona envia, lista e abre; link assinado
// adulterado ou vencido não abre; conteúdo que não é imagem/PDF/DICOM/ZIP é recusado.
// pool.query é mockado (nenhuma query chega ao Postgres); o upload de sucesso grava
// um arquivo de teste em uploads/exames/<tenant> e o remove no fim.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { rm, readdir } from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const exameA = 'eeeeeeee-0000-4000-8000-00000000000a';
const exameB = 'eeeeeeee-0000-4000-8000-00000000000b';
const donoExame = { [exameA]: tenantA, [exameB]: tenantB };
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

let sqlLog;
let querySpy;
let arquivos; // linhas de exame_arquivos "no banco"
let exameLaudado;
const token = (tenant = tenantA) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'admin@clinica.com',
  role: 'admin', tenant_id: tenant, is_super_admin: false,
}, JWT_SECRET);
const gravou = (re) => sqlLog.some(q => re.test(q.text));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  arquivos = [];
  exameLaudado = false;
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/SELECT id, paciente_id, status, laudado_em FROM exames WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      const ok = donoExame[params[0]] === params[1];
      return Promise.resolve({ rows: ok ? [{ id: params[0], paciente_id: null, status: 'novo', laudado_em: exameLaudado ? '2026-11-05T10:00:00Z' : null }] : [], rowCount: ok ? 1 : 0 });
    }
    if (/^\s*INSERT INTO exame_arquivos/.test(text)) {
      const [id, tenant_id, exame_id, paciente_id, caminho, nome_original, mime_type, tamanho_bytes] = params;
      const row = { id, tenant_id, exame_id, paciente_id, caminho, nome_original, mime_type, tamanho_bytes, created_at: new Date().toISOString() };
      arquivos.push(row);
      return Promise.resolve({ rows: [row], rowCount: 1 });
    }
    if (/SELECT caminho, nome_original, mime_type FROM exame_arquivos/.test(text)) {
      const r = arquivos.find(a => a.id === params[0] && a.tenant_id === params[1]);
      return Promise.resolve({ rows: r ? [r] : [], rowCount: r ? 1 : 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => {
  await rm(path.join(__dirname, '..', '..', 'uploads', 'exames', tenantA), { recursive: true, force: true });
  await pool.end();
});

const enviar = (exame, corpo, tk = token()) => request(app)
  .post(`/api/exames/${exame}/arquivos`)
  .set('Authorization', `Bearer ${tk}`)
  .set('Content-Type', 'application/octet-stream')
  .set('X-Nome-Arquivo', encodeURIComponent('panorâmica.png'))
  .send(corpo);

describe('arquivos de exame', () => {
  test('sem login → 401', async () => {
    const res = await request(app).get(`/api/exames/${exameA}/arquivos`);
    expect(res.status).toBe(401);
  });

  test('listar ou enviar para exame de outra clínica → 404 sem gravar', async () => {
    expect((await request(app).get(`/api/exames/${exameB}/arquivos`).set('Authorization', `Bearer ${token()}`)).status).toBe(404);
    const res = await enviar(exameB, PNG);
    expect(res.status).toBe(404);
    expect(gravou(/INSERT INTO exame_arquivos/)).toBe(false);
  });

  test('conteúdo que não é imagem/PDF/DICOM/ZIP → 415', async () => {
    const res = await enviar(exameA, Buffer.from('<html><script>alert(1)</script></html>'));
    expect(res.status).toBe(415);
    expect(gravou(/INSERT INTO exame_arquivos/)).toBe(false);
  });

  test('envio da própria clínica grava com tenant e devolve link assinado que abre', async () => {
    const res = await enviar(exameA, PNG);
    expect(res.status).toBe(200);
    const ins = sqlLog.find(q => /INSERT INTO exame_arquivos/.test(q.text));
    expect(ins.params[1]).toBe(tenantA);
    expect(ins.params[4]).toMatch(new RegExp(`^${tenantA}/[0-9a-f-]{36}\\.png$`));
    expect(ins.params[6]).toBe('image/png');
    expect(res.body.nome_original).toBe('panorâmica.png');
    expect(res.body.url).toMatch(/^\/api\/exame-arquivos\/[0-9a-f-]{36}\/conteudo\?t=.+&exp=\d+&sig=[0-9a-f]{64}$/);

    const abre = await request(app).get(res.body.url);
    expect(abre.status).toBe(200);
    expect(abre.headers['content-type']).toMatch(/image\/png/);
    expect(abre.headers['x-content-type-options']).toBe('nosniff');
    expect(abre.headers['cache-control']).toMatch(/private/);

    const baixa = await request(app).get(res.body.url_download);
    expect(baixa.headers['content-disposition']).toMatch(/^attachment/);

    // assinatura adulterada → 403
    const adulterado = res.body.url.replace(/sig=([0-9a-f])/, (_, c) => `sig=${c === 'a' ? 'b' : 'a'}`);
    expect((await request(app).get(adulterado)).status).toBe(403);
    // trocar a clínica no link invalida a assinatura
    expect((await request(app).get(res.body.url.replace(tenantA, tenantB))).status).toBe(403);
    // vencido → 403
    const vencido = res.body.url.replace(/exp=\d+/, 'exp=1000');
    expect((await request(app).get(vencido)).status).toBe(403);
    // sem assinatura e sem login → 401
    expect((await request(app).get(res.body.url.split('?')[0])).status).toBe(401);
    // Bearer de outra clínica → 404
    const outra = await request(app).get(res.body.url.split('?')[0]).set('Authorization', `Bearer ${token(tenantB)}`);
    expect(outra.status).toBe(404);
    // Bearer da própria clínica → 200
    const mesma = await request(app).get(res.body.url.split('?')[0]).set('Authorization', `Bearer ${token()}`);
    expect(mesma.status).toBe(200);
  });

  test('INSERT falhou → arquivo não fica no disco', async () => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'exames', tenantA);
    const antes = await readdir(dir).catch(() => []);
    const original = querySpy.getMockImplementation();
    querySpy.mockImplementation((sql, params) => (/INSERT INTO exame_arquivos/.test(String(sql))
      ? Promise.reject(new Error('permission denied for table exame_arquivos'))
      : original(sql, params)));
    const res = await enviar(exameA, PNG);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/permission/);
    expect((await readdir(dir).catch(() => [])).length).toBe(antes.length);
  });

  test('laudo finalizado: anexar ou tirar imagem → 409 sem gravar', async () => {
    exameLaudado = true;
    expect((await enviar(exameA, PNG)).status).toBe(409);
    const del = await request(app).delete(`/api/exames/${exameA}/arquivos/abababab-0000-4000-8000-000000000001`).set('Authorization', `Bearer ${token()}`);
    expect(del.status).toBe(409);
    expect(sqlLog.some(q => /INSERT INTO exame_arquivos|UPDATE exame_arquivos/.test(q.text))).toBe(false);
  });

  test('tirar arquivo do exame só marca removido_em (não apaga) e filtra a clínica', async () => {
    const arq = 'abababab-0000-4000-8000-000000000001';
    await request(app).delete(`/api/exames/${exameA}/arquivos/${arq}`).set('Authorization', `Bearer ${token()}`);
    const upd = sqlLog.find(q => /UPDATE exame_arquivos a SET removido_em/.test(q.text));
    expect(upd.params.slice(0, 3)).toEqual([arq, exameA, tenantA]);
    expect(gravou(/DELETE FROM exame_arquivos/)).toBe(false);
  });

  test('PATCH não aceita apontar arquivo_url para um caminho qualquer', async () => {
    const res = await request(app).patch(`/api/exames/${exameA}`).set('Authorization', `Bearer ${token()}`)
      .send({ arquivo_url: '/uploads/media/2026-01/00000000-0000-0000-0000-000000000000.png' });
    expect(res.status).toBe(400);
    expect(gravou(/UPDATE exames/)).toBe(false);
  });
});
