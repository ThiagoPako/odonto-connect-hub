import { CheckCircle2, Clock, XCircle, PlayCircle, AlertCircle, CalendarClock } from "lucide-react";

// Status da agenda (filtro lateral). "remarcar" vem da resposta ao pedido de confirmação.
export const STATUS_OPTIONS = [
  { id: "agendado", label: "Agendado", icon: Clock, color: "bg-primary" },
  { id: "confirmado", label: "Confirmado", icon: CheckCircle2, color: "bg-emerald-500" },
  { id: "remarcar", label: "Pediu remarcação", icon: CalendarClock, color: "bg-orange-500" },
  { id: "em_atendimento", label: "Em atendimento", icon: PlayCircle, color: "bg-blue-500" },
  { id: "finalizado", label: "Finalizado", icon: CheckCircle2, color: "bg-muted-foreground" },
  { id: "faltou", label: "Faltou", icon: AlertCircle, color: "bg-amber-500" },
  { id: "cancelado", label: "Cancelado / Desmarcado", icon: XCircle, color: "bg-destructive" },
];

/** Ainda não confirmados: agendado + pediu remarcação (atalho "Só não confirmados"). */
export const UNCONFIRMED_STATUSES = ["agendado", "remarcar"];

const IDS_FILTRO = new Set(STATUS_OPTIONS.map((s) => s.id));
/**
 * Em qual opção do filtro lateral o status entra. "desmarcado" (horário liberado pela
 * recepção, usado pela lista de espera) fica junto de "Cancelado / Desmarcado"; status
 * desconhecidos (ex.: vindos do Clinicorp) contam como "Agendado", igual ao card da grade.
 * Antes esses agendamentos sumiam da agenda sem aviso.
 */
export function statusDoFiltro(status?: string | null): string {
  const s = status || "agendado";
  if (s === "desmarcado") return "cancelado";
  return IDS_FILTRO.has(s) ? s : "agendado";
}
