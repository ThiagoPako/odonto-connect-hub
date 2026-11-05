// Painéis (dentista, dashboard, comercial), conversão de lead e relatórios clínicos:
// isolamento por clínica e colunas que existem no schema de produção.
//
// pool.query mockado (nenhuma query chega ao Postgres).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const dentistaDaB = '66666666-6666-6666-6666-666666666666';
const dentistaDaA = '77777777-7777-7777-7777-777777777777';
const leadDaA = '88888888-8888-8888-8888-888888888888';

const token = (tenant_id) => jwt.sign({
  sub: '44444444-4444-4444-4444-444444444444',
  email: 'admin@clinica.com', role: 'admin', tenant_id, is_super_admin: false,
}, JWT_SECRET);

// Colunas que NÃO existem em produção (schema real) e não podem voltar a aparecer.
const COLUNAS_INEXISTENTES = [
  /valor_final/, /quantidade_atual/, /custo_unitario/, /follow_up_at/, /created_by/,
  /SELECT stage\b/, /GROUP BY stage\b/, /pacientes WHERE \(status/, /p\.alergias/, /pr\.paciente_nome/, /o\.paciente_nome/,
  /a\.paciente_nome/, /a\.valor\b/,
];

let sqlLog;
let querySpy;
let reportRows;
let movimentos;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  sqlLog = [];
  reportRows = [];
  movimentos = [];
  querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
    const text = String(sql);
    sqlLog.push({ text, params });
    if (/SELECT \* FROM dentistas WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      const dono = { [dentistaDaB]: tenantB, [dentistaDaA]: tenantA }[params[0]];
      return Promise.resolve({ rows: dono === params[1] ? [{ id: params[0], nome: 'Dra. Ana', email: 'admin@clinica.com' }] : [] });
    }
    if (/FROM dentistas WHERE tenant_id = \$1 ORDER BY nome/.test(text)) {
      return Promise.resolve({ rows: [{ id: dentistaDaA, nome: 'Primeiro da A' }] });
    }
    if (/FROM prontuarios pr/.test(text)) {
      return Promise.resolve({ rows: [{ id: 'pr1', paciente_id: 'p1', p_nome: 'Maria Silva', alergias: ['Dipirona', ''], created_at: new Date() }] });
    }
    if (/FROM crm_leads WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
      return Promise.resolve({ rows: params[0] === leadDaA && params[1] === tenantA ? [{ id: leadDaA, nome: 'Lead', telefone: null }] : [] });
    }
    if (/FROM clinical_reports/.test(text)) return Promise.resolve({ rows: reportRows });
    if (/FROM fin_movements WHERE type = \$1 AND tenant_id = \$2 AND \(date LIKE \$3 OR date LIKE \$4\)/.test(text)) {
      // Simula o LIKE do Postgres (% = qualquer sequência, _ = um caractere).
      const like = (pat) => new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
      const [type, tenant, p3, p4] = params;
      const total = movimentos
        .filter(m => m.type === type && m.tenant_id === tenant && (like(p3).test(m.date) || like(p4).test(m.date)))
        .reduce((acc, m) => acc + m.value, 0);
      return Promise.resolve({ rows: [{ total: String(total) }] });
    }
    if (/AS total_jobs/.test(text)) {
      return Promise.resolve({ rows: [{ total_jobs: '0', total_sent: '0', total_failed: '0', total_pending: '0', total_cancelled: '0' }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => querySpy.mockRestore());
afterAll(async () => { await pool.end(); });

const chamar = (method, url, tk, body) => {
  const r = request(app)[method](url).set('Authorization', `Bearer ${tk}`);
  return body ? r.send(body) : r;
};
const semColunasInexistentes = () => {
  for (const q of sqlLog) for (const re of COLUNAS_INEXISTENTES) expect([re.toString(), q.text.match(re)?.[0]]).toEqual([re.toString(), undefined]);
};

describe('GET /api/dentista/painel/:id', () => {
  test('clínica A recebe 404 no dentista da clínica B (sem cair no primeiro dentista da A)', async () => {
    const res = await chamar('get', `/api/dentista/painel/${dentistaDaB}`, token(tenantA));
    expect(res.status).toBe(404);
    expect(sqlLog.some(q => /FROM agendamentos|FROM orcamentos|FROM prontuarios/.test(q.text))).toBe(false);
    expect(sqlLog.some(q => /ORDER BY nome ASC LIMIT 1/.test(q.text))).toBe(false);
  });

  test('id inválido → 404 sem consultar o banco', async () => {
    const res = await chamar('get', '/api/dentista/painel/nao-uuid', token(tenantA));
    expect(res.status).toBe(404);
    expect(sqlLog).toHaveLength(0);
  });

  test('dentista da própria clínica: todas as consultas filtram tenant_id e alergias vêm da anamnese', async () => {
    const res = await chamar('get', `/api/dentista/painel/${dentistaDaB}`, token(tenantB));
    expect(res.status).toBe(200);
    const dados = sqlLog.filter(q => /FROM (agendamentos|orcamentos|prontuarios|comissoes|tratamentos) /.test(q.text));
    expect(dados).toHaveLength(6);
    for (const q of dados) {
      expect(q.text).toMatch(/\.tenant_id = \$\d/);
      expect(q.params).toContain(tenantB);
      expect(q.text).toMatch(/LEFT JOIN pacientes p ON p\.id = \w+\.paciente_id AND p\.tenant_id = \w+\.tenant_id/);
    }
    const pr = dados.find(q => /FROM prontuarios/.test(q.text));
    expect(pr.text).toMatch(/FROM anamneses x\s+WHERE x\.paciente_id = pr\.paciente_id AND x\.tenant_id = pr\.tenant_id/);
    expect(res.body.prontuarios[0]).toMatchObject({ pacienteNome: 'Maria Silva', alergias: ['Dipirona'] });
    semColunasInexistentes();
  });
});

describe('GET /api/dashboard', () => {
  test('usa colunas reais e receita de fin_movements, tudo por clínica', async () => {
    const res = await chamar('get', '/api/dashboard/kpis', token(tenantA));
    expect(res.status).toBe(200);
    const txt = sqlLog.map(q => q.text).join('\n');
    expect(txt).toMatch(/SUM\(valor_total\)/);
    expect(txt).toMatch(/kanban_stage AS stage/);
    expect(txt).toMatch(/quantidade AS current_stock/);
    expect(txt).toMatch(/valor_unitario AS unit_cost/);
    expect(txt).toMatch(/FROM fin_movements WHERE type = \$1 AND tenant_id = \$2/);
    for (const q of sqlLog) expect(q.params).toContain(tenantA);
    semColunasInexistentes();
  });

  test('receita/despesa do mês somam datas dd/mm/aaaa e aaaa-mm-dd, só da clínica', async () => {
    const hoje = new Date().toISOString().split('T')[0];
    const [ano, mes, dia] = hoje.split('-');
    const outroMes = mes === '01' ? `${Number(ano) - 1}-12` : `${ano}-${String(Number(mes) - 1).padStart(2, '0')}`;
    const [ao, mo] = outroMes.split('-');
    movimentos = [
      { type: 'entrada', tenant_id: tenantA, value: 100, date: `${dia}/${mes}/${ano}` },
      { type: 'entrada', tenant_id: tenantA, value: 50, date: `${ano}-${mes}-01` },
      { type: 'entrada', tenant_id: tenantA, value: 999, date: `10/${mo}/${ao}` },
      { type: 'entrada', tenant_id: tenantA, value: 999, date: `${ao}-${mo}-10` },
      { type: 'entrada', tenant_id: tenantA, value: 999, date: 'lixo' },
      { type: 'entrada', tenant_id: tenantB, value: 999, date: `${dia}/${mes}/${ano}` },
      { type: 'saida', tenant_id: tenantA, value: 30, date: `05/${mes}/${ano}` },
    ];
    const res = await chamar('get', '/api/dashboard/kpis', token(tenantA));
    expect(res.status).toBe(200);
    expect(res.body.receitaMensal).toBe(150);
    expect(res.body.despesaMensal).toBe(30);
    expect(res.body.crm.receitaTotal).toBe(150);
  });

  test('usuário sem clínica → 403', async () => {
    const res = await chamar('get', '/api/dashboard', token(null));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/comercial/painel', () => {
  test('sem colunas inexistentes; joins e subconsultas filtram a clínica', async () => {
    const res = await chamar('get', '/api/comercial/painel', token(tenantA));
    expect(res.status).toBe(200);
    const ag = sqlLog.find(q => /FROM agendamentos a/.test(q.text));
    expect(ag.text).toMatch(/l\.paciente_id = a\.paciente_id AND l\.tenant_id = a\.tenant_id/);
    const fu = sqlLog.find(q => /FROM chat_messages cm/.test(q.text));
    expect(fu.text).toMatch(/cm\.tenant_id = l\.tenant_id/);
    for (const q of sqlLog) expect(q.params).toContain(tenantA);
    semColunasInexistentes();
  });

  test('attendantId inválido (admin) → 400', async () => {
    const res = await chamar('get', '/api/comercial/painel?attendantId=xyz', token(tenantA));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/crm/leads/:id/convert-to-patient', () => {
  test('não lê crm_leads.cpf; CPF opcional vem do corpo', async () => {
    const res = await chamar('post', `/api/crm/leads/${leadDaA}/convert-to-patient`, token(tenantA), { cpf: '123' });
    expect(res.status).toBe(200);
    const sel = sqlLog.find(q => /FROM crm_leads WHERE id/.test(q.text));
    expect(sel.text).not.toMatch(/cpf/);
    const ins = sqlLog.find(q => /INSERT INTO pacientes/.test(q.text));
    expect(ins.params[2]).toBe('123');
    expect(ins.params[6]).toBe(tenantA);
  });

  test('lead de outra clínica → 404', async () => {
    const res = await chamar('post', `/api/crm/leads/${leadDaA}/convert-to-patient`, token(tenantB));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/ai/reports com prescricoes que não é lista', () => {
  test('objeto, texto inválido e null não derrubam a rota', async () => {
    reportRows = [
      { id: 'r1', patient_id: 'p1', prescricoes: { item: 'x' } },
      { id: 'r2', patient_id: 'p2', prescricoes: 'não é json' },
      { id: 'r3', patient_id: 'p3', prescricoes: null },
      { id: 'r4', patient_id: 'p4', prescricoes: [{ nome: 'Amoxicilina' }] },
    ];
    const res = await chamar('get', '/api/ai/reports?status=com_prescricao', token(tenantA));
    expect(res.status).toBe(200);
    expect(res.body.stats.com_prescricao).toBe(1);
    const q = sqlLog.find(x => /FROM clinical_reports/.test(x.text));
    expect(q.text).toMatch(/jsonb_typeof\(prescricoes\) = 'array'/);
  });
});

describe('métricas com ?days inválido', () => {
  test.each(['/api/metrics/attendance?days=abc', '/api/automations/stats?days=abc'])('%s usa 30 dias', async (url) => {
    const res = await chamar('get', url, token(tenantA));
    expect(res.status).toBe(200);
    expect(sqlLog.some(q => /NaN/.test(q.text))).toBe(false);
    expect(sqlLog.some(q => /INTERVAL '30 days'/.test(q.text))).toBe(true);
  });
});
