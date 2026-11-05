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
const dentistaA = 'aaaaaaaa-2222-4000-8000-0000000000da';
const dentistaA2 = 'aaaaaaaa-2222-4000-8000-0000000000d2';
const dentistaSaiu = 'aaaaaaaa-2222-4000-8000-0000000000d0';
const agendamentoA = 'aaaaaaaa-3333-4000-8000-0000000000ac';
const relatorioOutroDentista = 'aaaaaaaa-1111-4000-8000-0000000000a2';
const relatorioDentistaSaiu = 'aaaaaaaa-1111-4000-8000-0000000000a0';
// Cadastro de dentistas da clínica A, por e-mail do usuário (ativo = ainda na clínica)
const dentistasPorEmail = {
  'dentista@clinica-a.com': { id: dentistaA, nome: 'Ana Lima', cro: 'SP-1234', tenant: tenantA },
  'outra@clinica-a.com': { id: dentistaA2, nome: 'Bia Reis', cro: 'SP-5678', tenant: tenantA },
};
const dentistasCadastro = {
  [dentistaA]: { nome: 'Ana Lima', ativo: true },
  [dentistaA2]: { nome: 'Bia Reis', ativo: true },
  [dentistaSaiu]: { nome: 'Caio Antigo', ativo: false },
};
const agendamentos = { [agendamentoA]: { tenant: tenantA, dentista_id: dentistaA2 } };
const relatorios = {
  [relatorioA]: { tenant: tenantA, patient_id: pacienteA, attendant_id: userId, dentista_id: dentistaA, status: 'rascunho' },
  [relatorioB]: { tenant: tenantB, patient_id: pacienteB, attendant_id: userId, dentista_id: null, status: 'rascunho' },
  [relatorioOutroDentista]: { tenant: tenantA, patient_id: pacienteA, attendant_id: 'x', dentista_id: dentistaA2, status: 'rascunho' },
  [relatorioDentistaSaiu]: { tenant: tenantA, patient_id: pacienteA, attendant_id: 'x', dentista_id: dentistaSaiu, status: 'rascunho' },
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
    if (/FROM dentistas\s+WHERE tenant_id = \$1 AND LOWER\(email\) = LOWER\(\$2\)/.test(text)) {
      const d = dentistasPorEmail[String(params[1]).toLowerCase()];
      return Promise.resolve(d && d.tenant === params[0] ? { rows: [{ id: d.id, nome: d.nome, cro: d.cro }], rowCount: 1 } : vazio);
    }
    if (/SELECT dentista_id FROM agendamentos WHERE id = \$1::uuid AND tenant_id = \$2/.test(text)) {
      const a = agendamentos[params[0]];
      return Promise.resolve(a && a.tenant === params[1] ? { rows: [{ dentista_id: a.dentista_id }], rowCount: 1 } : vazio);
    }
    if (/FROM clinical_reports r\s+LEFT JOIN profiles p/.test(text)) {
      const r = relatorios[params[0]];
      if (!r || r.tenant !== params[1]) return Promise.resolve(vazio);
      const d = r.dentista_id ? dentistasCadastro[r.dentista_id] : null;
      return um({ id: params[0], status: r.status, responsavel_id: r.dentista_id, responsavel_cadastro: d ? r.dentista_id : null, responsavel_ativo: d?.ativo ?? null, responsavel_nome: d?.nome ?? null });
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
      const r = relatorios[params[7]];
      return Promise.resolve(r && r.tenant === params[8]
        ? { rows: [{ id: params[7], status: 'aprovado', aprovado_por_nome: params[2], aprovado_por_cro: params[3], aprovado_por_outro_dentista: params[5], aprovado_em: '2026-11-05T12:00:00Z', transcricao_apagada_em: '2026-11-05T12:00:00Z', origem_ia_sem_revisao: false }], rowCount: 1 }
        : vazio);
    }
    if (/^\s*UPDATE clinical_reports\s+SET status = 'nao_aprovado'/.test(text)) {
      const r = relatorios[params[5]];
      return Promise.resolve(r && r.tenant === params[6]
        ? { rows: [{ id: params[5], status: 'nao_aprovado', nao_aprovado_por_nome: params[1], nao_aprovado_por_cro: params[2], nao_aprovado_em: '2026-11-05T12:00:00Z', transcricao_apagada_em: null }], rowCount: 1 }
        : vazio);
    }
    if (/INSERT INTO automation_jobs/.test(text)) return um({ id: 'job1' });
    if (/INSERT INTO exportacoes_relatorios_ia/.test(text)) {
      return opcoes.falhaRegistroExport ? Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' })) : Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (/FROM clinical_reports/.test(text) && /LIMIT 5000/.test(text)) {
      return Promise.resolve({ rows: [{ id: relatorioA, created_at: '2026-11-01T10:00:00Z', patient_id: pacienteA, patient_name: '=HYPERLINK("x")', attendant_name: 'Ana', queixa_principal: '', procedimento: '', dente_regiao: '', duration_seconds: 600, prescricoes: [], status: 'aprovado', aprovado_por_nome: 'Ana Lima', aprovado_por_cro: 'SP-1234', aprovado_por_outro_dentista: false, aprovado_em: '2026-11-02T10:00:00Z' }], rowCount: 1 });
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
    // dentista que gerou é o dentista do atendimento (quem vai aprovar)
    expect(ins.params[13]).toBe(dentistaA);
  });

  test('admin gera o rascunho: grava o dentista do agendamento, não o admin', async () => {
    const res = await chamar('post', '/api/ai/clinical-report', corpoRelatorio({ appointmentId: agendamentoA }),
      token({ role: 'admin', email: 'admin@clinica-a.com' }));
    expect(res.status).toBe(200);
    expect(achar(/INSERT INTO clinical_reports/).params[13]).toBe(dentistaA2);
  });

  test('admin sem agendamento com dentista não gera (400), nada vai à OpenAI', async () => {
    const res = await chamar('post', '/api/ai/clinical-report', corpoRelatorio(),
      token({ role: 'admin', email: 'admin@clinica-a.com' }));
    expect(res.status).toBe(400);
    expect(chamadasOpenAI()).toHaveLength(0);
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

  test('prontuário do paciente só traz relatório aprovado, da clínica do usuário (rascunho antigo fica fora)', async () => {
    const res = await chamar('get', `/api/ai/reports/${pacienteA}`);
    expect(res.status).toBe(200);
    const q = achar(/FROM clinical_reports\s+WHERE patient_id = \$1 AND tenant_id = \$2/);
    expect(q.text).toMatch(/AND status = 'aprovado'\s/);
    expect(q.text).not.toMatch(/origem_ia_sem_revisao = true/);
    expect(q.params[1]).toBe(tenantA);
  });
});

describe('R2 — aprovação só pelo dentista do atendimento', () => {
  test('dentista do atendimento aprova com texto editado; grava nome, CRO, quem e quando, e apaga a transcrição', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'Texto revisado' });
    expect(res.status).toBe(200);
    expect(res.body.transcricao_mantida).toBe(false);
    expect(res.body.aprovado_por_cro).toBe('SP-1234');
    const up = achar(/UPDATE clinical_reports\s+SET report = \$1, status = 'aprovado'/);
    expect(up.text).toMatch(/aprovado_por = \$2, aprovado_por_nome = \$3, aprovado_por_cro = \$4/);
    expect(up.text).toMatch(/WHERE id = \$8 AND tenant_id = \$9 AND status = 'rascunho'/);
    expect(up.text).toMatch(/transcription = CASE WHEN \$7::boolean THEN transcription ELSE NULL END/);
    expect(up.params[0]).toBe('Texto revisado');
    expect(up.params[2]).toBe('Ana Lima');
    expect(up.params[3]).toBe('SP-1234');
    expect(up.params[4]).toBe(dentistaA);
    expect(up.params[5]).toBe(false); // é o dentista do atendimento
    expect(up.params[6]).toBe(false); // padrão: não manter a transcrição
    expect(up.params[8]).toBe(tenantA);
  });

  test('admin sem cadastro de dentista não aprova (403)', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'ok' },
      token({ role: 'admin', email: 'admin@clinica-a.com' }));
    expect(res.status).toBe(403);
    expect(gravou(/UPDATE clinical_reports\s+SET report/)).toBe(false);
  });

  test('outro dentista ativo não aprova o relatório de quem fez o atendimento (403)', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioOutroDentista}/aprovar`, { report: 'ok' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Bia Reis/);
    expect(gravou(/UPDATE clinical_reports\s+SET report/)).toBe(false);
  });

  test('dentista do atendimento saiu da clínica: outro dentista aprova, marcado "não realizou o atendimento"', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioDentistaSaiu}/aprovar`, { report: 'ok' });
    expect(res.status).toBe(200);
    const up = achar(/UPDATE clinical_reports\s+SET report = \$1, status = 'aprovado'/);
    expect(up.params[5]).toBe(true);
    expect(res.body.aprovado_por_outro_dentista).toBe(true);
  });

  test('relatório de outra clínica → 404', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioB}/aprovar`, { report: 'x' });
    expect(res.status).toBe(404);
  });

  test('recepção não aprova; texto vazio não aprova', async () => {
    expect((await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: 'x' }, token({ role: 'recepcionista', email: 'recepcao@clinica-a.com' }))).status).toBe(403);
    expect((await chamar('post', `/api/ai/reports/${relatorioA}/aprovar`, { report: '   ' })).status).toBe(400);
    expect(gravou(/UPDATE clinical_reports\s+SET report/)).toBe(false);
  });
});

describe('R2 — "Não aprovar"', () => {
  test('dentista do atendimento marca como não aprovado: guarda o texto, grava quem (com CRO) e o motivo', async () => {
    const res = await chamar('post', `/api/ai/reports/${relatorioA}/nao-aprovar`, { motivo: 'Texto não confere com a consulta' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('nao_aprovado');
    const up = achar(/UPDATE clinical_reports\s+SET status = 'nao_aprovado'/);
    expect(up.text).toMatch(/WHERE id = \$6 AND tenant_id = \$7 AND status = 'rascunho'/);
    expect(up.text).not.toMatch(/SET report =|DELETE/);
    expect(up.params[1]).toBe('Ana Lima');
    expect(up.params[2]).toBe('SP-1234');
    expect(up.params[3]).toBe('Texto não confere com a consulta');
    expect(up.params[6]).toBe(tenantA);
  });

  test('admin sem cadastro de dentista e relatório de outra clínica não passam', async () => {
    expect((await chamar('post', `/api/ai/reports/${relatorioA}/nao-aprovar`, {}, token({ role: 'admin', email: 'admin@clinica-a.com' }))).status).toBe(403);
    expect((await chamar('post', `/api/ai/reports/${relatorioB}/nao-aprovar`, {})).status).toBe(404);
    expect(gravou(/SET status = 'nao_aprovado'/)).toBe(false);
  });
});

describe('Lista de relatórios: prazo de revisão e pendentes por dentista', () => {
  test('dentista vê os seus, os do seu atendimento e os rascunhos de quem saiu; prazo padrão 60 dias', async () => {
    const res = await chamar('get', '/api/ai/reports');
    expect(res.status).toBe(200);
    expect(res.body.stats.prazo_revisao_dias).toBe(60);
    const q = achar(/FROM clinical_reports\s+WHERE tenant_id = \$1/);
    expect(q.params[0]).toBe(tenantA);
    expect(q.text).toMatch(/attendant_id = \$2 OR dentista_id = \$3/);
    expect(q.params[2]).toBe(dentistaA);
    expect(q.text).toMatch(/dd\.tenant_id = clinical_reports\.tenant_id AND dd\.ativo IS NOT FALSE/);
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

describe('R7 — exportações (CSV e PDF)', () => {
  test.each(['/api/ai/reports/export.csv', '/api/ai/reports/export-pdf'])('%s: dentista (não admin) → 403 e nada é lido', async (url) => {
    const res = await chamar('get', url);
    expect(res.status).toBe(403);
    expect(gravou(/LIMIT 5000/)).toBe(false);
  });

  test.each([['/api/ai/reports/export.csv?from=2026-11-01', 'csv'], ['/api/ai/reports/export-pdf?from=2026-11-01', 'pdf']])(
    '%s: admin exporta só aprovados da própria clínica, com registro', async (url, formato) => {
      const res = await chamar('get', url, {}, token({ role: 'admin', email: 'admin@clinica-a.com' }));
      expect(res.status).toBe(200);
      const q = achar(/LIMIT 5000/);
      expect(q.params[0]).toBe(tenantA);
      expect(q.text).toMatch(/status = 'aprovado'/);
      const reg = achar(/INSERT INTO exportacoes_relatorios_ia/);
      expect(reg.params[0]).toBe(tenantA);
      expect(reg.params[1]).toBe(userId);
      expect(reg.params[3]).toBe(1);
      expect(reg.params[5]).toBe(formato);
      expect(JSON.parse(reg.params[4]).from).toBe('2026-11-01');
      // também no registro de acesso ao prontuário, por paciente (tabela do PR #59, se existir)
      expect(achar(/INSERT INTO acessos_prontuario/).params[2]).toEqual([pacienteA]);
      if (formato === 'csv') {
        expect(res.text).toMatch(/Aprovado por Ana Lima \(CRO SP-1234\)/);
        expect(res.text).toMatch(/"'=HYPERLINK/); // proteção contra fórmula na planilha
      } else {
        expect(res.body.reports[0].rotulo_aprovacao).toMatch(/Aprovado por Ana Lima \(CRO SP-1234\)/);
      }
    });

  test.each(['/api/ai/reports/export.csv', '/api/ai/reports/export-pdf'])('%s: sem conseguir registrar, não exporta (503)', async (url) => {
    opcoes.falhaRegistroExport = true;
    const res = await chamar('get', url, {}, token({ role: 'admin', email: 'admin@clinica-a.com' }));
    expect(res.status).toBe(503);
    expect(res.text).not.toMatch(/HYPERLINK/);
  });
});

describe('R1 — configuração da transcrição por clínica', () => {
  test('padrão: apagar a transcrição e 60 dias de prazo de revisão', async () => {
    const res = await chamar('get', '/api/ai/clinic-settings');
    expect(res.status).toBe(200);
    expect(res.body.manter_transcricao).toBe(false);
    expect(res.body.prazo_revisao_dias).toBe(60);
  });

  test('prazo de revisão fora de 7 a 365 dias → 400', async () => {
    const res = await chamar('put', '/api/ai/clinic-settings', { prazo_revisao_dias: 3 }, token({ role: 'admin', email: 'admin@clinica-a.com' }));
    expect(res.status).toBe(400);
  });

  test('só o admin altera; grava na clínica do usuário', async () => {
    expect((await chamar('put', '/api/ai/clinic-settings', { manter_transcricao: true })).status).toBe(403);
    const res = await chamar('put', '/api/ai/clinic-settings', { manter_transcricao: true }, token({ role: 'admin' }));
    expect(res.status).toBe(200);
    const ins = achar(/INSERT INTO tenant_settings/);
    expect(ins.params[0]).toBe(tenantA);
    expect(ins.params[1]).toBe('ia_relatorio_clinico');
    // não apaga o prazo ao mudar só a transcrição
    expect(JSON.parse(ins.params[2])).toEqual({ manter_transcricao: true, prazo_revisao_dias: 60 });
  });
});
