/**
 * Store local de Campanhas de Marketing.
 * - CRUD de campanhas
 * - Geração de UTM links por canal
 * - Tracking de leads que chegaram via cada link
 *
 * Persistência: localStorage (modo demo).
 */

export type CanalCampanha =
  | "meta_ads"
  | "google_ads"
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "email"
  | "whatsapp"
  | "site_organico"
  | "indicacao";

export interface CanalConfig {
  id: CanalCampanha;
  label: string;
  icon: string; // emoji para visual rápido
  color: string; // tailwind class (bg-...)
  utmSource: string;
  utmMedium: string;
}

export const CANAIS: CanalConfig[] = [
  { id: "meta_ads", label: "Meta Ads (Facebook/Instagram)", icon: "📘", color: "bg-[#1877F2]", utmSource: "meta", utmMedium: "cpc" },
  { id: "google_ads", label: "Google Ads", icon: "🔍", color: "bg-[#4285F4]", utmSource: "google", utmMedium: "cpc" },
  { id: "tiktok", label: "TikTok Ads", icon: "🎵", color: "bg-[#000000]", utmSource: "tiktok", utmMedium: "cpc" },
  { id: "instagram", label: "Instagram Orgânico", icon: "📸", color: "bg-gradient-to-br from-[#F58529] to-[#DD2A7B]", utmSource: "instagram", utmMedium: "social" },
  { id: "youtube", label: "YouTube", icon: "▶️", color: "bg-[#FF0000]", utmSource: "youtube", utmMedium: "video" },
  { id: "linkedin", label: "LinkedIn", icon: "💼", color: "bg-[#0A66C2]", utmSource: "linkedin", utmMedium: "social" },
  { id: "email", label: "E-mail Marketing", icon: "✉️", color: "bg-chart-3", utmSource: "email", utmMedium: "email" },
  { id: "whatsapp", label: "WhatsApp", icon: "💬", color: "bg-[#25D366]", utmSource: "whatsapp", utmMedium: "messaging" },
  { id: "site_organico", label: "Site Orgânico (SEO)", icon: "🌐", color: "bg-chart-2", utmSource: "site", utmMedium: "organic" },
  { id: "indicacao", label: "Indicação", icon: "🤝", color: "bg-chart-5", utmSource: "indicacao", utmMedium: "referral" },
];

export interface CampaignLeadHit {
  leadId?: string;
  leadName?: string;
  canal: CanalCampanha;
  timestamp: number; // epoch ms
  convertido?: boolean; // virou paciente?
  valor?: number; // valor do orçamento aprovado
}

export interface Campaign {
  id: string;
  nome: string;
  descricao: string;
  destino: string; // URL base de destino (ex: link do WhatsApp ou landing page)
  canais: CanalCampanha[]; // canais ativos para essa campanha
  ativa: boolean;
  budget?: number;
  /** Nome da instância WhatsApp escolhida para substituir {{number}}. Se vazio, usa a primeira conectada. */
  instanceName?: string;
  criadaEm: number;
  hits: CampaignLeadHit[];
}

const STORAGE_KEY = "odonto-campanhas";
const PENDING_UTM_KEY = "odonto-pending-utm";

/* ─────────────── Persistência ─────────────── */

export function getCampanhas(): Campaign[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // seed inicial: campanha demo
  const demo = seedDemo();
  saveCampanhas(demo);
  return demo;
}

export function saveCampanhas(list: Campaign[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function upsertCampanha(c: Campaign) {
  const list = getCampanhas();
  const idx = list.findIndex((x) => x.id === c.id);
  if (idx >= 0) list[idx] = c;
  else list.unshift(c);
  saveCampanhas(list);
  return list;
}

export function deleteCampanha(id: string) {
  saveCampanhas(getCampanhas().filter((c) => c.id !== id));
}

export function getCampanhaById(id: string): Campaign | undefined {
  return getCampanhas().find((c) => c.id === id);
}

/* ─────────────── Geração de Links UTM ─────────────── */

export interface UtmExtras {
  /** utm_term — palavra-chave/segmento (ex: "implante-dentario") */
  term?: string;
  /** utm_id — ID externo do anúncio/ad set (ex: "adset_123") */
  id?: string;
  /** Número principal da instância WhatsApp conectada — substitui {{number}} no destino */
  number?: string;
}

/** Substitui placeholders dinâmicos ({{number}}) no destino antes de aplicar UTMs. */
function resolveDestino(destino: string, number?: string): string {
  if (!destino) return destino;
  // Remove tudo que não é dígito do número principal
  const clean = (number ?? "").replace(/\D/g, "");
  return destino.replace(/\{\{\s*number\s*\}\}/gi, clean);
}

export function buildTrackingLink(
  campaign: Campaign,
  canalId: CanalCampanha,
  extras: UtmExtras = {}
): string {
  const canal = CANAIS.find((c) => c.id === canalId);
  if (!canal) return campaign.destino;
  const term = extras.term?.trim();
  const utmId = extras.id?.trim();
  const destino = resolveDestino(campaign.destino, extras.number);
  try {
    const url = new URL(destino, typeof window !== "undefined" ? window.location.origin : "https://app.local");
    url.searchParams.set("utm_source", canal.utmSource);
    url.searchParams.set("utm_medium", canal.utmMedium);
    url.searchParams.set("utm_campaign", slugify(campaign.nome));
    url.searchParams.set("utm_content", canal.id);
    if (term) url.searchParams.set("utm_term", slugify(term));
    if (utmId) url.searchParams.set("utm_id", utmId);
    url.searchParams.set("cid", campaign.id);
    return url.toString();
  } catch {
    const parts = [
      `utm_source=${canal.utmSource}`,
      `utm_medium=${canal.utmMedium}`,
      `utm_campaign=${slugify(campaign.nome)}`,
      `utm_content=${canal.id}`,
      ...(term ? [`utm_term=${slugify(term)}`] : []),
      ...(utmId ? [`utm_id=${encodeURIComponent(utmId)}`] : []),
      `cid=${campaign.id}`,
    ];
    const qs = parts.join("&");
    return destino.includes("?") ? `${destino}&${qs}` : `${destino}?${qs}`;
  }
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/* ─────────────── Captura de UTM (visitante) ─────────────── */

export interface PendingUtm {
  campaignId: string;
  canal: CanalCampanha;
  timestamp: number;
}

/** Lê os utm_* da URL atual e guarda — chamar no carregamento inicial. */
export function captureUtmFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const cid = params.get("cid");
  const content = params.get("utm_content") as CanalCampanha | null;
  if (!cid || !content) return;
  const camp = getCampanhaById(cid);
  if (!camp) return;
  const pending: PendingUtm = { campaignId: cid, canal: content, timestamp: Date.now() };
  localStorage.setItem(PENDING_UTM_KEY, JSON.stringify(pending));
  // registra hit anônimo imediato
  registerHit(cid, content, { leadName: "Visitante anônimo" });
}

export function getPendingUtm(): PendingUtm | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_UTM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingUtm() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PENDING_UTM_KEY);
}

/* ─────────────── Tracking de hits/conversões ─────────────── */

export function registerHit(
  campaignId: string,
  canal: CanalCampanha,
  data: { leadId?: string; leadName?: string; convertido?: boolean; valor?: number } = {}
) {
  const list = getCampanhas();
  const camp = list.find((c) => c.id === campaignId);
  if (!camp) return;
  camp.hits.push({ canal, timestamp: Date.now(), ...data });
  saveCampanhas(list);
}

/** Vincula um lead recém-criado ao UTM pendente, retornando a campanha de origem.
 *  Também cria/aplica automaticamente as tags "Origem: <Canal>" e "Campanha: <Nome>" no CRM. */
export async function linkLeadToCampaign(leadId: string, leadName: string): Promise<{ campaign: Campaign; canal: CanalCampanha } | null> {
  const pending = getPendingUtm();
  if (!pending) return null;
  const camp = getCampanhaById(pending.campaignId);
  if (!camp) {
    clearPendingUtm();
    return null;
  }
  registerHit(camp.id, pending.canal, { leadId, leadName });

  // Auto-aplica tags de origem + campanha
  try {
    const { ensureCampaignTags, applyTagsToLead } = await import("./leadTags");
    const canal = CANAIS.find((c) => c.id === pending.canal);
    const canalLabel = canal ? canal.label.split(" (")[0] : pending.canal;
    const tagIds = ensureCampaignTags(pending.canal, canalLabel, camp.nome);
    applyTagsToLead(leadId, tagIds);
  } catch {}

  clearPendingUtm();
  return { campaign: camp, canal: pending.canal };
}

/**
 * Marca um lead como convertido em todas as campanhas onde ele aparece.
 * Atualiza o hit existente com convertido=true e valor (se fornecido).
 * Retorna a lista de campanhas afetadas.
 */
export function markLeadConverted(leadId: string, valor?: number): Campaign[] {
  if (!leadId) return [];
  const list = getCampanhas();
  const affected: Campaign[] = [];
  for (const camp of list) {
    let touched = false;
    for (const hit of camp.hits) {
      if (hit.leadId === leadId && !hit.convertido) {
        hit.convertido = true;
        if (valor !== undefined) hit.valor = valor;
        touched = true;
      }
    }
    if (touched) affected.push(camp);
  }
  if (affected.length > 0) saveCampanhas(list);
  return affected;
}

/** Verifica se um lead está vinculado a alguma campanha. */
export function findCampaignsByLead(leadId: string): Campaign[] {
  return getCampanhas().filter((c) => c.hits.some((h) => h.leadId === leadId));
}

/* ─────────────── Métricas ─────────────── */

export interface CampanhaMetrics {
  totalHits: number;
  porCanal: Record<CanalCampanha, number>;
  leadsIdentificados: number;
  conversoes: number;
  receita: number;
  taxaConversao: number;
}

export function computeMetrics(camp: Campaign): CampanhaMetrics {
  const porCanal = {} as Record<CanalCampanha, number>;
  let leadsIdentificados = 0;
  let conversoes = 0;
  let receita = 0;
  for (const h of camp.hits) {
    porCanal[h.canal] = (porCanal[h.canal] ?? 0) + 1;
    if (h.leadId) leadsIdentificados++;
    if (h.convertido) {
      conversoes++;
      receita += h.valor ?? 0;
    }
  }
  return {
    totalHits: camp.hits.length,
    porCanal,
    leadsIdentificados,
    conversoes,
    receita,
    taxaConversao: leadsIdentificados > 0 ? (conversoes / leadsIdentificados) * 100 : 0,
  };
}

/* ─────────────── Série temporal ─────────────── */

export interface DailyPoint {
  date: string;        // YYYY-MM-DD
  label: string;       // "12/04"
  total: number;       // total de cliques no dia
  anonimos: number;    // cliques sem leadId
  leads: number;       // cliques com leadId
  conversoes: number;  // hits convertidos
  receita: number;
  porCanal: Partial<Record<CanalCampanha, number>>;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Série diária agregada dos últimos `days` dias (inclui dias zerados). */
export function computeDailySeries(camp: Campaign, days = 7): DailyPoint[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const map = new Map<string, DailyPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = ymd(d);
    map.set(key, {
      date: key,
      label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      total: 0, anonimos: 0, leads: 0, conversoes: 0, receita: 0,
      porCanal: {},
    });
  }
  const cutoff = today.getTime() - (days - 1) * 86400000;
  for (const h of camp.hits) {
    if (h.timestamp < cutoff) continue;
    const d = new Date(h.timestamp);
    d.setHours(0, 0, 0, 0);
    const point = map.get(ymd(d));
    if (!point) continue;
    point.total++;
    if (h.leadId) point.leads++; else point.anonimos++;
    if (h.convertido) {
      point.conversoes++;
      point.receita += h.valor ?? 0;
    }
    point.porCanal[h.canal] = (point.porCanal[h.canal] ?? 0) + 1;
  }
  return Array.from(map.values());
}

/** Estatística agregada por canal ao longo do período. */
export interface CanalStats {
  canal: CanalCampanha;
  total: number;
  anonimos: number;
  leads: number;
  conversoes: number;
  receita: number;
}

export function computeCanalStats(camp: Campaign): CanalStats[] {
  const map = new Map<CanalCampanha, CanalStats>();
  for (const h of camp.hits) {
    const cur = map.get(h.canal) ?? { canal: h.canal, total: 0, anonimos: 0, leads: 0, conversoes: 0, receita: 0 };
    cur.total++;
    if (h.leadId) cur.leads++; else cur.anonimos++;
    if (h.convertido) { cur.conversoes++; cur.receita += h.valor ?? 0; }
    map.set(h.canal, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function seedDemo(): Campaign[] {
  const now = Date.now();
  const day = 86400000;
  return [
    {
      id: "camp-demo-1",
      nome: "Implantes Dentários — Outono 2026",
      descricao: "Campanha de captação para tratamento de implantes osseointegrados.",
      destino: "https://wa.me/5511999990000?text=Quero%20saber%20sobre%20implantes",
      canais: ["meta_ads", "google_ads", "tiktok", "instagram"],
      ativa: true,
      budget: 5000,
      criadaEm: now - 30 * day,
      hits: [
        { canal: "meta_ads", timestamp: now - 12 * day, leadId: "k1", leadName: "Carlos Oliveira", convertido: false },
        { canal: "meta_ads", timestamp: now - 8 * day, leadId: "k4", leadName: "Juliana Pires", convertido: true, valor: 8000 },
        { canal: "google_ads", timestamp: now - 6 * day, leadId: "k3", leadName: "Marcos Souza", convertido: false },
        { canal: "google_ads", timestamp: now - 5 * day, leadName: "Visitante anônimo" },
        { canal: "tiktok", timestamp: now - 3 * day, leadName: "Visitante anônimo" },
        { canal: "tiktok", timestamp: now - 2 * day, leadName: "Visitante anônimo" },
        { canal: "instagram", timestamp: now - 1 * day, leadId: "k2", leadName: "Pedro Costa", convertido: false },
      ],
    },
    {
      id: "camp-demo-2",
      nome: "Clareamento Dental — Verão",
      descricao: "Promoção de clareamento estético para o verão.",
      destino: "https://wa.me/5511999990000?text=Quero%20clarear%20os%20dentes",
      canais: ["instagram", "tiktok", "google_ads"],
      ativa: true,
      budget: 2000,
      criadaEm: now - 15 * day,
      hits: [
        { canal: "instagram", timestamp: now - 10 * day, leadName: "Visitante anônimo" },
        { canal: "instagram", timestamp: now - 7 * day, leadId: "k5", leadName: "Ricardo Alves", convertido: true, valor: 1500 },
        { canal: "tiktok", timestamp: now - 4 * day, leadName: "Visitante anônimo" },
      ],
    },
  ];
}

/* ─────────────── Tags de origem ─────────────── */

/** Retorna o nome da tag de origem para um canal (usada no CRM). */
export function getOriginTagName(canal: CanalCampanha): string {
  const c = CANAIS.find((x) => x.id === canal);
  return c ? `Origem: ${c.label.split(" (")[0]}` : `Origem: ${canal}`;
}
