/**
 * Comercial interno da Odonto Connect (só super-admin e equipe comercial interna):
 * buscador de leads (Google Places oficial + CSV) e base de leads (com_leads).
 * vpsApiFetch não lança: verifique `error`.
 */
import { vpsApiFetch } from "./vpsApi";

const BASE = "/super-admin/comercial";

export type PapelComercial = "dono" | "gestor" | "vendedor" | "sdr";
export type StatusItem = "novo" | "duplicado" | "descartado" | "nao_contatar";

export interface AcessoComercial {
  papel: PapelComercial;
  pode_buscar: boolean;
  pode_configurar: boolean;
  ve_todos: boolean;
  places_configurado: boolean;
  places_simulado: boolean;
  scraper_configurado: boolean;
  etapas: string[];
  tipos_busca: { id: string; rotulo: string }[];
}

export interface ItemPrevia {
  chave: string;
  status: StatusItem;
  motivo: string | null;
  ja_cliente: { tenant_id: string; nome: string } | null;
  duplicado_de: string | null;
  clinica_nome: string | null;
  categoria: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  telefone_comercial: string | null;
  telefone_celular: boolean;
  email_comercial: string | null;
  email_pessoal: boolean;
  site: string | null;
  nota_avaliacao: number | null;
  total_avaliacoes: number | null;
  place_id: string | null;
  tipo_busca: string | null;
}

export interface ResumoPrevia {
  total: number;
  novos: number;
  duplicados: number;
  descartados: number;
  nao_contatar: number;
  ja_clientes: number;
  motivos_descarte: Record<string, number>;
}

export interface Previa {
  previa_id: string;
  fonte: "google_places" | "csv" | "google_maps_scraper";
  aviso?: string | null;
  simulado?: boolean;
  formato?: string;
  excedeu_limite?: boolean;
  limite_linhas?: number;
  resumo: ResumoPrevia;
  itens: ItemPrevia[];
  custo?: { chamadas: number; cache: number; gasto_usd: number; parou_por_limite_da_busca: boolean };
  uso_hoje?: { chamadas: number; custo_usd: number };
}

export interface DadosGoogle {
  telefone_celular: boolean;
  clinica_nome: string | null;
  categoria: string | null;
  endereco: string | null;
  telefone_comercial: string | null;
  site: string | null;
  nota_avaliacao: number | null;
  total_avaliacoes: number | null;
}

export interface LeadComercial {
  id: string;
  clinica_nome: string | null;
  cidade: string | null;
  uf: string | null;
  endereco: string | null;
  site: string | null;
  telefone_comercial: string | null;
  telefone_celular: boolean;
  email_comercial: string | null;
  email_pessoal: boolean;
  categoria: string | null;
  origem: string;
  origem_detalhe: string | null;
  campanha: string | null;
  place_id: string | null;
  dados_confirmados_em: string | null;
  dono_id: string | null;
  dono_nome: string | null;
  etapa: string;
  notas: string | null;
  nao_contatar: boolean;
  tenant_id_cliente: string | null;
  criado_em: string;
  dados_google: DadosGoogle | null;
}

export interface MembroEquipe {
  profile_id: string;
  nome: string;
  email: string;
  papel: PapelComercial;
  ativo: boolean;
}

export interface ConfigBuscador {
  categorias_aceitas: string[];
  categorias_exigem_nome_odonto: string[];
  termos_nome_odonto: string[];
  categorias_recusadas: string[];
  places_max_paginas_por_busca: number;
  places_limite_busca_usd: number;
  places_limite_diario_usd: number;
  places_custo_text_search_usd: number;
  places_custo_detalhes_usd: number;
  places_custo_geocode_usd: number;
  places_cache_minutos: number;
  raio_max_km: number;
}

export interface RegistroAuditoria {
  id: number;
  criado_em: string;
  acao: string;
  alvo_tipo: string | null;
  alvo_id: string | null;
  detalhe: Record<string, unknown>;
  ator_papel: string | null;
  ator_nome: string | null;
}

export type StatusJobScraper = "na_fila" | "rodando" | "concluido" | "falhou" | "bloqueado" | "cancelado" | "importado";

export interface JobScraper {
  id: string;
  cidade: string;
  uf: string;
  tipos: string[];
  palavras: string[];
  depth: number;
  coletar_emails: boolean;
  status: StatusJobScraper;
  erro: string | null;
  aviso: string | null;
  progresso: { keywords_done?: number; keywords_total?: number; places?: number; percent?: number; stage?: string };
  linhas: number | null;
  criado_em: string;
  iniciado_em: string | null;
  concluido_em: string | null;
  criado_por_nome: string | null;
}

export const comercialApi = {
  jobsScraper: () => vpsApiFetch<{ data: JobScraper[]; hoje: number; limite_dia: number; depth_padrao: number; depth_max: number }>(`${BASE}/scraper/jobs`),
  criarJobScraper: (body: { cidade: string; uf: string; tipos: string[]; depth: number; coletar_emails: boolean }) =>
    vpsApiFetch<{ data: JobScraper }>(`${BASE}/scraper/jobs`, { method: "POST", body }),
  cancelarJobScraper: (id: string) => vpsApiFetch<{ ok: boolean }>(`${BASE}/scraper/jobs/${id}/cancelar`, { method: "POST" }),
  previaJobScraper: (id: string) => vpsApiFetch<Previa>(`${BASE}/scraper/jobs/${id}/previa`, { method: "POST" }),
  acesso: () => vpsApiFetch<AcessoComercial>(`${BASE}/acesso`),
  config: () => vpsApiFetch<{ config: ConfigBuscador; uso_hoje: { chamadas: number; custo_usd: number } }>(`${BASE}/config`),
  salvarConfig: (config: Partial<ConfigBuscador>) => vpsApiFetch<{ config: ConfigBuscador }>(`${BASE}/config`, { method: "PUT", body: { config } }),
  previaPlaces: (body: { cidade: string; uf: string; tipos: string[]; raio_km?: number | null }) =>
    vpsApiFetch<Previa>(`${BASE}/buscador/places/previa`, { method: "POST", body }),
  previaCsv: (csv: string, nome_arquivo: string) => vpsApiFetch<Previa>(`${BASE}/buscador/csv/previa`, { method: "POST", body: { csv, nome_arquivo } }),
  importar: (body: { previa_id: string; chaves: string[]; dono_id?: string | null; campanha?: string; origem_declarada?: string; base_legal_confirmada?: boolean }) =>
    vpsApiFetch<{ importados: number; pulados: number }>(`${BASE}/buscador/importar`, { method: "POST", body }),
  leads: (params: Record<string, string>) => vpsApiFetch<{ data: LeadComercial[]; total: number }>(`${BASE}/leads`, { params }),
  atualizarLead: (id: string, body: { etapa?: string; dono_id?: string | null; notas?: string }) =>
    vpsApiFetch<{ data: LeadComercial }>(`${BASE}/leads/${id}`, { method: "PATCH", body }),
  dadosGoogle: (id: string) => vpsApiFetch<{ dados: DadosGoogle; custo_usd: number }>(`${BASE}/leads/${id}/google`),
  confirmarDados: (id: string, body: { clinica_nome: string; telefone_comercial?: string; site?: string; email_comercial?: string; endereco?: string; cnpj?: string }) =>
    vpsApiFetch<{ data: LeadComercial }>(`${BASE}/leads/${id}/confirmar-dados`, { method: "POST", body }),
  naoContatar: (id: string, motivo: string) => vpsApiFetch<{ data: LeadComercial }>(`${BASE}/leads/${id}/nao-contatar`, { method: "POST", body: { motivo } }),
  equipe: () => vpsApiFetch<{ data: MembroEquipe[] }>(`${BASE}/equipe`),
  incluirNaEquipe: (email: string, papel: string) => vpsApiFetch<{ ok: boolean }>(`${BASE}/equipe`, { method: "POST", body: { email, papel } }),
  removerDaEquipe: (profileId: string) => vpsApiFetch<{ ok: boolean }>(`${BASE}/equipe/${profileId}`, { method: "DELETE" }),
  auditoria: () => vpsApiFetch<{ data: RegistroAuditoria[] }>(`${BASE}/auditoria`),
};

export const ROTULO_ETAPA: Record<string, string> = {
  novo: "Novo",
  qualificado: "Qualificado",
  reuniao_marcada: "Reunião marcada",
  demonstracao_feita: "Demonstração feita",
  proposta: "Proposta",
  teste_gratis: "Teste grátis ativo",
  ganho: "Ganho",
  perdido: "Perdido",
};

export const ROTULO_ORIGEM: Record<string, string> = {
  google_places: "Google Maps (API)",
  google_maps_scraper: "Google Maps (scraper)",
  csv: "CSV",
  manual: "Manual",
  site: "Site",
  teste_gratis: "Teste grátis",
};
