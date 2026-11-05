import { VPS_API_BASE, getAccessToken, getCachedTenantId, resolveMediaUrl, vpsApiFetch } from "./vpsApi";

export type ExameStatus = "novo" | "em_andamento" | "aguardando_laudo" | "concluido" | "entregue" | "cancelado";
export type ExamePrioridade = "baixa" | "normal" | "alta" | "urgente";

export interface ExameTipo {
  id: string;
  nome: string;
  categoria: string | null;
  codigo_tiss: string | null;
  preco: number;
  ativo: boolean;
}

export interface Exame {
  id: string;
  codigo: string | null;
  paciente_id: string | null;
  paciente_nome?: string | null;
  dentista_solicitante_id: string | null;
  dentista_nome?: string | null;
  clinica_origem: string | null;
  tipo_exame_id: string | null;
  tipo_nome: string;
  status: ExameStatus;
  prioridade: ExamePrioridade;
  data_solicitacao: string;
  data_realizacao: string | null;
  data_entrega: string | null;
  valor: number;
  modo_entrega: string | null;
  laudo_texto: string | null;
  arquivo_url: string | null;
  observacoes: string | null;
  terceirizado: boolean;
  fornecedor_terc: string | null;
  arquivos_count?: number;
  /** Laudo finalizado: quem assinou e quando (null = rascunho ou sem laudo). */
  laudado_por?: string | null;
  laudado_em?: string | null;
  laudado_por_nome?: string | null;
  laudo_atualizado_em?: string | null;
  updated_at?: string;
  /** Só em GET /exames/:id */
  paciente_data_nascimento?: string | null;
  clinica_nome?: string | null;
}

export interface ExameLaudoHistorico {
  id: string;
  acao: "finalizado" | "reaberto";
  laudo_texto: string | null;
  criado_em: string;
  autor_nome: string | null;
}

export type ExameUpdate = Partial<Exame> & { updated_at_esperado?: string };

/** Imagem ou arquivo de um exame. `url` e `url_download` são links assinados de vida curta (1 h). */
export interface ExameArquivo {
  id: string;
  exame_id: string;
  nome_original: string | null;
  mime_type: string;
  tamanho_bytes: number;
  descricao: string | null;
  created_at: string;
  enviado_por_nome: string | null;
  imagem: boolean;
  /** Requisição/encaminhamento anexado no pedido: não é resultado do exame. */
  anexo_do_pedido?: boolean;
  url: string;
  url_download: string;
}

export interface ExameStats {
  novo: number;
  em_andamento: number;
  aguardando_laudo: number;
  concluido: number;
  entregue: number;
  cancelado: number;
  total: number;
}

async function unwrap<T>(p: Promise<{ data: T | null; error: string | null }>, fallback: T): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(r.error);
  return (r.data ?? fallback) as T;
}

export const examesApi = {
  list: (params: Partial<{ status: ExameStatus; q: string; paciente_id: string; from: string; to: string; terceirizado: boolean }> = {}) => {
    const qs: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== "") qs[k] = String(v); });
    return unwrap<Exame[]>(vpsApiFetch<Exame[]>("/exames", { params: qs }), []);
  },
  stats: () => unwrap<ExameStats>(
    vpsApiFetch<ExameStats>("/exames/stats"),
    { novo:0, em_andamento:0, aguardando_laudo:0, concluido:0, entregue:0, cancelado:0, total:0 }
  ),
  create: (data: Partial<Exame>) =>
    unwrap<Exame>(vpsApiFetch<Exame>("/exames", { method: "POST", body: data }), {} as Exame),
  get: (id: string) => unwrap<Exame>(vpsApiFetch<Exame>(`/exames/${id}`), {} as Exame),
  update: (id: string, data: ExameUpdate) =>
    unwrap<Exame>(vpsApiFetch<Exame>(`/exames/${id}`, { method: "PATCH", body: data }), {} as Exame),
  /** Grava o texto, quem laudou e quando, e conclui o exame. */
  finalizarLaudo: (id: string, laudo_texto: string, updated_at_esperado?: string) =>
    unwrap<Exame>(vpsApiFetch<Exame>(`/exames/${id}/laudo/finalizar`, { method: "POST", body: { laudo_texto, updated_at_esperado } }), {} as Exame),
  historicoLaudo: (id: string) =>
    unwrap<ExameLaudoHistorico[]>(vpsApiFetch<ExameLaudoHistorico[]>(`/exames/${id}/laudo/historico`), []),
  reabrirLaudo: (id: string) =>
    unwrap<Exame>(vpsApiFetch<Exame>(`/exames/${id}/laudo/reabrir`, { method: "POST", body: {} }), {} as Exame),
  remove: (id: string) =>
    unwrap<{ success: boolean }>(vpsApiFetch<{ success: boolean }>(`/exames/${id}`, { method: "DELETE" }), { success: false }),
};

export const exameArquivosApi = {
  list: (exameId: string) =>
    unwrap<ExameArquivo[]>(vpsApiFetch<ExameArquivo[]>(`/exames/${exameId}/arquivos`), []),
  /** Envia o arquivo como bytes; o nome vai num cabeçalho (nunca na URL: pode ter o nome do paciente). */
  upload: async (exameId: string, file: File, opcoes: { anexoDoPedido?: boolean } = {}): Promise<ExameArquivo> => {
    const token = await getAccessToken();
    const tenantId = getCachedTenantId();
    let response: Response;
    try {
      response = await fetch(`${VPS_API_BASE}/exames/${exameId}/arquivos`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
          "Content-Type": "application/octet-stream",
          "X-Nome-Arquivo": encodeURIComponent(file.name),
          // Anexo do pedido não muda o status do exame para "aguardando laudo"
          ...(opcoes.anexoDoPedido ? { "X-Anexo-Do-Pedido": "1" } : {}),
        },
        body: file,
      });
    } catch {
      throw new Error("Sem conexão com o servidor");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 413) throw new Error("Arquivo maior que 64 MB");
      throw new Error((data as { error?: string })?.error || `Erro ${response.status}`);
    }
    return data as ExameArquivo;
  },
  remove: (exameId: string, arquivoId: string) =>
    unwrap<{ success: boolean }>(
      vpsApiFetch<{ success: boolean }>(`/exames/${exameId}/arquivos/${arquivoId}`, { method: "DELETE" }),
      { success: false },
    ),
};

/** Endereço absoluto de um link de arquivo devolvido pela API. */
export function urlArquivoExame(url: string): string {
  return resolveMediaUrl(url) ?? url;
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export const exameTiposApi = {
  list: () => unwrap<ExameTipo[]>(vpsApiFetch<ExameTipo[]>("/exame-tipos"), []),
  upsert: (data: Partial<ExameTipo>) =>
    unwrap<ExameTipo>(vpsApiFetch<ExameTipo>("/exame-tipos", { method: "POST", body: data }), {} as ExameTipo),
  remove: (id: string) =>
    unwrap<{ success: boolean }>(vpsApiFetch<{ success: boolean }>(`/exame-tipos/${id}`, { method: "DELETE" }), { success: false }),
};

export const STATUS_LABELS: Record<ExameStatus, string> = {
  novo: "Pedido",
  em_andamento: "Em realização",
  aguardando_laudo: "Aguardando laudo",
  concluido: "Concluído",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const STATUS_COLORS: Record<ExameStatus, string> = {
  novo: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  em_andamento: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  aguardando_laudo: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30",
  concluido: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  entregue: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30",
  cancelado: "bg-muted text-muted-foreground border-border",
};

export const PRIORIDADE_COLORS: Record<ExamePrioridade, string> = {
  baixa: "bg-muted text-muted-foreground border-border",
  normal: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  alta: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  urgente: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
};
