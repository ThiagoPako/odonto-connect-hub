// Rotas do comercial interno (/api/super-admin/comercial/*): buscador de leads (Google Places oficial + CSV),
// base de leads (com_leads), equipe comercial, configuração, gasto com o Google e auditoria.
//
// Quem acessa: super-admin (papel "dono") e a equipe comercial interna (com_equipe: gestor,
// vendedor, sdr) — e só conta SEM clínica (profiles.tenant_id nulo). Usuário de clínica cliente
// nunca entra, mesmo que alguém o coloque em com_equipe. As tabelas com_* não têm tenant_id
// (são da empresa) e nenhuma rota de clínica as lê.
import crypto from 'crypto';
import {
  CHAVES_CONFIG, CacheTemporario, TIPOS_BUSCA, candidatoDoCsv, classificarCandidatos, criarFontePlaces,
  dominioSite, emailEhPessoal, formatoDoCsv, mesclarConfig, normalizarTelefoneBR, normalizarTexto,
  parseCsv, telefoneEhCelular, ufValida,
} from './leads-fontes.mjs';
import { criarFetchPlacesMock } from './places-mock.mjs';
import { AVISO_BLOQUEIO, candidatoDoScraper, criarClienteScraper, erroEhBloqueio, palavrasChave } from './scraper-fonte.mjs';

export const ETAPAS = ['novo', 'qualificado', 'reuniao_marcada', 'demonstracao_feita', 'proposta', 'teste_gratis', 'ganho', 'perdido'];
const PAPEIS_EQUIPE = ['gestor', 'vendedor', 'sdr'];
const PREVIA_TTL_MS = 30 * 60_000;
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_LINHAS_CSV = 5000;

const erro = (status, message) => Object.assign(new Error(message), { status });

export function registrarRotasComercialLeads(app, { pool, verifyUser, env = process.env, fetchImpl = globalThis.fetch, scraperFetchImpl = fetchImpl, agora = () => Date.now() }) {
  const usarMock = env.GOOGLE_PLACES_MOCK === '1' && env.NODE_ENV !== 'production';
  const apiKey = usarMock ? 'mock' : (env.GOOGLE_PLACES_API_KEY || '');
  const fetchPlaces = usarMock ? criarFetchPlacesMock() : fetchImpl;
  const cachePlaces = new CacheTemporario(agora);
  const previas = new Map();
  const scraper = criarClienteScraper({ baseUrl: env.LEADS_SCRAPER_URL, apiKey: env.SCRAPER_API_KEY || '', fetchImpl: scraperFetchImpl });

  let chaveHmac = env.COM_SUPRESSAO_HMAC_KEY;
  if (!chaveHmac) {
    chaveHmac = `com-supressao:${env.JWT_SECRET || 'dev'}`;
    if (env.NODE_ENV === 'production') console.warn('[comercial] COM_SUPRESSAO_HMAC_KEY ausente: usando chave derivada do JWT_SECRET (defina uma própria no .env)');
  }
  const hmac = (tipo, valor) => crypto.createHmac('sha256', chaveHmac).update(`${tipo}:${valor}`).digest('hex');
  const hmacsDoCandidato = c => [
    c.telefone_norm && hmac('telefone', c.telefone_norm),
    c.email_comercial && hmac('email', String(c.email_comercial).toLowerCase()),
    c.cnpj && hmac('cnpj', c.cnpj),
    c.place_id && hmac('place_id', c.place_id),
  ].filter(Boolean);

  // ─── Permissão ─────────────────────────────────────────────────────────────
  async function acessoComercial(req) {
    const { user } = await verifyUser(req);
    if (user.is_super_admin) return { user, papel: 'dono' };
    // Conta de clínica nunca acessa o comercial interno (regra dura do console).
    if (user.tenant_id) throw erro(403, 'Acesso restrito à equipe interna da Odonto Connect');
    const { rows } = await pool.query(
      `SELECT e.papel FROM com_equipe e JOIN profiles p ON p.id = e.profile_id
        WHERE e.profile_id = $1 AND e.ativo = true AND p.tenant_id IS NULL`, [user.id]);
    if (!rows[0]) throw erro(403, 'Acesso restrito à equipe interna da Odonto Connect');
    return { user, papel: rows[0].papel };
  }
  const podeBuscar = papel => ['dono', 'gestor', 'sdr'].includes(papel);
  const veTodos = papel => ['dono', 'gestor'].includes(papel);

  async function auditar(ator, acao, alvoTipo, alvoId, detalhe = {}) {
    try {
      await pool.query(
        'INSERT INTO com_auditoria (ator_id, ator_papel, acao, alvo_tipo, alvo_id, detalhe) VALUES ($1, $2, $3, $4, $5, $6)',
        [ator.user.id, ator.papel, acao, alvoTipo, alvoId == null ? null : String(alvoId), JSON.stringify(detalhe)]);
    } catch (e) {
      console.error('[comercial] auditoria falhou:', acao, e.message);
    }
  }

  function responder(res, e, ctx) {
    const status = e?.status || (e?.message === 'Unauthorized' ? 401 : 500);
    if (status !== 500) return res.status(status).json({ error: e.message, ...(e.limite ? { limite: e.limite } : {}) });
    if (e?.code === '22P02' || e?.code === '23514') return res.status(400).json({ error: 'Dados inválidos' });
    if (e?.code === '42P01') return res.status(503).json({ error: 'Módulo comercial ainda sendo instalado no banco. Tente em alguns segundos.' });
    console.error(`[comercial:${ctx}]`, e?.message);
    return res.status(500).json({ error: 'Erro interno' });
  }

  // ─── Configuração e gasto ────────────────────────────────────────────────────
  let cfgCache = null;
  async function lerConfig() {
    if (cfgCache && cfgCache.ate > agora()) return cfgCache.v;
    const { rows } = await pool.query("SELECT valor FROM com_config WHERE chave = 'buscador'");
    const v = mesclarConfig(rows[0]?.valor || {});
    cfgCache = { v, ate: agora() + 30_000 };
    return v;
  }

  const diaSaoPaulo = "(NOW() AT TIME ZONE 'America/Sao_Paulo')::date";
  async function reservarCusto(usd, limiteDiario) {
    if (usd > limiteDiario) return false;
    const { rows } = await pool.query(
      `INSERT INTO com_places_uso (dia, chamadas, custo_usd) VALUES (${diaSaoPaulo}, 1, $1)
       ON CONFLICT (dia) DO UPDATE SET chamadas = com_places_uso.chamadas + 1,
         custo_usd = com_places_uso.custo_usd + EXCLUDED.custo_usd, atualizado_em = NOW()
       WHERE com_places_uso.custo_usd + EXCLUDED.custo_usd <= $2
       RETURNING custo_usd`, [usd, limiteDiario]);
    return rows.length > 0;
  }
  async function usoHoje() {
    const { rows } = await pool.query(`SELECT chamadas, custo_usd FROM com_places_uso WHERE dia = ${diaSaoPaulo}`);
    return { chamadas: rows[0]?.chamadas || 0, custo_usd: Number(rows[0]?.custo_usd || 0) };
  }
  const fonte = cfg => criarFontePlaces({
    apiKey, fetchImpl: fetchPlaces, cache: cachePlaces, config: cfg,
    reservarCusto: usd => reservarCusto(usd, cfg.places_limite_diario_usd),
  });

  // ─── Base para classificar (CRM, clientes, supressão) ─────────────────────────────
  async function baseParaClassificar(candidatos) {
    const uniq = a => [...new Set(a.filter(Boolean))];
    const places = uniq(candidatos.map(c => c.place_id));
    const fones = uniq(candidatos.map(c => c.telefone_norm));
    const doms = uniq(candidatos.map(c => c.site_dominio));
    const cnpjs = uniq(candidatos.map(c => c.cnpj));
    const cidades = uniq(candidatos.flatMap(c => c.cidade ? [String(c.cidade).toLowerCase().trim(), normalizarTexto(c.cidade)] : []));
    const [{ rows: leads }, { rows: tenants }, { rows: sup }] = await Promise.all([
      // Cidade: busca as duas grafias (com e sem acento); a comparação fina de nome+cidade é em JS.
      pool.query(
        `SELECT id, place_id, telefone_norm, site_dominio, clinica_nome, cidade, cnpj FROM com_leads
          WHERE place_id = ANY($1::text[]) OR telefone_norm = ANY($2::text[]) OR site_dominio = ANY($3::text[])
             OR cnpj = ANY($4::text[]) OR lower(cidade) = ANY($5::text[])
          LIMIT 50000`, [places, fones, doms, cnpjs, cidades]),
      pool.query('SELECT id, nome, telefone, cnpj, email_contato FROM tenants'),
      pool.query('SELECT hmac FROM com_supressao WHERE hmac = ANY($1::text[])', [uniq(candidatos.flatMap(hmacsDoCandidato))]),
    ]);
    const suprimidos = new Set(sup.map(s => s.hmac));
    // Lead do Google ainda não confirmado só tem place_id no banco. Enquanto os dados dele estiverem
    // no cache temporário (memória), usa telefone/site/nome de lá para achar duplicados vindos do CSV.
    const { rows: doGoogle } = await pool.query(
      "SELECT id, place_id FROM com_leads WHERE origem = 'google_places' AND dados_confirmados_em IS NULL AND place_id IS NOT NULL LIMIT 50000");
    for (const g of doGoogle) {
      const c = cachePlaces.get(`pl:${g.place_id}`);
      if (c) leads.push({ id: g.id, place_id: g.place_id, telefone_norm: c.telefone_norm, site_dominio: c.site_dominio, clinica_nome: c.clinica_nome, cidade: c.cidade, cnpj: null });
    }
    return {
      leads,
      clientes: tenants.map(t => {
        const dom = String(t.email_contato || '').split('@')[1]?.toLowerCase();
        return {
          id: t.id, nome: t.nome, telefone_norm: normalizarTelefoneBR(t.telefone),
          cnpj: String(t.cnpj || '').replace(/\D/g, '') || null,
          dominio: dom && !emailEhPessoal(t.email_contato) ? dom : null,
        };
      }),
      suprimido: c => hmacsDoCandidato(c).some(h => suprimidos.has(h)),
    };
  }

  function guardarPrevia(ator, fonteNome, extra, classif) {
    for (const [k, p] of previas) if (p.expira < agora()) previas.delete(k);
    const id = crypto.randomUUID();
    previas.set(id, { id, criado_por: ator.user.id, fonte: fonteNome, ...extra, itens: classif.itens, resumo: classif.resumo, expira: agora() + PREVIA_TTL_MS });
    return id;
  }

  // Item devolvido à tela: com aviso de dado pessoal (LGPD) e sem o índice interno.
  const itemTela = it => ({
    chave: it.chave, status: it.status, motivo: it.motivo, ja_cliente: it.ja_cliente,
    duplicado_de: it.duplicado_de?.tipo === 'crm' ? it.duplicado_de.id : null,
    clinica_nome: it.clinica_nome, categoria: it.categoria, endereco: it.endereco, cidade: it.cidade, uf: it.uf,
    telefone_comercial: it.telefone_comercial, telefone_celular: telefoneEhCelular(it.telefone_norm),
    email_comercial: it.email_comercial, email_pessoal: !!it.email_pessoal, site: it.site,
    nota_avaliacao: it.nota_avaliacao, total_avaliacoes: it.total_avaliacoes, place_id: it.place_id,
    tipo_busca: it.tipo_busca || null, redes: it.redes || {},
  });

  // ─── Rotas ─────────────────────────────────────────────────────────────────
  app.get('/api/super-admin/comercial/acesso', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      res.json({ papel: ator.papel, pode_buscar: podeBuscar(ator.papel), pode_configurar: ator.papel === 'dono', ve_todos: veTodos(ator.papel), places_configurado: !!apiKey, places_simulado: usarMock, scraper_configurado: scraper.configurado, etapas: ETAPAS, tipos_busca: Object.entries(TIPOS_BUSCA).map(([id, t]) => ({ id, rotulo: t.rotulo })) });
    } catch (e) { responder(res, e, 'acesso'); }
  });

  app.get('/api/super-admin/comercial/config', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!podeBuscar(ator.papel)) throw erro(403, 'Sem permissão');
      const cfg = await lerConfig();
      res.json({ config: cfg, uso_hoje: await usoHoje() });
    } catch (e) { responder(res, e, 'config'); }
  });

  app.put('/api/super-admin/comercial/config', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (ator.papel !== 'dono') throw erro(403, 'Só o dono altera a configuração do buscador');
      const entrada = Object.fromEntries(Object.entries(req.body?.config || {}).filter(([k]) => CHAVES_CONFIG.includes(k)));
      const cfg = mesclarConfig({ ...(await lerConfig()), ...entrada });
      await pool.query(
        `INSERT INTO com_config (chave, valor, atualizado_por, atualizado_em) VALUES ('buscador', $1, $2, NOW())
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = NOW()`,
        [JSON.stringify(cfg), ator.user.id]);
      cfgCache = null;
      await auditar(ator, 'config_alterada', 'config', 'buscador', { chaves: Object.keys(entrada) });
      res.json({ config: cfg });
    } catch (e) { responder(res, e, 'config-put'); }
  });

  // Prévia do Google Places: busca, filtra e classifica. Nada é gravado em com_leads aqui.
  app.post('/api/super-admin/comercial/buscador/places/previa', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!podeBuscar(ator.papel)) throw erro(403, 'Seu papel não pode buscar leads');
      const cidade = String(req.body?.cidade || '').trim().slice(0, 80);
      const uf = ufValida(req.body?.uf);
      if (!cidade || !uf) throw erro(400, 'Informe cidade e UF');
      const tipos = (Array.isArray(req.body?.tipos) && req.body.tipos.length ? req.body.tipos : Object.keys(TIPOS_BUSCA)).filter(t => TIPOS_BUSCA[t]);
      if (!tipos.length) throw erro(400, 'Tipo de busca inválido');
      const raio = req.body?.raio_km ? Number(req.body.raio_km) : null;
      if (raio != null && (!Number.isFinite(raio) || raio <= 0)) throw erro(400, 'Raio inválido');
      const cfg = await lerConfig();
      const f = fonte(cfg);
      let orcamento = cfg.places_limite_busca_usd, gasto = 0, chamadas = 0, cacheHit = 0, parouPorCusto = false;
      const todos = [];
      for (const tipo of tipos) {
        const r = await f.buscar({ cidade, uf, tipo, raioKm: raio ? Math.min(raio, cfg.raio_max_km) : null, orcamentoUsd: orcamento - gasto, maxPaginas: cfg.places_max_paginas_por_busca });
        todos.push(...r.itens); gasto += r.gasto; chamadas += r.chamadas; cacheHit += r.cacheHit;
        if (r.parouPorCusto) { parouPorCusto = true; break; }
      }
      // A mesma clínica pode vir em "dentista" e "clínica": fica a primeira ocorrência.
      const vistos = new Set();
      const unicos = todos.filter(c => !c.place_id || (!vistos.has(c.place_id) && vistos.add(c.place_id)));
      const classif = classificarCandidatos(unicos, await baseParaClassificar(unicos), cfg);
      const previaId = guardarPrevia(ator, 'google_places', { cidade, uf, tipos, raio_km: raio }, classif);
      await auditar(ator, 'busca_places', 'previa', previaId, { cidade, uf, tipos, raio_km: raio, chamadas, gasto_usd: Number(gasto.toFixed(4)), resumo: classif.resumo });
      res.json({ previa_id: previaId, fonte: 'google_places', simulado: usarMock, resumo: classif.resumo, itens: classif.itens.map(itemTela), custo: { chamadas, cache: cacheHit, gasto_usd: Number(gasto.toFixed(4)), parou_por_limite_da_busca: parouPorCusto }, uso_hoje: await usoHoje() });
    } catch (e) { responder(res, e, 'places-previa'); }
  });

  app.post('/api/super-admin/comercial/buscador/csv/previa', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!podeBuscar(ator.papel)) throw erro(403, 'Seu papel não pode importar leads');
      const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
      if (!csv.trim()) throw erro(400, 'Envie o conteúdo do CSV');
      if (Buffer.byteLength(csv) > MAX_CSV_BYTES) throw erro(413, 'CSV maior que 5 MB: divida o arquivo');
      const nomeArquivo = String(req.body?.nome_arquivo || 'arquivo.csv').replace(/[^\w.\- ]/g, '').slice(0, 120);
      const { cabecalho, linhas, excedeu } = parseCsv(csv, { maxLinhas: MAX_LINHAS_CSV });
      if (!linhas.length) throw erro(400, 'CSV sem linhas de dados');
      const temNome = ['title', 'name', 'nome', 'nome_da_clinica', 'clinica', 'empresa', 'razao_social', 'nome_fantasia'].some(c => cabecalho.includes(c));
      if (!temNome) throw erro(400, 'CSV sem coluna de nome (title, nome ou empresa)');
      const formato = formatoDoCsv(cabecalho);
      const cfg = await lerConfig();
      const candidatos = linhas.map(candidatoDoCsv);
      const classif = classificarCandidatos(candidatos, await baseParaClassificar(candidatos), cfg);
      const previaId = guardarPrevia(ator, 'csv', { nome_arquivo: nomeArquivo, formato }, classif);
      await auditar(ator, 'previa_csv', 'previa', previaId, { nome_arquivo: nomeArquivo, formato, linhas: linhas.length, resumo: classif.resumo });
      res.json({ previa_id: previaId, fonte: 'csv', formato, excedeu_limite: excedeu, limite_linhas: MAX_LINHAS_CSV, resumo: classif.resumo, itens: classif.itens.map(itemTela) });
    } catch (e) { responder(res, e, 'csv-previa'); }
  });

  // Importa os itens "novos" escolhidos de uma prévia para com_leads.
  app.post('/api/super-admin/comercial/buscador/importar', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!podeBuscar(ator.papel)) throw erro(403, 'Seu papel não pode importar leads');
      const previa = previas.get(String(req.body?.previa_id || ''));
      if (!previa || previa.expira < agora()) throw erro(410, 'A prévia expirou (30 min). Faça a busca de novo.');
      if (previa.criado_por !== ator.user.id && ator.papel !== 'dono') throw erro(403, 'Esta prévia é de outra pessoa');
      const origemDeclarada = String(req.body?.origem_declarada || '').trim().slice(0, 200);
      if (previa.fonte === 'csv') {
        if (!origemDeclarada) throw erro(400, 'Informe a origem dos dados do CSV (ex.: base própria, evento, google-maps-scraper-kit)');
        if (req.body?.base_legal_confirmada !== true) throw erro(400, 'Confirme que há base legal (legítimo interesse B2B) para estes contatos');
      }
      let donoId = req.body?.dono_id || null;
      if (donoId) {
        if (!veTodos(ator.papel) && ator.papel !== 'sdr') throw erro(403, 'Seu papel não atribui leads');
        const { rows } = await pool.query(
          `SELECT p.id FROM profiles p LEFT JOIN com_equipe e ON e.profile_id = p.id
            WHERE p.id = $1 AND (COALESCE(p.is_super_admin, false) = true OR (e.ativo = true AND p.tenant_id IS NULL))`, [donoId]);
        if (!rows[0]) throw erro(400, 'Responsável não faz parte da equipe comercial');
      } else if (ator.papel === 'sdr') donoId = ator.user.id;
      const campanha = String(req.body?.campanha || '').trim().slice(0, 120) || null;
      const pedidas = new Set(Array.isArray(req.body?.chaves) ? req.body.chaves.map(String) : previa.itens.filter(i => i.status === 'novo').map(i => i.chave));
      const escolhidos = previa.itens.filter(i => pedidas.has(i.chave) && i.status === 'novo');

      // Supressão é conferida de novo na hora de gravar (pode ter mudado desde a prévia).
      const base = await baseParaClassificar(escolhidos);
      let importados = 0, pulados = 0;
      const ids = [];
      for (const it of escolhidos) {
        if (base.suprimido(it)) { pulados++; continue; }
        const google = previa.fonte === 'google_places';
        const raspado = previa.fonte === 'google_maps_scraper';
        // Google: só place_id + a cidade/UF que NÓS buscamos + data da consulta (Termos do Google Maps).
        const detalhe = google
          ? `Google Places API (busca ${previa.tipos.join('+')} em ${previa.cidade}-${previa.uf}) em ${new Date(agora()).toISOString().slice(0, 10)}`
          : raspado
            ? `Google Maps (scraper-kit, job ${previa.engine_job_id}) "${previa.palavras.join('", "')}" coletado em ${new Date(previa.coletado_em).toISOString().slice(0, 10)}`
            : `CSV ${previa.formato} · ${previa.nome_arquivo} · origem declarada: ${origemDeclarada}`;
        const valores = google
          ? [null, null, previa.cidade, previa.uf, null, null, null, null, null, null, false, null, '{}', null, null,
            'google_places', detalhe, campanha, it.place_id, it.tipo_busca, new Date(agora()), donoId, it.ja_cliente?.tenant_id || null, ator.user.id]
          : [it.clinica_nome, it.cnpj, it.cidade, it.uf, it.endereco, it.site, it.site_dominio, it.telefone_comercial, it.telefone_norm,
            it.email_comercial, !!it.email_pessoal, it.categoria, JSON.stringify(it.redes || {}), it.nota_avaliacao, it.total_avaliacoes,
            raspado ? 'google_maps_scraper' : 'csv', detalhe, campanha, it.place_id, raspado ? previa.tipos.join('+') : null,
            raspado ? new Date(previa.coletado_em) : null, donoId, it.ja_cliente?.tenant_id || null, ator.user.id];
        const { rows } = await pool.query(
          `INSERT INTO com_leads (clinica_nome, cnpj, cidade, uf, endereco, site, site_dominio, telefone_comercial, telefone_norm,
             email_comercial, email_pessoal, categoria, redes, nota_avaliacao, total_avaliacoes,
             origem, origem_detalhe, campanha, place_id, tipo_busca, google_consultado_em, dono_id, tenant_id_cliente, criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           ON CONFLICT DO NOTHING RETURNING id`, valores);
        if (rows[0]) { importados++; ids.push(rows[0].id); } else pulados++;
      }
      if (previa.fonte === 'google_maps_scraper' && importados > 0) {
        // Resultado importado: marca o job e apaga as linhas no engine (não ficam guardadas em dois lugares).
        await pool.query("UPDATE com_scraper_jobs SET status = 'importado' WHERE id = $1", [previa.scraper_job_id]);
        await scraper.apagarJob(previa.engine_job_id).catch(e => console.warn('[comercial] não apagou o job no engine:', e.message));
      }
      await auditar(ator, 'importacao', 'previa', previa.id, {
        fonte: previa.fonte, importados, pulados, pedidos: pedidas.size, dono_id: donoId, campanha,
        origem_declarada: origemDeclarada || null, resumo_previa: previa.resumo,
      });
      res.json({ importados, pulados, ids, resumo_previa: previa.resumo });
    } catch (e) { responder(res, e, 'importar'); }
  });

  // ─── Google Maps (scraper-kit): fila de jobs no engine separado ─────────────────────
  const diaSP = "(criado_em AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date";
  let tickRodando = null;

  // Avança a fila: atualiza o job em andamento e, se não houver, envia o próximo. Um por vez.
  async function tickScraper() {
    if (!scraper.configurado) return;
    if (tickRodando) return tickRodando;
    tickRodando = (async () => {
      const { rows: [ativo] } = await pool.query("SELECT * FROM com_scraper_jobs WHERE status = 'rodando' ORDER BY iniciado_em LIMIT 1");
      if (ativo) {
        if (!ativo.engine_job_id) return;
        let j;
        try { j = await scraper.statusJob(ativo.engine_job_id); }
        catch (e) {
          if (e.http === 404) await pool.query("UPDATE com_scraper_jobs SET status = 'falhou', erro = $1, concluido_em = NOW() WHERE id = $2", ['O job sumiu do engine (reinstalado ou apagado).', ativo.id]);
          return;
        }
        const prog = j?.Progress || {};
        if (j?.Status === 'ok') {
          const bloqueio = erroEhBloqueio(j.Error);
          await pool.query("UPDATE com_scraper_jobs SET status = 'concluido', linhas = $1, aviso = $2, progresso = $3, concluido_em = NOW() WHERE id = $4",
            [Number(prog.places) || 0, bloqueio ? `${AVISO_BLOQUEIO} As linhas coletadas antes do bloqueio foram mantidas.` : (j.Error || null), JSON.stringify(prog), ativo.id]);
        } else if (j?.Status === 'failed') {
          const bloqueio = erroEhBloqueio(j.Error);
          await pool.query("UPDATE com_scraper_jobs SET status = $1, erro = $2, progresso = $3, concluido_em = NOW() WHERE id = $4",
            [bloqueio ? 'bloqueado' : 'falhou', bloqueio ? AVISO_BLOQUEIO : String(j.Error || 'Falha no engine').slice(0, 500), JSON.stringify(prog), ativo.id]);
        } else {
          await pool.query('UPDATE com_scraper_jobs SET progresso = $1 WHERE id = $2', [JSON.stringify(prog), ativo.id]);
        }
        return;
      }
      const { rows: [prox] } = await pool.query(
        `UPDATE com_scraper_jobs SET status = 'rodando', iniciado_em = NOW()
          WHERE id = (SELECT id FROM com_scraper_jobs WHERE status = 'na_fila' ORDER BY criado_em LIMIT 1 FOR UPDATE SKIP LOCKED)
            AND NOT EXISTS (SELECT 1 FROM com_scraper_jobs WHERE status = 'rodando')
          RETURNING *`);
      if (!prox) return;
      try {
        const engineId = await scraper.criarJob({ nome: `odonto-connect ${prox.id}`, palavras: prox.palavras, depth: prox.depth, maxTempo: prox.max_tempo_s, coletarEmails: prox.coletar_emails });
        await pool.query('UPDATE com_scraper_jobs SET engine_job_id = $1 WHERE id = $2', [engineId, prox.id]);
      } catch (e) {
        await pool.query("UPDATE com_scraper_jobs SET status = 'falhou', erro = $1, concluido_em = NOW() WHERE id = $2", [String(e.message).slice(0, 500), prox.id]);
      }
    })().catch(e => console.error('[comercial] fila do scraper:', e.message)).finally(() => { tickRodando = null; });
    return tickRodando;
  }

  app.post('/api/super-admin/comercial/scraper/jobs', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!podeBuscar(ator.papel)) throw erro(403, 'Seu papel não pode buscar leads');
      if (!scraper.configurado) throw erro(503, 'Scraper não configurado: falta LEADS_SCRAPER_URL no .env do servidor');
      const cidade = String(req.body?.cidade || '').trim().slice(0, 80);
      const uf = ufValida(req.body?.uf);
      if (!cidade || !uf) throw erro(400, 'Informe cidade e UF');
      if (/[\r\n\t]/.test(cidade)) throw erro(400, 'Cidade inválida');
      const tipos = (Array.isArray(req.body?.tipos) && req.body.tipos.length ? req.body.tipos : Object.keys(TIPOS_BUSCA)).filter(t => TIPOS_BUSCA[t]);
      if (!tipos.length) throw erro(400, 'Tipo de busca inválido');
      const cfg = await lerConfig();
      const depth = req.body?.depth == null ? cfg.scraper_depth_padrao : Math.floor(Number(req.body.depth));
      if (!Number.isFinite(depth) || depth < 1 || depth > cfg.scraper_depth_max) throw erro(400, `Profundidade de 1 a ${cfg.scraper_depth_max}`);
      const { rows: [blq] } = await pool.query("SELECT concluido_em FROM com_scraper_jobs WHERE status = 'bloqueado' AND concluido_em > NOW() - INTERVAL '6 hours' ORDER BY concluido_em DESC LIMIT 1");
      if (blq) throw erro(429, `Coleta pausada por 6 horas depois de um bloqueio do Google. ${AVISO_BLOQUEIO}`);
      const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM com_scraper_jobs WHERE ${diaSP}`);
      if (n >= cfg.scraper_max_jobs_dia) throw erro(429, `Limite de ${cfg.scraper_max_jobs_dia} coletas por dia atingido. Tente amanhã ou use a Places API.`);
      const palavras = palavrasChave(tipos, cidade, uf);
      const { rows: [job] } = await pool.query(
        `INSERT INTO com_scraper_jobs (cidade, uf, tipos, palavras, depth, max_tempo_s, coletar_emails, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [cidade, uf, tipos, palavras, depth, cfg.scraper_max_tempo_s, req.body?.coletar_emails === true, ator.user.id]);
      await auditar(ator, 'scraper_job_criado', 'scraper_job', job.id, { cidade, uf, tipos, depth, coletar_emails: job.coletar_emails });
      await tickScraper();
      const { rows: [atual] } = await pool.query('SELECT * FROM com_scraper_jobs WHERE id = $1', [job.id]);
      res.status(201).json({ data: atual || job });
    } catch (e) { responder(res, e, 'scraper-criar'); }
  });

  app.get('/api/super-admin/comercial/scraper/jobs', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!podeBuscar(ator.papel)) throw erro(403, 'Sem permissão');
      await tickScraper();
      const cfg = await lerConfig();
      const { rows } = await pool.query(
        `SELECT j.id, j.cidade, j.uf, j.tipos, j.palavras, j.depth, j.coletar_emails, j.status, j.erro, j.aviso, j.progresso, j.linhas,
                j.criado_em, j.iniciado_em, j.concluido_em, COALESCE(p.name, p.email) AS criado_por_nome
           FROM com_scraper_jobs j LEFT JOIN profiles p ON p.id = j.criado_por ORDER BY j.criado_em DESC LIMIT 30`);
      const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM com_scraper_jobs WHERE ${diaSP}`);
      res.json({ data: rows, hoje: n, limite_dia: cfg.scraper_max_jobs_dia, depth_padrao: cfg.scraper_depth_padrao, depth_max: cfg.scraper_depth_max });
    } catch (e) { responder(res, e, 'scraper-listar'); }
  });

  async function jobDoScraper(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw erro(400, 'Job inválido');
    const { rows: [j] } = await pool.query('SELECT * FROM com_scraper_jobs WHERE id = $1', [id]);
    if (!j) throw erro(404, 'Job não encontrado');
    return j;
  }

  app.post('/api/super-admin/comercial/scraper/jobs/:id/cancelar', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!podeBuscar(ator.papel)) throw erro(403, 'Sem permissão');
      const j = await jobDoScraper(req.params.id);
      if (!['na_fila', 'rodando'].includes(j.status)) throw erro(409, 'Este job já terminou');
      if (j.engine_job_id) await scraper.apagarJob(j.engine_job_id);
      await pool.query("UPDATE com_scraper_jobs SET status = 'cancelado', concluido_em = NOW() WHERE id = $1 AND status IN ('na_fila', 'rodando')", [j.id]);
      await auditar(ator, 'scraper_job_cancelado', 'scraper_job', j.id, {});
      await tickScraper();
      res.json({ ok: true });
    } catch (e) { responder(res, e, 'scraper-cancelar'); }
  });

  // Baixa o resultado do engine e passa pelo MESMO filtro, dedupe e prévia das outras fontes.
  app.post('/api/super-admin/comercial/scraper/jobs/:id/previa', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!podeBuscar(ator.papel)) throw erro(403, 'Sem permissão');
      const j = await jobDoScraper(req.params.id);
      if (j.status !== 'concluido') throw erro(409, 'O job ainda não terminou com resultado');
      const linhas = await scraper.baixarJob(j.engine_job_id);
      const cfg = await lerConfig();
      const candidatos = linhas.slice(0, 5000).map(candidatoDoScraper);
      const classif = classificarCandidatos(candidatos, await baseParaClassificar(candidatos), cfg);
      const previaId = guardarPrevia(ator, 'google_maps_scraper', {
        scraper_job_id: j.id, engine_job_id: j.engine_job_id, palavras: j.palavras, tipos: j.tipos, coletado_em: j.concluido_em || new Date(agora()),
      }, classif);
      await auditar(ator, 'previa_scraper', 'scraper_job', j.id, { linhas: linhas.length, resumo: classif.resumo });
      res.json({ previa_id: previaId, fonte: 'google_maps_scraper', aviso: j.aviso, resumo: classif.resumo, itens: classif.itens.map(itemTela) });
    } catch (e) { responder(res, e, 'scraper-previa'); }
  });

  app.get('/api/super-admin/comercial/leads', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      const cond = [], params = [];
      const p = v => { params.push(v); return `$${params.length}`; };
      if (!veTodos(ator.papel)) {
        cond.push(ator.papel === 'sdr' ? `(l.dono_id = ${p(ator.user.id)} OR l.dono_id IS NULL)` : `l.dono_id = ${p(ator.user.id)}`);
      } else if (req.query.dono_id === 'sem') cond.push('l.dono_id IS NULL');
      else if (req.query.dono_id) cond.push(`l.dono_id = ${p(String(req.query.dono_id))}`);
      if (req.query.etapa && ETAPAS.includes(String(req.query.etapa))) cond.push(`l.etapa = ${p(String(req.query.etapa))}`);
      if (req.query.origem) cond.push(`l.origem = ${p(String(req.query.origem))}`);
      if (req.query.busca) {
        const b = `%${String(req.query.busca).slice(0, 80).replace(/[%_\\]/g, m => `\\${m}`)}%`;
        cond.push(`(l.clinica_nome ILIKE ${p(b)} OR l.cidade ILIKE ${p(b)} OR l.telefone_comercial ILIKE ${p(b)})`);
      }
      const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 50));
      const pagina = Math.max(0, Number(req.query.pagina) || 0);
      const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT l.*, COALESCE(pr.name, pr.email) AS dono_nome, COUNT(*) OVER() AS total
           FROM com_leads l LEFT JOIN profiles pr ON pr.id = l.dono_id
           ${where} ORDER BY l.criado_em DESC LIMIT ${limite} OFFSET ${pagina * limite}`, params);
      // Lead do Google ainda não confirmado: nome/telefone só do cache temporário (não do banco).
      const dados = rows.map(({ total, telefone_norm, ...l }) => ({
        ...l,
        telefone_celular: telefoneEhCelular(telefone_norm),
        dados_google: l.origem === 'google_places' && !l.dados_confirmados_em && l.place_id ? (cachePlaces.get(`pl:${l.place_id}`) ? pickGoogle(cachePlaces.get(`pl:${l.place_id}`)) : null) : null,
      }));
      res.json({ data: dados, total: Number(rows[0]?.total || 0), pagina, limite });
    } catch (e) { responder(res, e, 'leads'); }
  });

  const pickGoogle = c => ({ telefone_celular: telefoneEhCelular(c.telefone_norm), clinica_nome: c.clinica_nome, categoria: c.categoria, endereco: c.endereco, telefone_comercial: c.telefone_comercial, site: c.site, nota_avaliacao: c.nota_avaliacao, total_avaliacoes: c.total_avaliacoes });

  async function leadVisivel(ator, id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw erro(400, 'Lead inválido');
    const { rows } = await pool.query('SELECT * FROM com_leads WHERE id = $1', [id]);
    const l = rows[0];
    if (!l) throw erro(404, 'Lead não encontrado');
    if (!veTodos(ator.papel) && l.dono_id !== ator.user.id && !(ator.papel === 'sdr' && !l.dono_id)) throw erro(404, 'Lead não encontrado');
    return l;
  }

  // Dados atuais do Google para um lead (cache temporário ou Place Details, que conta no limite diário).
  app.get('/api/super-admin/comercial/leads/:id/google', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      const l = await leadVisivel(ator, req.params.id);
      if (!l.place_id) throw erro(400, 'Lead sem place_id do Google');
      const cfg = await lerConfig();
      const { candidato, custo } = await fonte(cfg).detalhes(l.place_id);
      await pool.query('UPDATE com_leads SET google_consultado_em = NOW() WHERE id = $1', [l.id]);
      if (custo) await auditar(ator, 'detalhes_places', 'lead', l.id, { gasto_usd: custo });
      res.json({ dados: pickGoogle(candidato), custo_usd: custo, atribuicao: 'Google Maps' });
    } catch (e) { responder(res, e, 'lead-google'); }
  });

  app.patch('/api/super-admin/comercial/leads/:id', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      const l = await leadVisivel(ator, req.params.id);
      const sets = [], params = [];
      const p = v => { params.push(v); return `$${params.length}`; };
      const mudou = {};
      if (req.body?.etapa !== undefined) {
        if (!ETAPAS.includes(req.body.etapa)) throw erro(400, 'Etapa inválida');
        sets.push(`etapa = ${p(req.body.etapa)}`); mudou.etapa = [l.etapa, req.body.etapa];
      }
      if (req.body?.notas !== undefined) { sets.push(`notas = ${p(String(req.body.notas || '').slice(0, 5000) || null)}`); mudou.notas = true; }
      if (req.body?.dono_id !== undefined) {
        if (!veTodos(ator.papel) && ator.papel !== 'sdr') throw erro(403, 'Seu papel não redistribui leads');
        const novo = req.body.dono_id || null;
        if (novo) {
          const { rows } = await pool.query(
            `SELECT p.id FROM profiles p LEFT JOIN com_equipe e ON e.profile_id = p.id
              WHERE p.id = $1 AND (COALESCE(p.is_super_admin, false) = true OR (e.ativo = true AND p.tenant_id IS NULL))`, [novo]);
          if (!rows[0]) throw erro(400, 'Responsável não faz parte da equipe comercial');
        }
        sets.push(`dono_id = ${p(novo)}`); mudou.dono_id = [l.dono_id, novo];
      }
      if (!sets.length) throw erro(400, 'Nada para alterar');
      const { rows } = await pool.query(`UPDATE com_leads SET ${sets.join(', ')}, atualizado_em = NOW() WHERE id = ${p(l.id)} RETURNING *`, params);
      await auditar(ator, 'lead_alterado', 'lead', l.id, mudou);
      res.json({ data: rows[0] });
    } catch (e) { responder(res, e, 'lead-patch'); }
  });

  // O vendedor confirmou os dados falando com a clínica: viram dados próprios e podem ser gravados.
  app.post('/api/super-admin/comercial/leads/:id/confirmar-dados', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      const l = await leadVisivel(ator, req.params.id);
      const b = req.body || {};
      const nome = String(b.clinica_nome || '').trim().slice(0, 200);
      if (!nome) throw erro(400, 'Informe o nome da clínica confirmado');
      const tel = String(b.telefone_comercial || '').trim().slice(0, 40) || null;
      const site = String(b.site || '').trim().slice(0, 300) || null;
      const email = String(b.email_comercial || '').trim().toLowerCase().slice(0, 200) || null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro(400, 'E-mail inválido');
      const { rows } = await pool.query(
        `UPDATE com_leads SET clinica_nome = $1, telefone_comercial = $2, telefone_norm = $3, site = $4, site_dominio = $5,
           email_comercial = $6, email_pessoal = $7, endereco = COALESCE($8, endereco), cnpj = COALESCE($9, cnpj),
           dados_confirmados_em = NOW(), dados_confirmados_por = $10, atualizado_em = NOW()
         WHERE id = $11 RETURNING *`,
        [nome, tel, normalizarTelefoneBR(tel), site, dominioSite(site), email, emailEhPessoal(email),
          String(b.endereco || '').trim().slice(0, 300) || null, String(b.cnpj || '').replace(/\D/g, '') || null, ator.user.id, l.id]);
      await auditar(ator, 'dados_confirmados', 'lead', l.id, {});
      res.json({ data: rows[0] });
    } catch (e) { responder(res, e, 'lead-confirmar'); }
  });

  // "Não quer ser contatado": bloqueia o lead e grava a supressão (HMAC) que vale para reimportação.
  app.post('/api/super-admin/comercial/leads/:id/nao-contatar', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      const l = await leadVisivel(ator, req.params.id);
      const motivo = String(req.body?.motivo || 'pedido do titular').slice(0, 300);
      const cand = { telefone_norm: l.telefone_norm, email_comercial: l.email_comercial, cnpj: l.cnpj, place_id: l.place_id };
      const tipos = [['telefone', l.telefone_norm], ['email', l.email_comercial && l.email_comercial.toLowerCase()], ['cnpj', l.cnpj], ['place_id', l.place_id]];
      for (const [tipo, valor] of tipos) {
        if (!valor) continue;
        await pool.query('INSERT INTO com_supressao (hmac, tipo, motivo, criado_por) VALUES ($1, $2, $3, $4) ON CONFLICT (hmac) DO NOTHING',
          [hmac(tipo, valor), tipo, motivo, ator.user.id]);
      }
      const { rows } = await pool.query(
        `UPDATE com_leads SET nao_contatar = true, nao_contatar_em = NOW(), nao_contatar_motivo = $1, canal_whatsapp_permitido = false,
           etapa = CASE WHEN etapa = 'ganho' THEN etapa ELSE 'perdido' END, atualizado_em = NOW() WHERE id = $2 RETURNING *`, [motivo, l.id]);
      await auditar(ator, 'nao_contatar', 'lead', l.id, { supressoes: hmacsDoCandidato(cand).length });
      res.json({ data: rows[0] });
    } catch (e) { responder(res, e, 'lead-optout'); }
  });

  // ─── Equipe comercial ──────────────────────────────────────────────────────────
  app.get('/api/super-admin/comercial/equipe', async (req, res) => {
    try {
      await acessoComercial(req);
      const { rows } = await pool.query(
        `SELECT p.id AS profile_id, COALESCE(p.name, p.email) AS nome, p.email, 'dono' AS papel, true AS ativo
           FROM profiles p WHERE COALESCE(p.is_super_admin, false) = true
         UNION ALL
         SELECT e.profile_id, COALESCE(p.name, p.email), p.email, e.papel, e.ativo
           FROM com_equipe e JOIN profiles p ON p.id = e.profile_id
          WHERE p.tenant_id IS NULL AND COALESCE(p.is_super_admin, false) = false
         ORDER BY 4, 2`);
      res.json({ data: rows });
    } catch (e) { responder(res, e, 'equipe'); }
  });

  app.post('/api/super-admin/comercial/equipe', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (ator.papel !== 'dono') throw erro(403, 'Só o dono gerencia a equipe comercial');
      const email = String(req.body?.email || '').trim().toLowerCase();
      const papel = String(req.body?.papel || '');
      if (!PAPEIS_EQUIPE.includes(papel)) throw erro(400, 'Papel inválido (gestor, vendedor ou sdr)');
      const { rows } = await pool.query('SELECT id, tenant_id, COALESCE(is_super_admin, false) AS is_super_admin FROM profiles WHERE lower(email) = $1 LIMIT 1', [email]);
      const alvo = rows[0];
      if (!alvo) throw erro(404, 'Nenhuma conta interna com esse e-mail');
      if (alvo.tenant_id) throw erro(400, 'Esta é uma conta de clínica: a equipe comercial usa contas internas, sem clínica');
      if (alvo.is_super_admin) throw erro(400, 'Super-admin já tem acesso total');
      await pool.query(
        `INSERT INTO com_equipe (profile_id, papel, ativo, criado_por) VALUES ($1, $2, true, $3)
         ON CONFLICT (profile_id) DO UPDATE SET papel = EXCLUDED.papel, ativo = true, atualizado_em = NOW()`, [alvo.id, papel, ator.user.id]);
      await auditar(ator, 'equipe_incluida', 'profile', alvo.id, { papel });
      res.json({ ok: true });
    } catch (e) { responder(res, e, 'equipe-post'); }
  });

  app.delete('/api/super-admin/comercial/equipe/:profileId', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (ator.papel !== 'dono') throw erro(403, 'Só o dono gerencia a equipe comercial');
      if (!/^[0-9a-f-]{36}$/i.test(req.params.profileId)) throw erro(400, 'Conta inválida');
      const { rowCount } = await pool.query('UPDATE com_equipe SET ativo = false, atualizado_em = NOW() WHERE profile_id = $1', [req.params.profileId]);
      if (!rowCount) throw erro(404, 'Pessoa não está na equipe');
      await auditar(ator, 'equipe_desativada', 'profile', req.params.profileId, {});
      res.json({ ok: true });
    } catch (e) { responder(res, e, 'equipe-delete'); }
  });

  app.get('/api/super-admin/comercial/auditoria', async (req, res) => {
    try {
      const ator = await acessoComercial(req);
      if (!veTodos(ator.papel)) throw erro(403, 'Sem permissão');
      const { rows } = await pool.query(
        `SELECT a.id, a.criado_em, a.acao, a.alvo_tipo, a.alvo_id, a.detalhe, a.ator_papel, COALESCE(p.name, p.email) AS ator_nome
           FROM com_auditoria a LEFT JOIN profiles p ON p.id = a.ator_id ORDER BY a.criado_em DESC LIMIT 100`);
      res.json({ data: rows });
    } catch (e) { responder(res, e, 'auditoria'); }
  });

  return { acessoComercial, previas, cachePlaces, tickScraper, scraperConfigurado: scraper.configurado };
}
