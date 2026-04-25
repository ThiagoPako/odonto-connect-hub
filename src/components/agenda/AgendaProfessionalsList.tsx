import { Stethoscope, AlertCircle } from "lucide-react";

interface Prof {
  id: string;
  nome: string;
  especialidade?: string | null;
  cor?: string | null;
}

interface Props {
  professionals: Prof[];
  selected: string[]; // ids visíveis
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  alertasRetorno?: { paciente_nome: string; data: string }[];
}

const FALLBACK_COLORS = [
  "bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-primary", "bg-dental-cyan",
];

export function AgendaProfessionalsList({
  professionals, selected, onToggle, onSelectAll, alertasRetorno = [],
}: Props) {
  return (
    <div className="space-y-3">
      <div className="bg-card rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Profissionais
          </div>
          <button
            onClick={onSelectAll}
            className="text-[10px] font-medium text-primary hover:underline"
          >
            {selected.length === professionals.length ? "Limpar" : "Todos"}
          </button>
        </div>
        {professionals.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Nenhum profissional cadastrado.</p>
        ) : (
          <ul className="space-y-1">
            {professionals.map((p, i) => {
              const checked = selected.includes(p.id);
              const color = p.cor || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
              return (
                <li key={p.id}>
                  <button
                    onClick={() => onToggle(p.id)}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-sm transition-colors ${
                      checked ? "bg-muted/60" : "hover:bg-muted/40"
                    }`}
                  >
                    <span
                      className={`h-3 w-3 rounded-sm ${color} ${
                        checked ? "" : "opacity-30"
                      }`}
                    />
                    <span className={`truncate ${checked ? "text-foreground" : "text-muted-foreground"}`}>
                      {p.nome}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bg-card rounded-lg border border-border/60 p-3">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="h-3.5 w-3.5 text-warning" />
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Alertas de Retorno
          </div>
        </div>
        {alertasRetorno.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">Nenhum retorno pendente.</p>
        ) : (
          <ul className="space-y-1.5">
            {alertasRetorno.slice(0, 5).map((a, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <span className="text-foreground truncate">{a.paciente_nome}</span>
                <span className="text-muted-foreground shrink-0 ml-2">{a.data}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-muted/30 rounded-lg border border-dashed border-border/60 p-3 flex items-start gap-2">
        <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Cores = profissional. Clique numa célula vazia para criar um agendamento.
        </p>
      </div>
    </div>
  );
}
