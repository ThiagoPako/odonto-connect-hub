import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Clock, CheckCircle2, XCircle, UserCheck, Plus, ChevronLeft, ChevronRight,
  Phone, MessageSquare, AlertTriangle, RefreshCw, Search, ExternalLink, History, HeartPulse,
  LayoutGrid, List, CalendarDays, Stethoscope, Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { mockProfessionals, type Appointment } from "@/data/agendaMockData";
import { getAlergias, getCondicoesCriticas, getHistorico } from "@/data/registroCentral";
import { agendaApi, type AgendamentoVPS } from "@/lib/vpsApi";
import { toast } from "sonner";

export const Route = createFileRoute("/agenda")({
  ssr: false,
  component: AgendaPage,
});

const statusConfig: Record<Appointment["status"], { label: string; color: string; icon: React.ElementType }> = {
  confirmado: { label: "Confirmado", color: "bg-success/15 text-success", icon: CheckCircle2 },
  aguardando: { label: "Aguardando", color: "bg-warning/15 text-warning", icon: Clock },
  em_atendimento: { label: "Em atendimento", color: "bg-primary/15 text-primary", icon: UserCheck },
  finalizado: { label: "Finalizado", color: "bg-muted text-muted-foreground", icon: CheckCircle2 },
  faltou: { label: "Faltou", color: "bg-destructive/15 text-destructive", icon: XCircle },
  encaixe: { label: "Encaixe", color: "bg-chart-4/15 text-chart-4", icon: AlertTriangle },
};

type ViewMode = "kanban" | "lista" | "calendario";

const HOURS = Array.from({ length: 12 }, (_, i) => `${String(i + 7).padStart(2, "0")}:00`);

/** Convert VPS agendamento to local Appointment shape */
function vpsToAppointment(a: AgendamentoVPS): Appointment {
  const name = a.paciente_nome || "Paciente";
  const initials = name.split(" ").filter((_: string, i: number, arr: string[]) => i === 0 || i === arr.length - 1).map((n: string) => n[0]).join("").toUpperCase();
  const colors = ["bg-chart-1","bg-chart-2","bg-chart-3","bg-chart-4","bg-chart-5","bg-primary","bg-dental-cyan"];
  const colorIdx = name.length % colors.length;
  const profName = a.dentista_nome || "Dr. Não atribuído";
  const profInitials = profName.split(" ").filter((_: string, i: number, arr: string[]) => i === 0 || i === arr.length - 1).map((n: string) => n[0]).join("").toUpperCase();
  const statusMap: Record<string, Appointment["status"]> = {
    agendado: "confirmado", confirmado: "confirmado", aguardando: "aguardando",
    em_atendimento: "em_atendimento", finalizado: "finalizado", realizado: "finalizado",
    faltou: "faltou", cancelado: "faltou", desmarcado: "faltou", encaixe: "encaixe",
  };
  return {
    id: a.id,
    pacienteId: a.paciente_id,
    patientName: name,
    patientInitials: initials,
    avatarColor: colors[colorIdx],
    professional: profName,
    professionalInitials: profInitials,
    room: a.sala || "Sala 1",
    procedure: a.procedimento || "Consulta",
    date: a.data,
    time: a.hora || "08:00",
    duration: a.duracao || 30,
    status: statusMap[a.status] || "confirmado",
    phone: "",
    confirmed: a.status === "confirmado",
  };
}

function AgendaPage() {
  const navigate = useNavigate();
  const [selectedProfessional, setSelectedProfessional] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateOffset, setDateOffset] = useState(0);

  const currentDate = new Date();
  currentDate.setDate(currentDate.getDate() + dateOffset);
  const dateStr = currentDate.toISOString().split("T")[0]; // YYYY-MM-DD
  const dateDisplay = currentDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", weekday: "long" });

  const fetchAgenda = useCallback(async () => {
    setLoading(true);
    const { data, error } = await agendaApi.list({ data: dateStr });
    if (error) {
      toast.error("Erro ao carregar agenda: " + error);
      setAppointments([]);
    } else if (data && Array.isArray(data)) {
      setAppointments(data.map(vpsToAppointment));
    } else {
      setAppointments([]);
    }
    setLoading(false);
  }, [dateStr]);

  useEffect(() => { fetchAgenda(); }, [fetchAgenda]);

  const handleUpdateStatus = useCallback(async (id: string, status: string) => {
    const { error } = await agendaApi.update(id, { status });
    if (error) {
      toast.error("Erro ao atualizar status: " + error);
    } else {
      toast.success("Status atualizado");
      fetchAgenda();
    }
  }, [fetchAgenda]);

  const handleAtender = useCallback((appointment: Appointment) => {
    navigate({ to: "/atendimento", search: { appointmentId: appointment.id } });
  }, [navigate]);

  const filtered = appointments
    .filter((a) => selectedProfessional === "all" || a.professional.includes(selectedProfessional))
    .filter((a) => !searchTerm || a.patientName.toLowerCase().includes(searchTerm.toLowerCase()));

  const countByStatus = (status: Appointment["status"]) => appointments.filter((a) => a.status === status).length;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Agenda e Recepção" />
      <main className="flex-1 p-6 space-y-5 overflow-auto">
        {/* Stats bar */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 animate-slide-up" style={{ animationFillMode: 'both' }}>
          {(["confirmado", "aguardando", "em_atendimento", "finalizado", "faltou", "encaixe"] as const).map((s) => {
            const cfg = statusConfig[s];
            const Icon = cfg.icon;
            return (
              <div key={s} className="group bg-card rounded-xl border border-border p-3 flex items-center gap-2 hover-lift hover:shadow-glow-primary transition-all duration-300">
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${cfg.color} group-hover:shadow-[0_0_10px_-2px_currentColor] transition-shadow duration-300`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground leading-none">{countByStatus(s)}</p>
                  <p className="text-[10px] text-muted-foreground">{cfg.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setDateOffset(d => d - 1)} className="p-1.5 rounded-lg hover:bg-muted"><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>
            <span className="text-sm font-semibold text-foreground capitalize">{dateDisplay}</span>
            <button onClick={() => setDateOffset(d => d + 1)} className="p-1.5 rounded-lg hover:bg-muted"><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center bg-muted rounded-lg p-0.5">
              {([
                { mode: "kanban" as const, icon: LayoutGrid, label: "Kanban" },
                { mode: "lista" as const, icon: List, label: "Lista" },
                { mode: "calendario" as const, icon: CalendarDays, label: "Calendário" },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                    viewMode === mode
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={label}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar paciente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
              />
            </div>
            <select
              value={selectedProfessional}
              onChange={(e) => setSelectedProfessional(e.target.value)}
              className="h-8 px-3 rounded-lg bg-muted border-0 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">Todos profissionais</option>
              {mockProfessionals.map((p) => (
                <option key={p.id} value={p.name.split(" ")[1]}>{p.name}</option>
              ))}
            </select>
            <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Agendar
            </button>
          </div>
        </div>

        {/* Views */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <span className="ml-3 text-sm text-muted-foreground">Carregando agenda...</span>
          </div>
        ) : (
          <>
            {viewMode === "kanban" && <KanbanView filtered={filtered} selectedProfessional={selectedProfessional} onAtender={handleAtender} onUpdateStatus={handleUpdateStatus} />}
            {viewMode === "lista" && <ListView filtered={filtered} onAtender={handleAtender} onUpdateStatus={handleUpdateStatus} />}
            {viewMode === "calendario" && <CalendarView filtered={filtered} selectedProfessional={selectedProfessional} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ===================== KANBAN VIEW ===================== */
function KanbanView({ filtered, selectedProfessional, onAtender, onUpdateStatus }: { filtered: Appointment[]; selectedProfessional: string; onAtender: (a: Appointment) => void; onUpdateStatus: (id: string, status: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {mockProfessionals
        .filter((p) => selectedProfessional === "all" || p.name.includes(selectedProfessional))
        .map((prof) => {
          const profAppts = filtered.filter((a) => a.professional === prof.name).sort((a, b) => a.time.localeCompare(b.time));
          return (
            <div key={prof.id} className="bg-card rounded-xl border border-border overflow-hidden shadow-card hover:shadow-card-hover transition-all duration-300">
              <div className="flex items-center gap-2 p-3 border-b border-border">
                <div className={`h-7 w-7 rounded-full ${prof.color} flex items-center justify-center text-[10px] font-bold text-white`}>
                  {prof.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{prof.name}</p>
                  <p className="text-[10px] text-muted-foreground">{prof.specialty}</p>
                </div>
                <span className="text-[10px] font-medium text-muted-foreground">{profAppts.length} consultas</span>
              </div>
              <div className="p-2 space-y-1.5 max-h-[500px] overflow-y-auto">
                {profAppts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Sem consultas</p>
                ) : (
                  profAppts.map((appt) => <AppointmentCard key={appt.id} appointment={appt} onAtender={onAtender} onUpdateStatus={onUpdateStatus} />)
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}

/* ===================== LIST VIEW ===================== */
function ListView({ filtered, onAtender, onUpdateStatus }: { filtered: Appointment[]; onAtender: (a: Appointment) => void; onUpdateStatus: (id: string, status: string) => void }) {
  const sorted = [...filtered].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Horário</th>
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Paciente</th>
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Procedimento</th>
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Profissional</th>
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Sala</th>
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Duração</th>
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Status</th>
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Alertas</th>
              <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const cfg = statusConfig[a.status];
              const alergias = a.pacienteId ? getAlergias(a.pacienteId) : [];
              const condicoes = a.pacienteId ? getCondicoesCriticas(a.pacienteId) : [];
              return (
                <tr key={a.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${a.status === "faltou" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3">
                    <span className="text-xs font-bold text-foreground">{a.time}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-7 w-7 rounded-full ${a.avatarColor} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                        {a.patientInitials}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">{a.patientName}</p>
                        <p className="text-[10px] text-muted-foreground">{a.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-foreground">{a.procedure}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-foreground">{a.professional}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{a.room}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{a.duration}min</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {alergias.length > 0 && (
                        <div className="group/al relative">
                          <div className="h-5 w-5 rounded-full bg-destructive/15 flex items-center justify-center">
                            <AlertTriangle className="h-3 w-3 text-destructive" />
                          </div>
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/al:block z-50">
                            <div className="bg-destructive text-destructive-foreground text-[9px] font-bold px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                              ⚠ {alergias.join(", ")}
                            </div>
                          </div>
                        </div>
                      )}
                      {condicoes.length > 0 && (
                        <div className="group/co relative">
                          <div className="h-5 w-5 rounded-full bg-warning/15 flex items-center justify-center">
                            <HeartPulse className="h-3 w-3 text-warning" />
                          </div>
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/co:block z-50">
                            <div className="bg-warning text-warning-foreground text-[9px] font-bold px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                              ♥ {condicoes.join(", ")}
                            </div>
                          </div>
                        </div>
                      )}
                      {alergias.length === 0 && condicoes.length === 0 && (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {a.status === "aguardando" && (
                        <button className="p-1.5 rounded-lg hover:bg-primary/10" title="Check-in">
                          <UserCheck className="h-3.5 w-3.5 text-primary" />
                        </button>
                      )}
                      {a.status === "faltou" && (
                        <button className="p-1.5 rounded-lg hover:bg-warning/10" title="Reagendar">
                          <RefreshCw className="h-3.5 w-3.5 text-warning" />
                        </button>
                      )}
                      <button className="p-1.5 rounded-lg hover:bg-muted" title="WhatsApp">
                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button className="p-1.5 rounded-lg hover:bg-muted" title="Ligar">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      {a.pacienteId && (
                        <Link to="/pacientes" search={{ pacienteId: a.pacienteId }} className="p-1.5 rounded-lg hover:bg-primary/10" title="Ficha">
                          <ExternalLink className="h-3.5 w-3.5 text-primary" />
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== CALENDAR VIEW ===================== */
function CalendarView({ filtered, selectedProfessional }: { filtered: Appointment[]; selectedProfessional: string }) {
  const professionals = mockProfessionals.filter(
    (p) => selectedProfessional === "all" || p.name.includes(selectedProfessional)
  );

  const getApptForSlot = (profName: string, hour: string) => {
    return filtered.filter((a) => a.professional === profName && a.time.startsWith(hour.split(":")[0]));
  };

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-3 w-16 sticky left-0 bg-muted/50 z-10">
                Hora
              </th>
              {professionals.map((prof) => (
                <th key={prof.id} className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-3 min-w-[180px]">
                  <div className="flex items-center justify-center gap-1.5">
                    <div className={`h-5 w-5 rounded-full ${prof.color} flex items-center justify-center text-[8px] font-bold text-white`}>
                      {prof.initials}
                    </div>
                    <span>{prof.name.split(" ").slice(0, 2).join(" ")}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour} className="border-b border-border/30 hover:bg-muted/10">
                <td className="px-3 py-1 text-[11px] font-semibold text-muted-foreground align-top pt-2 sticky left-0 bg-card z-10 border-r border-border/30">
                  {hour}
                </td>
                {professionals.map((prof) => {
                  const appts = getApptForSlot(prof.name, hour);
                  return (
                    <td key={prof.id} className="px-1.5 py-1 align-top min-w-[180px]">
                      {appts.length === 0 ? (
                        <div className="h-12 rounded-lg border border-dashed border-border/30 hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer flex items-center justify-center">
                          <Plus className="h-3 w-3 text-muted-foreground/30" />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {appts.map((a) => {
                            const cfg = statusConfig[a.status];
                            const alergias = a.pacienteId ? getAlergias(a.pacienteId) : [];
                            const condicoes = a.pacienteId ? getCondicoesCriticas(a.pacienteId) : [];
                            const heightSlots = Math.max(Math.ceil(a.duration / 30), 1);
                            return (
                              <div
                                key={a.id}
                                className={`rounded-lg border p-2 transition-all hover:shadow-md cursor-pointer ${
                                  a.status === "faltou"
                                    ? "border-destructive/20 bg-destructive/5 opacity-60"
                                    : a.status === "em_atendimento"
                                    ? "border-primary/30 bg-primary/5"
                                    : a.status === "finalizado"
                                    ? "border-border/50 bg-muted/30"
                                    : "border-border/50 bg-card"
                                }`}
                                style={{ minHeight: `${heightSlots * 40}px` }}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-bold text-foreground">{a.time}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${cfg.color}`}>
                                    {cfg.label}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <div className={`h-5 w-5 rounded-full ${a.avatarColor} flex items-center justify-center text-[8px] font-bold text-white shrink-0`}>
                                    {a.patientInitials}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-medium text-foreground truncate">{a.patientName}</p>
                                    <p className="text-[9px] text-muted-foreground truncate">{a.procedure} · {a.duration}min</p>
                                  </div>
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    {alergias.length > 0 && (
                                      <div className="h-4 w-4 rounded-full bg-destructive/15 flex items-center justify-center" title={`Alergias: ${alergias.join(", ")}`}>
                                        <AlertTriangle className="h-2.5 w-2.5 text-destructive" />
                                      </div>
                                    )}
                                    {condicoes.length > 0 && (
                                      <div className="h-4 w-4 rounded-full bg-warning/15 flex items-center justify-center" title={condicoes.join(", ")}>
                                        <HeartPulse className="h-2.5 w-2.5 text-warning" />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== APPOINTMENT CARD (Kanban) ===================== */
function AppointmentCard({ appointment: a }: { appointment: Appointment }) {
  const cfg = statusConfig[a.status];
  const [showHistory, setShowHistory] = useState(false);

  const historico = a.pacienteId ? getHistorico(a.pacienteId).slice(0, 4) : [];
  const alergias = a.pacienteId ? getAlergias(a.pacienteId) : [];
  const condicoes = a.pacienteId ? getCondicoesCriticas(a.pacienteId) : [];

  return (
    <div className={`rounded-lg border border-border/50 p-2.5 space-y-2 hover-lift hover:shadow-glow-primary transition-all duration-300 ${a.status === "faltou" ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-foreground">{a.time}</span>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cfg.color}`}>{cfg.label}</span>
      </div>
      <div className="relative flex items-center gap-2">
        <div className={`h-6 w-6 rounded-full ${a.avatarColor} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
          {a.patientInitials}
        </div>
        <div
          className="min-w-0 flex-1"
          onMouseEnter={() => historico.length > 0 && setShowHistory(true)}
          onMouseLeave={() => setShowHistory(false)}
        >
          <div className="flex items-center gap-1">
            <p className="text-[11px] font-medium text-foreground truncate">{a.patientName}</p>
            {alergias.length > 0 && (
              <div className="group/alergia relative shrink-0">
                <div className="h-4 w-4 rounded-full bg-destructive/15 flex items-center justify-center">
                  <AlertTriangle className="h-2.5 w-2.5 text-destructive" />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/alergia:block z-50 animate-fade-in">
                  <div className="bg-destructive text-destructive-foreground text-[9px] font-bold px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                    ⚠ Alergias: {alergias.join(", ")}
                  </div>
                </div>
              </div>
            )}
            {condicoes.length > 0 && (
              <div className="group/cond relative shrink-0">
                <div className="h-4 w-4 rounded-full bg-warning/15 flex items-center justify-center">
                  <HeartPulse className="h-2.5 w-2.5 text-warning" />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/cond:block z-50 animate-fade-in">
                  <div className="bg-warning text-warning-foreground text-[9px] font-bold px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                    ♥ {condicoes.join(", ")}
                  </div>
                </div>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground truncate">{a.procedure}</p>
        </div>
        {a.pacienteId && (
          <Link
            to="/pacientes"
            search={{ pacienteId: a.pacienteId }}
            className="p-1 rounded hover:bg-primary/10 shrink-0"
            title="Ver ficha do paciente"
          >
            <ExternalLink className="h-3 w-3 text-primary" />
          </Link>
        )}

        {/* Tooltip de histórico */}
        {showHistory && historico.length > 0 && (
          <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-card border border-border rounded-xl shadow-xl p-3 space-y-2 animate-fade-in">
            <div className="flex items-center gap-1.5 mb-1">
              <History className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-bold text-foreground uppercase tracking-wider">Últimas consultas</span>
            </div>
            {historico.map((h) => (
              <div key={h.id} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-foreground">{h.data.toLocaleDateString("pt-BR")}</span>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                      h.tipo === "urgencia" ? "bg-destructive/10 text-destructive"
                        : h.tipo === "procedimento" ? "bg-primary/10 text-primary"
                        : h.tipo === "retorno" ? "bg-muted text-muted-foreground"
                        : "bg-info/10 text-info"
                    }`}>
                      {h.tipo}
                    </span>
                  </div>
                  <p className="text-[9px] text-muted-foreground truncate">{h.procedimento}</p>
                  <p className="text-[9px] text-muted-foreground/70 truncate">{h.dentista}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{a.room} · {a.duration}min</span>
        <div className="flex items-center gap-1">
          {a.status === "aguardando" && (
            <button className="p-1 rounded hover:bg-primary/10" title="Check-in">
              <UserCheck className="h-3 w-3 text-primary" />
            </button>
          )}
          {a.status === "faltou" && (
            <button className="p-1 rounded hover:bg-warning/10" title="Reagendar">
              <RefreshCw className="h-3 w-3 text-warning" />
            </button>
          )}
          <button className="p-1 rounded hover:bg-muted" title="WhatsApp">
            <MessageSquare className="h-3 w-3" />
          </button>
          <button className="p-1 rounded hover:bg-muted" title="Ligar">
            <Phone className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}