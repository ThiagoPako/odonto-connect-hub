// Consentimento de gravação e transcrição por IA v2.0 (parecer da Helena).
// pool.query é mockado: nenhuma query chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const ci = await import('../consentimento-ia.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const tenantC = '55555555-5555-5555-5555-555555555555'; // clínica sem encarregado (o cache de tenant_settings é por clínica)
const pacId = '33333333-3333-3333-3333-333333333333';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const token = (extra = {}) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444', email: 'dentista@clinica-a.com',
  role: 'dentista', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);

let querySpy;
let sqlLog;
let db;

function resetDb() {
  db = {
    paciente: { id: pacId, nome: 'Ana Souza', data_nascimento: '1990-05-10' },
    encarregado: { nome: 'Carla DPO', contato: 'dpo@clinica-a.com' },
    consents: [], // { versao, decisao, aceito_em }
    report: { patient_id: pacId },
  };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  resetDb();
  sqlLog = [];
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const t = String(sql);
    sqlLog.push({ text: t, params });
    const ok = (rows) => Promise.resolve({ rows, rowCount: rows.length });
    if (/FROM pacientes WHERE id::text = \$1 AND tenant_id = \$2/.test(t)) {
      return ok([tenantA, tenantC].includes(params[1]) && params[0] === pacId && db.paciente ? [db.paciente] : []);
    }
    if (/FROM agendamentos WHERE id::text/.test(t)) return ok([]);
    if (/SELECT nome, cnpj FROM tenants/.test(t)) return ok([{ nome: 'Clínica Sorriso', cnpj: '12.345.678/0001-90' }]);
    if (/FROM tenant_settings/.test(t)) {
      if (params[1] === 'lgpd_encarregado') return ok(params[0] === tenantA && db.encarregado ? [{ value: db.encarregado }] : []);
      return ok([]);
    }
    if (/FROM consentimentos_pacientes/.test(t)) {
      if (params[0] !== tenantA) return ok([]);
      return ok([...db.consents].sort((a, b) => b.aceito_em - a.aceito_em).map((c, i) => ({ id: `c${i}`, tipo: params[2], ...c })));
    }
    if (/INSERT INTO consentimentos_pacientes/.test(t)) {
      return ok([{ id: 'novo', tipo: params[2], versao: params[3], decisao: params[6], texto_hash: params[5] }]);
    }
    if (/FROM clinical_reports/.test(t)) return ok(db.report ? [db.report] : []);
    if (/FROM ai_settings/.test(t)) return ok([]); // sem OpenAI: se passar do consentimento, responde 400
    return ok([]);
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

const auth = (r, tk = token()) => r.set('Authorization', `Bearer ${tk}`);
const registrar = (body, tk) => auth(request(app).post(`/api/pacientes/${pacId}/consentimentos`), tk)
  .send({ tipo: 'gravacao_transcricao_ia', ...body });
const adulto = { decisao: 'autorizo', assinante_tipo: 'paciente', assinante_nome: 'Ana Souza', assinatura: { base64: PNG } };
const insert = () => sqlLog.find((q) => /INSERT INTO consentimentos_pacientes/.test(q.text));

describe('catálogo e regras (consentimento-ia.mjs)', () => {
  test('texto montado tem as variáveis da clínica e hash SHA-256 estável', () => {
    const vars = { clinica: 'Clínica X', cnpj: '1', endereco: 'Rua A', contato_encarregado: 'Carla (c@x)', paciente: 'Ana' };
    const a = ci.montarTextoConsentimento('gravacao_transcricao_ia', '2.0', vars);
    const b = ci.montarTextoConsentimento('gravacao_transcricao_ia', '2.0', vars);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(ci.sha256(a.texto));
    expect(a.texto).toContain('Clínica X');
    expect(a.texto).toContain('consultas de Ana');
    expect(a.texto).toContain('orientações pós-consulta');
    expect(a.texto).toContain('(e) se a clínica usar');
    expect(a.texto).not.toMatch(/\{(clinica|cnpj|endereco|contato_encarregado|retencao|paciente)\}/);
  });

  test('retenção configurável, padrão "por até 30 dias"', () => {
    expect(ci.retencaoProvedor({})).toBe('por até 30 dias');
    expect(ci.retencaoProvedor({ OPENAI_RETENCAO_TEXTO: 'não guarda' })).toBe('não guarda');
  });

  test('versões comparadas como números', () => {
    expect(ci.versaoMaiorOuIgual('2.0', '2.0')).toBe(true);
    expect(ci.versaoMaiorOuIgual('10.0', '2.0')).toBe(true);
    expect(ci.versaoMaiorOuIgual('1.0', '2.0')).toBe(false);
  });

  test('idade pela data de nascimento', () => {
    const hoje = new Date('2026-11-05T12:00:00');
    expect(ci.idadeEmAnos('2014-11-06', hoje)).toBe(11);
    expect(ci.idadeEmAnos('2014-11-05', hoje)).toBe(12);
    expect(ci.idadeEmAnos(null, hoje)).toBeNull();
  });
});

describe('GET /api/consentimentos/texto', () => {
  test('devolve o texto da clínica, a versão 2.0, o hash e a idade do cadastro', async () => {
    const res = await auth(request(app).get('/api/consentimentos/texto').query({ tipo: 'gravacao_transcricao_ia', paciente_id: pacId }));
    expect(res.status).toBe(200);
    expect(res.body.versao).toBe('2.0');
    expect(res.body.curta).toContain('Clínica Sorriso');
    expect(res.body.completa).toContain('Carla DPO (dpo@clinica-a.com)');
    expect(res.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.encarregado_cadastrado).toBe(true);
    expect(res.body.idade).toBeGreaterThan(30);
  });

  test('paciente de outra clínica → 404', async () => {
    const res = await auth(request(app).get('/api/consentimentos/texto').query({ tipo: 'gravacao_transcricao_ia', paciente_id: pacId }), token({ tenant_id: tenantB }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/pacientes/:id/consentimentos', () => {
  test('grava o hash do texto que o servidor montou, não o texto do navegador', async () => {
    const res = await registrar({ ...adulto, texto: 'texto falso vindo do navegador', versao: '9.9' });
    expect(res.status).toBe(200);
    const ins = insert();
    expect(ins.params[0]).toBe(tenantA);
    expect(ins.params[3]).toBe('2.0');
    expect(ins.params[4]).not.toContain('texto falso');
    expect(ins.params[5]).toBe(ci.sha256(ins.params[4]));
    expect(ins.params[6]).toBe('autorizo');
    expect(sqlLog.some((q) => /INSERT INTO assinaturas_eletronicas/.test(q.text))).toBe(true);
  });

  test('sem encarregado cadastrado → 409 e nada gravado', async () => {
    const res = await registrar(adulto, token({ tenant_id: tenantC }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ENCARREGADO_REQUIRED');
    expect(insert()).toBeUndefined();
  });

  test('"autorizo" sem assinatura → 400', async () => {
    const res = await registrar({ ...adulto, assinatura: undefined });
    expect(res.status).toBe(400);
    expect(insert()).toBeUndefined();
  });

  test('a recusa também é registrada (sem assinatura obrigatória)', async () => {
    const res = await registrar({ decisao: 'nao_autorizo', assinante_tipo: 'paciente', assinante_nome: 'Ana Souza' });
    expect(res.status).toBe(200);
    expect(res.body.consent).toBeNull();
    expect(insert().params[6]).toBe('nao_autorizo');
  });

  test('sem decisão → 400', async () => {
    const res = await registrar({ assinante_tipo: 'paciente', assinante_nome: 'Ana', assinatura: { base64: PNG } });
    expect(res.status).toBe(400);
  });

  test('hash da tela diferente do atual → 409 para recarregar', async () => {
    const res = await registrar({ ...adulto, texto_hash: 'abc' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEXTO_DESATUALIZADO');
  });

  test('menor de 12: só o responsável, com documento', async () => {
    db.paciente.data_nascimento = '2018-01-01';
    expect((await registrar(adulto)).status).toBe(400);
    expect((await registrar({ ...adulto, assinante_tipo: 'responsavel', assinante_nome: 'Mãe', assinante_vinculo: 'mãe' })).status).toBe(400);
    const ok = await registrar({ ...adulto, assinante_tipo: 'responsavel', assinante_nome: 'Mãe', assinante_vinculo: 'mãe', responsavel_documento: '123' });
    expect(ok.status).toBe(200);
  });

  test('12 a 17: responsável assina e o adolescente precisa estar ciente', async () => {
    db.paciente.data_nascimento = '2011-01-01';
    const base = { ...adulto, assinante_tipo: 'responsavel', assinante_nome: 'Pai', assinante_vinculo: 'pai' };
    expect((await registrar(base)).status).toBe(400);
    expect((await registrar({ ...base, adolescente_ciente: true })).status).toBe(200);
  });

  test('sem data de nascimento: exige a idade informada', async () => {
    db.paciente.data_nascimento = null;
    expect((await registrar(adulto)).status).toBe(400);
    expect((await registrar({ ...adulto, idade_informada: 40 })).status).toBe(200);
    expect(insert().params[12]).toBe(40);
  });
});

describe('rotas que mandam dado do paciente à IA exigem consentimento v2.0', () => {
  const transcrever = () => auth(request(app).post(`/api/ai/transcribe?paciente_id=${pacId}`))
    .set('Content-Type', 'audio/webm').send(Buffer.from('x'));
  const relatorio = () => auth(request(app).post('/api/ai/clinical-report')).send({ transcription: 'oi', patientId: pacId });
  const followup = () => auth(request(app).post('/api/ai/followup-messages')).send({ reportId: 'r1' });

  test.each([['transcribe', transcrever], ['clinical-report', relatorio], ['followup-messages', followup]])(
    '%s: sem consentimento → 403 CONSENT_REQUIRED', async (_n, call) => {
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CONSENT_REQUIRED');
    });

  test.each([['transcribe', transcrever], ['clinical-report', relatorio], ['followup-messages', followup]])(
    '%s: consentimento v1.0 não vale', async (_n, call) => {
      db.consents = [{ versao: '1.0', decisao: null, aceito_em: new Date('2026-01-01') }];
      expect((await call()).status).toBe(403);
    });

  test.each([['transcribe', transcrever], ['clinical-report', relatorio], ['followup-messages', followup]])(
    '%s: com v2.0 "autorizo" passa do consentimento', async (_n, call) => {
      db.consents = [{ versao: '2.0', decisao: 'autorizo', aceito_em: new Date('2026-11-01') }];
      const res = await call();
      expect(res.status).not.toBe(403);
    });

  test('"não autorizo" mais recente anula um "autorizo" anterior', async () => {
    db.consents = [
      { versao: '2.0', decisao: 'autorizo', aceito_em: new Date('2026-10-01') },
      { versao: '2.0', decisao: 'nao_autorizo', aceito_em: new Date('2026-11-01') },
    ];
    expect((await relatorio()).status).toBe(403);
  });

  test('clinical-report sem paciente → 403', async () => {
    const res = await auth(request(app).post('/api/ai/clinical-report')).send({ transcription: 'oi' });
    expect(res.status).toBe(403);
  });
});

describe('encarregado de dados', () => {
  test('só admin cadastra', async () => {
    const naoAdmin = await auth(request(app).put('/api/lgpd/encarregado')).send({ nome: 'X', contato: 'y' });
    expect(naoAdmin.status).toBe(403);
    const admin = await auth(request(app).put('/api/lgpd/encarregado'), token({ role: 'admin' })).send({ nome: 'Carla', contato: 'dpo@x' });
    expect(admin.status).toBe(200);
    const up = sqlLog.find((q) => /INSERT INTO tenant_settings/.test(q.text));
    expect(up.params[0]).toBe(tenantA);
    expect(up.params[1]).toBe('lgpd_encarregado');
  });
});
