import { useMemo } from "react";
import type { AgendamentoVPS } from "@/lib/vpsApi";
import { CheckCircle2, Clock, AlertCircle, XCircle, PlayCircle, CircleDot, User2 } from "lucide-react";

interface Prof {
  id: string;
  nome: string;
  especialidade?: string | null;
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

const PROF_COLORS = [
  { bar: "bg-chart-1", soft: "bg-chart-1/10", text: "text-chart-1" },
  { bar: "bg-chart-2", soft: "bg-chart-2/10", text: "text-chart-2" },
  { bar: "bg-chart-3", soft: "bg-chart-3/10", text: "text-chart-3" },
  { bar: "bg-chart-4", soft: "bg-chart-4/10", text: "text-chart-4" },
  { bar: "bg-chart-5", soft: "bg-chart-5/10", text: "text-chart-5" },
  { bar: "bg-primary", soft: "bg-primary/10", text: "text-primary" },
];

const STATUS_STYLE: Record<
  string,
  { chip: string; icon: typeof Clock; label: string; ring: string }
> = {
  agendado:        { chip: "bg-primary/15 text-primary",                                              icon: Clock,        label: "Agendado",      ring: "ring-primary/30" },
  confirmado:      { chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",                icon: CheckCircle2, label: "Confirmado",    ring: "ring-emerald-500/40" },
  em_atendimento:  { chip: "bg-blue-500/15 text-blue-600 dark:text-blue-400",                         icon: PlayCircle,   label: "Em atendimento",ring: "ring-blue-500/40" },
  finalizado:      { chip: "bg-muted text-muted-foreground",                                          icon: CheckCircle2, label: "Finalizado",    ring: "ring-muted-foreground/30" },
  faltou:          { chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",                      icon: AlertCircle,  label: "Faltou",        ring: "ring-amber-500/40" },
  cancelado:       { chip: "bg-destructive/15 text-destructive",                                      icon: XCircle,      label: "Cancelado",     ring: "ring-destructive/40" },
};

// hex helpers para cor da categoria (procedimento)
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{6}|[a-f\d]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function withAlpha(hex: string, a: number): string | null {
  const c = hexToRgb(hex);
  if (!c) return null;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

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

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

export function AgendaGrid({
  professionals, appointments, intervalo, inicio, fim, onCellClick, onAppointmentClick,
}: Props) {
  const slots = useMemo(() => buildSlots(inicio, fim, intervalo), [inicio, fim, intervalo]);
  const startMin = timeToMin(inicio);
  const SLOT_HEIGHT = 32; // px por slot
  const totalHeight = slots.length * SLOT_HEIGHT;
  const slotsPerHour = Math.max(1, Math.round(60 / intervalo));

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
    <div className="flex-1 overflow-auto bg-card rounded-xl border border-border/60 shadow-sm">
      <div className="min-w-fit">
        {/* Header com nomes dos profissionais */}
        <div
          className="grid sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border"
          style={{ gridTemplateColumns: `64px repeat(${professionals.length}, minmax(180px, 1fr))` }}
        >
          <div className="border-r border-border/60" />
          {professionals.map((p, i) => {
            const c = PROF_COLORS[i % PROF_COLORS.length];
            return (
              <div
                key={p.id}
                className="px-3 py-2.5 border-r border-border/60 flex items-center gap-2.5"
              >
                <div className={`h-8 w-8 rounded-full ${c.soft} ${c.text} flex items-center justify-center text-xs font-semibold ring-1 ring-border/40`}>
                  {initials(p.nome) || <User2 className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate leading-tight">{p.nome}</div>
                  {p.especialidade && (
                    <div className="text-[10px] text-muted-foreground truncate leading-tight">{p.especialidade}</div>
                  )}
                </div>
                <div className={`h-1.5 w-1.5 rounded-full ${c.bar}`} />
              </div>
            );
          })}
        </div>

        {/* Body com horários e células */}
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `64px repeat(${professionals.length}, minmax(180px, 1fr))`,
            height: totalHeight,
          }}
        >
          {/* Coluna de horários */}
          <div className="border-r border-border/60 relative bg-muted/20">
            {slots.map((s, i) => {
              const isHour = i % slotsPerHour === 0;
              return (
                <div
                  key={s}
                  className={`text-[11px] pr-2 text-right ${
                    isHour
                      ? "text-foreground font-semibold border-b border-border/60"
                      : "text-muted-foreground/60 border-b border-border/20"
                  }`}
                  style={{ height: SLOT_HEIGHT, lineHeight: `${SLOT_HEIGHT}px` }}
                >
                  {isHour ? s : ""}
                </div>
              );
            })}
          </div>

          {/* Colunas dos profissionais */}
          {professionals.map((prof, profIdx) => {
            const apts = byProf.get(prof.id) || [];
            const profColor = PROF_COLORS[profIdx % PROF_COLORS.length];
            return (
              <div key={prof.id} className="relative border-r border-border/60">
                {/* células base (clicáveis) */}
                {slots.map((s, i) => {
                  const isHour = i % slotsPerHour === 0;
                  return (
                    <div
                      key={s}
                      onClick={() => onCellClick(prof.id, s)}
                      className={`group hover:bg-primary/5 cursor-pointer transition-colors ${
                        isHour ? "border-b border-border/60" : "border-b border-border/15"
                      }`}
                      style={{ height: SLOT_HEIGHT }}
                    >
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity h-full flex items-center justify-center">
                        <span className="text-[10px] text-primary font-medium">+ {s}</span>
                      </div>
                    </div>
                  );
                })}

                {/* agendamentos sobrepostos */}
                {apts.map((a) => {
                  const min = timeToMin(a.hora || "00:00") - startMin;
                  if (min < 0 || min >= slots.length * intervalo) return null;
                  const top = (min / intervalo) * SLOT_HEIGHT;
                  const height = Math.max(SLOT_HEIGHT, ((a.duracao || 30) / intervalo) * SLOT_HEIGHT);
                  const status = STATUS_STYLE[a.status] || STATUS_STYLE.agendado;
                  const StatusIcon = status.icon;
                  const compact = height < 50;

                  return (
                    <button
                      key={a.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAppointmentClick(a);
                      }}
                      className={`absolute left-1 right-1 rounded-md bg-card border border-border/60 shadow-sm hover:shadow-md hover:-translate-y-px hover:border-primary/40 transition-all overflow-hidden text-left group/apt`}
                      style={{ top, height: height - 2 }}
                      title={`${a.paciente_nome} — ${a.procedimento || ""} (${status.label})`}
                    >
                      {/* Barra colorida lateral (status) */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${status.side}`} />
                      {/* Faixa de cor do profissional no topo */}
                      <div className={`absolute right-0 top-0 bottom-0 w-0.5 ${profColor.bar} opacity-60`} />

                      <div className={`pl-2.5 pr-2 ${compact ? "py-1" : "py-1.5"} h-full flex flex-col gap-0.5`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <CircleDot className="h-2.5 w-2.5 text-primary shrink-0" />
                          <span className="text-[11px] font-semibold text-foreground truncate flex-1">
                            {a.paciente_nome}
                          </span>
                          {!compact && (
                            <span className={`inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded-sm ${status.chip} font-medium shrink-0`}>
                              <StatusIcon className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                        {!compact && a.procedimento && (
                          <div className="text-[10px] text-muted-foreground truncate pl-4">
                            {a.procedimento}
                          </div>
                        )}
                        {!compact && (
                          <div className="mt-auto flex items-center gap-1.5 text-[9px] text-muted-foreground pl-4">
                            <Clock className="h-2.5 w-2.5" />
                            <span className="font-medium">{a.hora}</span>
                            {a.duracao ? <span>· {a.duracao}min</span> : null}
                          </div>
                        )}
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
