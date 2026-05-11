import { useEffect, useMemo, useState } from "react";
import type { AgendamentoVPS } from "@/lib/vpsApi";
import { CheckCircle2, Clock, AlertCircle, XCircle, PlayCircle, CircleDot, User2, Users } from "lucide-react";
import { CategoriaBadge } from "./CategoriaBadge";
import { cn } from "@/lib/utils";

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
// Luminância relativa (WCAG) para escolher texto contrastante
function relLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const srgb = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}
/** Retorna cor de texto com contraste adequado para um fundo hex. */
function readableText(hex: string): string {
  const c = hexToRgb(hex);
  if (!c) return "hsl(var(--foreground))";
  // Texto escuro em fundos claros; texto claro em fundos escuros
  return relLuminance(c) > 0.55 ? "#0b0f14" : "#ffffff";
}
/** Versão "ink" da cor: escurece se muito clara, mantém se já escura — boa para texto/bordas sobre fundo neutro. */
function inkFromHex(hex: string, isDark: boolean): string {
  const c = hexToRgb(hex);
  if (!c) return "hsl(var(--foreground))";
  const lum = relLuminance(c);
  // No tema escuro, queremos cores mais claras; no claro, mais escuras
  if (isDark) {
    if (lum < 0.3) {
      // clarear
      const f = 0.55;
      return `rgb(${Math.round(c.r + (255 - c.r) * f)}, ${Math.round(c.g + (255 - c.g) * f)}, ${Math.round(c.b + (255 - c.b) * f)})`;
    }
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  } else {
    if (lum > 0.6) {
      // escurecer
      const f = 0.55;
      return `rgb(${Math.round(c.r * (1 - f))}, ${Math.round(c.g * (1 - f))}, ${Math.round(c.b * (1 - f))})`;
    }
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }
}
function useIsDark(): boolean {
  const [dark, setDark] = useState<boolean>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
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
  const isDark = useIsDark();
  const slots = useMemo(() => buildSlots(inicio, fim, intervalo), [inicio, fim, intervalo]);
  const startMin = timeToMin(inicio);
  const SLOT_HEIGHT = 48; // px por slot (mais ar para design premium)
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
    <div className="flex-1 overflow-auto glass-card rounded-2xl border-none shadow-xl animate-fade-in">
      <div className="min-w-fit">
        {/* Header com nomes dos profissionais */}
        <div
          className="grid sticky top-0 z-20 bg-card/60 backdrop-blur-md border-b border-border/40"
          style={{ gridTemplateColumns: `72px repeat(${professionals.length}, minmax(200px, 1fr))` }}
        >
          <div className="border-r border-border/60" />
          {professionals.map((p, i) => {
            const c = PROF_COLORS[i % PROF_COLORS.length];
            return (
              <div
                key={p.id}
                className="px-3 py-2.5 border-r border-border/60 flex items-center gap-2.5"
              >
                <div className={`h-10 w-10 rounded-xl ${c.soft} ${c.text} flex items-center justify-center text-[10px] font-bold ring-1 ring-border/20 shadow-inner overflow-hidden`}>
                  {initials(p.nome) || <User2 className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-foreground tracking-tight truncate leading-tight uppercase">{p.nome}</div>
                  {p.especialidade && (
                    <div className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider truncate leading-tight">{p.especialidade}</div>
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
            gridTemplateColumns: `72px repeat(${professionals.length}, minmax(200px, 1fr))`,
            height: totalHeight,
          }}
        >
          {/* Coluna de horários */}
          <div className="border-r border-border/40 relative bg-muted/5">
            {slots.map((s, i) => {
              const isHour = i % slotsPerHour === 0;
              return (
                <div
                  key={s}
                  className={`text-[11px] pr-2 text-right ${
                    isHour
                      ? "text-foreground/80 font-medium border-b border-border/30"
                      : "text-muted-foreground/40 border-b border-border/10"
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
                        <span className="text-[10px] text-primary font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">+ {s}</span>
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
                  
                  // Verifica se é um evento compartilhado (mesmo título, data e hora)
                  const others = a.evento_titulo ? appointments.filter(apt => 
                    apt.id !== a.id && 
                    apt.data === a.data && 
                    apt.hora === a.hora && 
                    apt.evento_titulo === a.evento_titulo
                  ) : [];
                  const isShared = others.length > 0;

                  // Cor da CATEGORIA/PROCEDIMENTO (identidade visual principal)
                  // Validamos o hex: vazio OU formato inválido => fallback neutro (sem cor),
                  // mantendo legibilidade com tokens do tema.
                  const rawHex = (a.categoria_cor || "").trim();
                  const validHex = rawHex && hexToRgb(rawHex) ? rawHex : "";
                  const ink = validHex ? inkFromHex(validHex, isDark) : undefined;
                  const catBg = validHex
                    ? withAlpha(validHex, isDark ? 0.18 : 0.10) || undefined
                    : undefined;
                  const catBorder = ink || undefined;
                  const catSide = ink || undefined;

                  return (
                    <button
                      key={a.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAppointmentClick(a);
                      }}
                      className={`absolute left-1 right-1 rounded-xl border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden text-left group/apt ${
                        validHex
                          ? "hover:border-foreground/30"
                          : "bg-muted/30 border-dashed border-border/40 hover:border-primary/40 hover:bg-muted/50"
                      }`}
                      style={{
                        top,
                        height: height - 2,
                        background: catBg,
                        borderColor: catBorder,
                      }}
                      title={`${a.paciente_nome} — ${a.categoria || a.procedimento || "Sem categoria"} (${status.label})`}
                    >
                      {/* Barra lateral: cor da categoria OU listrada neutra (fallback) */}
                      <div
                        className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                          validHex ? "" : "bg-[repeating-linear-gradient(135deg,hsl(var(--muted-foreground)/0.35)_0_4px,transparent_4px_8px)]"
                        }`}
                        style={validHex ? { background: catSide } : undefined}
                      />
                      {/* Faixa fina à direita = cor do profissional */}
                      <div className={`absolute right-0 top-0 bottom-0 w-0.5 ${profColor.bar} opacity-60`} />

                      <div className={`pl-4 pr-2 ${compact ? "py-1" : "py-2"} h-full flex flex-col justify-center gap-1`}>
                        <div className="flex items-center justify-between min-w-0">
                          <span className="text-[12px] font-bold text-foreground tracking-tight truncate flex-1 uppercase">
                            {a.evento_titulo || a.procedimento || a.paciente_nome}
                          </span>
                          {!compact && (
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${status.chip} font-semibold shrink-0 shadow-sm border border-foreground/5`}
                              title={status.label}
                            >
                              <StatusIcon className="h-3 w-3" />
                              <span className="hidden sm:inline">{status.label}</span>
                            </span>
                          )}
                        </div>
                        {!compact && (
                          <div className="flex flex-col gap-1.5 mt-1">
                            <CategoriaBadge
                              categoria={a.categoria}
                              procedimento={a.procedimento}
                              cor={a.categoria_cor}
                              variant="dot"
                              size="xs"
                              className="opacity-90"
                            />
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80 font-medium">
                              <div className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                <span>{a.hora}</span>
                              </div>
                              {a.duracao ? (
                                <div className="flex items-center gap-1 before:content-['·'] before:mr-1">
                                  <span>{a.duracao} min</span>
                                </div>
                              ) : null}
                              {isShared && (
                                <div className="flex items-center gap-1 before:content-['·'] before:mr-1 text-primary animate-pulse">
                                  <Users className="h-3 w-3" />
                                  <span>+{others.length + 1} prof.</span>
                                </div>
                              )}
                            </div>
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
