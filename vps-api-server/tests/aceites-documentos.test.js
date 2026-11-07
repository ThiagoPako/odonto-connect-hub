// Aceite de documentos legais: prova em aceites_documentos, pendências de versão nova, isolamento.
// pool.query e pool.connect são mockados; nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { assinarComPapel } from './helpers/papel-do-jwt.mjs';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const { hashTexto } = await import('../legal.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const adminA = '44444444-4444-4444-4444-444444444444';
const token = (extra = {}) => assinarComPapel({ sub: adminA, email: 'admin@a.test', role: 'admin', tenant_id: tenantA, is_super_admin: false, ...extra }, JWT_SECRET);

const dias = (n) => new Date(Date.now() + n * 86400000).toISOString();
let sqlLog, versoes, aceites, spyQ, spyC;

function responder(sql, params = []) {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  sqlLog.push({ text, params });
  if (/FROM user_roles WHERE user_id/.test(text)) return { rows: [] };
  if (/^SELECT documento, versao, hash_texto, avisado_em, vigente_em FROM documentos_legais_versoes/.test(text)) {
    return { rows: versoes.filter(v => params[0].includes(v.documento)).sort((a, b) => (a.vigente_em < b.vigente_em ? 1 : -1)) };
  }
  if (/^SELECT documento, versao, hash_texto, vigente_em <= NOW\(\) AS em_vigor/.test(text)) {
    return { rows: versoes.filter(v => params[0].includes(v.documento))
      .map(v => ({ ...v, em_vigor: new Date(v.vigente_em) <= new Date() }))
      .sort((a, b) => (a.vigente_em < b.vigente_em ? 1 : -1)) };
  }
  if (/^SELECT DISTINCT documento, versao, hash_texto FROM aceites_documentos WHERE tenant_id = \$1/.test(text)) {
    return { rows: aceites.filter(a => a.tenant_id === params[0]) };
  }
  if (/^SELECT hash_texto FROM documentos_legais_versoes WHERE documento = \$1 AND versao = \$2/.test(text)) {
    const v = versoes.find(x => x.documento === params[0] && x.versao === params[1]);
    return { rows: v ? [{ hash_texto: v.hash_texto }] : [] };
  }
  if (/^INSERT INTO aceites_documentos/.test(text)) {
    aceites.push({ tenant_id: params[0], usuario_id: params[1], documento: params[2], versao: params[3], hash_texto: params[4] });
    return { rows: [{ id: 1, documento: params[2], versao: params[3], hash_texto: params[4], aceito_em: new Date().toISOString() }], rowCount: 1 };
  }
  if (/^INSERT INTO documentos_legais_versoes/.test(text)) {
    if (versoes.some(v => v.documento === params[0] && v.versao === params[1])) return { rows: [], rowCount: 0 };
    return { rows: [{ documento: params[0], versao: params[1], hash_texto: params[3], vigente_em: dias(Number(params[4])) }], rowCount: 1 };
  }
  // signup
  if (/FROM profiles/.test(text) && /email/.test(text)) return { rows: [] };
  if (/FROM plans WHERE slug/.test(text)) return { rows: [{ id: 'p1', slug: 'starter', trial_days: 14 }] };
  if (/^SELECT 1 FROM tenants WHERE slug/.test(text)) return { rows: [], rowCount: 0 };
  if (/^INSERT INTO tenants/.test(text)) return { rows: [{ id: tenantB, nome: params[0] }] };
  if (/^INSERT INTO profiles/.test(text)) return { rows: [{ id: '55555555-5555-5555-5555-555555555555', name: params[0], email: params[1], role: 'admin', tenant_id: tenantB }] };
  return { rows: [], rowCount: 1 };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  sqlLog = []; aceites = [];
  versoes = [
    { documento: 'termos', versao: '1.0', hash_texto: null, avisado_em: '2026-11-04', vigente_em: '2026-11-04T03:00:00Z' },
    { documento: 'politica', versao: '1.0', hash_texto: null, avisado_em: '2026-11-04', vigente_em: '2026-11-04T03:00:00Z' },
  ];
  spyQ = jest.spyOn(pool, 'query').mockImplementation(async (s, p) => responder(s, p));
  spyC = jest.spyOn(pool, 'connect').mockImplementation(async () => ({ query: async (s, p) => responder(s, p), release: () => {} }));
});
afterEach(() => { spyQ.mockRestore(); spyC.mockRestore(); });
afterAll(async () => { await pool.end(); });

describe('cadastro da clínica', () => {
  test('grava um aceite por documento em aceites_documentos, com hash e IP, e mantém as colunas de tenants', async () => {
    versoes[0].hash_texto = hashTexto('Termos de uso versão 1.0 ...');
    const res = await request(app).post('/api/auth/signup-clinic').set('X-Forwarded-For', '10.0.0.1, 203.0.113.7')
      .send({ clinic_name: 'Clínica Nova', admin_name: 'Admin', email: 'novo@b.test', password: 'senha-forte-1', termos_versao: '1.0', politica_versao: '1.0' });
    expect(res.status).toBe(200);
    const ins = sqlLog.filter(q => /^INSERT INTO aceites_documentos/.test(q.text));
    expect(ins.map(q => q.params[2]).sort()).toEqual(['politica', 'termos']);
    const termos = ins.find(q => q.params[2] === 'termos');
    expect(termos.params[0]).toBe(tenantB);
    expect(termos.params[4]).toBe(versoes[0].hash_texto);
    expect(termos.params[5]).toBe('203.0.113.7');
    expect(sqlLog.find(q => /^INSERT INTO tenants/.test(q.text)).text).toMatch(/termos_versao, politica_versao/);
    expect(sqlLog.some(q => /SAVEPOINT aceite_documento/.test(q.text))).toBe(true);
  });

  test('IP do aceite não vem do 1º valor do X-Forwarded-For (forjável): usa o IP visto pelo proxy confiável', async () => {
    const res = await request(app).post('/api/auth/signup-clinic').set('X-Forwarded-For', '6.6.6.6, 203.0.113.50')
      .send({ clinic_name: 'Clínica Nova', admin_name: 'Admin', email: 'ip@b.test', password: 'senha-forte-1', termos_versao: '1.0', politica_versao: '1.0' });
    expect(res.status).toBe(200);
    const ips = sqlLog.filter(q => /^INSERT INTO aceites_documentos/.test(q.text)).map(q => q.params[5]);
    expect(ips).toEqual(['203.0.113.50', '203.0.113.50']);
  });

  test('versão não publicada no body: 400 com mensagem clara, sem criar a clínica', async () => {
    const res = await request(app).post('/api/auth/signup-clinic')
      .send({ clinic_name: 'Clínica Nova', admin_name: 'Admin', email: 'v9@b.test', password: 'senha-forte-1', termos_versao: '9.9', politica_versao: '1.0' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/9\.9 dos Termos de Uso não é a publicada \(em vigor: 1\.0\)/);
    expect(sqlLog.some(q => /^INSERT INTO (tenants|aceites_documentos)/.test(q.text))).toBe(false);
  });

  test('versão publicada mas já substituída pela vigente: 400', async () => {
    versoes.push({ documento: 'politica', versao: '2.0', hash_texto: 'hp2', avisado_em: dias(-31), vigente_em: dias(-1) });
    const res = await request(app).post('/api/auth/signup-clinic')
      .send({ clinic_name: 'Clínica Nova', admin_name: 'Admin', email: 'velha@b.test', password: 'senha-forte-1', termos_versao: '1.0', politica_versao: '1.0' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/da Política de Privacidade não é a publicada \(em vigor: 2\.0\)/);
    expect(sqlLog.some(q => /^INSERT INTO tenants/.test(q.text))).toBe(false);
  });

  test('versão nova ainda no aviso de 30 dias: o cadastro pode aceitá-la (com o hash dela)', async () => {
    versoes.push({ documento: 'termos', versao: '2.0', hash_texto: 'ht2', avisado_em: dias(-5), vigente_em: dias(25) });
    const res = await request(app).post('/api/auth/signup-clinic')
      .send({ clinic_name: 'Clínica Nova', admin_name: 'Admin', email: 'v2@b.test', password: 'senha-forte-1', termos_versao: '2.0', politica_versao: '1.0' });
    expect(res.status).toBe(200);
    const termos = sqlLog.find(q => /^INSERT INTO aceites_documentos/.test(q.text) && q.params[2] === 'termos');
    expect(termos.params.slice(2, 5)).toEqual(['termos', '2.0', 'ht2']);
  });

  test('multi-clínica: tenant_id/usuario_id do body são ignorados; vale a clínica criada', async () => {
    const res = await request(app).post('/api/auth/signup-clinic').set('X-Tenant-Id', tenantA)
      .send({ clinic_name: 'Clínica Nova', admin_name: 'Admin', email: 'mt@b.test', password: 'senha-forte-1', termos_versao: '1.0', politica_versao: '1.0', tenant_id: tenantA, usuario_id: adminA });
    expect(res.status).toBe(200);
    const ins = sqlLog.filter(q => /^INSERT INTO aceites_documentos/.test(q.text));
    expect(ins).toHaveLength(2);
    for (const q of ins) expect(q.params.slice(0, 2)).toEqual([tenantB, '55555555-5555-5555-5555-555555555555']);
  });

  test('tabela de aceites ausente (migração pendente) não derruba o cadastro', async () => {
    spyC.mockImplementation(async () => ({
      query: async (s, p) => {
        if (/INSERT INTO aceites_documentos/.test(String(s))) throw Object.assign(new Error('relation "aceites_documentos" does not exist'), { code: '42P01' });
        return responder(s, p);
      },
      release: () => {},
    }));
    const res = await request(app).post('/api/auth/signup-clinic')
      .send({ clinic_name: 'Clínica Nova', admin_name: 'Admin', email: 'novo2@b.test', password: 'senha-forte-1', termos_versao: '1.0', politica_versao: '1.0' });
    expect(res.status).toBe(200);
    expect(sqlLog.some(q => /ROLLBACK TO SAVEPOINT aceite_documento/.test(q.text))).toBe(true);
    expect(sqlLog.some(q => q.text === 'COMMIT')).toBe(true);
  });
});

describe('GET /api/legal/pendencias', () => {
  test('sem aceite da versão vigente: pendente, e o admin precisa aceitar', async () => {
    const res = await request(app).get('/api/legal/pendencias').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.pendentes.map(p => p.documento).sort()).toEqual(['politica', 'termos']);
    expect(res.body.precisa_aceitar).toBe(true);
    const q = sqlLog.find(x => /FROM aceites_documentos WHERE tenant_id = \$1/.test(x.text));
    expect(q.params[0]).toBe(tenantA);
  });

  test('v2 avisada há menos de 30 dias: só aviso; a v1 aceita segue valendo', async () => {
    aceites.push({ tenant_id: tenantA, documento: 'termos', versao: '1.0' }, { tenant_id: tenantA, documento: 'politica', versao: '1.0' });
    versoes.push({ documento: 'termos', versao: '2.0', hash_texto: 'h2', avisado_em: dias(-10), vigente_em: dias(20) });
    const res = await request(app).get('/api/legal/pendencias').set('Authorization', `Bearer ${token()}`);
    expect(res.body.pendentes).toEqual([]);
    expect(res.body.avisos).toEqual([expect.objectContaining({ documento: 'termos', versao: '2.0' })]);
    expect(res.body.precisa_aceitar).toBe(false);
  });

  test('passados os 30 dias, a v2 fica pendente no primeiro login', async () => {
    aceites.push({ tenant_id: tenantA, documento: 'termos', versao: '1.0' }, { tenant_id: tenantA, documento: 'politica', versao: '1.0' });
    versoes.push({ documento: 'termos', versao: '2.0', hash_texto: 'h2', avisado_em: dias(-31), vigente_em: dias(-1) });
    const res = await request(app).get('/api/legal/pendencias').set('Authorization', `Bearer ${token()}`);
    expect(res.body.pendentes).toEqual([expect.objectContaining({ documento: 'termos', versao: '2.0', hash_texto: 'h2' })]);
    expect(res.body.precisa_aceitar).toBe(true);
  });

  test('aceite da versão vigente com hash diferente do publicado não conta: continua pendente', async () => {
    versoes.push({ documento: 'termos', versao: '2.0', hash_texto: 'hash-certo', avisado_em: dias(-31), vigente_em: dias(-1) });
    aceites.push({ tenant_id: tenantA, documento: 'termos', versao: '2.0', hash_texto: 'hash-outro' },
      { tenant_id: tenantA, documento: 'politica', versao: '1.0', hash_texto: null });
    const res = await request(app).get('/api/legal/pendencias').set('Authorization', `Bearer ${token()}`);
    expect(res.body.pendentes).toEqual([expect.objectContaining({ documento: 'termos', versao: '2.0', hash_texto: 'hash-certo' })]);
  });

  test('aceite de outra clínica não conta', async () => {
    aceites.push({ tenant_id: tenantB, documento: 'termos', versao: '1.0' }, { tenant_id: tenantB, documento: 'politica', versao: '1.0' });
    const res = await request(app).get('/api/legal/pendencias').set('Authorization', `Bearer ${token()}`);
    expect(res.body.pendentes).toHaveLength(2);
  });

  test('usuário que não é admin vê a pendência mas não precisa aceitar', async () => {
    const res = await request(app).get('/api/legal/pendencias').set('Authorization', `Bearer ${token({ role: 'dentista' })}`);
    expect(res.body.pendentes).toHaveLength(2);
    expect(res.body.precisa_aceitar).toBe(false);
    expect(res.body.pode_aceitar).toBe(false);
  });
});

describe('POST /api/legal/aceites', () => {
  test('admin aceita: grava na clínica dele com o hash da versão e atualiza tenants', async () => {
    versoes.push({ documento: 'termos', versao: '2.0', hash_texto: 'hash-v2', avisado_em: dias(-31), vigente_em: dias(-1) });
    const res = await request(app).post('/api/legal/aceites').set('Authorization', `Bearer ${token()}`)
      .set('X-Forwarded-For', '198.51.100.2').send({ documento: 'termos', versao: '2.0', tenantId: tenantB });
    expect(res.status).toBe(201);
    const ins = sqlLog.find(q => /^INSERT INTO aceites_documentos/.test(q.text));
    expect(ins.params.slice(0, 6)).toEqual([tenantA, adminA, 'termos', '2.0', 'hash-v2', '198.51.100.2']);
    const upd = sqlLog.find(q => /^UPDATE tenants SET termos_versao/.test(q.text));
    expect(upd.params).toEqual([tenantA, '2.0', '198.51.100.2']);
  });

  test('multi-clínica: grava a clínica e o usuário do token, não os do body nem do X-Tenant-Id; IP forjado no XFF ignorado', async () => {
    const res = await request(app).post('/api/legal/aceites').set('Authorization', `Bearer ${token()}`)
      .set('X-Tenant-Id', tenantB).set('X-Forwarded-For', '6.6.6.6, 198.51.100.9')
      .send({ documento: 'termos', versao: '1.0', tenant_id: tenantB, usuario_id: '99999999-9999-9999-9999-999999999999' });
    expect(res.status).toBe(201);
    const ins = sqlLog.find(q => /^INSERT INTO aceites_documentos/.test(q.text));
    expect(ins.params.slice(0, 2)).toEqual([tenantA, adminA]);
    expect(ins.params[5]).toBe('198.51.100.9');
    expect(aceites.filter(a => a.tenant_id === tenantB)).toHaveLength(0);
  });

  test('tenants sem as colunas antigas: o aceite vale do mesmo jeito', async () => {
    spyC.mockImplementation(async () => ({
      query: async (sq, p) => {
        if (/^UPDATE tenants SET/.test(String(sq).trim())) throw Object.assign(new Error('column "termos_versao" does not exist'), { code: '42703' });
        return responder(sq, p);
      },
      release: () => {},
    }));
    const res = await request(app).post('/api/legal/aceites').set('Authorization', `Bearer ${token()}`).send({ documento: 'termos', versao: '1.0' });
    expect(res.status).toBe(201);
    expect(sqlLog.some(q => /ROLLBACK TO SAVEPOINT aceite_tenants/.test(q.text))).toBe(true);
    expect(sqlLog.some(q => q.text === 'COMMIT')).toBe(true);
  });

  test('versão não publicada: 404 sem gravar', async () => {
    const res = await request(app).post('/api/legal/aceites').set('Authorization', `Bearer ${token()}`).send({ documento: 'termos', versao: '9.9' });
    expect(res.status).toBe(404);
    expect(sqlLog.some(q => /^INSERT INTO aceites_documentos/.test(q.text))).toBe(false);
  });

  test('documento inválido 400; não admin 403; super-admin 403', async () => {
    expect((await request(app).post('/api/legal/aceites').set('Authorization', `Bearer ${token()}`).send({ documento: 'x', versao: '1.0' })).status).toBe(400);
    expect((await request(app).post('/api/legal/aceites').set('Authorization', `Bearer ${token({ role: 'dentista' })}`).send({ documento: 'termos', versao: '1.0' })).status).toBe(403);
    const sup = await request(app).post('/api/legal/aceites').set('Authorization', `Bearer ${token({ tenant_id: null, is_super_admin: true })}`)
      .set('X-Tenant-Id', tenantA).send({ documento: 'termos', versao: '1.0' });
    expect(sup.status).toBe(403);
    expect(sqlLog.some(q => /^INSERT INTO aceites_documentos/.test(q.text))).toBe(false);
  });
});

describe('POST /api/legal/documentos (super-admin)', () => {
  test('publica com hash do texto e vigência de no mínimo 30 dias', async () => {
    const texto = 'Termos de Uso, versão 2.0 — texto integral da nova versão.';
    const res = await request(app).post('/api/legal/documentos')
      .set('Authorization', `Bearer ${token({ tenant_id: null, is_super_admin: true })}`)
      .send({ documento: 'termos', versao: '2.0', texto, dias_aviso: 5 });
    expect(res.status).toBe(201);
    const ins = sqlLog.find(q => /^INSERT INTO documentos_legais_versoes/.test(q.text));
    expect(ins.params[3]).toBe(hashTexto(texto));
    expect(ins.params[4]).toBe('30');
  });

  test('versão já publicada não é alterada (409); admin de clínica não publica (403)', async () => {
    const sup = token({ tenant_id: null, is_super_admin: true });
    const r1 = await request(app).post('/api/legal/documentos').set('Authorization', `Bearer ${sup}`)
      .send({ documento: 'termos', versao: '1.0', texto: 'texto qualquer com tamanho suficiente' });
    expect(r1.status).toBe(409);
    const r2 = await request(app).post('/api/legal/documentos').set('Authorization', `Bearer ${token()}`)
      .send({ documento: 'termos', versao: '3.0', texto: 'texto qualquer com tamanho suficiente' });
    expect(r2.status).toBe(403);
  });
});
