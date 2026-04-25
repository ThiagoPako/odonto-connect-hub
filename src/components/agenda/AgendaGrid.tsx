import { useMemo } from "react";
import type { AgendamentoVPS } from "@/lib/vpsApi";

interface Prof {
  id: string;
  nome: string;
  cor?: string | null;
}

interface Props {
  professionals: Prof[];
  appointments: AgendamentoVPS[];
  intervalo: number; // minutos por slot
  inicio: string; // "08:00"
  fim: string; // "19:00"
  onCellClick: (profId: string, hora: string) => void;
  onAppointmentClick: (apt: AgendamentoVPS) => void;
}

const PROF_COLOR_FALLBACK = [
  "bg-chart-1/15 border-chart-1",
  "bg-chart-2/15 border-chart-2",
  "bg-chart-3/15 border-chart-3",
  "bg-chart-4/15 border-chart-4",
  "bg-chart-5/15 border-chart-5",
  "bg-primary/15 border-primary",
];

const STATUS_BADGE: Record<string, string> = {
  agendado: "border-primary",
  confirmado: "border-success",
  em_atendimento: "border-primary",
  finalizado: "border-muted-foreground",
  faltou: "border-destructive",
  cancelado: "border-destructive",
};

function buildSlots(inicio: string, fim: string, intervalo: number): string[] {
  const [hi, mi] = inicio.split(":").map(Number);
  const [hf, mf] = fim.split(":").map(Number);
  const startMin = hi * 60 + mi;
  const endMin = hf * 60 + mf;
  const slots: string[] = [];
  for (let m = startMin; m < endMin; m += intervalo) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  return slots;
}

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function AgendaGrid({
  professionals, appointments, intervalo, inicio, fim, onCellClick, onAppointmentClick,
}: Props) {
  const slots = useMemo(() => buildSlots(inicio, fim, intervalo), [inicio, fim, intervalo]);
  const startMin = timeToMin(inicio);
  const SLOT_HEIGHT = 32; // px por slot
  const totalHeight = slots.length * SLOT_HEIGHT;

  // Agrupa appointments por profissional
  const byProf = useMemo(() => {
    const map = new Map<string, AgendamentoVPS[]>();
    for (const a of appointments) {
      const arr = map.get(a.dentista_id) || [];
      arr.push(a);
      map.set(a.dentista_id, arr);
    }
    return map;
  }, [appointments]);

  if (professionals.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-10">
        Selecione ao menos um profissional na lista lateral.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-card rounded-lg border border-border/60">
      <div className="min-w-fit">
        {/* Header com nomes dos profissionais */}
        <div
          className="grid sticky top-0 z-10 bg-card border-b border-border"
          style={{ gridTemplateColumns: `64px repeat(${professionals.length}, minmax(160px, 1fr))` }}
        >
          <div className="border-r border-border/60" />
          {professionals.map((p, i) => {
            const color = PROF_COLOR_FALLBACK[i % PROF_COLOR_FALLBACK.length];
            return (
              <div
                key={p.id}
                className={`px-3 py-2 border-r border-border/60 border-t-2 ${color.split(" ")[1]}`}
              >
                <div className="text-sm font-medium text-foreground truncate">{p.nome}</div>
              </div>
            );
          })}
        </div>

        {/* Body com horários e células */}
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `64px repeat(${professionals.length}, minmax(160px, 1fr))`,
            height: totalHeight,
          }}
        >
          {/* Coluna de horários */}
          <div className="border-r border-border/60 relative">
            {slots.map((s, i) => (
              <div
                key={s}
                className="text-[11px] text-muted-foreground pr-2 text-right border-b border-border/40"
                style={{ height: SLOT_HEIGHT, lineHeight: `${SLOT_HEIGHT}px` }}
              >
                {i % Math.max(1, Math.round(60 / intervalo)) === 0 ? s : ""}
              </div>
            ))}
          </div>

          {/* Colunas dos profissionais */}
          {professionals.map((prof) => {
            const apts = byProf.get(prof.id) || [];
            return (
              <div key={prof.id} className="relative border-r border-border/60">
                {/* células base (clicáveis) */}
                {slots.map((s) => (
                  <div
                    key={s}
                    onClick={() => onCellClick(prof.id, s)}
                    className="border-b border-border/40 hover:bg-muted/40 cursor-pointer transition-colors"
                    style={{ height: SLOT_HEIGHT }}
                  />
                ))}

                {/* agendamentos sobrepostos */}
                {apts.map((a) => {
                  const min = timeToMin(a.hora || "00:00") - startMin;
                  if (min < 0 || min >= slots.length * intervalo) return null;
                  const top = (min / intervalo) * SLOT_HEIGHT;
                  const height = Math.max(SLOT_HEIGHT, ((a.duracao || 30) / intervalo) * SLOT_HEIGHT);
                  const statusBorder = STATUS_BADGE[a.status] || "border-primary";
                  const bg = a.categoria_cor || "bg-primary/20";
                  return (
                    <button
                      key={a.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAppointmentClick(a);
                      }}
                      className={`absolute left-1 right-1 rounded border-l-4 ${statusBorder} ${bg} px-2 py-1 text-left text-xs hover:shadow-md transition-shadow overflow-hidden`}
                      style={{ top, height: height - 2 }}
                      title={`${a.paciente_nome} — ${a.procedimento || ""}`}
                    >
                      <div className="font-medium text-foreground truncate">{a.paciente_nome}</div>
                      {a.procedimento && (
                        <div className="text-[10px] text-muted-foreground truncate">{a.procedimento}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        {a.hora}{a.duracao ? ` · ${a.duracao}min` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
