import { vpsApiFetch } from "./vpsApi";

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
  update: (id: string, data: Partial<Exame>) =>
    unwrap<Exame>(vpsApiFetch<Exame>(`/exames/${id}`, { method: "PATCH", body: data }), {} as Exame),
  remove: (id: string) =>
    unwrap<{ success: boolean }>(vpsApiFetch<{ success: boolean }>(`/exames/${id}`, { method: "DELETE" }), { success: false }),
};

export const exameTiposApi = {
  list: () => unwrap<ExameTipo[]>(vpsApiFetch<ExameTipo[]>("/exame-tipos"), []),
  upsert: (data: Partial<ExameTipo>) =>
    unwrap<ExameTipo>(vpsApiFetch<ExameTipo>("/exame-tipos", { method: "POST", body: data }), {} as ExameTipo),
  remove: (id: string) =>
    unwrap<{ success: boolean }>(vpsApiFetch<{ success: boolean }>(`/exame-tipos/${id}`, { method: "DELETE" }), { success: false }),
};

export const STATUS_LABELS: Record<ExameStatus, string> = {
  novo: "Novo",
  em_andamento: "Em andamento",
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
