import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Info } from "lucide-react";
import { type AlertasMedicos } from "@/lib/alertasMedicos";

export type EstadoAnamnese =
  | { status: "carregando" }
  | { status: "sem_paciente" }
  | { status: "erro"; mensagem: string }
  | { status: "vazia" }
  | { status: "ok"; alertas: AlertasMedicos };

interface Props {
  estado: EstadoAnamnese;
  onTentarNovamente?: () => void;
}

/** Faixa de alergias e alertas médicos da anamnese, exibida no topo da consulta. */
export function AlertasMedicosBanner({ estado, onTentarNovamente }: Props) {
  if (estado.status === "carregando") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando alergias e alertas na anamnese…
      </div>
    );
  }

  if (estado.status === "sem_paciente") {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-xs font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        Agendamento sem paciente cadastrado — não foi possível verificar alergias. Confirme com o paciente antes de prescrever.
      </div>
    );
  }

  if (estado.status === "erro") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-medium text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1 min-w-0">
          Não foi possível carregar a anamnese ({estado.mensagem}). Confirme alergias com o paciente antes de prescrever.
        </span>
        {onTentarNovamente && (
          <button
            type="button"
            onClick={onTentarNovamente}
            className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-2 py-1 hover:bg-destructive/10"
          >
            <RefreshCw className="h-3 w-3" /> Tentar novamente
          </button>
        )}
      </div>
    );
  }

  if (estado.status === "vazia") {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-xs font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        Paciente sem anamnese registrada — pergunte sobre alergias e doenças antes de prescrever.
      </div>
    );
  }

  const { alergias, condicoes, medicamentos, outros, temAlerta } = estado.alertas;
  const contexto = [
    ...(medicamentos.length > 0 ? [`Medicamentos em uso: ${medicamentos.join(", ")}`] : []),
    ...outros,
  ];

  if (!temAlerta) {
    return (
      <div role="status" className="rounded-xl border border-success/30 bg-success/5 px-4 py-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Anamnese sem alergias ou doenças registradas.
        </p>
        {contexto.length > 0 && (
          <p className="mt-1 flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {contexto.join(" • ")}</p>
        )}
      </div>
    );
  }

  return (
    <div role="alert" className="rounded-xl border-2 border-destructive bg-destructive px-4 py-3 text-destructive-foreground shadow-md">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 space-y-1 text-sm">
          {alergias.length > 0 && (
            <p className="font-bold">
              {alergias.length === 1 ? "Alergia" : "Alergias"}: {alergias.join(", ")}
            </p>
          )}
          {condicoes.length > 0 && (
            <p className="font-semibold">Alertas médicos: {condicoes.join(", ")}</p>
          )}
          {contexto.length > 0 && <p className="text-xs opacity-90">{contexto.join(" • ")}</p>}
        </div>
      </div>
    </div>
  );
}
