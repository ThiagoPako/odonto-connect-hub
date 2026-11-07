// Consentimento de gravação e transcrição por IA v2.0 (parecer da Helena).
// pool.query é mockado: nenhuma query chega ao Postgres.
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
const ci = await import('../consentimento-ia.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const tenantC = '55555555-5555-5555-5555-555555555555'; // clínica sem encarregado (o cache de tenant_settings é por clínica)
const pacId = '33333333-3333-3333-3333-333333333333';
const aptSemPac = '77777777-7777-4777-8777-777777777777';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const token = (extra = {}) => assinarComPapel({
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
    // agendamento sem paciente (aptSemPac) que depois foi vinculado a pacId (db.vinculado)
    if (/SELECT paciente_id::text AS paciente_id FROM agendamentos WHERE id::text = \$1 AND tenant_id = \$2/.test(t)) {
      return ok(db.vinculado && params[0] === aptSemPac && params[1] === tenantA ? [{ paciente_id: pacId }] : []);
    }
    if (/SELECT id::text AS id FROM agendamentos WHERE tenant_id = \$1 AND paciente_id::text = \$2/.test(t)) {
      return ok(db.vinculado && params[0] === tenantA && params[1] === pacId ? [{ id: aptSemPac }] : []);
    }
    if (/FROM agendamentos WHERE id::text/.test(t)) return ok([]);
    // Consentimentos guardados por titular (db.porId): leitura, alvo da revogação e revogação.
    if (db.porId) {
      if (/SELECT paciente_id, tipo FROM consentimentos_pacientes WHERE id::text = \$1 AND tenant_id = \$2/.test(t)) {
        const c = db.porId.find((x) => x.id === params[0] && params[1] === tenantA);
        return ok(c ? [{ paciente_id: c.paciente_id, tipo: c.tipo }] : []);
      }
      if (/^\s*UPDATE consentimentos_pacientes/.test(t)) {
        // formato antigo (revoga só o paciente_id do alvo) e novo (lista de titulares)
        let alvos;
        if (/FROM consentimentos_pacientes alvo/.test(t)) {
          const a = db.porId.find((x) => x.id === params[0]);
          alvos = db.porId.filter((x) => a && x.paciente_id === a.paciente_id && x.tipo === a.tipo);
        } else {
          alvos = db.porId.filter((x) => params[0] === tenantA && params[1].includes(x.paciente_id) && x.tipo === params[4]);
        }
        alvos = alvos.filter((x) => !x.revogado);
        alvos.forEach((x) => { x.revogado = true; });
        return Promise.resolve({ rows: [], rowCount: alvos.length });
      }
      if (/FROM consentimentos_pacientes/.test(t)) {
        if (params[0] !== tenantA) return ok([]);
        const ids = [].concat(params[1]);
        return ok(db.porId.filter((x) => ids.includes(x.paciente_id) && !x.revogado).sort((a, b) => b.aceito_em - a.aceito_em));
      }
    }
    // #79: o relatório exige paciente da clínica e o dentista do atendimento
    if (/SELECT 1 FROM pacientes WHERE id = \$1::uuid AND tenant_id = \$2/.test(t)) {
      return ok(params[0] === pacId && params[1] === tenantA ? [{ '?column?': 1 }] : []);
    }
    if (/FROM dentistas\s+WHERE tenant_id = \$1 AND user_id = \$2::uuid/.test(t)) return ok([{ id: 'd1', nome: 'Dra', cro: 'CRO 1' }]);
    if (/SELECT nome, cnpj FROM tenants/.test(t)) return ok([{ nome: 'Clínica Sorriso', cnpj: '12.345.678/0001-90' }]);
    if (/FROM tenant_settings/.test(t)) {
      if (params[1] === 'lgpd_encarregado') return ok(params[0] === tenantA && db.encarregado ? [{ value: db.encarregado }] : []);
      if (params[1] === 'clinic_location') return ok([{ value: { name: 'Clínica Sorriso', address: 'Rua A, 10', city: 'Campinas', state: 'SP' } }]);
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
  const vars = { clinica: 'Clínica X', cnpj: '12.345.678/0001-90', endereco: 'Rua A, 10', contato_encarregado: 'Carla (c@x)', paciente: 'Ana' };

  test('texto final da Helena com as variáveis da clínica e hash SHA-256 estável', () => {
    const a = ci.montarTextoConsentimento('gravacao_transcricao_ia', '2.0', { ...vars, retencao: '30d' });
    const b = ci.montarTextoConsentimento('gravacao_transcricao_ia', '2.0', { ...vars, retencao: '30d' });
    expect(a.faltando).toEqual([]);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(ci.sha256(a.texto));
    expect(a.texto).toContain('A Clínica X (12.345.678/0001-90, Rua A, 10) é a controladora');
    expect(a.texto).toContain('Contato do encarregado de dados: Carla (c@x).');
    expect(a.texto).toContain('consultas de Ana');
    expect(a.texto).toContain('O dentista revisa e aprova o texto antes de ele entrar no seu prontuário.');
    expect(a.texto).toContain('Para transcrever o áudio e preparar o rascunho do relatório');
    expect(a.texto).toContain('é enviado à OpenAI, sem o seu nome,');
    expect(a.texto).toContain('Transcrição completa (o texto de tudo o que foi dito)');
    // sem o item 3(e): o follow-up pós-consulta usa modelos fixos, sem IA (#79)
    expect(a.texto).not.toContain('(e) ');
    expect(a.texto).not.toContain('orientações pós-consulta');
    expect(a.texto).not.toMatch(/\{[a-z_]+\}/);
    expect(a.texto).not.toMatch(/não informado/i);
  });

  test('retenção por valor fechado, com uma frase inteira por opção', () => {
    const d30 = ci.montarTextoConsentimento('gravacao_transcricao_ia', '2.0', { ...vars, retencao: '30d' });
    const zero = ci.montarTextoConsentimento('gravacao_transcricao_ia', '2.0', { ...vars, retencao: 'zero' });
    expect(d30.curta).toContain('A OpenAI mantém registros técnicos de segurança por até 30 dias e não usa seus dados para treinar a IA.');
    expect(d30.completa).toContain('Na OpenAI: o provedor mantém registros técnicos por até 30 dias, para segurança e prevenção de abuso, e depois os apaga.');
    expect(zero.curta).toContain('A OpenAI não guarda o conteúdo depois de processar e não usa seus dados para treinar a IA.');
    expect(zero.completa).toContain('Na OpenAI: o provedor não guarda o conteúdo depois de processar e não o usa para treinar modelos de IA.');
    expect(zero.hash).not.toBe(d30.hash);
    expect(ci.retencaoProvedor({})).toBe('30d');
    expect(ci.retencaoProvedor({ OPENAI_RETENCAO: 'zero' })).toBe('zero');
    expect(ci.retencaoProvedor({ OPENAI_RETENCAO: 'não guarda nada' })).toBe('30d'); // texto livre não entra
  });

  test.each(['cnpj', 'endereco', 'contato_encarregado'])('sem %s o termo completo não é montado (nada de substituto)', (campo) => {
    const m = ci.montarTextoConsentimento('gravacao_transcricao_ia', '2.0', { ...vars, [campo]: '  ' });
    expect(m.faltando).toEqual([campo]);
    expect(m.completa).toBeNull();
    expect(m.texto).not.toContain('controladora');
    expect(m.hash).toBe(ci.sha256(m.texto)); // hash da versão curta, para registrar a recusa
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
    expect(res.body.faltando).toEqual([]);
    expect(res.body.completa).toContain('(12.345.678/0001-90, Rua A, 10, Campinas - SP)');
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

  test('sem encarregado, a recusa é registrada (só a autorização exige encarregado)', async () => {
    const res = await registrar({ decisao: 'nao_autorizo', assinante_tipo: 'paciente', assinante_nome: 'Ana Souza' }, token({ tenant_id: tenantC }));
    expect(res.status).toBe(200);
    expect(insert().params[6]).toBe('nao_autorizo');
  });

  test('sem CNPJ → 409 CADASTRO_INCOMPLETO para autorizar; recusa continua registrada', async () => {
    querySpy.mockImplementation((sql, params = []) => {
      const t = String(sql);
      sqlLog.push({ text: t, params });
      const ok = (rows) => Promise.resolve({ rows, rowCount: rows.length });
      if (/FROM pacientes WHERE id::text/.test(t)) return ok([db.paciente]);
      if (/SELECT nome, cnpj FROM tenants/.test(t)) return ok([{ nome: 'Clínica Sorriso', cnpj: null }]);
      if (/FROM tenant_settings/.test(t) && params[1] === 'lgpd_encarregado') return ok([{ value: db.encarregado }]);
      if (/FROM tenant_settings/.test(t) && params[1] === 'clinic_location') return ok([{ value: { address: 'Rua A' } }]);
      if (/INSERT INTO consentimentos_pacientes/.test(t)) return ok([{ id: 'novo', decisao: params[6] }]);
      return ok([]);
    });
    const res = await registrar(adulto);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CADASTRO_INCOMPLETO');
    expect(res.body.faltando).toEqual(['cnpj']);
    expect(insert()).toBeUndefined();
    const recusa = await registrar({ decisao: 'nao_autorizo', assinante_tipo: 'paciente', assinante_nome: 'Ana Souza' });
    expect(recusa.status).toBe(200);
    expect(insert().params[4]).not.toContain('controladora');
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

  test('IP da prova vem de req.ip (trust proxy), não do X-Forwarded-For bruto', async () => {
    // o 1º valor é forjável pelo cliente; o nginx acrescenta o IP real no fim
    const res = await registrar(adulto).set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');
    expect(res.status).toBe(200);
    expect(insert().params[18]).toBe('203.0.113.9');
    const assin = sqlLog.find((q) => /INSERT INTO assinaturas_eletronicas/.test(q.text));
    expect(assin.params[3]).toBe('203.0.113.9');
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

  test.each([['transcribe', transcrever], ['clinical-report', relatorio]])(
    '%s: sem consentimento → 403 CONSENT_REQUIRED', async (_n, call) => {
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CONSENT_REQUIRED');
    });

  test.each([['transcribe', transcrever], ['clinical-report', relatorio]])(
    '%s: consentimento v1.0 não vale', async (_n, call) => {
      db.consents = [{ versao: '1.0', decisao: null, aceito_em: new Date('2026-01-01') }];
      expect((await call()).status).toBe(403);
    });

  test.each([['transcribe', transcrever], ['clinical-report', relatorio]])(
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

  test('clinical-report sem paciente → 404 (#79: paciente da clínica é obrigatório)', async () => {
    const res = await auth(request(app).post('/api/ai/clinical-report')).send({ transcription: 'oi' });
    expect(res.status).toBe(404);
  });

  test('followup-messages não usa IA (#79): não exige consentimento', async () => {
    await auth(request(app).post('/api/ai/followup-messages')).send({ reportId: '66666666-6666-6666-6666-666666666666' });
    expect(sqlLog.some((q) => /FROM consentimentos_pacientes/.test(q.text))).toBe(false);
  });

  const consent = (id, paciente_id, decisao = 'autorizo', t = 1) =>
    ({ id, paciente_id, tipo: 'gravacao_transcricao_ia', versao: '2.0', decisao, aceito_em: t });

  test('revogar desativa todas as linhas ativas do paciente e tipo, na clínica do usuário', async () => {
    db.porId = [consent('c0', pacId, 'autorizo', 2), consent('c1', pacId, 'autorizo', 1)];
    const res = await auth(request(app).post('/api/consentimentos/c0/revogar')).send({ canal: 'recepcao' });
    expect(res.body.success).toBe(true);
    expect(db.porId.every((c) => c.revogado)).toBe(true);
    const up = sqlLog.find((q) => /UPDATE consentimentos_pacientes/.test(q.text));
    expect(up.text).toMatch(/tenant_id = \$1 AND paciente_id = ANY\(\$2::text\[\]\) AND tipo = \$5/);
    expect(up.params[0]).toBe(tenantA);
    expect(up.params.slice(2, 5)).toEqual(['44444444-4444-4444-4444-444444444444', 'recepcao', 'gravacao_transcricao_ia']);
  });

  test('consentimento de outra clínica: não revoga nada', async () => {
    db.porId = [consent('c0', pacId)];
    const res = await auth(request(app).post('/api/consentimentos/c0/revogar'), token({ tenant_id: tenantB })).send({});
    expect(res.body.success).toBe(false);
    expect(db.porId[0].revogado).toBeUndefined();
  });

  test('consentimento gravado no agendamento sem paciente: depois de vincular e revogar, transcribe é barrado', async () => {
    // autorizo gravado no id do agendamento; depois o agendamento ganha o paciente, que autoriza e revoga
    db.porId = [consent('cAg', aptSemPac, 'autorizo', 1), consent('cPac', pacId, 'autorizo', 2)];
    db.vinculado = true;
    await auth(request(app).post('/api/consentimentos/cPac/revogar')).send({ canal: 'recepcao' });
    expect(db.porId.find((c) => c.id === 'cAg').revogado).toBe(true);
    const res = await auth(request(app).post(`/api/ai/transcribe?paciente_id=${aptSemPac}`))
      .set('Content-Type', 'audio/webm').send(Buffer.from('x'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
  });

  test('recusa registrada no paciente depois de vincular anula o "autorizo" gravado no agendamento', async () => {
    db.porId = [consent('cAg', aptSemPac, 'autorizo', 1), consent('cPac', pacId, 'nao_autorizo', 2)];
    db.vinculado = true;
    const res = await auth(request(app).post(`/api/ai/transcribe?paciente_id=${aptSemPac}`))
      .set('Content-Type', 'audio/webm').send(Buffer.from('x'));
    expect(res.status).toBe(403);
    const q = sqlLog.find((x) => /FROM consentimentos_pacientes/.test(x.text));
    expect(q.params[1]).toEqual([aptSemPac, pacId]);
  });

  test('agendamento sem paciente vinculado continua usando só o próprio consentimento', async () => {
    db.porId = [consent('cAg', aptSemPac, 'autorizo', 1)];
    const res = await auth(request(app).post(`/api/ai/transcribe?paciente_id=${aptSemPac}`))
      .set('Content-Type', 'audio/webm').send(Buffer.from('x'));
    expect(res.status).toBe(400); // passou do consentimento; para na OpenAI não configurada
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
