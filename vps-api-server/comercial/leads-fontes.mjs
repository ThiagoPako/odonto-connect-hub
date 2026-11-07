// Buscador de leads do comercial interno da Odonto Connect (só clínicas odontológicas, radiologia
// odontológica e dentistas). Funções puras + as duas fontes de lead:
//   1) Google Places API (New) oficial — nunca raspagem do Google Maps (contra os Termos do Google);
//   2) Importação de CSV, inclusive o formato do google-maps-scraper-kit (que o dono roda no
//      computador dele, sob responsabilidade dele) e planilhas em português.
// Nada aqui toca o banco: as rotas (rotas-leads.mjs) cuidam de persistência, permissão e auditoria.

// ─── Configuração ───────────────────────────────────────────────────────────
// Categorias comparadas sem acento e em minúsculas, por "contém".
export const CONFIG_PADRAO = Object.freeze({
  // Lead só entra se a categoria (ou o tipo do Google) contiver um destes termos.
  categorias_aceitas: [
    'dentista', 'dentist', 'odontolog', 'odonto', 'dental clinic', 'clinica dental', 'dental_clinic',
    'ortodont', 'orthodont', 'implantodont', 'endodont', 'periodont', 'odontopediatr',
    'cirurgiao dentista', 'cirurgia bucomaxilo', 'radiologia odontolog', 'radiologia oral',
    'documentacao odontolog', 'oral surgeon', 'prosthodont', 'pediatric dentist',
  ],
  // Categoria genérica de imagem/radiologia: só entra se o NOME tiver um termo odontológico.
  // Inclui os tipos genéricos que o Google dá a centros de radiologia (medical_lab, health...).
  categorias_exigem_nome_odonto: ['radiolog', 'diagnostico por imagem', 'imagem', 'tomografia', 'raio x', 'raio-x', 'medical lab', 'laboratorio', 'diagnostic', 'health', 'saude'],
  // Comparados no início de palavra do nome ("oral" não casa com "Moral").
  termos_nome_odonto: ['odonto', 'dent', 'oral', 'bucal', 'ortodont', 'implant', 'radiologia odonto', 'maxilo'],
  // Têm prioridade sobre as aceitas: "Dental supply store" contém "dental" mas não é clínica.
  categorias_recusadas: [
    'veterin', 'loja', 'store', 'supply', 'distribuidor', 'deposito', 'dental lab', 'laboratorio de protese',
    'protetico', 'protese dentaria lab', 'material odontolog', 'artigos odontolog', 'escola', 'faculdade', 'universidade',
    'curso', 'farmacia', 'pharmacy',
  ],
  // Google Places: limites de custo (USD, preço de tabela do Google) e paginação.
  places_max_paginas_por_busca: 3,      // Text Search devolve até 20 por página e no máximo 60 por consulta
  places_limite_busca_usd: 0.35,        // teto de uma busca (todas as consultas e páginas somadas)
  places_limite_diario_usd: 5,          // teto do dia, somando todas as buscas e detalhes
  places_custo_text_search_usd: 0.035,  // Text Search Enterprise: US$ 35 / 1.000 (faixa 0–100 mil)
  places_custo_detalhes_usd: 0.020,     // Place Details Enterprise: US$ 20 / 1.000
  places_custo_geocode_usd: 0.005,      // Geocoding: US$ 5 / 1.000
  places_cache_minutos: 60,             // cache temporário em memória (nunca no banco)
  raio_max_km: 50,                      // limite da API (50.000 m)
});

export const CHAVES_CONFIG = Object.keys(CONFIG_PADRAO);

// Valida/mescla a config salva pelo dono (com_config) sobre o padrão. Ignora chave desconhecida.
export function mesclarConfig(salva = {}) {
  const cfg = { ...CONFIG_PADRAO };
  for (const [k, v] of Object.entries(salva || {})) {
    if (!(k in CONFIG_PADRAO)) continue;
    const padrao = CONFIG_PADRAO[k];
    if (Array.isArray(padrao)) {
      if (Array.isArray(v)) cfg[k] = v.map(t => normalizarTexto(t)).filter(Boolean).slice(0, 200);
    } else if (typeof padrao === 'number') {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) cfg[k] = n;
    }
  }
  cfg.places_max_paginas_por_busca = Math.min(3, Math.max(1, Math.floor(cfg.places_max_paginas_por_busca)));
  cfg.raio_max_km = Math.min(50, cfg.raio_max_km);
  return cfg;
}

// ─── Normalização ───────────────────────────────────────────────────────────
export function normalizarTexto(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

// Nome para comparar duplicados: sem acento, sem pontuação e sem palavras genéricas.
const PALAVRAS_GENERICAS = new Set(['clinica', 'consultorio', 'odontologica', 'odontologia', 'odontologico', 'dr', 'dra', 'de', 'da', 'do', 'das', 'dos', 'e', 'ltda', 'me', 'eireli', 'ss', 'the']);
export function chaveNome(nome) {
  return normalizarTexto(nome).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(p => p && !PALAVRAS_GENERICAS.has(p)).join(' ');
}

// Telefone brasileiro → só dígitos com 55 + DDD (12 ou 13 dígitos). null se não parece telefone BR.
export function normalizarTelefoneBR(tel) {
  let d = String(tel ?? '').replace(/\D/g, '');
  if (!d) return null;
  d = d.replace(/^0+/, '');                      // 0xx11..., 0800 vira 800 (descartado abaixo)
  if (d.length >= 14 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!((d.length === 12 || d.length === 13) && d.startsWith('55'))) return null;
  // DDD brasileiro: 11–99 e nenhum termina em 0 (0800/0300 viram "80"/"30" e são descartados).
  if (d[2] === '0' || d[3] === '0') return null;
  return d;
}

// Celular BR (55 + DDD + 9 + 8 dígitos): de dentista pessoa física costuma ser número pessoal.
export function telefoneEhCelular(norm) {
  return !!norm && norm.length === 13 && norm[4] === '9';
}

export function dominioSite(site) {
  const s = String(site ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return null;
    // Perfil em rede social/agregador não identifica a clínica (muitas usam instagram.com/...).
    if (/(^|\.)(instagram|facebook|linktr|wa\.me|whatsapp|google|doctoralia|boaconsulta)\./.test(`${host}.`) || host === 'wa.me') return null;
    return host;
  } catch { return null; }
}

const PROVEDORES_GRATUITOS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com',
  'msn.com', 'yahoo.com', 'yahoo.com.br', 'ymail.com', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br',
  'icloud.com', 'me.com', 'globo.com', 'globomail.com', 'r7.com', 'zipmail.com.br', 'protonmail.com', 'proton.me',
]);

// Primeiro e-mail válido; prefere o do domínio do site (caixa da clínica).
export function escolherEmail(emails, siteDominio) {
  const lista = String(emails ?? '').split(/[,;\s]+/).map(e => e.trim().toLowerCase())
    .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (!lista.length) return { email: null, pessoal: false };
  const doSite = siteDominio ? lista.find(e => e.endsWith(`@${siteDominio}`)) : null;
  const email = doSite || lista[0];
  return { email, pessoal: emailEhPessoal(email) };
}

// LGPD: e-mail em provedor gratuito (gmail, hotmail...) é, em regra, de uma pessoa física.
export function emailEhPessoal(email) {
  const dom = String(email ?? '').split('@')[1]?.toLowerCase();
  return !!dom && PROVEDORES_GRATUITOS.has(dom);
}

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
export function ufValida(uf) {
  const u = String(uf ?? '').trim().toUpperCase();
  return UFS.has(u) ? u : null;
}

// "R. X, 100 - Centro, Campinas - SP, 13010-000, Brasil" → { cidade: 'Campinas', uf: 'SP' }
export function extrairCidadeUf(endereco) {
  const s = String(endereco ?? '');
  const m = s.match(/([^,\-–]+?)\s*[-–]\s*([A-Z]{2})\s*(?:,|$)/g);
  if (m) {
    for (let i = m.length - 1; i >= 0; i--) {
      const mm = m[i].match(/([^,\-–]+?)\s*[-–]\s*([A-Z]{2})\s*(?:,|$)/);
      if (mm && ufValida(mm[2])) return { cidade: mm[1].trim(), uf: mm[2] };
    }
  }
  return { cidade: null, uf: null };
}

const escaparRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Filtro de categoria (obrigatório nas duas fontes) ─────────────────────────
// candidato: { clinica_nome, categoria, tipos: [] }
export function avaliarCategoria(candidato, config = CONFIG_PADRAO) {
  const nome = normalizarTexto(candidato.clinica_nome);
  const tipos = (candidato.tipos || []).map(normalizarTexto);
  const categoria = normalizarTexto(candidato.categoria);
  const textos = [categoria, ...tipos].filter(Boolean);
  if (!textos.length) return { aceito: false, motivo: 'sem categoria' };
  const contem = (lista, alvo) => lista.find(t => t && alvo.includes(normalizarTexto(t)));
  const nomeTem = lista => lista.find(t => t && new RegExp(`(^|[^a-z0-9])${escaparRegex(normalizarTexto(t))}`).test(nome));

  // Recusa olha só a categoria principal: tipos secundários do Google ("store", "health") são ruidosos.
  if (categoria && contem(config.categorias_recusadas, categoria)) {
    return { aceito: false, motivo: `categoria recusada (${candidato.categoria})` };
  }
  for (const txt of textos) {
    if (contem(config.categorias_aceitas, txt)) return { aceito: true, motivo: null };
  }
  for (const txt of textos) {
    if (contem(config.categorias_exigem_nome_odonto, txt)) {
      return nomeTem(config.termos_nome_odonto)
        ? { aceito: true, motivo: null }
        : { aceito: false, motivo: 'categoria genérica (radiologia/imagem/saúde) sem indício de odontologia no nome' };
    }
  }
  return { aceito: false, motivo: `fora do segmento (${candidato.categoria || tipos[0] || 'sem categoria'})` };
}

// ─── CSV ────────────────────────────────────────────────────────────────────
// Parser RFC 4180 (aspas, aspas duplicadas, quebra de linha dentro de aspas), detecta , ou ;
export function parseCsv(texto, { maxLinhas = 5000 } = {}) {
  let s = String(texto ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const primeira = s.split(/\r?\n/, 1)[0] || '';
  const delim = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === delim) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(v => v !== '')) linhas.push(linha);
      linha = [];
      if (linhas.length > maxLinhas + 1) break;
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); if (linha.some(v => v !== '')) linhas.push(linha); }
  if (!linhas.length) return { cabecalho: [], linhas: [], excedeu: false };
  const cabecalho = linhas[0].map(h => normalizarTexto(h).replace(/\s+/g, '_'));
  const corpo = linhas.slice(1, maxLinhas + 1).map(l => Object.fromEntries(cabecalho.map((h, i) => [h, desfazerGuardaFormula((l[i] ?? '').trim())])));
  return { cabecalho, linhas: corpo, excedeu: linhas.length - 1 > maxLinhas };
}

// O kit protege célula que o Excel rodaria como fórmula com um ' na frente; desfaz para ler o texto.
const FORMULA = /^'*(?:[=@\t\r]|[+-](?![\d\s().-]*$))/;
export function desfazerGuardaFormula(v) {
  return typeof v === 'string' && v.length > 1 && v[0] === "'" && FORMULA.test(v.slice(1)) ? v.slice(1) : v;
}
// Ao exportar: protege de novo (injeção de fórmula em planilha).
export function protegerFormula(v) {
  const s = v == null ? '' : String(v);
  return FORMULA.test(s) ? `'${s}` : s;
}

const ALIASES = {
  clinica_nome: ['title', 'name', 'nome', 'nome_da_clinica', 'clinica', 'empresa', 'razao_social', 'nome_fantasia'],
  telefone: ['phone', 'telefone', 'fone', 'phone_number', 'telefone_comercial', 'whatsapp'],
  emails: ['emails', 'email', 'e-mail', 'e_mail', 'email_comercial'],
  site: ['website', 'site', 'url', 'web'],
  categoria: ['category', 'categoria', 'categories', 'tipo', 'segmento', 'main_category'],
  endereco: ['address', 'endereco', 'full_address', 'logradouro'],
  cidade: ['city', 'cidade', 'municipio'],
  uf: ['state', 'uf', 'estado'],
  cnpj: ['cnpj'],
  nota: ['review_rating', 'rating', 'nota', 'avaliacao'],
  total_avaliacoes: ['review_count', 'reviews', 'reviews_count', 'avaliacoes', 'user_ratings_total'],
  place_id: ['place_id', 'placeid'],
};
const REDES = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'x', 'twitter'];

function pegar(row, chave) {
  for (const a of ALIASES[chave]) {
    const v = row[a];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

export function formatoDoCsv(cabecalho) {
  const kit = ['title', 'phone', 'emails', 'website', 'category', 'address', 'review_rating', 'review_count'];
  return kit.every(c => cabecalho.includes(c)) ? 'google-maps-scraper-kit' : 'planilha';
}

// Linha do CSV → candidato a lead (mesmo formato da fonte Places).
export function candidatoDoCsv(row) {
  const endereco = pegar(row, 'endereco');
  const doEnd = extrairCidadeUf(endereco);
  const site = pegar(row, 'site');
  const site_dominio = dominioSite(site);
  const { email, pessoal } = escolherEmail(pegar(row, 'emails'), site_dominio);
  const telefone = pegar(row, 'telefone');
  const nota = Number(String(pegar(row, 'nota') ?? '').replace(',', '.'));
  const total = parseInt(String(pegar(row, 'total_avaliacoes') ?? '').replace(/\D/g, ''), 10);
  const redes = {};
  for (const r of REDES) if (row[r]) redes[r] = String(row[r]).slice(0, 300);
  return {
    clinica_nome: pegar(row, 'clinica_nome'),
    categoria: pegar(row, 'categoria'),
    tipos: [],
    endereco,
    cidade: pegar(row, 'cidade') || doEnd.cidade,
    uf: ufValida(pegar(row, 'uf')) || doEnd.uf,
    telefone_comercial: telefone,
    telefone_norm: normalizarTelefoneBR(telefone),
    email_comercial: email,
    email_pessoal: pessoal,
    site,
    site_dominio,
    cnpj: (pegar(row, 'cnpj') || '').replace(/\D/g, '') || null,
    nota_avaliacao: Number.isFinite(nota) && nota > 0 && nota <= 5 ? Math.round(nota * 10) / 10 : null,
    total_avaliacoes: Number.isFinite(total) ? total : null,
    place_id: pegar(row, 'place_id'),
    redes,
    fechado: false,
  };
}

// ─── Google Places API (New) ────────────────────────────────────────────────
// Field mask enxuto: só o que o comercial usa. Telefone/site/nota fazem a chamada cair no SKU
// Enterprise (US$ 35/1.000 no Text Search); sem eles seria Pro (US$ 32), mas sem eles o lead não serve.
export const PLACES_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.nationalPhoneNumber', 'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.types', 'places.primaryType', 'places.primaryTypeDisplayName', 'places.businessStatus', 'nextPageToken',
].join(',');
export const DETALHES_FIELD_MASK = PLACES_FIELD_MASK.split(',').filter(f => f !== 'nextPageToken').map(f => f.replace(/^places\./, '')).join(',');

// Tipo pedido na tela → consultas da Text Search (tipos da Tabela A do Google).
export const TIPOS_BUSCA = Object.freeze({
  dentista: { rotulo: 'Dentistas', textQuery: 'dentista', includedType: 'dentist' },
  clinica: { rotulo: 'Clínicas odontológicas', textQuery: 'clínica odontológica', includedType: 'dental_clinic' },
  radiologia: { rotulo: 'Radiologia odontológica', textQuery: 'radiologia odontológica', includedType: null },
});

export function candidatoDoPlace(p, { cidadeBusca = null, ufBusca = null } = {}) {
  const comp = Array.isArray(p.addressComponents) ? p.addressComponents : [];
  const doTipo = t => comp.find(c => (c.types || []).includes(t));
  const cidade = doTipo('administrative_area_level_2')?.longText || doTipo('locality')?.longText || extrairCidadeUf(p.formattedAddress).cidade || cidadeBusca;
  const uf = ufValida(doTipo('administrative_area_level_1')?.shortText) || extrairCidadeUf(p.formattedAddress).uf || ufBusca;
  const site = p.websiteUri || null;
  const site_dominio = dominioSite(site);
  const telefone = p.nationalPhoneNumber || null;
  return {
    clinica_nome: p.displayName?.text || null,
    categoria: p.primaryTypeDisplayName?.text || p.primaryType || null,
    tipos: Array.isArray(p.types) ? p.types : [],
    endereco: p.formattedAddress || null,
    cidade,
    uf,
    telefone_comercial: telefone,
    telefone_norm: normalizarTelefoneBR(telefone),
    email_comercial: null,
    email_pessoal: false,
    site,
    site_dominio,
    cnpj: null,
    nota_avaliacao: typeof p.rating === 'number' ? p.rating : null,
    total_avaliacoes: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    place_id: p.id || null,
    redes: {},
    fechado: p.businessStatus === 'CLOSED_PERMANENTLY',
  };
}

// Cache em memória com prazo (nunca persistido: os Termos só deixam guardar o place_id).
export class CacheTemporario {
  constructor(agora = () => Date.now()) { this.mapa = new Map(); this.agora = agora; }
  get(k) {
    const e = this.mapa.get(k);
    if (!e) return undefined;
    if (e.ate < this.agora()) { this.mapa.delete(k); return undefined; }
    return e.v;
  }
  set(k, v, ttlMs) {
    if (this.mapa.size > 20000) this.limpar();
    this.mapa.set(k, { v, ate: this.agora() + ttlMs });
  }
  limpar() { const t = this.agora(); for (const [k, e] of this.mapa) if (e.ate < t) this.mapa.delete(k); if (this.mapa.size > 20000) this.mapa.clear(); }
}

// Fonte Places. `reservarCusto(usd)` (das rotas) grava o gasto do dia e devolve false se passar do
// limite diário: a chamada nem é feita. `fetchImpl` é injetável (testes e mock local).
export function criarFontePlaces({ apiKey, fetchImpl = globalThis.fetch, reservarCusto, cache = new CacheTemporario(), config = CONFIG_PADRAO, baseUrl = 'https://places.googleapis.com/v1', geocodeUrl = 'https://maps.googleapis.com/maps/api/geocode/json' }) {
  const ttl = () => Math.max(1, config.places_cache_minutos) * 60_000;

  async function chamar(url, init, custo, rotulo) {
    if (!apiKey) { const e = new Error('Google Places não configurado: falta GOOGLE_PLACES_API_KEY no .env do servidor'); e.status = 503; throw e; }
    if (!(await reservarCusto(custo, rotulo))) { const e = new Error('Limite diário de gasto com o Google atingido. Aumente em Configurações ou tente amanhã.'); e.status = 429; e.limite = 'diario'; throw e; }
    let resp;
    try { resp = await fetchImpl(url, init); } catch (err) { const e = new Error('Google Places fora do ar ou sem rede'); e.status = 502; e.cause = err; throw e; }
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = corpo?.error?.message || `HTTP ${resp.status}`;
      const e = new Error(`Google Places recusou a consulta: ${msg}`);
      e.status = resp.status === 400 ? 400 : 502;
      throw e;
    }
    return corpo;
  }

  async function geocodificar(cidade, uf) {
    const k = `geo:${normalizarTexto(cidade)}:${uf}`;
    const c = cache.get(k);
    if (c) return { centro: c, custo: 0 };
    const url = `${geocodeUrl}?${new URLSearchParams({ address: `${cidade}, ${uf}, Brasil`, region: 'br', language: 'pt-BR', key: apiKey })}`;
    const corpo = await chamar(url, { method: 'GET' }, config.places_custo_geocode_usd, 'geocode');
    const loc = corpo?.results?.[0]?.geometry?.location;
    if (!loc) return { centro: null, custo: config.places_custo_geocode_usd };
    const centro = { latitude: loc.lat, longitude: loc.lng };
    // Latitude/longitude podem ficar em cache por até 30 dias (Termos); aqui fica no máximo 1 dia.
    cache.set(k, centro, 24 * 3600_000);
    return { centro, custo: config.places_custo_geocode_usd };
  }

  // Busca uma ou mais páginas da Text Search para um tipo. Respeita o teto de custo da busca.
  async function buscar({ cidade, uf, tipo, raioKm = null, orcamentoUsd, maxPaginas }) {
    const def = TIPOS_BUSCA[tipo];
    if (!def) { const e = new Error('Tipo de busca inválido'); e.status = 400; throw e; }
    let gasto = 0, chamadas = 0, cacheHit = 0;
    const itens = [];
    let centro = null;
    if (raioKm) {
      if (orcamentoUsd < config.places_custo_geocode_usd) return { itens, gasto, chamadas, cacheHit, parouPorCusto: true };
      const g = await geocodificar(cidade, uf);
      centro = g.centro; gasto += g.custo; if (g.custo) chamadas++;
    }
    const corpoBase = {
      textQuery: `${def.textQuery} em ${cidade} - ${uf}`,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      pageSize: 20,
      ...(def.includedType ? { includedType: def.includedType, strictTypeFiltering: true } : {}),
      ...(centro ? { locationBias: { circle: { center: centro, radius: Math.min(config.raio_max_km, Number(raioKm)) * 1000 } } } : {}),
    };
    let pageToken = null, parouPorCusto = false;
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      const corpo = pageToken ? { ...corpoBase, pageToken } : corpoBase;
      const chave = `ts:${JSON.stringify(corpo)}`;
      let resp = cache.get(chave);
      if (resp) cacheHit++;
      else {
        if (gasto + config.places_custo_text_search_usd > orcamentoUsd + 1e-9) { parouPorCusto = true; break; }
        resp = await chamar(`${baseUrl}/places:searchText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': PLACES_FIELD_MASK },
          body: JSON.stringify(corpo),
        }, config.places_custo_text_search_usd, `text_search:${tipo}`);
        gasto += config.places_custo_text_search_usd; chamadas++;
        cache.set(chave, resp, ttl());
      }
      for (const p of resp.places || []) {
        const cand = candidatoDoPlace(p, { cidadeBusca: cidade, ufBusca: uf });
        if (cand.place_id) cache.set(`pl:${cand.place_id}`, cand, ttl());
        itens.push({ ...cand, tipo_busca: tipo });
      }
      pageToken = resp.nextPageToken || null;
      if (!pageToken) break;
    }
    return { itens, gasto, chamadas, cacheHit, parouPorCusto };
  }

  // Dados atuais de um place_id (lead do Google ainda não confirmado com a clínica).
  async function detalhes(placeId) {
    const c = cache.get(`pl:${placeId}`);
    if (c) return { candidato: c, custo: 0 };
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(String(placeId))) { const e = new Error('place_id inválido'); e.status = 400; throw e; }
    const p = await chamar(`${baseUrl}/places/${encodeURIComponent(placeId)}?languageCode=pt-BR&regionCode=BR`, {
      method: 'GET', headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': DETALHES_FIELD_MASK },
    }, config.places_custo_detalhes_usd, 'place_details');
    const cand = candidatoDoPlace(p);
    cache.set(`pl:${placeId}`, cand, ttl());
    return { candidato: cand, custo: config.places_custo_detalhes_usd };
  }

  return { buscar, detalhes, cache, doCache: placeId => cache.get(`pl:${placeId}`) };
}

// ─── Classificação: filtro + duplicados + supressão + "já é cliente" ──────────────
// base: {
//   leads: [{ id, place_id, telefone_norm, site_dominio, clinica_nome, cidade, cnpj }],   (com_leads)
//   clientes: [{ id, nome, telefone_norm, dominio, cnpj }],                                 (tenants)
//   suprimido: (candidato) => boolean                                                       (com_supressao)
// }
// Retorna cada item com status: 'novo' | 'duplicado' | 'descartado' | 'nao_contatar'.
export function classificarCandidatos(candidatos, base, config = CONFIG_PADRAO) {
  const idx = { place: new Map(), fone: new Map(), dom: new Map(), nomeCidade: new Map(), cnpj: new Map() };
  const indexar = (l, ref) => {
    if (l.place_id) idx.place.set(l.place_id, ref);
    if (l.telefone_norm) idx.fone.set(l.telefone_norm, ref);
    if (l.site_dominio) idx.dom.set(l.site_dominio, ref);
    if (l.cnpj) idx.cnpj.set(l.cnpj, ref);
    const nc = l.clinica_nome && l.cidade ? `${chaveNome(l.clinica_nome)}|${normalizarTexto(l.cidade)}` : null;
    if (nc && nc.split('|')[0]) idx.nomeCidade.set(nc, ref);
  };
  for (const l of base.leads || []) indexar(l, { tipo: 'crm', id: l.id });

  const cli = { fone: new Map(), dom: new Map(), cnpj: new Map(), nome: new Map() };
  for (const c of base.clientes || []) {
    if (c.telefone_norm) cli.fone.set(c.telefone_norm, c);
    if (c.dominio) cli.dom.set(c.dominio, c);
    if (c.cnpj) cli.cnpj.set(c.cnpj, c);
    const n = chaveNome(c.nome); if (n) cli.nome.set(n, c);
  }

  const resumo = { total: candidatos.length, novos: 0, duplicados: 0, descartados: 0, nao_contatar: 0, ja_clientes: 0, motivos_descarte: {} };
  const itens = candidatos.map((cand, i) => {
    const item = { ...cand, chave: cand.place_id ? `place:${cand.place_id}` : `linha:${i}`, status: 'novo', motivo: null, duplicado_de: null, ja_cliente: null };
    const descartar = motivo => { item.status = 'descartado'; item.motivo = motivo; resumo.descartados++; resumo.motivos_descarte[motivo] = (resumo.motivos_descarte[motivo] || 0) + 1; };

    if (!cand.clinica_nome && !cand.place_id) { descartar('sem nome'); return item; }
    if (cand.fechado) { descartar('fechado permanentemente'); return item; }
    const cat = avaliarCategoria(cand, config);
    if (!cat.aceito) { descartar(cat.motivo.startsWith('categoria recusada') ? 'categoria recusada' : cat.motivo.startsWith('fora do segmento') ? 'fora do segmento' : cat.motivo); item.motivo = cat.motivo; return item; }

    // Já é cliente (clínica cadastrada): marca, não descarta (pode ser upsell/filial).
    const cliente = (cand.cnpj && cli.cnpj.get(cand.cnpj)) || (cand.telefone_norm && cli.fone.get(cand.telefone_norm))
      || (cand.site_dominio && cli.dom.get(cand.site_dominio)) || (chaveNome(cand.clinica_nome) && cli.nome.get(chaveNome(cand.clinica_nome)));
    if (cliente) { item.ja_cliente = { tenant_id: cliente.id, nome: cliente.nome }; resumo.ja_clientes++; }

    if (base.suprimido?.(cand)) { item.status = 'nao_contatar'; item.motivo = 'pediu para não ser contatado'; resumo.nao_contatar++; return item; }

    const nc = cand.clinica_nome && cand.cidade ? `${chaveNome(cand.clinica_nome)}|${normalizarTexto(cand.cidade)}` : null;
    const dup = (cand.place_id && idx.place.get(cand.place_id) && ['place_id', idx.place.get(cand.place_id)])
      || (cand.cnpj && idx.cnpj.get(cand.cnpj) && ['CNPJ', idx.cnpj.get(cand.cnpj)])
      || (cand.telefone_norm && idx.fone.get(cand.telefone_norm) && ['telefone', idx.fone.get(cand.telefone_norm)])
      || (cand.site_dominio && idx.dom.get(cand.site_dominio) && ['site', idx.dom.get(cand.site_dominio)])
      || (nc && nc.split('|')[0] && idx.nomeCidade.get(nc) && ['nome e cidade', idx.nomeCidade.get(nc)]);
    if (dup) {
      item.status = 'duplicado';
      item.duplicado_de = dup[1];
      item.motivo = dup[1].tipo === 'crm' ? `já está no CRM (mesmo ${dup[0]})` : `repetido neste lote (mesmo ${dup[0]})`;
      resumo.duplicados++;
      // Telefone/site deste item também apontam para o lead existente: o lead do Google no CRM só
      // guarda o place_id, e sem isso a filial com o mesmo telefone passaria como nova.
      if (dup[1].tipo === 'crm') indexar(cand, dup[1]);
      return item;
    }
    indexar(cand, { tipo: 'lote', chave: item.chave });
    resumo.novos++;
    return item;
  });
  return { itens, resumo };
}
