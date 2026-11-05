// IA clínica com revisão humana (auditoria jurídica de IA, R1/R2/R3/R4/R7):
// rascunho que só entra no prontuário depois da aprovação, consentimento no servidor,
// follow-up com modelos fixos e filtro de termos, telefone sempre do cadastro,
// isolamento entre clínicas e exportação CSV só do admin, com registro.
// pool.query e fetch são mockados: nada chega ao Postgres nem à OpenAI.
import request from 'supertest';
import jwt from 'jsonwebtoken';
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
const pacienteA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const pacienteB = 'bbbbbbbb-0000-4000-8000-00000000000b';
const relatorioA = 'aaaaaaaa-1111-4000-8000-0000000000aa';
const relatorioB = 'bbbbbbbb-1111-4000-8000-0000000000bb';
const userId = '44444444-4444-4444-4444-444444444444';
const pacientes = {
  [pacienteA]: { tenant: tenantA, nome: 'Maria Souza', telefone: '11988887777' },
  [pacienteB]: { tenant: tenantB, nome: 'Joao B', telefone: '21977776666' },
};
const relatorios = {
  [relatorioA]: { tenant: tenantA, patient_id: pacienteA, attendant_id: userId },
  [relatorioB]: { tenant: tenantB, patient_id: pacienteB, attendant_id: userId },
};

let sqlLog;
let querySpy;
let fetchSpy;
let opcoes;
const token = (extra = {}) => jwt.sign({
  sub: userId, email: 'dentista@clinica-a.com',
  role: 'dentista', tenant_id: tenantA, is_super_admin: false, ...extra,
}, JWT_SECRET);
const chamar = (method, url, body = {}, tk = token()) =>
  request(app)[method](url).set('Authorization', `Bearer ${tk}`).send(body);
const achar = (re) => sqlLog.find(q => re.test(q.text));
const gravou = (re) => sqlLog.some(q => re.test(q.text));
const chamadasOpenAI = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('api.openai.com'));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  opcoes = { consentimento: true, falhaRegistroExport: false, papeisExtras: [] };
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('api.openai.com')) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '## Resumo da consulta\nnão mencionado' } }] }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '[]', headers: new Map() };
  });
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    const vazio = { rows: [], rowCount: 0 };
    const um = (row) => Promise.resolve({ rows: [row], rowCount: 1 });
    if (/FROM user_roles/.test(text)) {
      const pedidos = Array.isArray(params[1]) ? params[1] : [params[1]];
      const ok = pedidos.some(p => opcoes.papeisExtras.includes(p));
      return Promise.resolve(ok ? { rows: [{ '?column?': 1 }], rowCount: 1 } : vazio);
    }
    if (/SELECT 1 FROM pacientes WHERE id = \$1::uuid AND tenant_id = \$2\s+UNION ALL/.test(text)) {
      return Promise.resolve(pacientes[params[0]]?.tenant === params[1] ? { rows: [{}], rowCount: 1 } : vazio);
    }
    if (/FROM consentimentos_pacientes/.test(text)) {
      return Promise.resolve(opcoes.consentimento && pacientes[params[1]]?.tenant === params[0]
        ? { rows: [{ id: 'c1', tipo: params[2], versao: '1.0' }], rowCount: 1 } : vazio);
    }
    if (/FROM ai_settings/.test(text)) return um({ api_key: 'sk-test', model: 'gpt-4o-mini', enabled: true });
    if (/FROM profiles WHERE id/.test(text)) return um({ nome: 'Ana Lima' });
    if (/FROM tenant_settings/.test(text)) return Promise.resolve(vazio);
    if (/SELECT nome FROM tenants/.test(text)) return um({ nome: 'Clínica Sorriso' });
    if (/SELECT p\.id, p\.nome, p\.telefone FROM pacientes p/.test(text)) {
      const p = pacientes[params[0]];
      return Promise.resolve(p && p.tenant === params[1] ? { rows: [{ id: params[0], nome: p.nome, telefone: p.telefone }], rowCount: 1 } : vazio);
    }
    if (/SELECT (id|id, patient_id) FROM clinical_reports WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      const r = relatorios[params[0]];
      return Promise.resolve(r && r.tenant === params[1] ? { rows: [{ id: params[0], patient_id: r.patient_id }], rowCount: 1 } : vazio);
    }
    if (/^\s*UPDATE clinical_reports\s+SET report = \$1, status = 'aprovado'/.test(text)) {
      const r = relatorios[params[4]];
      const dono = params.length < 7 || r?.attendant_id === params[6];
      return Promise.resolve(r && r.tenant === params[5] && dono
        ? { rows: [{ id: params[4], status: 'aprovado', aprovado_por_nome: 'Ana Lima', aprovado_em: '2026-11-05T12:00:00Z', transcricao_apagada_em: '2026-11-05T12:00:00Z', origem_ia_sem_revisao: false }], rowCount: 1 }
        : vazio);
    }
    if (/INSERT INTO automation_jobs/.test(text)) return um({ id: 'job1' });
    if (/INSERT INTO exportacoes_relatorios_ia/.test(text)) {
      return opcoes.falhaRegistroExport ? Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' })) : Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (/FROM clinical_reports/.test(text) && /LIMIT 5000/.test(text)) {
      return Promise.resolve({ rows: [{ created_at: '2026-11-01T10:00:00Z', patient_id: pacienteA, patient_name: '=HYPERLINK("x")', attendant_name: 'Ana', queixa_principal: '', procedimento: '', dente_regiao: '', duration_seconds: 600, prescricoes: [], status: 'rascunho', origem_ia_sem_revisao: true }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => { querySpy.mockRestore(); fetchSpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

const corpoRelatorio = (extra = {}) => ({ transcription: 'Paciente relatou sensibilidade.', patientId: pacienteA, patientName: 'Maria', ...extra });

describe('R2 — relatório clínico nasce como rascunho', () => {
  test('gera rascunho: grava status rascunho, gerado_por_ia e o texto original da IA', async () => {
    const res = await chamar('post', '/api/ai/clinical-report', corpoRelatorio());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rascunho');
    const ins = achar(/INSERT INTO clinical_reports/);
    expect(ins.text).toMatch(/report_ia_original, status, gerado_por_ia/);
    expect(ins.text).toMatch(/\$7, \$7, 'rascunho', true/);
    expect(ins.params[12]).toBe(tenantA);
  });

  test('prompt não pede diagnóstico e manda marcar "não mencionado" e não sugerir medicamento', async () => {
    await chamar('post', '/api/ai/clinical-report', corpoRelatorio());
    const [, init] = chamadasOpenAI()[0];
    const prompt = JSON.parse(init.body).messages[0].content;
    expect(prompt).not.toMatch(/\*\*Diagn[oó]stico\*\*|hip[oó]tese diagn[oó]stica baseada|Plano de Tratamento\*\*/i);
    expect(prompt).toMatch(/Não formule diagnóstico nem hipótese diagnóstica/);
    expect(prompt).toMatch(/"não mencionado"/);
    expect(prompt).toMatch(/Não invente achados/);
    expect(prompt).toMatch(/Nunca sugira medicamento, dose/);
    // nome do paciente não vai para a OpenAI
    expect(init.body).not.toMatch(/Maria/);
  });

  test('sem consentimento do paciente → 403 e nada vai para a OpenAI', async () => {
    opcoes.consentimento = false;
    const res = await chamar('post', '/api/ai/clinical-report', corpoRelatorio());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(chamadasOpenAI()).toHaveLength(0);
    expect(gravou(/INSERT INTO clinical_reports/)).toBe(false);
  });

  test.each([
    ['paciente de outra clínica', { patientId: pacienteB }],
    ['sem paciente', { patientId: undefined }],
    ['paciente "unknown"', { patientId: 'unknown' }],
  ])('%s → 404 sem chamar a OpenAI', async (_n, extra) => {
    const res = await chamar('post', '/api/ai/clinical-report', corpoRelatorio(extra));
    expect(res.status).toBe(404);
    expect(chamadasOpenAI()).toHaveLength(0);
  });

  test('recepção não gera relatório clínico', async () => {
    const res = await chamar('post', '/api/ai/clinical-report', corpoRelatorio(), token({ role: 'recepcionista' }));
    expect(res.status).toBe(403);
    expect(chamadasOpenAI()).toHaveLength(0);
  });

  test('prontuário do paciente só traz relatório aprovado (ou antigo marcado), da clínica do usuário', async () => {
    const res = await chamar('get', `/api/ai/reports/${pacienteA}`);
    expect(res.status).toBe(200);
    const q = achar(/FROM clinical_reports\s+WHERE patient_id = \$1 AND tenant_id = \$2/);
    expect(q.text).toMatch(/AND \(status = 'aprovado' OR origem_ia_sem_revisao = true\)/);
    expect(q.params[1]).toBe(tenantA);
  });
});

describe('R2 — aprovação pelo dentista', () => {
  test('aprova com texto editado, grava quem e quando e apaga a transcrição por padrão', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'Texto revisado' });
    expect(res.status).toBe(200);
    expect(res.body.transcricao_mantida).toBe(false);
    const up = achar(/UPDATE clinical_reports\s+SET report = \$1, status = 'aprovado'/);
    expect(up.text).toMatch(/aprovado_por = \$2, aprovado_por_nome = \$3, aprovado_em = NOW\(\)/);
    expect(up.text).toMatch(/WHERE id = \$5 AND tenant_id = \$6 AND status = 'rascunho'/);
    expect(up.text).toMatch(/transcription = CASE WHEN \$4::boolean THEN transcription ELSE NULL END/);
    expect(up.params[0]).toBe('Texto revisado');
    expect(up.params[3]).toBe(false);
    expect(up.params[5]).toBe(tenantA);
    // dentista só aprova o que gerou
    expect(up.text).toMatch(/AND attendant_id = \$7/);
  });

  test('relatório de outra clínica → 404', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioB}/aprovar`, { report: 'x' });
    expect(res.status).toBe(404);
  });

  test('recepção não aprova; texto vazio não aprova', async () => {
    expect((await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'x' }, token({ role: 'recepcionista' }))).status).toBe(403);
    expect((await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: '   ' })).status).toBe(400);
    expect(gravou(/UPDATE clinical_reports\s+SET report/)).toBe(false);
  });

  test('admin aprova relatório de qualquer dentista da clínica (sem filtro de autor)', async () => {
    await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'ok' }, token({ role: 'admin' }));
    const up = achar(/UPDATE clinical_reports\s+SET report = \$1, status = 'aprovado'/);
    expect(up.text).not.toMatch(/attendant_id/);
  });
});

describe('R3 — mensagens de acompanhamento sem IA', () => {
  test('devolve modelos fixos e não chama a OpenAI', async () => {
    const res = await chamar('post', '/api/ai/followup-messages', { reportId: relatorioA, patientName: 'Maria' });
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(3);
    expect(res.body.fonte).toBe('modelo_fixo');
    expect(chamadasOpenAI()).toHaveLength(0);
    expect(gravou(/SELECT report/)).toBe(false); // o relatório nem é lido
  });

  test('relatório de outra clínica → 404', async () => {
    const res = await chamar('post', '/api/ai/followup-messages', { reportId: relatorioB });
    expect(res.status).toBe(404);
  });
});

describe('R4 — agendamento do acompanhamento', () => {
  const modelos = async () => (await chamar('post', '/api/ai/followup-messages', { reportId: relatorioA })).body.messages;

  test('telefone e nome vêm do cadastro do paciente, nunca do corpo; envio pela fila como transacional', async () => {
    const messages = await modelos();
    sqlLog = [];
    const res = await chamar('post', '/api/ai/schedule-followup', {
      reportId: relatorioA, messages, revisado: true,
      patientPhone: '5599900000000', patientName: 'Outro Nome',
    });
    expect(res.status).toBe(200);
    const jobs = sqlLog.filter(q => /INSERT INTO automation_jobs/.test(q.text));
    expect(jobs).toHaveLength(3);
    for (const j of jobs) {
      const cols = j.text.match(/\(([^)]*)\) VALUES/)[1].split(',').map(c => c.trim());
      const val = (c) => j.params[cols.indexOf(c)];
      expect(val('patient_phone')).toBe('5511988887777');
      expect(val('tenant_id')).toBe(tenantA);
      expect(val('category')).toBe('transactional');
      expect(val('message')).toMatch(/Maria Souza/);
      expect(val('message')).not.toMatch(/Outro Nome/);
    }
    const lookup = achar(/FROM pacientes p/);
    expect(lookup.params).toEqual([pacienteA, tenantA]);
    const up = achar(/UPDATE clinical_reports SET metadata/);
    expect(up.text).toMatch(/WHERE id = \$2 AND tenant_id = \$3/);
    expect(up.params[2]).toBe(tenantA);
  });

  test('relatório de outra clínica → 404 sem enfileirar', async () => {
    const res = await chamar('post', '/api/ai/schedule-followup', {
      reportId: relatorioB, messages: [{ delay_days: 1, text: 'Olá, {{nome}}!' }], revisado: true,
    });
    expect(res.status).toBe(404);
    expect(gravou(/INSERT INTO automation_jobs/)).toBe(false);
  });

  test('sem a caixa "Revisei as mensagens" → 400', async () => {
    const res = await chamar('post', '/api/ai/schedule-followup', {
      reportId: relatorioA, messages: [{ delay_days: 1, text: 'Olá, {{nome}}!' }],
    });
    expect(res.status).toBe(400);
    expect(gravou(/INSERT INTO automation_jobs/)).toBe(false);
  });

  test('recepção não agenda', async () => {
    const res = await chamar('post', '/api/ai/schedule-followup', {
      reportId: relatorioA, messages: [{ delay_days: 1, text: 'Olá, {{nome}}!' }], revisado: true,
    }, token({ role: 'recepcionista' }));
    expect(res.status).toBe(403);
  });

  test('dentista pelo user_roles (papel no token diferente) agenda', async () => {
    opcoes.papeisExtras = ['dentista'];
    const res = await chamar('post', '/api/ai/schedule-followup', {
      reportId: relatorioA, messages: [{ delay_days: 1, text: 'Olá, {{nome}}!' }], revisado: true,
    }, token({ role: 'user' }));
    expect(res.status).toBe(200);
  });

  test.each([
    'Oi {{nome}}, como está o seu canal?',
    'Olá {{nome}}, tome a amoxicilina de 8 em 8 horas',
    'Tome 500 mg depois do almoço',
    'Seu diagnóstico de gengivite está melhor?',
    'Promoção de clareamento só esta semana!',
    'Pagamento com 20% de desconto',
    'Preço especial: R$ 99',
    'Como está a dor depois da extração?',
    'Olá {{procedimento}}',
    'Veja em https://exemplo.com',
    'Como foi o procedimento?',
  ])('filtro de termos recusa: %s', async (text) => {
    const res = await chamar('post', '/api/ai/schedule-followup', {
      reportId: relatorioA, messages: [{ delay_days: 1, text }], revisado: true,
    });
    expect(res.status).toBe(400);
    expect(gravou(/INSERT INTO automation_jobs/)).toBe(false);
  });

  test.each([0, 31, 1.5, 'x'])('dias fora de 1 a 30 (%p) → 400', async (delay_days) => {
    const res = await chamar('post', '/api/ai/schedule-followup', {
      reportId: relatorioA, messages: [{ delay_days, text: 'Olá, {{nome}}!' }], revisado: true,
    });
    expect(res.status).toBe(400);
  });
});

describe('R7 — exportação CSV', () => {
  test('dentista (não admin) → 403 e nada é lido', async () => {
    const res = await chamar('get', '/api/ai/reports/export.csv');
    expect(res.status).toBe(403);
    expect(gravou(/LIMIT 5000/)).toBe(false);
  });

  test('admin exporta da própria clínica e a exportação fica registrada', async () => {
    const res = await chamar('get', '/api/ai/reports/export.csv?from=2026-11-01', {}, token({ role: 'admin' }));
    expect(res.status).toBe(200);
    const q = achar(/LIMIT 5000/);
    expect(q.params[0]).toBe(tenantA);
    const reg = achar(/INSERT INTO exportacoes_relatorios_ia/);
    expect(reg.params[0]).toBe(tenantA);
    expect(reg.params[1]).toBe(userId);
    expect(reg.params[3]).toBe(1);
    expect(JSON.parse(reg.params[4]).from).toBe('2026-11-01');
    // também no registro de acesso ao prontuário, por paciente (tabela do PR #59, se existir)
    const acesso = achar(/INSERT INTO acessos_prontuario/);
    expect(acesso.params[2]).toEqual([pacienteA]);
    // coluna de revisão e proteção contra fórmula na planilha
    expect(res.text).toMatch(/Revisão/);
    expect(res.text).toMatch(/"'=HYPERLINK/);
  });

  test('sem conseguir registrar, não exporta (503)', async () => {
    opcoes.falhaRegistroExport = true;
    const res = await chamar('get', '/api/ai/reports/export.csv', {}, token({ role: 'admin' }));
    expect(res.status).toBe(503);
    expect(res.text).not.toMatch(/HYPERLINK/);
  });
});

describe('R1 — configuração da transcrição por clínica', () => {
  test('padrão: apagar a transcrição', async () => {
    const res = await chamar('get', '/api/ai/clinic-settings');
    expect(res.status).toBe(200);
    expect(res.body.manter_transcricao).toBe(false);
  });

  test('só o admin altera; grava na clínica do usuário', async () => {
    expect((await chamar('put', '/api/ai/clinic-settings', { manter_transcricao: true })).status).toBe(403);
    const res = await chamar('put', '/api/ai/clinic-settings', { manter_transcricao: true }, token({ role: 'admin' }));
    expect(res.status).toBe(200);
    const ins = achar(/INSERT INTO tenant_settings/);
    expect(ins.params[0]).toBe(tenantA);
    expect(ins.params[1]).toBe('ia_relatorio_clinico');
  });
});
