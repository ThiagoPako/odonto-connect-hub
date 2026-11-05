// LGPD: direitos do titular (/api/lgpd/*) e registro de acesso ao prontuário, entre clínicas.
// pool.query e pool.connect são mockados (nenhuma query chega ao Postgres). JWT_SECRET vem do
// ambiente, como nos outros testes desta pasta.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const { limparCacheInventarioParaTestes, chaveTelefone } = await import('../lgpd.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const pacienteDaB = '33333333-3333-3333-3333-333333333333';
const adminId = '44444444-4444-4444-4444-444444444444';
const leadDaB = '66666666-6666-6666-6666-666666666666';

const token = (extra = {}) => jwt.sign({
  sub: adminId, email: 'admin@clinica.test', role: 'admin', tenant_id: tenantB, is_super_admin: false, ...extra,
}, JWT_SECRET);

const INVENTARIO = {
  pacientes: ['id', 'tenant_id', 'nome', 'telefone', 'cpf', 'email', 'created_at'],
  prontuarios: ['id', 'tenant_id', 'paciente_id', 'descricao', 'created_at', 'updated_at'],
  financeiro: ['id', 'tenant_id', 'paciente_id', 'valor', 'created_at'],
  crm_leads: ['id', 'tenant_id', 'paciente_id', 'telefone', 'nome'],
  chat_messages: ['id', 'tenant_id', 'phone', 'lead_id', 'content'],
  tag_assignments: ['id', 'lead_id', 'tag_id'],
  tabela_de_outro: ['id', 'paciente_id'], // sem tenant_id: nunca pode ser tocada
  whatsapp_opt_outs: ['tenant_id', 'phone_key', 'phone'],
  acessos_prontuario: ['id', 'tenant_id', 'usuario_id', 'paciente_id', 'recurso', 'acao', 'em'],
};

let sqlLog;
let solicitacoes;
let ultimoClinico; // data do último registro clínico (retenção)

function responder(sql, params = []) {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  sqlLog.push({ text, params });
  const vazio = { rows: [], rowCount: 0 };
  if (/FROM information_schema\.columns/.test(text)) {
    return { rows: Object.entries(INVENTARIO).flatMap(([t, cs]) => cs.map(c => ({ table_name: t, column_name: c }))) };
  }
  if (/FROM user_roles WHERE user_id/.test(text)) return vazio; // ninguém é admin por user_roles
  if (/^SELECT \* FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(text) || /^SELECT 1 FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
    const ok = params[0] === pacienteDaB && params[1] === tenantB;
    return ok ? { rows: [{ id: pacienteDaB, tenant_id: tenantB, nome: 'Fulana Teste', telefone: '(11) 98888-7777' }], rowCount: 1 } : vazio;
  }
  if (/^SELECT id::text AS id FROM crm_leads/.test(text)) return params[0] === tenantB ? { rows: [{ id: leadDaB }] } : vazio;
  const cont = text.match(/^SELECT count\(\*\)::int AS n, .* FROM "([a-z_]+)"/);
  if (cont) {
    const n = { prontuarios: 2, financeiro: 0, crm_leads: 1, chat_messages: 5, tag_assignments: 1 }[cont[1]] ?? 0;
    return { rows: [{ n, ultimo: cont[1] === 'prontuarios' ? ultimoClinico : null }] };
  }
  if (/^SELECT \* FROM "prontuarios"/.test(text)) return { rows: [{ id: 'p1', paciente_id: pacienteDaB }] };
  if (/^SELECT nome FROM tenants/.test(text)) return { rows: [{ nome: 'Clínica B' }] };
  if (/^INSERT INTO lgpd_solicitacoes/.test(text)) {
    const recusada = /'recusada'/.test(text);
    const s = {
      id: '77777777-7777-7777-7777-77777777777' + solicitacoes.length,
      tenant_id: params[0], paciente_id: params[1], tipo: params[2],
      status: recusada ? 'recusada' : 'aguardando_confirmacao',
      codigo_hash: recusada ? null : params[7],
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
const criar = (tk, body) => chamar('post', '/api/lgpd/solicitacoes', tk, body);
const confirmar = (tk, id, body) => chamar('post', `/api/lgpd/solicitacoes/${id}/confirmar`, tk, body);
const tocou = (re) => sqlLog.filter(q => re.test(q.text));

describe('LGPD — direitos do titular e acesso ao prontuário', () => {
  let spyQuery, spyConnect;
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  beforeEach(() => {
    sqlLog = []; solicitacoes = [];
    ultimoClinico = new Date().toISOString(); // prontuário recente: retenção em vigor
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

  describe('permissões e isolamento', () => {
    test('admin da clínica A pedindo pelo paciente da B recebe 404 e nada é gravado', async () => {
      const res = await criar(token({ tenant_id: tenantA }), { paciente_id: pacienteDaB, tipo: 'excluir' });
      expect(res.status).toBe(404);
      expect(tocou(/INSERT INTO lgpd_solicitacoes/)).toHaveLength(0);
      expect(tocou(/FROM information_schema/)).toHaveLength(0);
    });

    test('usuário que não é admin recebe 403', async () => {
      const res = await criar(token({ role: 'dentista' }), { paciente_id: pacienteDaB, tipo: 'exportar' });
      expect(res.status).toBe(403);
      expect(tocou(/lgpd_solicitacoes/)).toHaveLength(0);
    });

    test('super-admin da plataforma não executa pedido de titular', async () => {
      const res = await request(app).post('/api/lgpd/solicitacoes')
        .set('Authorization', `Bearer ${token({ tenant_id: null, is_super_admin: true })}`)
        .set('X-Tenant-Id', tenantB).send({ paciente_id: pacienteDaB, tipo: 'exportar' });
      expect(res.status).toBe(403);
    });

    test('clínica A não confirma solicitação da B (404, sem DELETE)', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir' });
      expect(c.status).toBe(201);
      sqlLog = [];
      const res = await confirmar(token({ tenant_id: tenantA }), c.body.solicitacao.id,
        { codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR' });
      expect(res.status).toBe(404);
      expect(tocou(/^DELETE/)).toHaveLength(0);
    });

    test('histórico de solicitações e de acessos filtra pela clínica', async () => {
      await chamar('get', '/api/lgpd/solicitacoes', token());
      await chamar('get', `/api/lgpd/pacientes/${pacienteDaB}/acessos`, token());
      const lista = tocou(/FROM lgpd_solicitacoes WHERE tenant_id = \$1/);
      expect(lista[0].params[0]).toBe(tenantB);
      const acessos = tocou(/FROM acessos_prontuario a/);
      expect(acessos[0].text).toMatch(/a\.tenant_id = \$1/);
      expect(acessos[0].params[0]).toBe(tenantB);
      const outra = await chamar('get', `/api/lgpd/pacientes/${pacienteDaB}/acessos`, token({ tenant_id: tenantA }));
      expect(outra.status).toBe(404);
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

    test('elimina só relacionamento, retém prontuário e cadastro, registra opt-out', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir', motivo: 'pedido por e-mail' });
      expect(c.status).toBe(201);
      expect(c.body.previa.retencao.em_vigor).toBe(true);
      expect(c.body.confirmacao.frase).toBe('EXCLUIR');
      expect(c.body.solicitacao).not.toHaveProperty('codigo_hash');
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo.toLowerCase(), frase: 'excluir' });
      expect(res.status).toBe(200);
      const deletes = tocou(/^DELETE/);
      expect(deletes.map(d => d.text.match(/FROM "?([a-z_]+)"?/)[1]).sort())
        .toEqual(['chat_messages', 'crm_leads', 'tag_assignments']);
      for (const d of deletes.filter(x => !/tag_assignments/.test(x.text))) {
        expect(d.text).toMatch(/WHERE tenant_id = \$1 AND/);
        expect(d.params[0]).toBe(tenantB);
      }
      expect(tocou(/DELETE FROM "?(prontuarios|pacientes|tabela_de_outro)/)).toHaveLength(0);
      expect(res.body.resumo.retidos).toMatchObject({ prontuarios: 2 });
      expect(res.body.resumo.cadastro).toBe('retido');
      const opt = tocou(/INSERT INTO whatsapp_opt_outs/);
      expect(opt).toHaveLength(1);
      expect(opt[0].params[0]).toBe(tenantB);
      // resumo gravado não leva conteúdo (só contagens)
      const fim = tocou(/UPDATE lgpd_solicitacoes SET status = 'executada'/)[0];
      expect(fim.params[4]).not.toMatch(/Fulana|descricao/);
      // código é de uso único
      const de_novo = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR' });
      expect(de_novo.status).toBe(409);
    });

    test('anonimizar é recusado e o motivo fica registrado (art. 18 § 4º II)', async () => {
      const res = await criar(token(), { paciente_id: pacienteDaB, tipo: 'anonimizar' });
      expect(res.status).toBe(409);
      expect(res.body.solicitacao.status).toBe('recusada');
      expect(res.body.error).toMatch(/Lei 13\.787/);
      expect(tocou(/UPDATE pacientes/)).toHaveLength(0);
    });
  });

  describe('prazo de guarda vencido', () => {
    beforeEach(() => { ultimoClinico = '2000-01-01T00:00:00Z'; });

    test('excluir elimina também prontuário e cadastro', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'excluir' });
      expect(c.body.previa.retencao.em_vigor).toBe(false);
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXCLUIR' });
      expect(res.status).toBe(200);
      expect(tocou(/DELETE FROM "prontuarios" WHERE tenant_id = \$1/)).toHaveLength(1);
      const pac = tocou(/DELETE FROM pacientes WHERE id = \$1 AND tenant_id = \$2/);
      expect(pac[0].params).toEqual([pacienteDaB, tenantB]);
      expect(res.body.resumo.cadastro).toBe('eliminado');
    });

    test('anonimizar tira identificadores do cadastro da própria clínica', async () => {
      const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'anonimizar' });
      expect(c.status).toBe(201);
      sqlLog = [];
      const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'ANONIMIZAR' });
      expect(res.status).toBe(200);
      const upd = tocou(/^UPDATE pacientes SET/)[0];
      expect(upd.text).toMatch(/"cpf" = NULL/);
      expect(upd.text).toMatch(/"telefone" = NULL/);
      expect(upd.params).toEqual([pacienteDaB, tenantB]);
      expect(tocou(/DELETE FROM pacientes/)).toHaveLength(0);
    });
  });

  test('exportar devolve o JSON do titular e só lê da clínica', async () => {
    const c = await criar(token(), { paciente_id: pacienteDaB, tipo: 'exportar' });
    sqlLog = [];
    const res = await confirmar(token(), c.body.solicitacao.id, { codigo: c.body.confirmacao.codigo, frase: 'EXPORTAR' });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.titular.id).toBe(pacienteDaB);
    expect(res.body.dados.prontuarios).toHaveLength(1);
    for (const s of tocou(/^SELECT \* FROM "/)) {
      if (/tag_assignments/.test(s.text)) continue;
      expect(s.text).toMatch(/WHERE tenant_id = \$1/);
      expect(s.params[0]).toBe(tenantB);
    }
    expect(tocou(/tabela_de_outro/)).toHaveLength(0);
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

    test('lista de prontuários registra cada paciente retornado', async () => {
      spyQuery.mockImplementation(async (sql, params) => {
        if (/FROM prontuarios pr/.test(String(sql))) {
          sqlLog.push({ text: String(sql), params });
          return { rows: [{ id: 'a', paciente_id: pacienteDaB }, { id: 'b', paciente_id: pacienteDaB }, { id: 'c', paciente_id: null }] };
        }
        return responder(sql, params);
      });
      const res = await chamar('get', '/api/prontuarios', token({ role: 'dentista' }));
      expect(res.status).toBe(200);
      await new Promise(r => setImmediate(r));
      const ins = tocou(/INSERT INTO acessos_prontuario/);
      expect(ins[0].params[2]).toEqual([pacienteDaB]);
      expect(ins[0].params[3]).toBe('prontuario');
    });
  });
});
