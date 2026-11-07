// Expurgo LGPD por prazo: o job só gera lista; nada é apagado sem aprovação e dry-run; isolamento
// entre clínicas; prontuário só com dentista. pool.query e pool.connect são mockados.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { assinarComPapel } from './helpers/papel-do-jwt.mjs';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const { processarExpurgoLgpd } = await import('../lgpd-expurgo.mjs');
const { classificar, novoColetor, avisoBackups, COLUNAS_REFERENCIA } = await import('../lgpd-arquivos.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const adminA = '44444444-4444-4444-4444-444444444444';
const dentistaA = '55555555-5555-5555-5555-555555555555'; // perfil vinculado a dentistas.user_id
const adminA2 = '66666666-6666-6666-6666-666666666666';
const listaA = 'aaaaaaaa-0000-0000-0000-000000000001';
const listaB = 'bbbbbbbb-0000-0000-0000-000000000001';
const token = (extra = {}) => assinarComPapel({ sub: adminA, email: 'admin@a.test', role: 'admin', tenant_id: tenantA, is_super_admin: false, ...extra }, JWT_SECRET);

const INV = {
  crm_leads: ['id', 'tenant_id', 'paciente_id', 'created_at', 'updated_at'],
  chat_messages: ['id', 'tenant_id', 'lead_id', 'timestamp', 'created_at', 'media_url'],
  automation_jobs: ['id', 'tenant_id', 'status', 'created_at'],
  acessos_prontuario: ['id', 'tenant_id', 'em'],
  lgpd_solicitacoes: ['id', 'tenant_id', 'solicitado_em', 'status'],
  pacientes: ['id', 'tenant_id', 'nome'],
};
let sqlLog, listas, itens, dentistaUser, semColunaUserId, spyQ, spyC, refsMidia, falharDelete, aindaCitado;
const assinatura = (its) => crypto.createHash('sha256').update(its.filter(i => i.aprovado).map(i => `${i.id}:${i.aprovado_em}`).sort().join('|')).digest('hex');

function responder(sql, params = []) {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  sqlLog.push({ text, params });
  if (/FROM information_schema\.columns/.test(text)) return { rows: Object.entries(INV).flatMap(([t, cs]) => cs.map(c => ({ table_name: t, column_name: c }))) };
  if (/FROM user_roles WHERE user_id/.test(text)) return { rows: [] };
  if (/FROM dentistas WHERE tenant_id = \$1 AND user_id = \$2::uuid/.test(text)) {
    if (semColunaUserId) throw Object.assign(new Error('column "user_id" does not exist'), { code: '42703' });
    return { rows: dentistaUser && params[1] === dentistaUser && params[0] === tenantA ? [{ id: 'd1' }] : [] };
  }
  if (/FROM dentistas/.test(text) && /email/.test(text)) throw new Error('dentista não pode ser identificado por e-mail');
  if (/^SELECT id FROM tenants WHERE/.test(text)) return { rows: [{ id: tenantA }, { id: tenantB }] };
  if (/^SELECT id FROM lgpd_expurgo_listas WHERE tenant_id = \$1 AND competencia = \$2/.test(text)) return { rows: [] };
  if (/^SELECT l\.id::text AS id FROM crm_leads/.test(text)) return { rows: [{ id: `lead-${params[0].slice(0, 4)}` }] };
  if (/^SELECT count\(\*\)::int AS n FROM/.test(text)) return { rows: [{ n: 3 }] };
  if (/^INSERT INTO lgpd_expurgo_listas/.test(text)) return { rows: [{ id: `lista-${params[0].slice(0, 4)}` }], rowCount: 1 };
  if (/^SELECT \* FROM lgpd_expurgo_listas WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
    const l = listas.find(x => x.id === params[0] && x.tenant_id === params[1]);
    return { rows: l ? [l] : [] };
  }
  if (/^SELECT \* FROM lgpd_expurgo_itens WHERE lista_id = \$1 AND tenant_id = \$2/.test(text)) {
    return { rows: itens.filter(i => i.lista_id === params[0] && i.tenant_id === params[1]) };
  }
  if (/^SELECT id, categoria, referencia/.test(text)) return { rows: itens.filter(i => i.lista_id === params[0] && i.tenant_id === params[1]) };
  if (/^SELECT i\.\*, l\.status AS lista_status FROM lgpd_expurgo_itens/.test(text)) {
    const i = itens.find(x => String(x.id) === params[0] && x.tenant_id === params[1]);
    return { rows: i ? [{ ...i, lista_status: listas.find(l => l.id === i.lista_id).status }] : [] };
  }
  if (/^UPDATE lgpd_expurgo_itens SET aprovado =/.test(text)) {
    const i = itens.find(x => String(x.id) === String(params[0]) && x.tenant_id === params[1]);
    if (i) { i.aprovado = params[2]; i.aprovado_por = params[3]; i.aprovado_papel = params[4]; i.aprovado_em = new Date().toISOString(); }
    return { rowCount: i ? 1 : 0, rows: [] };
  }
  if (/^UPDATE lgpd_expurgo_listas SET dry_run =/.test(text)) {
    const l = listas.find(x => x.id === params[0] && x.tenant_id === params[1]);
    if (l) { l.dry_run_em = new Date().toISOString(); l.dry_run_assinatura = params[4]; }
    return { rowCount: 1, rows: [] };
  }
  if (/^UPDATE lgpd_expurgo_listas SET status = 'executada'/.test(text)) {
    const l = listas.find(x => x.id === params[0] && x.tenant_id === params[1]);
    if (l) l.status = 'executada';
    return { rowCount: 1, rows: [] };
  }
  if (/^SELECT "media_url" FROM "chat_messages"/.test(text)) return { rows: refsMidia.map(m => ({ media_url: m })) };
  // Verificação "ainda citado por outra linha" (depois do COMMIT): aindaCitado = tabela que ainda cita
  if (/FROM unnest\(\$1::text\[\]\) WITH ORDINALITY/.test(text)) {
    return { rows: aindaCitado && text.includes(`FROM "${aindaCitado}"`) ? params[0].map((_, i) => ({ i: i + 1 })) : [] };
  }
  if (/^DELETE/.test(text)) { if (falharDelete) throw Object.assign(new Error('falha simulada'), { code: 'XX000' }); return { rowCount: 3, rows: [] }; }
  return { rows: [], rowCount: 0 };
}
const deletes = () => sqlLog.filter(q => /^DELETE/.test(q.text));
const corte = '2025-11-05T00:00:00.000Z';
const novoItem = (extra) => ({ id: itens.length + 1, lista_id: listaA, tenant_id: tenantA, categoria: 'fila', referencia: null, quantidade: 3, corte, acao: 'eliminar', aprovado: false, ...extra });

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  sqlLog = []; dentistaUser = null; semColunaUserId = false; refsMidia = []; falharDelete = false; aindaCitado = null;
  listas = [
    { id: listaA, tenant_id: tenantA, status: 'pendente' },
    { id: listaB, tenant_id: tenantB, status: 'pendente' },
  ];
  itens = [];
  itens.push(novoItem({ categoria: 'fila' }));
  itens.push(novoItem({ categoria: 'prontuario', referencia: '33333333-3333-3333-3333-333333333333', acao: 'eliminar' }));
  itens.push({ ...novoItem({ categoria: 'fila' }), lista_id: listaB, tenant_id: tenantB });
  spyQ = jest.spyOn(pool, 'query').mockImplementation(async (s, p) => responder(s, p));
  spyC = jest.spyOn(pool, 'connect').mockImplementation(async () => ({ query: async (s, p) => responder(s, p), release: () => {} }));
});
afterEach(() => { spyQ.mockRestore(); spyC.mockRestore(); });
afterAll(async () => { await pool.end(); });

const chamar = (m, url, tk, body) => { const r = request(app)[m](url).set('Authorization', `Bearer ${tk}`); return body ? r.send(body) : r; };

test('a tela chama os caminhos sem /api (VPS_API_BASE já termina em /api)', () => {
  const tela = fs.readFileSync(path.join(__dirname, '../../src/routes/lgpd-expurgo.tsx'), 'utf8');
  expect(tela).not.toMatch(/vpsApiFetch[^(]*\(\s*[`"']\/api\//);
  expect((tela.match(/[`"']\/lgpd\/expurgo\//g) || []).length).toBe(6);
});

describe('job mensal', () => {
  test('só gera lista, uma por clínica, e nunca apaga', async () => {
    await processarExpurgoLgpd(pool);
    expect(deletes()).toHaveLength(0);
    const ins = sqlLog.filter(q => /^INSERT INTO lgpd_expurgo_listas/.test(q.text));
    expect(ins.map(q => q.params[0]).sort()).toEqual([tenantA, tenantB]);
    // toda contagem é da própria clínica
    for (const c of sqlLog.filter(q => /^SELECT count\(\*\)::int AS n FROM/.test(q.text))) {
      if (/tag_assignments/.test(c.text)) continue;
      expect(c.text).toMatch(/tenant_id = \$1/);
      expect([tenantA, tenantB]).toContain(c.params[0]);
    }
    // corte de leads: 2 anos; fila: 1 ano (fixado na lista)
    const itensIns = sqlLog.filter(q => /^INSERT INTO lgpd_expurgo_itens/.test(q.text));
    const fila = itensIns.find(q => q.params[2] === 'fila');
    const anos = (Date.now() - new Date(fila.params[6]).getTime()) / (365.25 * 86400000);
    expect(Math.round(anos)).toBe(1);
  });
});

describe('aprovação e execução', () => {
  test('nada é apagado sem aprovação', async () => {
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'ELIMINAR' });
    expect(res.status).toBe(409);
    expect(deletes()).toHaveLength(0);
  });

  test('aprovado mas sem dry-run: 409 e nada apagado', async () => {
    await chamar('post', '/api/lgpd/expurgo/itens/1/aprovar', token(), { aprovar: true });
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'ELIMINAR' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/dry-run/);
    expect(deletes()).toHaveLength(0);
  });

  test('aprovação mudou depois do dry-run: 409 e nada apagado', async () => {
    await chamar('post', '/api/lgpd/expurgo/itens/1/aprovar', token(), { aprovar: true });
    await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/dry-run`, token());
    itens[0].aprovado_em = new Date(Date.now() + 5000).toISOString(); // reaprovado depois
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'ELIMINAR' });
    expect(res.status).toBe(409);
    expect(deletes()).toHaveLength(0);
  });

  test('sem a frase ELIMINAR: 422', async () => {
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), {});
    expect(res.status).toBe(422);
  });

  test('aprovado + dry-run + frase: apaga só o aprovado, na clínica, com o corte da lista', async () => {
    await chamar('post', '/api/lgpd/expurgo/itens/1/aprovar', token(), { aprovar: true });
    const dr = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/dry-run`, token());
    expect(dr.status).toBe(200);
    expect(deletes()).toHaveLength(0); // dry-run não apaga
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'eliminar' });
    expect(res.status).toBe(200);
    const d = deletes();
    expect(d.length).toBeGreaterThan(0);
    for (const x of d) {
      expect(x.text).toMatch(/automation_jobs|reactivation_sends/);
      expect(x.params[0]).toBe(tenantA);
      expect(new Date(x.params[1]).toISOString()).toBe(corte);
    }
    // item de prontuário não aprovado não foi tocado
    expect(sqlLog.some(q => /DELETE FROM pacientes/.test(q.text))).toBe(false);
    expect(sqlLog.some(q => /^UPDATE lgpd_expurgo_listas SET status = 'executada'/.test(q.text))).toBe(true);
  });
});

describe('papéis e isolamento', () => {
  test('clínica A não vê nem executa a lista da B', async () => {
    expect((await chamar('get', `/api/lgpd/expurgo/listas/${listaB}`, token())).status).toBe(404);
    expect((await chamar('post', `/api/lgpd/expurgo/listas/${listaB}/dry-run`, token())).status).toBe(404);
    expect((await chamar('post', `/api/lgpd/expurgo/listas/${listaB}/executar`, token(), { frase: 'ELIMINAR' })).status).toBe(404);
    expect((await chamar('post', '/api/lgpd/expurgo/itens/3/aprovar', token(), { aprovar: true })).status).toBe(404);
    expect(itens[2].aprovado).toBe(false);
    expect(deletes()).toHaveLength(0);
  });

  test('prontuário: admin que não é dentista não aprova; dentista da clínica aprova', async () => {
    const r1 = await chamar('post', '/api/lgpd/expurgo/itens/2/aprovar', token(), { aprovar: true });
    expect(r1.status).toBe(403);
    expect(itens[1].aprovado).toBe(false);
    dentistaUser = dentistaA;
    const r2 = await chamar('post', '/api/lgpd/expurgo/itens/2/aprovar', token({ role: 'dentista', email: 'dra@a.test', sub: dentistaA }), { aprovar: true });
    expect(r2.status).toBe(200);
    expect(itens[1].aprovado_papel).toBe('dentista');
  });

  test('dentista não aprova categoria em massa; quem não é admin nem dentista: 403', async () => {
    dentistaUser = dentistaA;
    expect((await chamar('post', '/api/lgpd/expurgo/itens/1/aprovar', token({ role: 'dentista', email: 'dra@a.test', sub: dentistaA }), { aprovar: true })).status).toBe(403);
    expect((await chamar('get', '/api/lgpd/expurgo/listas', token({ role: 'recepcionista' }))).status).toBe(403);
  });

  test('dentista é o perfil vinculado (dentistas.user_id), não quem tem o mesmo e-mail', async () => {
    dentistaUser = dentistaA;
    // perfil com o e-mail do dentista (trocou o próprio e-mail), mas sem vínculo: não é dentista
    const r = await chamar('post', '/api/lgpd/expurgo/itens/2/aprovar', token({ role: 'dentista', email: 'dra@a.test', sub: adminA2 }), { aprovar: true });
    expect(r.status).toBe(403);
    expect(itens[1].aprovado).toBe(false);
    const q = sqlLog.find(x => /FROM dentistas/.test(x.text));
    expect(q.params).toEqual([tenantA, adminA2]);
  });

  test('coluna dentistas.user_id ainda não criada: ninguém aprova prontuário (falha fechada)', async () => {
    dentistaUser = dentistaA; semColunaUserId = true;
    const r = await chamar('post', '/api/lgpd/expurgo/itens/2/aprovar', token({ role: 'dentista', email: 'dra@a.test', sub: dentistaA }), { aprovar: true });
    expect(r.status).toBe(403);
    expect(itens[1].aprovado).toBe(false);
  });

  test('prontuário exige duas pessoas: quem aprovou não executa; outra pessoa executa', async () => {
    dentistaUser = dentistaA;
    const tkDent = token({ role: 'dentista', email: 'dra@a.test', sub: dentistaA });
    expect((await chamar('post', '/api/lgpd/expurgo/itens/2/aprovar', tkDent, { aprovar: true })).status).toBe(200);
    expect(itens[1].aprovado_por).toBe(dentistaA);
    expect((await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/dry-run`, tkDent)).status).toBe(200);
    const mesma = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, tkDent, { frase: 'ELIMINAR' });
    expect(mesma.status).toBe(409);
    expect(mesma.body.error).toMatch(/duas pessoas/);
    expect(deletes()).toHaveLength(0);
    const outra = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'ELIMINAR' });
    expect(outra.body.error || '').not.toMatch(/duas pessoas/);
  });

  test('super-admin da plataforma não opera o expurgo da clínica', async () => {
    const res = await request(app).get('/api/lgpd/expurgo/listas')
      .set('Authorization', `Bearer ${token({ tenant_id: null, is_super_admin: true })}`).set('X-Tenant-Id', tenantA);
    expect(res.status).toBe(403);
  });

  test('aprovação de prontuário feita por admin (fora da regra) é recusada na execução', async () => {
    itens[1].aprovado = true; itens[1].aprovado_papel = 'admin'; itens[1].aprovado_em = 'x';
    listas[0].dry_run_em = new Date().toISOString();
    listas[0].dry_run_assinatura = assinatura(itens.filter(i => i.lista_id === listaA));
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'ELIMINAR' });
    expect(res.status).toBe(409);
    expect(deletes()).toHaveLength(0);
  });
});

describe('arquivos, backups e idade (parecer do #76)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgpd-uploads-'));
    process.env.LGPD_UPLOADS_DIR = dir;
    fs.mkdirSync(path.join(dir, '2026-11'));
    fs.writeFileSync(path.join(dir, '2026-11', 'foto.jpg'), 'x');
  });
  afterEach(() => { delete process.env.LGPD_UPLOADS_DIR; fs.rmSync(dir, { recursive: true, force: true }); });

  test('classifica: arquivo local, caminho fora de uploads, link externo e conteúdo inline', () => {
    expect(classificar('/uploads/media/2026-11/foto.jpg')).toEqual({ tipo: 'local', abs: path.join(dir, '2026-11', 'foto.jpg') });
    expect(classificar('https://api.exemplo.test/uploads/media/2026-11/foto.jpg').tipo).toBe('local');
    expect(classificar('/uploads/media/../../etc/passwd')).toEqual({ tipo: 'externo', host: 'caminho fora de uploads' });
    expect(classificar('https://mmg.whatsapp.net/v/abc.enc')).toEqual({ tipo: 'externo', host: 'mmg.whatsapp.net' });
    expect(classificar('data:image/png;base64,AAAA')).toBeNull();
  });

  test('coletor apaga o local e lista o que não alcançou, só por contagem e host', async () => {
    const c = novoColetor();
    const db = { query: async (sql) => (/unnest/.test(sql) ? { rows: [] } : { rows: [{ media_url: '/uploads/media/2026-11/foto.jpg' }, { media_url: 'https://mmg.whatsapp.net/x.enc' }] }) };
    await c.coletar(db, { tabela: 'chat_messages', where: 'tenant_id = $1', params: [tenantA] });
    expect(c.previa()).toEqual({ arquivos_locais: 1, nao_alcancados: { 'mmg.whatsapp.net': 1 } });
    const r = await c.apagar(db);
    expect(r.arquivos_apagados).toBe(1);
    expect(r.nao_alcancados).toEqual({ total: 1, por_host: { 'mmg.whatsapp.net': 1 } });
    expect(r.acao_manual).toMatch(/Evolution/);
    expect(fs.existsSync(path.join(dir, '2026-11', 'foto.jpg'))).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/foto\.jpg/);
  });

  // Revisão do Igor no #76: o coletor apagava qualquer /uploads/media citado na linha que sai, sem ver
  // se outra linha (da mesma ou de outra clínica) usava o arquivo.
  const coletarFoto = async () => {
    const c = novoColetor();
    await c.coletar({ query: async () => ({ rows: [{ media_url: '/uploads/media/2026-11/foto.jpg' }] }) },
      { tabela: 'chat_messages', where: 'tenant_id = $1', params: [tenantA] });
    return c;
  };

  test('arquivo ainda citado por outra linha (qualquer clínica) NÃO é apagado', async () => {
    const c = await coletarFoto();
    const consultas = [];
    const db = { query: async (sql, params) => {
      consultas.push({ sql, params });
      // outra mensagem (ex.: de outra clínica, gravada com a mesma URL) ainda cita o arquivo
      return /FROM "chat_messages"/.test(sql) ? { rows: [{ i: 1 }] } : { rows: [] };
    } };
    const r = await c.apagar(db);
    expect(r).toMatchObject({ arquivos_apagados: 0, arquivos_mantidos_em_uso: 1 });
    expect(fs.existsSync(path.join(dir, '2026-11', 'foto.jpg'))).toBe(true);
    // a busca não filtra por clínica (tem que enxergar todas) e procura pelo caminho relativo
    const q = consultas.find(x => /FROM "chat_messages"/.test(x.sql));
    expect(q.sql).not.toMatch(/tenant_id/);
    expect(q.params[0]).toEqual(['%2026-11/foto.jpg%']);
  });

  test('confere todas as colunas de referência, inclusive avatares', async () => {
    const c = await coletarFoto();
    const tabelas = [];
    await c.apagar({ query: async (sql) => { tabelas.push(/FROM "([a-z_]+)" x/.exec(sql)?.[1]); return { rows: [] }; } });
    expect(tabelas).toEqual(COLUNAS_REFERENCIA.map(([t]) => t));
    expect(COLUNAS_REFERENCIA).toEqual(expect.arrayContaining([['profiles', 'avatar_url'], ['exames', 'arquivo_url'], ['prontuarios', 'anexos']]));
  });

  test('tabela/coluna ausente é ignorada; outro erro na verificação → nada sai do disco', async () => {
    const c1 = await coletarFoto();
    const r1 = await c1.apagar({ query: async (sql) => { if (/clinical_reports/.test(sql)) throw Object.assign(new Error('x'), { code: '42P01' }); return { rows: [] }; } });
    expect(r1.arquivos_apagados).toBe(1);
    fs.writeFileSync(path.join(dir, '2026-11', 'foto.jpg'), 'x');
    const c2 = await coletarFoto();
    const r2 = await c2.apagar({ query: async () => { throw Object.assign(new Error('timeout'), { code: '57014' }); } });
    expect(r2).toMatchObject({ arquivos_apagados: 0, arquivos_nao_verificados: 1 });
    expect(r2.aviso_arquivos).toMatch(/nenhum foi apagado/);
    expect(fs.existsSync(path.join(dir, '2026-11', 'foto.jpg'))).toBe(true);
    const c3 = await coletarFoto();
    expect((await c3.apagar()).arquivos_apagados).toBe(0); // sem db: falha fechada
    expect(fs.existsSync(path.join(dir, '2026-11', 'foto.jpg'))).toBe(true);
  });

  test('execução: mídia compartilhada com outra linha fica no disco e o registro diz por quê', async () => {
    refsMidia = ['/uploads/media/2026-11/foto.jpg'];
    aindaCitado = 'chat_messages';
    itens.push({ ...itens[0], id: 4, categoria: 'conversas' });
    await chamar('post', '/api/lgpd/expurgo/itens/4/aprovar', token(), { aprovar: true });
    await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/dry-run`, token());
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'ELIMINAR' });
    expect(res.status).toBe(200);
    expect(res.body.resultado['4'].arquivos).toMatchObject({ arquivos_apagados: 0, arquivos_mantidos_em_uso: 1 });
    expect(fs.existsSync(path.join(dir, '2026-11', 'foto.jpg'))).toBe(true);
  });

  test('backups: data prevista = execução + 6 meses', () => {
    const b = avisoBackups(new Date('2026-11-05T12:00:00Z'));
    expect(b.previsto_ate.slice(0, 7)).toBe('2027-05');
    expect(b.texto).toMatch(/rotação normal dos backups/);
  });

  test('execução: conversas aprovadas apagam o arquivo ligado depois do commit e registram backups', async () => {
    refsMidia = ['/uploads/media/2026-11/foto.jpg', 'https://mmg.whatsapp.net/x.enc'];
    itens.push({ ...itens[0], id: 4, categoria: 'conversas' });
    await chamar('post', '/api/lgpd/expurgo/itens/4/aprovar', token(), { aprovar: true });
    const dr = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/dry-run`, token());
    expect(dr.body.dry_run['4']).toMatchObject({ arquivos_locais: 1, nao_alcancados: { 'mmg.whatsapp.net': 1 } });
    expect(fs.existsSync(path.join(dir, '2026-11', 'foto.jpg'))).toBe(true); // dry-run não apaga
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'ELIMINAR' });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(dir, '2026-11', 'foto.jpg'))).toBe(false);
    expect(res.body.resultado['4'].arquivos).toMatchObject({ arquivos_apagados: 1, nao_alcancados: { total: 1 } });
    expect(res.body.backups.texto).toMatch(/backups/);
    const reg = sqlLog.filter(q => /^UPDATE lgpd_expurgo_listas SET (status = 'executada'|resultado)/.test(q.text));
    expect(reg.some(q => /previsto_ate/.test(q.params[3] || q.params[2]))).toBe(true);
  });

  test('se a eliminação falha, nenhum arquivo sai do disco', async () => {
    refsMidia = ['/uploads/media/2026-11/foto.jpg'];
    itens.push({ ...itens[0], id: 4, categoria: 'conversas' });
    await chamar('post', '/api/lgpd/expurgo/itens/4/aprovar', token(), { aprovar: true });
    await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/dry-run`, token());
    falharDelete = true;
    const res = await chamar('post', `/api/lgpd/expurgo/listas/${listaA}/executar`, token(), { frase: 'ELIMINAR' });
    expect(res.status).toBe(500);
    expect(fs.existsSync(path.join(dir, '2026-11', 'foto.jpg'))).toBe(true);
  });

  test('prontuário sem data de nascimento: dentista precisa confirmar a idade para aprovar', async () => {
    dentistaUser = dentistaA;
    itens[1].detalhe = { alertas: ['idade_desconhecida'], alerta: 'Idade desconhecida' };
    const tk = token({ role: 'dentista', email: 'dra@a.test', sub: dentistaA });
    const r1 = await chamar('post', '/api/lgpd/expurgo/itens/2/aprovar', tk, { aprovar: true });
    expect(r1.status).toBe(422);
    expect(r1.body.exige).toBe('confirmo_idade');
    expect(itens[1].aprovado).toBe(false);
    const r2 = await chamar('post', '/api/lgpd/expurgo/itens/2/aprovar', tk, { aprovar: true, confirmo_idade: true });
    expect(r2.status).toBe(200);
    expect(itens[1].aprovado).toBe(true);
    const upd = sqlLog.filter(q => /^UPDATE lgpd_expurgo_itens SET aprovado =/.test(q.text)).pop();
    expect(upd.text).toMatch(/idade_confirmada_por = \$4, idade_confirmada_em = NOW\(\)/);
    expect(upd.params[3]).toBe(dentistaA);
  });
});
