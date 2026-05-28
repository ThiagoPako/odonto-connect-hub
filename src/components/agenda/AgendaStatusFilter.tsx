import { CheckCircle2, Clock, XCircle, PlayCircle, AlertCircle } from "lucide-react";

const STATUS_OPTIONS = [
  { id: "agendado", label: "Agendado", icon: Clock, color: "bg-primary" },
  { id: "confirmado", label: "Confirmado", icon: CheckCircle2, color: "bg-emerald-500" },
  { id: "em_atendimento", label: "Em atendimento", icon: PlayCircle, color: "bg-blue-500" },
  { id: "finalizado", label: "Finalizado", icon: CheckCircle2, color: "bg-muted-foreground" },
  { id: "faltou", label: "Faltou", icon: AlertCircle, color: "bg-amber-500" },
  { id: "cancelado", label: "Cancelado / Desmarcado", icon: XCircle, color: "bg-destructive" },
];

interface Props {
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
}

export function AgendaStatusFilter({ selected, onToggle, onSelectAll }: Props) {
  return (
    <div className="glass-card rounded-2xl p-4 shadow-lg animate-in fade-in slide-in-from-left-7 duration-800">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
          Status
        </div>
        <button
          onClick={onSelectAll}
          className="text-[10px] font-medium text-primary hover:underline"
        >
          {selected.length === STATUS_OPTIONS.length ? "Limpar" : "Todos"}
        </button>
      </div>
      <ul className="space-y-1">
        {STATUS_OPTIONS.map((s) => {
          const checked = selected.includes(s.id);
          const Icon = s.icon;
          return (
            <li key={s.id}>
              <button
                onClick={() => onToggle(s.id)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-sm transition-colors ${
                  checked ? "bg-muted/60" : "hover:bg-muted/40"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${checked ? "text-foreground" : "text-muted-foreground/40"}`} />
                <span className={`truncate ${checked ? "text-foreground" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
