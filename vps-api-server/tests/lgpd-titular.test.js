// LGPD: direitos do titular (/api/lgpd/*) e registro de acesso ao prontuário, entre clínicas.
// Regras do parecer jurídico (docs/juridico/parecer-pr59-retencao-lgpd.md) e ressalvas do Igor.
// pool.query e pool.connect são mockados (nenhuma query chega ao Postgres).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const { limparCacheInventarioParaTestes, chaveTelefone, montarRespostaTitular } = await import('../lgpd.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const pacienteDaB = '33333333-3333-3333-3333-333333333333';
const adminId = '44444444-4444-4444-4444-444444444444';
const leadLigado = '66666666-6666-6666-6666-666666666666';
const leadPossivel = '88888888-8888-8888-8888-888888888888';

const token = (extra = {}) => jwt.sign({
  sub: adminId, email: 'admin@clinica.test', role: 'admin', tenant_id: tenantB, is_super_admin: false, ...extra,
}, JWT_SECRET);
const IDENT = { conferida_por: 'Recepção (Ana)', documento: 'rg' };

const INVENTARIO = {
  pacientes: ['id', 'tenant_id', 'nome', 'telefone', 'cpf', 'email', 'data_nascimento', 'created_at'],
  prontuarios: ['id', 'tenant_id', 'paciente_id', 'descricao', 'titulo', 'created_at', 'updated_at'],
  agendamentos: ['id', 'tenant_id', 'paciente_id', 'status', 'data', 'created_at'],
  financeiro: ['id', 'tenant_id', 'paciente_id', 'valor', 'data', 'created_at'],
  assinaturas_eletronicas: ['id', 'tenant_id', 'paciente_id', 'assinatura_base64', 'created_at'],
  crm_leads: ['id', 'tenant_id', 'paciente_id', 'telefone', 'nome', 'created_at'],
  chat_messages: ['id', 'tenant_id', 'phone', 'lead_id', 'content', 'timestamp'],
  tag_assignments: ['id', 'lead_id', 'tag_id'],
  tabela_de_outro: ['id', 'paciente_id'], // sem tenant_id: nunca tocada, aparece em sem_regra
  whatsapp_opt_outs: ['tenant_id', 'phone_key', 'phone'],
  acessos_prontuario: ['id', 'tenant_id', 'usuario_id', 'paciente_id', 'recurso', 'acao', 'em'],
};
const NAO_NULO = new Set(['pacientes.nome', 'prontuarios.titulo']);

let sqlLog, solicitacoes, cenario;
const cenarioPadrao = () => ({
  ultimoClinico: new Date().toISOString(),           // prontuário recente: guarda em vigor
  ultimoComercial: '2010-01-01T00:00:00Z',
  ultimoFiscal: '2010-01-01T00:00:00Z',
  ultimaConversa: new Date().toISOString(),
  nascimento: '1980-05-05',
  temFinanceiro: false,
});

function responder(sql, params = []) {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  sqlLog.push({ text, params });
  const vazio = { rows: [], rowCount: 0 };
  if (/FROM information_schema\.columns/.test(text)) {
    return { rows: Object.entries(INVENTARIO).flatMap(([t, cs]) => cs.map(c => ({
      table_name: t, column_name: c, is_nullable: NAO_NULO.has(`${t}.${c}`) ? 'NO' : 'YES' }))) };
  }
  if (/FROM user_roles WHERE user_id/.test(text)) return vazio;
  if (/^SELECT \* FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(text) || /^SELECT 1 FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
    const ok = params[0] === pacienteDaB && params[1] === tenantB;
    return ok ? { rows: [{ id: pacienteDaB, tenant_id: tenantB, nome: 'Fulana Teste', telefone: '(11) 98888-7777', data_nascimento: cenario.nascimento }], rowCount: 1 } : vazio;
  }
  if (/^SELECT id::text AS id FROM crm_leads WHERE tenant_id = \$1 AND paciente_id/.test(text)) return params[0] === tenantB ? { rows: [{ id: leadLigado }] } : vazio;
  if (/^SELECT id::text AS id, nome, created_at FROM crm_leads/.test(text)) return params[0] === tenantB ? { rows: [{ id: leadPossivel, nome: 'Outra pessoa', created_at: '2025-01-01' }] } : vazio;
  const cont = text.match(/^SELECT count\(\*\)::int AS n, .* FROM "([a-z_]+)" WHERE (.*)$/);
  if (cont) {
    const [, t, w] = cont;
    const porTelefone = /regexp_replace/.test(w);
    const leadPorId = t === 'crm_leads' && /id::text = \$\d+$/.test(w);
    if (t === 'prontuarios') return { rows: [{ n: 2, ultimo: cenario.ultimoClinico }] };
    if (t === 'agendamentos') return /NOT COALESCE/.test(w) ? { rows: [{ n: 1, ultimo: cenario.ultimoComercial }] } : { rows: [{ n: 1, ultimo: cenario.ultimoClinico }] };
    if (t === 'financeiro') return { rows: [{ n: cenario.temFinanceiro ? 1 : 0, ultimo: cenario.ultimoFiscal }] };
    if (t === 'assinaturas_eletronicas') return { rows: [{ n: 1, ultimo: cenario.ultimoClinico }] };
    if (t === 'crm_leads') return { rows: [{ n: 1, ultimo: '2025-01-01' }] };
    if (t === 'chat_messages') return porTelefone ? { rows: [{ n: 3, ultimo: cenario.ultimaConversa }] }
      : /= ANY/.test(w) ? { rows: [{ n: 5, ultimo: cenario.ultimaConversa }] } : { rows: [{ n: 2, ultimo: cenario.ultimaConversa }] };
    if (t === 'tag_assignments') return { rows: [{ n: 1, ultimo: null }] };
    void leadPorId;
    return { rows: [{ n: 0, ultimo: null }] };
  }
  if (/^SELECT \* FROM "/.test(text)) return { rows: [{ id: 'linha', tabela: text.match(/FROM "([a-z_]+)"/)[1] }] };
  if (/^SELECT nome FROM tenants/.test(text)) return { rows: [{ nome: 'Clínica B' }] };
  if (/^INSERT INTO lgpd_solicitacoes/.test(text)) {
    const recusada = /'recusada'/.test(text);
    const s = {
      id: '77777777-7777-7777-7777-77777777777' + solicitacoes.length,
      tenant_id: params[0], paciente_id: params[1], tipo: params[2],
      status: recusada ? 'recusada' : 'aguardando_confirmacao',
      identidade_conferida_por: params[7], identidade_documento: params[8], representante_vinculo: params[10],
      eliminar_conversas: params[12], solicitado_em: new Date().toISOString(),
      codigo_hash: recusada ? null : params[13],
      expira_em: new Date(Date.now() + 15 * 60000).toISOString(), tentativas: 0,
    };
    solicitacoes.push(s);
    return { rows: [s], rowCount: 1 };
  }
  if (/^SELECT \* FROM lgpd_solicitacoes WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/.test(text)) {
    const s = solicitacoes.find(x => x.id === params[0] && x.tenant_id === params[1]);
    return s ? { rows: [s], rowCount: 1 } : vazio;
  }
  if (/^UPDATE lgpd_solicitacoes SET status = 'executada'/.test(text)) {
    const s = solicitacoes.find(x => x.id === params[0] && x.tenant_id === params[1]);
    if (s) { s.status = 'executada'; s.codigo_hash = null; }
    return { rows: [], rowCount: s ? 1 : 0 };
  }
  if (/^(DELETE|UPDATE|INSERT)/.test(text)) return { rows: [], rowCount: 1 };
  return vazio;
}

const chamar = (method, url, tk, body) => {
  const r = request(app)[method](url).set('Authorization', `Bearer ${tk}`);
  return body ? r.send(body) : r;
};
const criar = (tk, body) => chamar('post', '/api/lgpd/solicitacoes', tk, { identidade: IDENT, ...body });
const confirmar = (tk, id, body) => chamar('post', `/api/lgpd/solicitacoes/${id}/confirmar`, tk, body);
const tocou = (re) => sqlLog.filter(q => re.test(q.text));
const tabelaDe = (q) => q.text.match(/(?:FROM|UPDATE) "?([a-z_]+)"?/)[1];

describe('LGPD — direitos do titular e acesso ao prontuário', () => {
  let spyQuery, spyConnect;
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  beforeEach(() => {
    sqlLog = []; solicitacoes = []; cenario = cenarioPadrao();
    limparCacheInventarioParaTestes();
    spyQuery = jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => responder(sql, params));
    spyConnect = jest.spyOn(pool, 'connect').mockImplementation(async () => ({
      query: async (sql, params) => responder(sql, params), release: () => {},
    }));
  });
  afterEach(() => { spyQuery.mockRestore(); spyConnect.mockRestore(); });
  afterAll(async () => { await pool.end(); });

  test('chave de telefone casa com e sem 55 e com o nono dígito', () => {
    expect(chaveTelefone('5511988887777')).toBe(chaveTelefone('(11) 98888-7777'));
    expect(chaveTelefone('551188887777')).toBe(chaveTelefone('11 98888-7777'));
    expect(chaveTelefone('123')).toBeNull();
  });

  describe('permissões, isolamento e identidade', () => {
    test('admin da clínica A pedindo pelo paciente da B recebe 404 e nada é gravado', async () => {
      const res = await criar(token({ tenant_id: tenantA }), { paciente_id: pacienteDaB, tipo: 'excluir' });
      expect(res.status).toBe(404);
      expect(tocou(/INSERT INTO lgpd_solicitacoes/)).toHaveLength(0);
    });

    test('usuário que não é admin recebe 403; super-admin também', async () => {
      expect((await criar(token({ role: 'dentista' }), { paciente_id: pacienteDaB, tipo: 'exportar' })).status).toBe(403);
      const sup = await request(app).post('/api/lgpd/solicitacoes')
        .set('Authorization', `Bearer ${token({ tenant_id: null, is_super_admin: true })}`)
        .set('X-Tenant-Id', tenantB).send({ paciente_id: pacienteDaB, tipo: 'exportar', identidade: IDENT });
      expect(sup.status).toBe(403);
      expect(tocou(/lgpd_solicitacoes/)).toHaveLength(0);
    });

    test('sem identidade conferida: 400', async () => {
      const res = await chamar('post', '/api/lgpd/solicitacoes', token(), { paciente_id: pacienteDaB, tipo: 'excluir' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/conferiu a identidade/);
    });

    test('paciente menor de 18 sem responsável: 400; com responsável: grava o vínculo', async () => {
      cenario.nascimento = `${new Date().getFullYear() - 10}-01-01`;
      const sem = await criar(token(), { paciente_id: pacienteDaB, tipo: 'exportar' });
      expect(sem.status).toBe(400);
      const com = await criar(token(), { paciente_id: pacienteDaB, tipo: 'exportar',
        identidade: { ...IDENT, representante: { nome: 'Mãe Teste', vinculo: 'mãe' } } });
      expect(com.status).toBe(201);
      const ins = tocou(/INSERT INTO lgpd_solicitacoes/)[0];
      expect(ins.params[9]).toBe('Mãe Teste');
      expect(ins.params[10]).toBe('mãe');
    });

    test('clínica A não confirma solicitação da B (404, sem DELETE)', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir' });
      sqlLog = [];
      const res = await confirmar(token({ tenant_id: tenantA }), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR' });
      expect(res.status).toBe(404);
      expect(tocou(/^DELETE/)).toHaveLength(0);
    });

    test('tabela com paciente_id e sem tenant_id: listada em sem_regra e nunca consultada', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'exportar' });
      expect(c.body.previa.sem_regra).toContain('tabela_de_outro');
      expect(tocou(/tabela_de_outro/)).toHaveLength(0);
    });
  });

  describe('prazos de guarda (parecer)', () => {
    test('menor: guarda até os 21 anos quando isso passa dos 20 anos do último registro', async () => {
      // bebê atendido agora: faz 21 anos depois dos 20 anos do último registro
      const nasc = new Date(); nasc.setMonth(nasc.getMonth() - 6);
      cenario.nascimento = nasc.toISOString().slice(0, 10);
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'exportar',
        identidade: { ...IDENT, representante: { nome: 'Pai', vinculo: 'pai' } } });
      const ate = new Date(c.body.previa.retencao.prontuario_ate);
      expect(ate.getUTCFullYear()).toBe(new Date(cenario.nascimento).getUTCFullYear() + 21);
      expect(c.body.previa.retencao.menor_regra_21).toBe(true);
    });

    test('financeiro: 5 anos a partir de 1º de janeiro do ano seguinte', async () => {
      cenario.temFinanceiro = true; cenario.ultimoFiscal = '2024-03-10T12:00:00Z';
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'exportar' });
      expect(c.body.previa.retencao.fiscal_ate).toBe('2030-01-01T00:00:00.000Z');
    });

    test('agenda cancelada/futura e orçamento não aprovado não empurram o prazo do prontuário', async () => {
      cenario.ultimoClinico = '2000-01-01T00:00:00Z';
      cenario.ultimoComercial = new Date().toISOString();
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'anonimizar' });
      expect(c.status).toBe(409);
      expect(new Date(c.body.previa.retencao.prontuario_ate).getUTCFullYear()).toBe(2020);
      expect(c.body.previa.retencao.prontuario_em_vigor).toBe(false);
      expect(c.body.previa.retencao.comercial_em_vigor).toBe(true);
      expect(c.body.previa.grupos.comercial).toEqual({ agendamentos: 1 });
      expect(c.body.resposta_titular).toMatch(/Não é possível anonimizar/);
      const contClinico = tocou(/FROM "agendamentos" WHERE/).find(q => !/NOT COALESCE/.test(q.text));
      expect(contClinico.text).toMatch(/status IN \('realizado'/);
    });
  });

  describe('excluir com prontuário em guarda', () => {
    test('confirmação dupla: frase errada não apaga nada', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir' });
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'SIM' });
      expect(res.status).toBe(422);
      expect(tocou(/^DELETE/)).toHaveLength(0);
    });

    test('elimina só o relacionamento ligado ao paciente; conversas de paciente ficam; possível vínculo só se marcado', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir', motivo: 'pedido por e-mail' });
      expect(c.status).toBe(201);
      expect(c.body.previa.aviso_motivo).toMatch(/Não descreva sintomas/);
      expect(c.body.previa.possiveis.map(p => p.item).sort()).toEqual([`lead:${leadPossivel}`, 'telefone']);
      expect(c.body.previa.retencao.conversas_em_vigor).toBe(true);
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR' });
      expect(res.status).toBe(200);
      const deletes = tocou(/^DELETE/);
      expect(deletes.map(tabelaDe).sort()).toEqual(['crm_leads', 'tag_assignments']);
      // lead possível (pelo telefone) não foi apagado
      expect(deletes.some(d => d.params.includes(leadPossivel))).toBe(false);
      for (const d of deletes.filter(x => tabelaDe(x) === 'crm_leads')) {
        expect(d.text).toMatch(/WHERE tenant_id = \$1 AND/);
        expect(d.params[0]).toBe(tenantB);
      }
      expect(res.body.resumo.conversas).toBe('retidas');
      expect(res.body.resumo.retidos).toMatchObject({ prontuarios: 2, chat_messages: 5 });
      expect(res.body.resumo.cadastro).toBe('retido');
      // opt-out só com a chave do telefone
      const opt = tocou(/INSERT INTO whatsapp_opt_outs/)[0];
      expect(opt.params).toEqual([tenantB, expect.any(String)]);
      expect(opt.text).not.toMatch(/\bphone\b,/);
      // texto para o titular (redação do parecer)
      expect(res.body.resposta_titular).toMatch(/Olá, Fulana Teste/);
      expect(res.body.resposta_titular).toMatch(/Lei nº 13\.787\/2018, art\. 6º/);
      expect(res.body.resposta_titular).toMatch(/\d{2}\/\d{2}\/\d{4}/);
      expect(res.body.resposta_titular).toMatch(/histórico de conversas até/);
      // resumo gravado sem conteúdo
      const fim = tocou(/UPDATE lgpd_solicitacoes SET status = 'executada'/)[0];
      expect(fim.params[4]).not.toMatch(/Fulana/);
      // código de uso único
      expect((await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR' })).status).toBe(409);
    });

    test('clínica opta por eliminar conversas e marca o lead possível: só o marcado entra', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir', eliminar_conversas: true });
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, {
        codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR', possiveis_confirmados: [`lead:${leadPossivel}`] });
      expect(res.status).toBe(200);
      const deletes = tocou(/^DELETE/);
      expect(deletes.filter(d => tabelaDe(d) === 'chat_messages').length).toBeGreaterThan(0);
      expect(deletes.some(d => d.params.includes(leadPossivel))).toBe(true);
      expect(deletes.some(d => /regexp_replace/.test(d.text))).toBe(false); // item "telefone" não marcado
      expect(res.body.resumo.conversas).toBe('eliminadas');
      // chat antes do lead (FK)
      const idxChat = sqlLog.findIndex(q => /^DELETE FROM "chat_messages"/.test(q.text));
      const idxLead = sqlLog.findIndex(q => /^DELETE FROM "crm_leads"/.test(q.text));
      expect(idxChat).toBeLessThan(idxLead);
      expect(res.body.resposta_titular).toMatch(/histórico de atendimento pelo WhatsApp/);
    });

    test('item de possível vínculo que não está na prévia: 400 sem apagar', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir' });
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, {
        codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR', possiveis_confirmados: ['lead:99999999-9999-9999-9999-999999999999'] });
      expect(res.status).toBe(400);
      expect(tocou(/^DELETE/)).toHaveLength(0);
    });
  });

  describe('todos os prazos vencidos', () => {
    beforeEach(() => {
      cenario.ultimoClinico = '2000-01-01T00:00:00Z';
      cenario.ultimaConversa = '2010-01-01T00:00:00Z';
    });

    test('excluir elimina também prontuário e cadastro', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir' });
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR' });
      expect(res.status).toBe(200);
      expect(tocou(/DELETE FROM "prontuarios" WHERE tenant_id = \$1/)).toHaveLength(1);
      expect(tocou(/DELETE FROM pacientes WHERE id = \$1 AND tenant_id = \$2/)[0].params).toEqual([pacienteDaB, tenantB]);
      expect(res.body.resumo.cadastro).toBe('eliminado');
      expect(res.body.resposta_titular).toMatch(/todos os seus dados nesta clínica foram eliminados/);
    });

    test('anonimizar apaga o texto clínico livre e a assinatura, além dos identificadores', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'anonimizar' });
      expect(c.status).toBe(201);
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'ANONIMIZAR' });
      expect(res.status).toBe(200);
      const pront = tocou(/^UPDATE "prontuarios" SET/)[0];
      expect(pront.text).toMatch(/"descricao" = NULL/);
      expect(pront.text).not.toMatch(/"titulo" = NULL/); // NOT NULL no banco: não mexe
      expect(tocou(/^DELETE FROM "assinaturas_eletronicas"/)).toHaveLength(1);
      const pac = tocou(/^UPDATE pacientes SET/)[0];
      expect(pac.text).toMatch(/"cpf" = NULL/);
      expect(pac.text).toMatch(/"data_nascimento" = NULL/);
      expect(pac.params).toEqual([pacienteDaB, tenantB]);
    });
  });

  test('exportar: só o que está ligado ao paciente; possível vínculo fica de fora se não marcado', async () => {
    const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'exportar' });
    sqlLog = [];
    const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXPORTAR' });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.titular.id).toBe(pacienteDaB);
    expect(res.body.completo).toBe(true);
    const selects = tocou(/^SELECT \* FROM "/);
    expect(selects.some(s => /regexp_replace/.test(s.text))).toBe(false);
    expect(selects.some(s => s.params.includes(leadPossivel))).toBe(false);
    for (const s of selects) {
      if (/tag_assignments/.test(s.text)) continue;
      expect(s.text).toMatch(/WHERE tenant_id = \$1/);
      expect(s.params[0]).toBe(tenantB);
    }
    expect(res.body.entrega).toMatch(/meio seguro/);
    expect(tocou(/^DELETE|^UPDATE pacientes/)).toHaveLength(0);
  });

  test('código expirado: 410 e nada é feito', async () => {
    const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir' });
    solicitacoes[0].expira_em = new Date(Date.now() - 1000).toISOString();
    sqlLog = [];
    const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR' });
    expect(res.status).toBe(410);
    expect(tocou(/^DELETE/)).toHaveLength(0);
  });

  test('texto ao titular só cita sistemas integrados quando existem', () => {
    const r = { prontuario_em_vigor: true, prontuario_ate: '2046-01-01T00:00:00Z' };
    const sem = montarRespostaTitular({ tipo: 'excluir', nome: 'X', dataPedido: '2026-11-05', clinica: 'C', retencao: r });
    expect(sem).not.toMatch(/Sistemas integrados/);
    const com = montarRespostaTitular({ tipo: 'excluir', nome: 'X', dataPedido: '2026-11-05', clinica: 'C', retencao: r, sistemas: ['Clinicorp'] });
    expect(com).toMatch(/Sistemas integrados: pedimos também a exclusão em Clinicorp/);
  });

  describe('registro de acesso ao prontuário', () => {
    test.each([['anamnese'], ['odontograma']])('GET %s grava quem, paciente e recurso, sem conteúdo', async (recurso) => {
      const res = await chamar('get', `/api/pacientes/${pacienteDaB}/${recurso}`, token({ role: 'dentista' }));
      expect(res.status).toBe(200);
      await new Promise(r => setImmediate(r));
      const ins = tocou(/INSERT INTO acessos_prontuario/);
      expect(ins).toHaveLength(1);
      expect(ins[0].params).toEqual([tenantB, adminId, [pacienteDaB], recurso, 'visualizar']);
    });

    test('clínica A abrindo anamnese da B: 404 e nenhum registro', async () => {
      const res = await chamar('get', `/api/pacientes/${pacienteDaB}/anamnese`, token({ tenant_id: tenantA }));
      expect(res.status).toBe(404);
      await new Promise(r => setImmediate(r));
      expect(tocou(/INSERT INTO acessos_prontuario/)).toHaveLength(0);
    });

    test.each([
      ['/api/prontuarios', /FROM prontuarios pr/, 'paciente_id', 'prontuario', 'visualizar'],
      [`/api/ai/reports/${pacienteDaB}`, /FROM clinical_reports WHERE patient_id/, 'patient_id', 'relatorio_clinico', 'visualizar'],
      ['/api/ai/reports/export.csv', /FROM clinical_reports/, 'patient_id', 'relatorio_clinico', 'exportar'],
    ])('%s registra cada paciente retornado', async (url, re, col, recurso, acao) => {
      spyQuery.mockImplementation(async (sql, params) => {
        if (re.test(String(sql)) && !/INSERT/.test(String(sql))) {
          sqlLog.push({ text: String(sql), params });
          return { rows: [{ id: 'a', [col]: pacienteDaB, created_at: new Date() }, { id: 'b', [col]: pacienteDaB, created_at: new Date() }, { id: 'c', [col]: null, created_at: new Date() }] };
        }
        return responder(sql, params);
      });
      const res = await chamar('get', url, token({ role: 'admin' }));
      expect(res.status).toBe(200);
      await new Promise(r => setImmediate(r));
      const ins = tocou(/INSERT INTO acessos_prontuario/);
      expect(ins[0].params[2]).toEqual([pacienteDaB]);
      expect(ins[0].params[3]).toBe(recurso);
      expect(ins[0].params[4]).toBe(acao);
    });
  });
});
