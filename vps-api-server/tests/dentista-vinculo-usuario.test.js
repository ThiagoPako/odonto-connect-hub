// Dentista identificado pelo usuário vinculado (dentistas.user_id), nunca pelo e-mail.
// Antes: quem trocasse o próprio e-mail (PUT /api/auth/profile) para o de um dentista passava a
// aprovar relatório clínico com o nome e o CRO dele. Agora: vínculo por user_id + tenant_id,
// vínculo só pelo admin e só com perfil da mesma clínica, e o usuário não troca o próprio e-mail.
// pool.query é mockado: nada chega ao Postgres.
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
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const userDentista = '44444444-4444-4444-8444-444444444444'; // vinculado ao dentista da clínica A
const userImpostor = '66666666-6666-4666-8666-666666666666'; // mesmo e-mail do dentista, sem vínculo
const userAdmin = '77777777-7777-4777-8777-777777777777';
const perfilB = '88888888-8888-4888-8888-888888888888'; // perfil da clínica B
const perfilA = '99999999-9999-4999-8999-999999999999'; // perfil da clínica A
const dentistaA = 'aaaaaaaa-2222-4000-8000-0000000000da';
const dentistaExistente = 'aaaaaaaa-2222-4000-8000-0000000000d1';
const relatorioA = 'aaaaaaaa-1111-4000-8000-0000000000aa';
const relatorioB = 'bbbbbbbb-1111-4000-8000-0000000000bb';
const emailDentista = 'dentista@clinica-a.com';

// Cadastro de dentistas por (clínica, usuário vinculado).
const vinculos = [{ tenant: tenantA, user: userDentista, id: dentistaA, nome: 'Ana Lima', cro: 'SP-1234' }];
const perfis = {
  [userDentista]: { tenant: tenantA, email: emailDentista },
  [userImpostor]: { tenant: tenantA, email: 'impostor@clinica-a.com' },
  [userAdmin]: { tenant: tenantA, email: 'admin@clinica-a.com' },
  [perfilA]: { tenant: tenantA, email: 'novo@clinica-a.com' },
  [perfilB]: { tenant: tenantB, email: 'alguem@clinica-b.com' },
};
const relatorios = {
  [relatorioA]: { tenant: tenantA, dentista_id: dentistaA },
  [relatorioB]: { tenant: tenantB, dentista_id: null },
};

let sqlLog;
let querySpy;
const token = (sub, extra = {}) => assinarComPapel({
  sub, email: perfis[sub]?.email || emailDentista, role: 'dentista', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);
const chamar = (method, url, body, tk) => request(app)[method](url).set('Authorization', `Bearer ${tk}`).send(body);
const achar = (re) => sqlLog.filter(q => re.test(q.text));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    const vazio = { rows: [], rowCount: 0 };
    if (/FROM dentistas\s+WHERE tenant_id = \$1 AND user_id = \$2::uuid/.test(text)) {
      const d = vinculos.find(v => v.tenant === params[0] && v.user === params[1]);
      return Promise.resolve(d ? { rows: [{ id: d.id, nome: d.nome, cro: d.cro }], rowCount: 1 } : vazio);
    }
    if (/FROM clinical_reports r\s+LEFT JOIN dentistas d2/.test(text)) {
      const r = relatorios[params[0]];
      if (!r || r.tenant !== params[1]) return Promise.resolve(vazio);
      return Promise.resolve({ rows: [{ id: params[0], status: 'rascunho', responsavel_id: r.dentista_id, responsavel_cadastro: r.dentista_id, responsavel_ativo: true, responsavel_nome: 'Ana Lima' }], rowCount: 1 });
    }
    if (/^\s*UPDATE clinical_reports\s+SET report = \$1, status = 'aprovado'/.test(text)) {
      return Promise.resolve({ rows: [{ id: params[7], status: 'aprovado', aprovado_por_nome: params[2], aprovado_por_cro: params[3] }], rowCount: 1 });
    }
    if (/SELECT 1 FROM profiles WHERE id = \$1::uuid AND tenant_id = \$2/.test(text)) {
      return Promise.resolve(perfis[params[0]]?.tenant === params[1] ? { rows: [{}], rowCount: 1 } : vazio);
    }
    if (/SELECT email FROM profiles WHERE id = \$1/.test(text)) {
      const p = perfis[params[0]];
      return Promise.resolve(p ? { rows: [{ email: p.email }], rowCount: 1 } : vazio);
    }
    if (/SELECT id, name, email, avatar_url, role FROM profiles WHERE id = \$1/.test(text)) {
      return Promise.resolve({ rows: [{ id: params[0], name: 'Novo Nome', email: perfis[params[0]]?.email }], rowCount: 1 });
    }
    if (/^\s*UPDATE profiles SET/.test(text)) return Promise.resolve({ rows: [], rowCount: 1 });
    if (/INSERT INTO dentistas/.test(text)) return Promise.resolve({ rows: [], rowCount: 1 });
    if (/^UPDATE dentistas SET/.test(text)) {
      const ok = params[params.length - 2] === dentistaExistente && params[params.length - 1] === tenantA;
      return Promise.resolve({ rows: [], rowCount: ok ? 1 : 0 });
    }
    if (/SELECT \* FROM dentistas WHERE id=\$1 AND tenant_id=\$2/.test(text)) {
      return Promise.resolve({ rows: [{ id: params[0] }], rowCount: 1 });
    }
    return Promise.resolve(vazio);
  });
});

afterEach(() => { querySpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

const naoUsaEmailDeDentista = () => {
  for (const q of sqlLog) {
    if (/FROM dentistas|JOIN dentistas/.test(q.text)) expect(q.text).not.toMatch(/email/i);
  }
};

describe('Revisor do relatório clínico: pelo user_id, nunca pelo e-mail', () => {
  test('(a) usuário com o MESMO e-mail do dentista, mas sem vínculo, não aprova (403) e não vira revisor', async () => {
    // e-mail do token igual ao do cadastro do dentista: não importa mais
    const tk = token(userImpostor, { email: emailDentista });
    const res = await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'texto revisado' }, tk);
    expect(res.status).toBe(403);
    expect(achar(/UPDATE clinical_reports/)).toHaveLength(0);
    naoUsaEmailDeDentista();

    // Na lista, não ganha os relatórios do dentista (só os que ele mesmo gerou)
    sqlLog = [];
    await chamar('get', '/api/ai/reports', undefined, tk);
    const lista = achar(/FROM clinical_reports/).map(q => q.params).flat();
    expect(lista).not.toContain(dentistaA);
    naoUsaEmailDeDentista();
  });

  test('(b) dentista vinculado pelo user_id aprova; grava nome e CRO do cadastro dele', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'texto revisado' }, token(userDentista, { email: 'qualquer@coisa.com' }));
    expect(res.status).toBe(200);
    expect(res.body.aprovado_por_nome).toBe('Ana Lima');
    expect(res.body.aprovado_por_cro).toBe('SP-1234');
    const [busca] = achar(/FROM dentistas\s+WHERE tenant_id = \$1 AND user_id/);
    expect(busca.params).toEqual([tenantA, userDentista]);
    naoUsaEmailDeDentista();
  });

  test('(e) clínica B não acha o dentista da clínica A, mesmo com o mesmo user_id', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioB}/aprovar`, { report: 'texto' }, token(userDentista, { tenant_id: tenantB }));
    expect(res.status).toBe(403);
    const [busca] = achar(/FROM dentistas\s+WHERE tenant_id = \$1 AND user_id/);
    expect(busca.params).toEqual([tenantB, userDentista]);
    expect(achar(/UPDATE clinical_reports/)).toHaveLength(0);
    // relatório antigo sem dentista_id: o responsável sai do vínculo user_id na MESMA clínica
    const join = achar(/FROM clinical_reports r/);
    expect(join).toHaveLength(0); // parou antes: sem cadastro de dentista não lê o relatório
  });

  test('(e) busca do responsável do relatório filtra a clínica nos dois lados do JOIN', async () => {
    await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'texto' }, token(userDentista));
    const [q] = achar(/FROM clinical_reports r/);
    expect(q.text).toMatch(/d2\.tenant_id = r\.tenant_id AND d2\.user_id::text = r\.attendant_id/);
    expect(q.text).toMatch(/d\.tenant_id = r\.tenant_id/);
    expect(q.params).toEqual([relatorioA, tenantA]);
  });
});

describe('Vínculo do usuário no cadastro do dentista (só admin, só mesma clínica)', () => {
  const admin = () => token(userAdmin, { role: 'admin' });

  test('(c) POST com user_id de perfil de OUTRA clínica → 404 e nada é gravado', async () => {
    const res = await chamar('post', '/api/dentistas', { nome: 'X', cro: 'SP-1', user_id: perfilB }, admin());
    expect(res.status).toBe(404);
    expect(achar(/INSERT INTO dentistas/)).toHaveLength(0);
    const [chk] = achar(/FROM profiles WHERE id = \$1::uuid AND tenant_id = \$2/);
    expect(chk.params).toEqual([perfilB, tenantA]);
  });

  test('(c) PUT com user_id de perfil de OUTRA clínica → 404; user_id inválido → 400; nada é gravado', async () => {
    expect((await chamar('put', `/api/dentistas/${dentistaExistente}`, { user_id: perfilB }, admin())).status).toBe(404);
    expect((await chamar('put', `/api/dentistas/${dentistaExistente}`, { user_id: 'nao-e-uuid' }, admin())).status).toBe(400);
    expect(achar(/^UPDATE dentistas SET/)).toHaveLength(0);
  });

  test('(c) perfil da mesma clínica é vinculado (POST e PUT), e user_id null desvincula', async () => {
    expect((await chamar('post', '/api/dentistas', { nome: 'Novo', cro: 'SP-9', user_id: perfilA }, admin())).status).toBe(200);
    const [ins] = achar(/INSERT INTO dentistas/);
    expect(ins.text).toMatch(/user_id/);
    expect(ins.params).toContain(perfilA);
    expect(ins.params).toContain(tenantA);

    expect((await chamar('put', `/api/dentistas/${dentistaExistente}`, { user_id: perfilA }, admin())).status).toBe(200);
    expect((await chamar('put', `/api/dentistas/${dentistaExistente}`, { user_id: null }, admin())).status).toBe(200);
    const ups = achar(/^UPDATE dentistas SET/);
    expect(ups[0].text).toMatch(/user_id=\$1/);
    expect(ups[0].params).toEqual([perfilA, dentistaExistente, tenantA]);
    expect(ups[1].params).toEqual([null, dentistaExistente, tenantA]);
  });

  test('(c) quem não é admin não vincula', async () => {
    const res = await chamar('put', `/api/dentistas/${dentistaExistente}`, { user_id: userImpostor }, token(userImpostor, { role: 'recepcionista' }));
    expect(res.status).toBe(403);
    expect(achar(/^UPDATE dentistas SET/)).toHaveLength(0);
  });
});

describe('PUT /api/auth/profile: o próprio usuário não troca o e-mail', () => {
  test('(d) e-mail diferente → 403 com orientação, e nada é gravado', async () => {
    const res = await chamar('put', '/api/auth/profile', { name: 'Impostor', email: emailDentista }, token(userImpostor));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administrador da clínica/);
    expect(achar(/UPDATE profiles/)).toHaveLength(0);
  });

  test('(d) sem e-mail → 200 e só o nome muda', async () => {
    const res = await chamar('put', '/api/auth/profile', { name: 'Novo Nome' }, token(userImpostor));
    expect(res.status).toBe(200);
    const [up] = achar(/UPDATE profiles/);
    expect(up.text).not.toMatch(/email/);
    expect(up.params).toEqual(['Novo Nome', userImpostor]);
  });

  test('(d) mesmo e-mail atual (maiúsculas/espaços) → 200, e-mail não é regravado', async () => {
    const res = await chamar('put', '/api/auth/profile', { name: 'Nome', email: '  IMPOSTOR@clinica-a.com ' }, token(userImpostor));
    expect(res.status).toBe(200);
    const [up] = achar(/UPDATE profiles/);
    expect(up.text).not.toMatch(/email/);
  });
});
