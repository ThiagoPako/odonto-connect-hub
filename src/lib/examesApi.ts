import { sbExamesApi, sbExameTiposApi } from "./sbAdapters";

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
  list: (params: Partial<{ status: ExameStatus; q: string; paciente_id: string; from: string; to: string; terceirizado: boolean }> = {}) =>
    unwrap<Exame[]>(sbExamesApi.list(params as Record<string, unknown>) as Promise<{ data: Exame[] | null; error: string | null }>, []),
  stats: () => unwrap<ExameStats>(
    sbExamesApi.stats() as Promise<{ data: ExameStats | null; error: string | null }>,
    { novo:0, em_andamento:0, aguardando_laudo:0, concluido:0, entregue:0, cancelado:0, total:0 }
  ),
  create: (data: Partial<Exame>) =>
    unwrap<Exame>(sbExamesApi.create(data as Record<string, unknown>) as Promise<{ data: Exame | null; error: string | null }>, {} as Exame),
  update: (id: string, data: Partial<Exame>) =>
    unwrap<Exame>(sbExamesApi.update(id, data as Record<string, unknown>) as Promise<{ data: Exame | null; error: string | null }>, {} as Exame),
  remove: (id: string) =>
    unwrap<{ success: boolean }>(sbExamesApi.remove(id), { success: false }),
};

export const exameTiposApi = {
  list: () => unwrap<ExameTipo[]>(sbExameTiposApi.list() as Promise<{ data: ExameTipo[] | null; error: string | null }>, []),
  upsert: (data: Partial<ExameTipo>) =>
    unwrap<ExameTipo>(sbExameTiposApi.upsert(data as Record<string, unknown>) as Promise<{ data: ExameTipo | null; error: string | null }>, {} as ExameTipo),
  remove: (id: string) =>
    unwrap<{ success: boolean }>(sbExameTiposApi.remove(id), { success: false }),
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

export const PRIORIDADE_COLORS: Record<ExamePrioridade, string> = {
  baixa: "bg-muted text-muted-foreground border-border",
  normal: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  alta: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  urgente: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
};
