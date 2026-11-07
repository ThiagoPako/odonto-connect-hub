// Isolamento entre clínicas nas rotas /api/pacientes/*.
//
// Requisitos do ambiente:
// - JWT_SECRET definido (env ou vps-api-server/.env). Sem ele o server.mjs encerra o
//   processo ao ser importado; o CI define em .github/workflows/backend-tests.yml.
// - verifyUser aceita token HS256 assinado com JWT_SECRET porque LEGACY_JWT_ENABLED é
//   constante `true` em server.mjs. Se isso mudar, estes tokens deixam de valer.
// - pool.query é mockado: nenhuma query chega ao Postgres, mas importar server.mjs
//   cria o Pool (como nos outros testes desta pasta).
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { limparCachePapel, _definirPapelParaTestes } from '../papeis.mjs';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const { app, pool } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

describe('Isolamento entre clínicas — rotas /api/pacientes/:id', () => {
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  const pacienteDaB = '33333333-3333-3333-3333-333333333333';
  const agendamentoDaB = '55555555-5555-5555-5555-555555555555';
  let querySpy;
  let sqlLog;

  const token = (extra = {}) => jwt.sign({
    sub: '44444444-4444-4444-4444-444444444444',
    email: 'admin@clinica.com',
    role: 'admin',
    tenant_id: tenantA,
    is_super_admin: false,
    ...extra,
  }, JWT_SECRET);
  const tokenA = () => token();
  const tokenB = () => token({ tenant_id: tenantB });

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    sqlLog = [];
    // Papel lido do banco (papeis.mjs): fixa no cache para o pool mockado.
    limparCachePapel();
    _definirPapelParaTestes('44444444-4444-4444-4444-444444444444', 'admin');
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      // pacientes e agendamentos só "existem" para a clínica B
      if (/FROM pacientes WHERE id(::text)?\s*=\s*\$1 AND tenant_id\s*=\s*\$2/.test(text)) {
        const ok = params[0] === pacienteDaB && params[1] === tenantB;
        return Promise.resolve({ rows: ok ? [{ '?column?': 1 }] : [], rowCount: ok ? 1 : 0 });
      }
      if (/FROM agendamentos WHERE id(::text)? = \$1 AND tenant_id = \$2/.test(text)) {
        const ok = params[0] === agendamentoDaB && params[1] === tenantB;
        return Promise.resolve({ rows: ok ? [{ '?column?': 1 }] : [], rowCount: ok ? 1 : 0 });
      }
      if (/^\s*(UPDATE|DELETE FROM) pacientes/.test(text)) {
        const ok = params.includes(pacienteDaB) && params.includes(tenantB);
        return Promise.resolve({ rows: [], rowCount: ok ? 1 : 0 });
      }
      // consentimento v2.0: a clínica B tem encarregado de dados cadastrado
      // termo completo exige CNPJ e endereço da clínica (LGPD art. 9º III)
      if (/SELECT nome, cnpj FROM tenants/.test(text)) {
        return Promise.resolve({ rows: [{ nome: 'Clínica B', cnpj: '00.000.000/0001-00' }], rowCount: 1 });
      }
      if (/FROM tenant_settings/.test(text) && params[1] === 'clinic_location') {
        return Promise.resolve({ rows: [{ value: { address: 'Rua B, 1' } }], rowCount: 1 });
      }
      if (/FROM tenant_settings/.test(text) && params[1] === 'lgpd_encarregado') {
        const ok = params[0] === tenantB;
        return Promise.resolve({ rows: ok ? [{ value: { nome: 'DPO B', contato: 'dpo@b' } }] : [], rowCount: ok ? 1 : 0 });
      }
      if (/INSERT INTO consentimentos_pacientes/.test(text)) {
        return Promise.resolve({ rows: [{ id: 'c1', tipo: params[2], versao: params[3] }], rowCount: 1 });
      }
      if (/SELECT \* FROM (anamneses|odontogramas)/.test(text)) {
        return Promise.resolve({ rows: [{ id: 'f1', paciente_id: params[0] }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  afterEach(() => querySpy.mockRestore());
  afterAll(async () => { await pool.end(); });

  const tocouTabela = (tabela) => sqlLog.some(q => new RegExp(`\\b(?:${tabela})\\b`, 'i').test(q.text));
  const chamar = (method, url, tk, body = {}) =>
    request(app)[method](url).set('Authorization', `Bearer ${tk}`).send(body);

  const rotasFilhas = [
    ['get', '/anamnese', 'anamneses'],
    ['put', '/anamnese', 'anamneses'],
    ['get', '/odontograma', 'odontogramas'],
    ['put', '/odontograma', 'odontogramas'],
    ['get', '/historico', 'agendamentos'],
    ['get', '/execucoes', 'procedimento_execucoes'],
  ];
  const corpo = { dentes: [], alergias: [] };

  describe('clínica A acessando paciente da clínica B', () => {
    test.each(rotasFilhas)('%s %s retorna 404 sem tocar %s', async (method, sufixo, tabela) => {
      const res = await chamar(method, `/api/pacientes/${pacienteDaB}${sufixo}`, tokenA(), corpo);
      expect(res.status).toBe(404);
      expect(tocouTabela(tabela)).toBe(false);
    });

    test('PUT /api/pacientes/:id retorna 404, filtra por tenant e não dispara Clinicorp', async () => {
      const res = await chamar('put', `/api/pacientes/${pacienteDaB}`, tokenA(), { nome: 'X' });
      expect(res.status).toBe(404);
      // O PUT lê o cadastro atual filtrando pela clínica do token e para no 404: nenhum UPDATE.
      const leitura = sqlLog.find(q => /SELECT cpf, telefone, email, data_nascimento FROM pacientes WHERE id = \$1 AND tenant_id = \$2/.test(q.text));
      expect(leitura.params).toEqual([pacienteDaB, tenantA]);
      expect(sqlLog.some(q => /UPDATE pacientes/.test(q.text))).toBe(false);
      // pushPatient começa com 'SELECT * FROM pacientes WHERE id = $1'
      expect(sqlLog.some(q => /SELECT \* FROM pacientes WHERE id = \$1$/.test(q.text))).toBe(false);
    });

    test('DELETE /api/pacientes/:id retorna 404', async () => {
      const res = await chamar('delete', `/api/pacientes/${pacienteDaB}`, tokenA());
      expect(res.status).toBe(404);
    });

    test('POST /consentimentos retorna 404 sem INSERT (paciente ou agendamento da B)', async () => {
      for (const id of [pacienteDaB, agendamentoDaB]) {
        const res = await chamar('post', `/api/pacientes/${id}/consentimentos`, tokenA(),
          { tipo: 'gravacao_transcricao_ia', decisao: 'autorizo', assinante_tipo: 'paciente', assinante_nome: 'Paciente', idade_informada: 30, assinatura: { base64: 'data:image/png;base64,iVBORw0KGgo=' } });
        expect(res.status).toBe(404);
      }
      expect(sqlLog.some(q => /INSERT INTO consentimentos_pacientes/.test(q.text))).toBe(false);
    });
  });

  describe('clínica B acessando o próprio paciente', () => {
    test.each(rotasFilhas)('%s %s retorna 200 e consulta %s', async (method, sufixo, tabela) => {
      const res = await chamar(method, `/api/pacientes/${pacienteDaB}${sufixo}`, tokenB(), corpo);
      expect(res.status).toBe(200);
      expect(tocouTabela(tabela)).toBe(true);
    });

    test('historico e execucoes filtram dentistas pela clínica', async () => {
      for (const sufixo of ['/historico', '/execucoes']) {
        sqlLog = [];
        await chamar('get', `/api/pacientes/${pacienteDaB}${sufixo}`, tokenB());
        const q = sqlLog.find(x => /LEFT JOIN dentistas/.test(x.text));
        expect(q.text).toMatch(/d\.tenant_id = (\$2|a\.tenant_id)/);
        expect(q.params[1]).toBe(tenantB);
      }
    });

    test('PUT /api/pacientes/:id retorna 200', async () => {
      const res = await chamar('put', `/api/pacientes/${pacienteDaB}`, tokenB(), { nome: 'X' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    test('DELETE /api/pacientes/:id retorna 200', async () => {
      const res = await chamar('delete', `/api/pacientes/${pacienteDaB}`, tokenB());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    test('POST /consentimentos com id de agendamento da própria clínica grava', async () => {
      const res = await chamar('post', `/api/pacientes/${agendamentoDaB}/consentimentos`, tokenB(),
        { tipo: 'gravacao_transcricao_ia', decisao: 'autorizo', assinante_tipo: 'paciente', assinante_nome: 'Paciente', idade_informada: 30, assinatura: { base64: 'data:image/png;base64,iVBORw0KGgo=' } });
      expect(res.status).toBe(200);
      expect(res.body.consent).toMatchObject({ id: 'c1' });
      const ins = sqlLog.find(q => /INSERT INTO consentimentos_pacientes/.test(q.text));
      expect(ins.params[0]).toBe(tenantB);
      expect(ins.params[1]).toBe(agendamentoDaB);
    });
  });

  describe('super-admin', () => {
    const tokenSuper = () => token({ tenant_id: null, is_super_admin: true });

    test('com X-Tenant-Id válido enxerga o paciente daquela clínica', async () => {
      const res = await request(app).get(`/api/pacientes/${pacienteDaB}/anamnese`)
        .set('Authorization', `Bearer ${tokenSuper()}`)
        .set('X-Tenant-Id', tenantB);
      expect(res.status).toBe(200);
      expect(tocouTabela('anamneses')).toBe(true);
    });

    test('sem tenant recebe 403', async () => {
      const res = await chamar('get', `/api/pacientes/${pacienteDaB}/anamnese`, tokenSuper());
      expect(res.status).toBe(403);
      expect(tocouTabela('anamneses')).toBe(false);
    });
  });

  describe('id inválido', () => {
    test.each([
      ['get', '/anamnese'],
      ['put', '/odontograma'],
      ['get', '/historico'],
      ['put', ''],
      ['delete', ''],
    ])('%s /api/pacientes/nao-uuid%s retorna 404 sem query', async (method, sufixo) => {
      const res = await chamar(method, `/api/pacientes/nao-uuid${sufixo}`, tokenB(), corpo);
      expect(res.status).toBe(404);
      expect(tocouTabela('pacientes')).toBe(false);
      expect(tocouTabela('anamneses|odontogramas|agendamentos')).toBe(false);
    });
  });

  test('POST /api/pacientes sem clínica retorna 403', async () => {
    const res = await chamar('post', '/api/pacientes', token({ tenant_id: null }), { nome: 'X' });
    expect(res.status).toBe(403);
    expect(sqlLog.some(q => /INSERT INTO pacientes/.test(q.text))).toBe(false);
  });

  test('GET /api/pacientes sem clínica retorna 403', async () => {
    const res = await chamar('get', '/api/pacientes', token({ tenant_id: null }));
    expect(res.status).toBe(403);
  });
});
