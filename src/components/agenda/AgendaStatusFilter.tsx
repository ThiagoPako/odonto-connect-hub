import { STATUS_OPTIONS, UNCONFIRMED_STATUSES } from "./agendaStatus";

interface Props {
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  /** Mostra só o que ainda não foi confirmado (agendado + pediu remarcação). */
  onOnlyUnconfirmed?: () => void;
}


export function AgendaStatusFilter({ selected, onToggle, onSelectAll, onOnlyUnconfirmed }: Props) {
  const onlyUnconfirmed = selected.length === UNCONFIRMED_STATUSES.length && UNCONFIRMED_STATUSES.every((s) => selected.includes(s));
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
                <span className={`break-words min-w-0 ${checked ? "text-foreground" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {onOnlyUnconfirmed && (
        <button
          onClick={onOnlyUnconfirmed}
          aria-pressed={onlyUnconfirmed}
          className={`mt-2 w-full rounded px-2 py-1.5 text-left text-xs font-medium transition-colors ${
            onlyUnconfirmed ? "bg-primary/15 text-primary" : "text-primary hover:bg-muted/40"
          }`}
        >
          Só não confirmados
        </button>
      )}
    </div>
  );
}
