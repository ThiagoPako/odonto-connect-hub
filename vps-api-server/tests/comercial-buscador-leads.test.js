// Buscador de leads do comercial interno (comercial/leads-fontes.mjs + comercial/rotas-leads.mjs):
// filtro de categoria (só odontologia/radiologia odontológica/dentista), deduplicação, CSV no
// formato do google-maps-scraper-kit, Google Places com limite de custo e cache (fetch falso,
// sem chave real), permissão (só super-admin e equipe interna; clínica nunca) e auditoria.
// Banco falso em memória: nenhuma query chega ao Postgres.
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  CONFIG_PADRAO, PLACES_FIELD_MASK, avaliarCategoria, candidatoDoCsv, classificarCandidatos, criarFontePlaces,
  formatoDoCsv, mesclarConfig, normalizarTelefoneBR, parseCsv, protegerFormula,
} from '../comercial/leads-fontes.mjs';
import { registrarRotasComercialLeads } from '../comercial/rotas-leads.mjs';
import { criarFetchPlacesMock } from '../comercial/places-mock.mjs';
import { candidatoDoScraper, palavrasChave, erroEhBloqueio } from '../comercial/scraper-fonte.mjs';
import { criarEngineFalso } from './helpers/fake-scraper-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '../.env') });

// ─── Filtro de categoria ──────────────────────────────────────────────────────────
describe('filtro de categoria', () => {
  const ok = (nome, categoria, tipos = []) => avaliarCategoria({ clinica_nome: nome, categoria, tipos }).aceito;

  test('aceita dentista, clínica odontológica, especialidades e tipos do Google', () => {
    expect(ok('Clínica Sorriso', 'Dentista')).toBe(true);
    expect(ok('X', 'Clínica odontológica')).toBe(true);
    expect(ok('X', 'Orthodontist')).toBe(true);
    expect(ok('X', 'Implantodontista')).toBe(true);
    expect(ok('X', null, ['dental_clinic', 'health'])).toBe(true);
    expect(ok('X', 'Radiologia Odontológica')).toBe(true);
  });

  test('radiologia/laboratório genérico só entra com termo odontológico no nome', () => {
    expect(ok('Radiologia Odontológica Imagem Oral', 'Laboratório médico')).toBe(true);
    expect(ok('Centro de Radiologia Médica', 'Laboratório médico')).toBe(false);
    expect(ok('Rad Oral', 'Centro de radiologia')).toBe(true);
    expect(ok('Clínica Moral', 'Centro de radiologia')).toBe(false); // "oral" só no início de palavra
  });

  test('recusa loja de material, veterinária, laboratório de prótese e fora do segmento', () => {
    expect(ok('Dental Shop', 'Dental supply store')).toBe(false);
    expect(ok('Dente de Leite', 'Veterinário')).toBe(false);
    expect(ok('Lab X', 'Laboratório de prótese dentária')).toBe(false);
    expect(ok('Pizzaria Dente Doce', 'Pizzaria')).toBe(false);
    expect(ok('Sem categoria', '')).toBe(false);
  });

  test('lista de categorias é configurável (mesclarConfig normaliza e ignora chave desconhecida)', () => {
    const cfg = mesclarConfig({ categorias_aceitas: ['Pizzaria'], chave_estranha: 1, places_max_paginas_por_busca: 99 });
    expect(cfg.chave_estranha).toBeUndefined();
    expect(cfg.places_max_paginas_por_busca).toBe(3);
    expect(avaliarCategoria({ clinica_nome: 'P', categoria: 'Pizzaria' }, cfg).aceito).toBe(true);
    expect(avaliarCategoria({ clinica_nome: 'P', categoria: 'Dentista' }, cfg).aceito).toBe(false);
  });
});

// ─── CSV do google-maps-scraper-kit ────────────────────────────────────────────────
const CSV_KIT = [
  'title,phone,emails,website,category,address,review_rating,review_count,instagram,facebook',
  '"Clínica Odonto Exemplo, Centro",(19) 3000-0001,"contato@odontoexemplo.com.br, dono@gmail.com",https://www.odontoexemplo.com.br,Clínica odontológica,"R. A, 1 - Centro, Campinas - SP, 13010-000, Brasil",4.8,120,https://instagram.com/odontoexemplo,',
  'Dra. Ana Exemplo,+55 19 99000-0002,ana.exemplo@gmail.com,,Dentista,"R. B, 2 - Cambuí, Campinas - SP, 13020-000, Brasil",5.0,33,,',
  '"\'=HYPERLINK(""x"")",(19) 3000-0003,,,Dentista,"R. C, 3, Campinas - SP, Brasil",4.1,2,,',
  'Dental Shop,(19) 3000-0004,,https://dentalshop.exemplo,Dental supply store,"R. D, 4, Campinas - SP, Brasil",4.0,10,,',
  'Clínica Odonto Exemplo Centro,(19) 3000-0001,,,Dentista,"R. A, 1, Campinas - SP, Brasil",4.8,120,,',
].join('\n');

describe('CSV no formato do google-maps-scraper-kit', () => {
  test('lê cabeçalho do kit, aspas com vírgula, e-mails e redes; detecta o formato', () => {
    const { cabecalho, linhas } = parseCsv(CSV_KIT);
    expect(formatoDoCsv(cabecalho)).toBe('google-maps-scraper-kit');
    expect(linhas).toHaveLength(5);
    const c = candidatoDoCsv(linhas[0]);
    expect(c.clinica_nome).toBe('Clínica Odonto Exemplo, Centro');
    expect(c.cidade).toBe('Campinas');
    expect(c.uf).toBe('SP');
    expect(c.telefone_norm).toBe('551930000001');
    expect(c.site_dominio).toBe('odontoexemplo.com.br');
    expect(c.email_comercial).toBe('contato@odontoexemplo.com.br'); // prefere o do domínio do site
    expect(c.email_pessoal).toBe(false);
    expect(c.nota_avaliacao).toBe(4.8);
    expect(c.total_avaliacoes).toBe(120);
    expect(c.redes.instagram).toBe('https://instagram.com/odontoexemplo');
  });

  test('e-mail de provedor gratuito do dentista pessoa física é marcado como dado pessoal', () => {
    const c = candidatoDoCsv(parseCsv(CSV_KIT).linhas[1]);
    expect(c.email_comercial).toBe('ana.exemplo@gmail.com');
    expect(c.email_pessoal).toBe(true);
    expect(c.telefone_norm).toBe('5519990000002');
  });

  test('desfaz a proteção de fórmula do kit ao ler e protege de novo ao exportar', () => {
    const c = candidatoDoCsv(parseCsv(CSV_KIT).linhas[2]);
    expect(c.clinica_nome).toBe('=HYPERLINK("x")');
    expect(protegerFormula(c.clinica_nome)).toBe('\'=HYPERLINK("x")');
    expect(protegerFormula('+55 19 3000-0001')).toBe('+55 19 3000-0001');
  });

  test('planilha em português com ponto e vírgula também funciona', () => {
    const { cabecalho, linhas } = parseCsv('Nome;Telefone;Categoria;Cidade;UF\nClínica Y;11 3333-4444;Dentista;São Paulo;sp\n');
    expect(formatoDoCsv(cabecalho)).toBe('planilha');
    const c = candidatoDoCsv(linhas[0]);
    expect([c.clinica_nome, c.cidade, c.uf, c.telefone_norm]).toEqual(['Clínica Y', 'São Paulo', 'SP', '551133334444']);
  });

  test('normalização de telefone BR', () => {
    expect(normalizarTelefoneBR('0xx19 3000-0001')).toBe('551930000001');
    expect(normalizarTelefoneBR('(019) 3000-0001')).toBe('551930000001');
    expect(normalizarTelefoneBR('0800 123 4567')).toBe(null);
    expect(normalizarTelefoneBR('')).toBe(null);
  });
});

// ─── Classificação: filtro + dedupe + supressão + cliente ─────────────────────────────
describe('deduplicação e classificação', () => {
  const cands = parseCsv(CSV_KIT).linhas.map(candidatoDoCsv);

  test('descarta fora do segmento e dedupe dentro do lote (telefone)', () => {
    const { itens, resumo } = classificarCandidatos(cands, { leads: [], clientes: [], suprimido: () => false });
    expect(itens.map(i => i.status)).toEqual(['novo', 'novo', 'novo', 'descartado', 'duplicado']);
    expect(itens[3].motivo).toMatch(/categoria recusada/);
    expect(itens[4].motivo).toBe('repetido neste lote (mesmo telefone)');
    expect(resumo).toMatchObject({ total: 5, novos: 3, duplicados: 1, descartados: 1 });
    expect(resumo.motivos_descarte['categoria recusada']).toBe(1);
  });

  test('dedupe contra o CRM por place_id, telefone, site e nome+cidade', () => {
    const base = {
      leads: [
        { id: 'L1', place_id: 'PL1' },
        { id: 'L2', telefone_norm: '5519990000002' },
        { id: 'L3', site_dominio: 'odontoexemplo.com.br' },
        { id: 'L4', clinica_nome: 'Consultório Odontológico Dr. Zé', cidade: 'Campinas' },
      ],
      clientes: [], suprimido: () => false,
    };
    const lote = [
      { clinica_nome: 'A', categoria: 'Dentista', place_id: 'PL1' },
      { clinica_nome: 'B', categoria: 'Dentista', telefone_norm: '5519990000002' },
      { clinica_nome: 'C', categoria: 'Dentista', site_dominio: 'odontoexemplo.com.br' },
      { clinica_nome: 'Clínica Dr Zé', categoria: 'Dentista', cidade: 'campinas' },
      { clinica_nome: 'Nova', categoria: 'Dentista', cidade: 'Campinas' },
    ];
    const { itens } = classificarCandidatos(lote, base);
    expect(itens.map(i => [i.status, i.duplicado_de?.id || null])).toEqual([
      ['duplicado', 'L1'], ['duplicado', 'L2'], ['duplicado', 'L3'], ['duplicado', 'L4'], ['novo', null],
    ]);
    expect(itens[0].motivo).toBe('já está no CRM (mesmo place_id)');
    expect(itens[3].motivo).toBe('já está no CRM (mesmo nome e cidade)');
  });

  test('marca quem já é cliente e respeita a lista de não contatar', () => {
    const base = {
      leads: [],
      clientes: [{ id: 'T1', nome: 'Clínica Odonto Exemplo, Centro', telefone_norm: null }],
      suprimido: c => c.telefone_norm === '5519990000002',
    };
    const { itens, resumo } = classificarCandidatos(cands.slice(0, 2), base);
    expect(itens[0].ja_cliente).toEqual({ tenant_id: 'T1', nome: 'Clínica Odonto Exemplo, Centro' });
    expect(itens[0].status).toBe('novo');
    expect(itens[1].status).toBe('nao_contatar');
    expect(resumo).toMatchObject({ ja_clientes: 1, nao_contatar: 1 });
  });

  test('clínica fechada permanentemente é descartada', () => {
    const { itens } = classificarCandidatos([{ clinica_nome: 'X', categoria: 'Dentista', fechado: true }], { leads: [], clientes: [] });
    expect(itens[0]).toMatchObject({ status: 'descartado', motivo: 'fechado permanentemente' });
  });
});

// ─── Fonte Google Places (fetch falso) ───────────────────────────────────────────────
describe('fonte Google Places', () => {
  const montar = (limiteDia = 1, cfg = {}) => {
    let gastoDia = 0;
    const chamadas = [];
    const mock = criarFetchPlacesMock();
    const fetchImpl = jest.fn(async (url, init) => { chamadas.push({ url: String(url), init }); return mock(url, init); });
    const fonte = criarFontePlaces({
      apiKey: 'chave-falsa', fetchImpl, config: mesclarConfig(cfg),
      reservarCusto: async usd => (gastoDia + usd <= limiteDia + 1e-9 ? (gastoDia += usd, true) : false),
    });
    return { fonte, chamadas, fetchImpl, gasto: () => gastoDia };
  };

  test('Text Search com field mask enxuto, includedType e região BR; pagina até o limite', async () => {
    const { fonte, chamadas } = montar();
    const r = await fonte.buscar({ cidade: 'Campinas', uf: 'SP', tipo: 'dentista', orcamentoUsd: 1, maxPaginas: 3 });
    const corpo = JSON.parse(chamadas[0].init.body);
    expect(chamadas[0].url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(chamadas[0].init.headers['X-Goog-FieldMask']).toBe(PLACES_FIELD_MASK);
    expect(chamadas[0].init.headers['X-Goog-Api-Key']).toBe('chave-falsa');
    expect(PLACES_FIELD_MASK).not.toMatch(/reviews|photos|places\.\*|\*/);
    expect(corpo).toMatchObject({ textQuery: 'dentista em Campinas - SP', includedType: 'dentist', strictTypeFiltering: true, regionCode: 'BR', languageCode: 'pt-BR' });
    expect(r.chamadas).toBe(2); // mock: 5 resultados para "dentist", 4 por página
    expect(r.itens[0].place_id).toMatch(/^MOCKplace/);
  });

  test('para no teto de custo da busca e no limite diário (sem chamar a API)', async () => {
    const a = montar(1);
    const r = await a.fonte.buscar({ cidade: 'Campinas', uf: 'SP', tipo: 'clinica', orcamentoUsd: CONFIG_PADRAO.places_custo_text_search_usd, maxPaginas: 3 });
    expect(r.chamadas).toBe(1);
    expect(r.parouPorCusto).toBe(true);

    const b = montar(0.01);
    await expect(b.fonte.buscar({ cidade: 'Campinas', uf: 'SP', tipo: 'clinica', orcamentoUsd: 1, maxPaginas: 3 }))
      .rejects.toMatchObject({ status: 429 });
    expect(b.fetchImpl).not.toHaveBeenCalled();
  });

  test('cache temporário: repetir a mesma busca não cobra de novo; detalhes saem do cache', async () => {
    const { fonte, fetchImpl, gasto } = montar();
    await fonte.buscar({ cidade: 'Campinas', uf: 'SP', tipo: 'clinica', orcamentoUsd: 1, maxPaginas: 1 });
    const g1 = gasto();
    const r2 = await fonte.buscar({ cidade: 'Campinas', uf: 'SP', tipo: 'clinica', orcamentoUsd: 1, maxPaginas: 1 });
    expect(r2.cacheHit).toBe(1);
    expect(gasto()).toBe(g1);
    const d = await fonte.detalhes(r2.itens[0].place_id);
    expect(d.custo).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('raio usa Geocoding (custo próprio) e locationBias em metros, no máximo 50 km', async () => {
    const { fonte, chamadas } = montar();
    await fonte.buscar({ cidade: 'Campinas', uf: 'SP', tipo: 'radiologia', raioKm: 80, orcamentoUsd: 1, maxPaginas: 1 });
    expect(chamadas[0].url).toMatch(/geocode/);
    const corpo = JSON.parse(chamadas[1].init.body);
    expect(corpo.locationBias.circle.radius).toBe(50000);
    expect(corpo.includedType).toBeUndefined();
  });

  test('sem chave configurada responde 503 claro', async () => {
    const fonte = criarFontePlaces({ apiKey: '', fetchImpl: jest.fn(), reservarCusto: async () => true });
    await expect(fonte.buscar({ cidade: 'X', uf: 'SP', tipo: 'dentista', orcamentoUsd: 1, maxPaginas: 1 }))
      .rejects.toMatchObject({ status: 503, message: expect.stringMatching(/GOOGLE_PLACES_API_KEY/) });
  });
});

// ─── Rotas (app Express isolado + banco falso) ────────────────────────────────────────
const SUPER = '77777777-7777-7777-7777-777777777777';
const GESTOR = '88888888-8888-8888-8888-888888888888';
const VENDEDOR = '99999999-9999-9999-9999-999999999999';
const CLINICA = '44444444-4444-4444-4444-444444444444';
const TENANT = '11111111-1111-1111-1111-111111111111';

function jobsFalsos(db, t, params) {
  const achar = id => db.jobs.find(j => j.id === id);
  if (/^SELECT \* FROM com_scraper_jobs WHERE status = 'rodando'/.test(t)) return { rows: db.jobs.filter(j => j.status === 'rodando') };
  if (/SET status = 'rodando'/.test(t)) {
    if (db.jobs.some(j => j.status === 'rodando')) return { rows: [] };
    const j = db.jobs.find(x => x.status === 'na_fila');
    if (!j) return { rows: [] };
    Object.assign(j, { status: 'rodando', iniciado_em: new Date() });
    return { rows: [j] };
  }
  if (/SET engine_job_id/.test(t)) { achar(params[1]).engine_job_id = params[0]; return { rows: [] }; }
  if (/SET status = 'concluido'/.test(t)) { Object.assign(achar(params[3]), { status: 'concluido', linhas: params[0], aviso: params[1], concluido_em: new Date() }); return { rows: [] }; }
  if (/SET status = \$1, erro = \$2/.test(t)) { Object.assign(achar(params[3]), { status: params[0], erro: params[1], concluido_em: new Date() }); return { rows: [] }; }
  if (/SET status = 'falhou'/.test(t)) { Object.assign(achar(params[1]), { status: 'falhou', erro: params[0] }); return { rows: [] }; }
  if (/SET status = 'cancelado'/.test(t)) { Object.assign(achar(params[0]), { status: 'cancelado' }); return { rows: [] }; }
  if (/SET status = 'importado'/.test(t)) { Object.assign(achar(params[0]), { status: 'importado' }); return { rows: [] }; }
  if (/SET progresso/.test(t)) return { rows: [] };
  if (/status = 'bloqueado' AND concluido_em >/.test(t)) return { rows: db.jobs.filter(j => j.status === 'bloqueado') };
  if (/COUNT\(\*\)::int AS n FROM com_scraper_jobs/.test(t)) return { rows: [{ n: db.jobs.length }] };
  if (/INSERT INTO com_scraper_jobs/.test(t)) {
    const j = { id: crypto.randomUUID(), cidade: params[0], uf: params[1], tipos: params[2], palavras: params[3], depth: params[4], max_tempo_s: params[5], coletar_emails: params[6], status: 'na_fila', criado_em: new Date() };
    db.jobs.push(j);
    return { rows: [j] };
  }
  if (/SELECT \* FROM com_scraper_jobs WHERE id = \$1/.test(t)) return { rows: db.jobs.filter(j => j.id === params[0]) };
  if (/FROM com_scraper_jobs j LEFT JOIN/.test(t)) return { rows: [...db.jobs].reverse() };
  return { rows: [] };
}

function bancoFalso() {
  const db = { jobs: [], leads: [], auditoria: [], supressao: new Set(), equipe: { [GESTOR]: 'gestor', [VENDEDOR]: 'vendedor', [CLINICA]: 'gestor' }, uso: 0, sql: [] };
  const query = jest.fn(async (sql, params = []) => {
    const t = String(sql);
    db.sql.push(t);
    if (/FROM com_equipe e JOIN profiles p ON p.id = e.profile_id\s+WHERE e.profile_id = \$1/.test(t)) {
      // a conta da clínica (CLINICA) tem tenant_id, então o JOIN com "p.tenant_id IS NULL" não acha
      const papel = params[0] === CLINICA ? null : db.equipe[params[0]];
      return { rows: papel ? [{ papel }] : [] };
    }
    if (/SELECT valor FROM com_config/.test(t)) return { rows: [] };
    if (/com_scraper_jobs/.test(t)) return jobsFalsos(db, t, params);
    if (/INSERT INTO com_places_uso/.test(t)) { if (db.uso + params[0] > params[1]) return { rows: [] }; db.uso += params[0]; return { rows: [{ custo_usd: db.uso }] }; }
    if (/FROM com_places_uso/.test(t)) return { rows: [{ chamadas: 1, custo_usd: db.uso }] };
    if (/FROM com_leads\s+WHERE place_id = ANY/.test(t)) return { rows: db.leads };
    if (/SELECT id, place_id FROM com_leads WHERE origem = 'google_places'/.test(t)) return { rows: db.leads.filter(l => l.origem === 'google_places').map(l => ({ id: l.id, place_id: l.place_id })) };
    if (/FROM tenants/.test(t)) return { rows: [{ id: TENANT, nome: 'OdontoVida Implantes', telefone: null, cnpj: null, email_contato: 'adm@gmail.com' }] };
    if (/FROM com_supressao/.test(t)) return { rows: params[0].filter(h => db.supressao.has(h)).map(hmac => ({ hmac })) };
    if (/INSERT INTO com_supressao/.test(t)) { db.supressao.add(params[0]); return { rows: [], rowCount: 1 }; }
    if (/INSERT INTO com_leads/.test(t)) {
      const id = `00000000-0000-0000-0000-${String(db.leads.length + 1).padStart(12, '0')}`;
      const cols = ['clinica_nome', 'cnpj', 'cidade', 'uf', 'endereco', 'site', 'site_dominio', 'telefone_comercial', 'telefone_norm', 'email_comercial', 'email_pessoal', 'categoria', 'redes', 'nota_avaliacao', 'total_avaliacoes', 'origem', 'origem_detalhe', 'campanha', 'place_id', 'tipo_busca', 'google_consultado_em', 'dono_id', 'tenant_id_cliente', 'criado_por'];
      const lead = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      if (lead.place_id && db.leads.some(l => l.place_id === lead.place_id)) return { rows: [] };
      db.leads.push({ id, ...lead, etapa: 'novo' });
      return { rows: [{ id }] };
    }
    if (/SELECT \* FROM com_leads WHERE id = \$1/.test(t)) return { rows: db.leads.filter(l => l.id === params[0]) };
    if (/UPDATE com_leads SET nao_contatar = true/.test(t)) { const l = db.leads.find(x => x.id === params[1]); Object.assign(l, { nao_contatar: true, etapa: 'perdido' }); return { rows: [l] }; }
    if (/FROM profiles p LEFT JOIN com_equipe e/.test(t)) return { rows: [GESTOR, VENDEDOR, SUPER].includes(params[0]) ? [{ id: params[0] }] : [] };
    if (/INSERT INTO com_auditoria/.test(t)) { db.auditoria.push({ ator: params[0], papel: params[1], acao: params[2], detalhe: JSON.parse(params[5]) }); return { rows: [] }; }
    if (/FROM com_leads l LEFT JOIN profiles/.test(t)) return { rows: db.leads.map(l => ({ ...l, total: db.leads.length })) };
    return { rows: [], rowCount: 0 };
  });
  return { db, pool: { query } };
}

function montarApp(env = {}) {
  const { db, pool } = bancoFalso();
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const usuarios = {
    super: { id: SUPER, is_super_admin: true, tenant_id: null },
    gestor: { id: GESTOR, is_super_admin: false, tenant_id: null },
    vendedor: { id: VENDEDOR, is_super_admin: false, tenant_id: null },
    clinica: { id: CLINICA, is_super_admin: false, tenant_id: TENANT, role: 'admin' },
  };
  const verifyUser = async req => {
    const u = usuarios[req.headers['x-teste-usuario']];
    if (!u) throw new Error('Unauthorized');
    return { user: { ...u } };
  };
  registrarRotasComercialLeads(app, { pool, verifyUser, env: { NODE_ENV: 'test', GOOGLE_PLACES_MOCK: '1', JWT_SECRET: 'x', ...env } });
  const chamar = (quem, method, url, body) => {
    const r = request(app)[method](url);
    if (quem) r.set('x-teste-usuario', quem);
    return body ? r.send(body) : r;
  };
  return { db, chamar };
}

describe('rotas do buscador: permissão', () => {
  test('sem login 401; usuário de clínica 403 (mesmo listado em com_equipe) e nada é lido', async () => {
    const { db, chamar } = montarApp();
    expect((await chamar(null, 'get', '/api/super-admin/comercial/acesso')).status).toBe(401);
    const r = await chamar('clinica', 'post', '/api/super-admin/comercial/buscador/places/previa', { cidade: 'Campinas', uf: 'SP' });
    expect(r.status).toBe(403);
    expect(db.sql.some(s => /com_leads|com_equipe/.test(s))).toBe(false);
    expect((await chamar('clinica', 'get', '/api/super-admin/comercial/leads')).status).toBe(403);
  });

  test('super-admin é "dono"; gestor busca; vendedor não busca nem importa', async () => {
    const { chamar } = montarApp();
    const a = await chamar('super', 'get', '/api/super-admin/comercial/acesso');
    expect(a.body).toMatchObject({ papel: 'dono', pode_buscar: true, pode_configurar: true, places_simulado: true });
    expect((await chamar('gestor', 'get', '/api/super-admin/comercial/acesso')).body).toMatchObject({ papel: 'gestor', pode_buscar: true, pode_configurar: false });
    expect((await chamar('vendedor', 'post', '/api/super-admin/comercial/buscador/places/previa', { cidade: 'Campinas', uf: 'SP' })).status).toBe(403);
    expect((await chamar('vendedor', 'post', '/api/super-admin/comercial/buscador/csv/previa', { csv: CSV_KIT })).status).toBe(403);
    expect((await chamar('gestor', 'put', '/api/super-admin/comercial/config', { config: {} })).status).toBe(403);
  });

  test('GOOGLE_PLACES_MOCK é ignorado em produção (sem chave → 503)', async () => {
    const { chamar } = montarApp({ NODE_ENV: 'production', GOOGLE_PLACES_API_KEY: '' });
    const r = await chamar('super', 'post', '/api/super-admin/comercial/buscador/places/previa', { cidade: 'Campinas', uf: 'SP', tipos: ['dentista'] });
    expect(r.status).toBe(503);
  });
});

describe('rotas do buscador: Places → prévia → importação', () => {
  test('prévia filtra e classifica; importação grava só place_id (Termos do Google) e audita', async () => {
    const { db, chamar } = montarApp();
    const p = await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/places/previa', { cidade: 'Campinas', uf: 'SP', tipos: ['clinica', 'dentista', 'radiologia'] });
    expect(p.status).toBe(200);
    const porNome = Object.fromEntries(p.body.itens.map(i => [i.clinica_nome, i]));
    expect(porNome['Dental Shop Materiais'].status).toBe('descartado');
    expect(porNome['Clínica Veterinária Dente de Leite'].status).toBe('descartado');
    expect(porNome['Centro de Radiologia Médica Exemplo'].status).toBe('descartado');
    expect(porNome['Consultório Dr. Bruno Exemplo'].motivo).toBe('fechado permanentemente');
    expect(porNome['Radiologia Odontológica Imagem Oral'].status).toBe('novo');
    expect(porNome['Sorriso Pleno Unidade 2'].status).toBe('duplicado'); // mesmo telefone/site da matriz
    expect(porNome['OdontoVida Implantes'].ja_cliente).toMatchObject({ tenant_id: TENANT });
    expect(porNome['Dra. Ana Exemplo — Ortodontia'].telefone_celular).toBe(true);
    expect(p.body.custo.chamadas).toBeGreaterThan(0);
    expect(db.auditoria.at(-1)).toMatchObject({ acao: 'busca_places', papel: 'gestor' });

    const imp = await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id, dono_id: VENDEDOR });
    expect(imp.status).toBe(200);
    expect(imp.body.importados).toBe(p.body.resumo.novos);
    for (const l of db.leads) {
      expect(l).toMatchObject({ origem: 'google_places', clinica_nome: null, telefone_comercial: null, site: null, endereco: null, cidade: 'Campinas', uf: 'SP', dono_id: VENDEDOR });
      expect(l.place_id).toMatch(/^MOCKplace/);
      expect(l.google_consultado_em).toBeInstanceOf(Date);
      expect(l.origem_detalhe).toMatch(/Google Places API/);
    }
    expect(db.auditoria.at(-1)).toMatchObject({ acao: 'importacao', detalhe: expect.objectContaining({ fonte: 'google_places', dono_id: VENDEDOR }) });

    // Segunda busca: tudo que foi importado aparece como "já está no CRM".
    const p2 = await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/places/previa', { cidade: 'Campinas', uf: 'SP', tipos: ['clinica', 'dentista', 'radiologia'] });
    expect(p2.body.resumo.novos).toBe(0);
    expect(p2.body.custo.chamadas).toBe(0); // veio do cache temporário
  });

  test('CSV com o telefone de um lead do Google já importado cai como duplicado (via cache temporário)', async () => {
    const { db, chamar } = montarApp();
    const p = await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/places/previa', { cidade: 'Campinas', uf: 'SP', tipos: ['dentista'] });
    await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id });
    const kids = db.leads.find(l => l.place_id === 'MOCKplace0008Campinas');
    expect(kids.telefone_norm).toBeNull(); // do Google o banco só tem o place_id
    const csv = await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/csv/previa', { csv: 'title,phone,category\nKids,(19) 3000-0009,Dentista\n' });
    expect(csv.body.itens[0]).toMatchObject({ status: 'duplicado', motivo: 'já está no CRM (mesmo telefone)', duplicado_de: kids.id });
  });

  test('responsável fora da equipe é recusado; prévia de outra pessoa não importa', async () => {
    const { chamar } = montarApp();
    const p = await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/places/previa', { cidade: 'Campinas', uf: 'SP', tipos: ['dentista'] });
    const fora = await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id, dono_id: CLINICA });
    expect(fora.status).toBe(400);
    expect((await chamar('vendedor', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id })).status).toBe(403);
    expect((await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: 'nao-existe' })).status).toBe(410);
  });
});

describe('rotas do buscador: CSV e não contatar', () => {
  test('CSV exige origem declarada e base legal; grava dados do CSV com e-mail pessoal marcado', async () => {
    const { db, chamar } = montarApp();
    const p = await chamar('super', 'post', '/api/super-admin/comercial/buscador/csv/previa', { csv: CSV_KIT, nome_arquivo: 'dentistas campinas.csv' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ formato: 'google-maps-scraper-kit', resumo: { total: 5, novos: 3, duplicados: 1, descartados: 1 } });
    const sem = await chamar('super', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id });
    expect(sem.status).toBe(400);
    const semBase = await chamar('super', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id, origem_declarada: 'google-maps-scraper-kit rodado pelo dono' });
    expect(semBase.status).toBe(400);
    const ok = await chamar('super', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id, origem_declarada: 'google-maps-scraper-kit rodado pelo dono', base_legal_confirmada: true, campanha: 'Campinas nov/26' });
    expect(ok.body.importados).toBe(3);
    const ana = db.leads.find(l => l.clinica_nome === 'Dra. Ana Exemplo');
    expect(ana).toMatchObject({ origem: 'csv', email_pessoal: true, campanha: 'Campinas nov/26' });
    expect(ana.origem_detalhe).toMatch(/origem declarada: google-maps-scraper-kit rodado pelo dono/);
  });

  test('"não contatar" grava supressão (HMAC, sem dado em claro) e bloqueia reimportação', async () => {
    const { db, chamar } = montarApp();
    const p = await chamar('super', 'post', '/api/super-admin/comercial/buscador/csv/previa', { csv: CSV_KIT });
    await chamar('super', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id, origem_declarada: 'base própria', base_legal_confirmada: true });
    const ana = db.leads.find(l => l.clinica_nome === 'Dra. Ana Exemplo');
    const r = await chamar('super', 'post', `/api/super-admin/comercial/leads/${ana.id}/nao-contatar`, { motivo: 'pediu por telefone' });
    expect(r.status).toBe(200);
    expect(db.supressao.size).toBe(2); // telefone + e-mail
    for (const h of db.supressao) expect(h).toMatch(/^[0-9a-f]{64}$/);

    // Reimporta o mesmo CSV num CRM vazio: a Ana cai em "não contatar".
    db.leads.length = 0;
    const p2 = await chamar('super', 'post', '/api/super-admin/comercial/buscador/csv/previa', { csv: CSV_KIT });
    const item = p2.body.itens.find(i => i.clinica_nome === 'Dra. Ana Exemplo');
    expect(item.status).toBe('nao_contatar');
  });

  test('vendedor só enxerga lead dele', async () => {
    const { db, chamar } = montarApp();
    db.leads.push({ id: '00000000-0000-0000-0000-000000000001', dono_id: GESTOR, origem: 'csv', etapa: 'novo' });
    expect((await chamar('vendedor', 'post', '/api/super-admin/comercial/leads/00000000-0000-0000-0000-000000000001/nao-contatar', {})).status).toBe(404);
    await chamar('vendedor', 'get', '/api/super-admin/comercial/leads');
    expect(db.sql.find(s => /FROM com_leads l LEFT JOIN profiles/.test(s))).toMatch(/l\.dono_id = \$1/);
  });
});

// ─── Fonte Google Maps (scraper-kit) com engine falso ────────────────────────────────
describe('fonte scraper-kit: unidades', () => {
  test('palavras-chave fixas por tipo + cidade/UF', () => {
    expect(palavrasChave(['dentista', 'clinica', 'radiologia', 'xxx'], 'Campinas', 'SP')).toEqual([
      'dentista em Campinas SP', 'clínica odontológica em Campinas SP', 'radiologia odontológica em Campinas SP',
    ]);
  });
  test('linha do engine: categorias viram tipos, fechado detectado, e-mail sempre pessoal, sem redes', () => {
    const c = candidatoDoScraper({ title: 'X', category: 'Centro de radiologia', categories: 'Centro de radiologia, Dentista', phone: '(19) 3111-0003', emails: 'contato@x.exemplo', website: 'https://x.exemplo', instagram: 'https://instagram.com/x', status: 'Permanently closed', address: 'R. A, 1, Campinas - SP', place_id: 'ChIJ1' });
    expect(c.tipos).toEqual(['Centro de radiologia', 'Dentista']);
    expect(c.fechado).toBe(true);
    expect(c.email_pessoal).toBe(true);
    expect(c.redes).toEqual({});
    expect([c.cidade, c.uf, c.place_id]).toEqual(['Campinas', 'SP', 'ChIJ1']);
  });
  test('reconhece a mensagem de bloqueio do engine', () => {
    expect(erroEhBloqueio("Google answered with its unusual-traffic page: this IP is rate-limited for now. Wait, or add proxies")).toBe(true);
    expect(erroEhBloqueio('keyword 1 failed: timeout')).toBe(false);
  });
});

describe('fonte scraper-kit: rotas com engine falso', () => {
  let engine, url;
  afterEach(async () => { if (engine) await engine.fechar(); engine = null; });
  const subir = async (opts = {}) => { engine = criarEngineFalso({ apiKey: 'chave-engine', ...opts }); url = await engine.ouvir(0); return url; };

  test('sem LEADS_SCRAPER_URL: 503 e acesso informa não configurado', async () => {
    const { chamar } = montarApp();
    expect((await chamar('super', 'get', '/api/super-admin/comercial/acesso')).body.scraper_configurado).toBe(false);
    expect((await chamar('super', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP' })).status).toBe(503);
  });

  test('job: envia sem proxy/redes/verify_emails, com chave; status até concluir; prévia filtrada; importa e apaga no engine', async () => {
    await subir();
    const { db, chamar } = montarApp({ LEADS_SCRAPER_URL: url, SCRAPER_API_KEY: 'chave-engine' });
    const cria = await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP', tipos: ['dentista', 'radiologia'] });
    expect(cria.status).toBe(201);
    expect(cria.body.data.status).toBe('rodando');
    const enviado = engine.recebidos[0];
    expect(enviado).toMatchObject({ keywords: ['dentista em Campinas SP', 'radiologia odontológica em Campinas SP'], lang: 'pt', country: 'br', depth: 2, max_time: 900, email: false, socials: false, verify_emails: false, proxies: [] });

    // Vendedor não dispara nem vê a fila
    expect((await chamar('vendedor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP' })).status).toBe(403);
    // Prévia antes de terminar: 409
    expect((await chamar('gestor', 'post', `/api/super-admin/comercial/scraper/jobs/${cria.body.data.id}/previa`)).status).toBe(409);

    let lista;
    for (let i = 0; i < 3; i++) lista = await chamar('gestor', 'get', '/api/super-admin/comercial/scraper/jobs');
    expect(lista.body.data[0]).toMatchObject({ status: 'concluido', linhas: 6 });

    const p = await chamar('gestor', 'post', `/api/super-admin/comercial/scraper/jobs/${cria.body.data.id}/previa`);
    expect(p.status).toBe(200);
    const porNome = Object.fromEntries(p.body.itens.map(i => [i.clinica_nome, i]));
    expect(porNome['Dental Depósito Raspado'].status).toBe('descartado');
    expect(porNome['Consultório Fechado Exemplo'].motivo).toBe('fechado permanentemente');
    expect(porNome['Imagem Odonto Radiologia'].status).toBe('novo');
    expect(porNome['Imagem Odonto Radiologia'].email_pessoal).toBe(true);
    expect(porNome['Imagem Odonto Radiologia'].redes).toEqual({});
    expect(porNome['=HYPERLINK("http://x")'].status).toBe('novo');

    const imp = await chamar('gestor', 'post', '/api/super-admin/comercial/buscador/importar', { previa_id: p.body.previa_id });
    expect(imp.body.importados).toBe(p.body.resumo.novos);
    const carlos = db.leads.find(l => l.clinica_nome === 'Dr. Carlos Exemplo Dentista');
    expect(carlos).toMatchObject({ origem: 'google_maps_scraper', email_pessoal: true, telefone_norm: '5519991110002', place_id: 'ChIJraspado000002', tipo_busca: 'dentista+radiologia' });
    expect(carlos.origem_detalhe).toMatch(/^Google Maps \(scraper-kit, job [0-9a-f-]{36}\) "dentista em Campinas SP", "radiologia odontológica em Campinas SP" coletado em \d{4}-\d{2}-\d{2}$/);
    expect(carlos.google_consultado_em).toBeInstanceOf(Date);
    expect(db.jobs[0].status).toBe('importado');
    expect(engine.jobs.size).toBe(0); // apagado no engine depois de importar
    expect(db.auditoria.map(a => a.acao)).toEqual(expect.arrayContaining(['scraper_job_criado', 'previa_scraper', 'importacao']));
  });

  test('um job por vez: o segundo espera na fila até o primeiro terminar', async () => {
    await subir();
    const { chamar } = montarApp({ LEADS_SCRAPER_URL: url, SCRAPER_API_KEY: 'chave-engine' });
    const a = await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP', tipos: ['dentista'] });
    const b = await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Sumaré', uf: 'SP', tipos: ['dentista'] });
    expect([a.body.data.status, b.body.data.status]).toEqual(['rodando', 'na_fila']);
    expect(engine.recebidos).toHaveLength(1);
    for (let i = 0; i < 4; i++) await chamar('gestor', 'get', '/api/super-admin/comercial/scraper/jobs');
    expect(engine.recebidos).toHaveLength(2);
  });

  test('bloqueio do Google: job "bloqueado" com aviso (sem proxy) e novas coletas pausadas', async () => {
    await subir({ bloquear: true });
    const { chamar } = montarApp({ LEADS_SCRAPER_URL: url, SCRAPER_API_KEY: 'chave-engine' });
    await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP' });
    let lista;
    for (let i = 0; i < 3; i++) lista = await chamar('gestor', 'get', '/api/super-admin/comercial/scraper/jobs');
    expect(lista.body.data[0].status).toBe('bloqueado');
    expect(lista.body.data[0].erro).toMatch(/Não usamos proxy/);
    expect(lista.body.data[0].erro).toMatch(/Places API/);
    const novo = await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP' });
    expect(novo.status).toBe(429);
    expect(novo.body.error).toMatch(/pausada por 6 horas/);
  });

  test('limite diário, profundidade máxima, chave errada e cancelamento', async () => {
    await subir();
    const { db, chamar } = montarApp({ LEADS_SCRAPER_URL: url, SCRAPER_API_KEY: 'errada' });
    expect((await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP', depth: 9 })).status).toBe(400);
    const j = await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP' });
    expect(j.body.data.status).toBe('falhou');
    expect(j.body.data.erro).toMatch(/X-API-Key/);
    for (let i = 0; i < 5; i++) db.jobs.push({ id: crypto.randomUUID(), status: 'cancelado' });
    expect((await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs', { cidade: 'Campinas', uf: 'SP' })).status).toBe(429);
    db.jobs.length = 0;
    db.jobs.push({ id: '00000000-0000-0000-0000-0000000000aa', status: 'na_fila', palavras: ['x'] });
    expect((await chamar('gestor', 'post', '/api/super-admin/comercial/scraper/jobs/00000000-0000-0000-0000-0000000000aa/cancelar')).status).toBe(200);
    expect(db.jobs[0].status).toBe('cancelado');
  });
});

// ─── Registro no servidor real (rota existe e recusa token de clínica) ───────────────────
describe('registro em server.mjs', () => {
  test('token de clínica recebe 403 em /api/super-admin/comercial/acesso', async () => {
    const { app, pool } = await import('../server.mjs');
    const spy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
      if (/COALESCE\(p\.active, true\) AS active/.test(String(sql))) return { rows: [{ active: true, role: null, is_super_admin: false }] };
      return { rows: [], rowCount: 0 };
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tk = jwt.sign({ sub: CLINICA, email: 'a@clinica.com', role: 'admin', tenant_id: TENANT, is_super_admin: false }, process.env.JWT_SECRET);
    const r = await request(app).get('/api/super-admin/comercial/acesso').set('Authorization', `Bearer ${tk}`);
    expect(r.status).toBe(403);
    spy.mockRestore(); warn.mockRestore();
    await pool.end();
  });
});
