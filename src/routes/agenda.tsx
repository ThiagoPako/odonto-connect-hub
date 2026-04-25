import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Clock, CheckCircle2, XCircle, UserCheck, Plus, ChevronLeft, ChevronRight,
  Phone, MessageSquare, AlertTriangle, RefreshCw, Search, ExternalLink, History, HeartPulse,
  LayoutGrid, List, CalendarDays, Stethoscope, Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { mockProfessionals as mockProfessionalsRaw, type Appointment, type Professional } from "@/data/agendaMockData";
import { getAlergias, getCondicoesCriticas, getHistorico } from "@/data/registroCentral";
import { agendaApi, whatsappApi, pacientesApi, dentistasApi, type AgendamentoVPS } from "@/lib/vpsApi";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { getDemoAppointments } from "@/data/demoAgenda";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
    professionalId: a.dentista_id,
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
  const [showNovoDialog, setShowNovoDialog] = useState(false);
  const [professionals, setProfessionals] = useState<Professional[]>(mockProfessionalsRaw);

  const currentDate = new Date();
  currentDate.setDate(currentDate.getDate() + dateOffset);
  const dateStr = currentDate.toISOString().split("T")[0]; // YYYY-MM-DD
  const dateDisplay = currentDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", weekday: "long" });

  // Carrega dentistas reais e mescla com mock como fallback
  useEffect(() => {
    dentistasApi.list().then(({ data }) => {
      if (Array.isArray(data) && data.length > 0) {
        const colors = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-primary", "bg-dental-cyan"];
        const real: Professional[] = data.map((d: any, idx: number) => ({
          id: d.id,
          name: d.nome || "Dentista",
          initials: (d.nome || "?")
            .split(" ")
            .filter((_: string, i: number, arr: string[]) => i === 0 || i === arr.length - 1)
            .map((n: string) => n[0])
            .join("")
            .toUpperCase(),
          specialty: d.especialidade || "Clínico Geral",
          color: colors[idx % colors.length],
        }));
        setProfessionals(real);
      }
    }).catch(() => { /* mantém mock */ });
  }, []);

  const fetchAgenda = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await agendaApi.list({ data: dateStr });
      if (error || !data || !Array.isArray(data) || data.length === 0) {
        // Fallback to demo data
        setAppointments(getDemoAppointments(dateStr));
      } else {
        setAppointments(data.map(vpsToAppointment));
      }
    } catch {
      setAppointments(getDemoAppointments(dateStr));
    }
    setLoading(false);
  }, [dateStr]);

  useEffect(() => { fetchAgenda(); }, [fetchAgenda]);

  const handleUpdateStatus = useCallback(async (id: string, status: string) => {
    const { error } = await agendaApi.update(id, { status });
    if (error) {
      // Demo mode: update locally
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: status as Appointment["status"] } : a));
      toast.success("Status atualizado (demonstração)");
    } else {
      toast.success("Status atualizado");
      fetchAgenda();
    }
  }, [fetchAgenda]);

  const handleAtender = useCallback((appointment: Appointment) => {
    navigate({ to: "/atendimento", search: { appointmentId: appointment.id } });
  }, [navigate]);

  const handleReschedule = useCallback(async (id: string, newDate: string, newTime: string) => {
    const { error } = await agendaApi.update(id, { status: "confirmado", hora: newTime, data: newDate });
    if (!error) {
      toast.success("Consulta reagendada com sucesso!");
      fetchAgenda();
    } else {
      toast.error("Erro ao reagendar: " + error);
    }
  }, [fetchAgenda]);

  const handleMoveToProfessional = useCallback(async (appointmentId: string, profId: string, profName: string) => {
    const { error } = await agendaApi.update(appointmentId, { dentista_id: profId, dentista_nome: profName });
    if (!error) {
      toast.success(`Consulta transferida para ${profName}`);
      fetchAgenda();
    } else {
      toast.error("Erro ao transferir: " + error);
    }
  }, [fetchAgenda]);

  const filtered = appointments
    .filter((a) => {
      if (selectedProfessional === "all") return true;
      if (a.professionalId && a.professionalId === selectedProfessional) return true;
      // Fallback for demo/legacy data without ID: match by name
      const prof = professionals.find((p) => p.id === selectedProfessional);
      return prof ? a.professional === prof.name : false;
    })
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
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button onClick={() => setShowNovoDialog(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
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
            {viewMode === "kanban" && <KanbanView filtered={filtered} selectedProfessional={selectedProfessional} professionals={professionals} onAtender={handleAtender} onUpdateStatus={handleUpdateStatus} onReschedule={handleReschedule} onMoveToProfessional={handleMoveToProfessional} />}
            {viewMode === "lista" && <ListView filtered={filtered} onAtender={handleAtender} onUpdateStatus={handleUpdateStatus} onReschedule={handleReschedule} />}
            {viewMode === "calendario" && <CalendarView filtered={filtered} selectedProfessional={selectedProfessional} professionals={professionals} />}
          </>
        )}

        <NovoAgendamentoDialog
          open={showNovoDialog}
          onOpenChange={setShowNovoDialog}
          defaultDate={dateStr}
          onCreated={fetchAgenda}
        />
      </main>
    </div>
  );
}

/* ===================== KANBAN VIEW ===================== */
function KanbanView({ filtered, selectedProfessional, professionals, onAtender, onUpdateStatus, onReschedule, onMoveToProfessional }: {
  filtered: Appointment[]; selectedProfessional: string;
  professionals: Professional[];
  onAtender: (a: Appointment) => void; onUpdateStatus: (id: string, status: string) => void;
  onReschedule: (id: string, date: string, time: string) => void;
  onMoveToProfessional: (id: string, profId: string, profName: string) => Promise<void>;
}) {
  const [dragOverProf, setDragOverProf] = useState<string | null>(null);
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [droppedId, setDroppedId] = useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent, prof: { id: string; name: string }) => {
    e.preventDefault();
    setDragOverProf(null);
    const appointmentId = e.dataTransfer.getData("appointmentId");
    const fromProf = e.dataTransfer.getData("fromProfessional");
    if (!appointmentId || fromProf === prof.name) return;
    setTransferringId(appointmentId);
    try {
      await onMoveToProfessional(appointmentId, prof.id, prof.name);
      setDroppedId(appointmentId);
      setTimeout(() => setDroppedId(null), 600);
    } finally {
      setTransferringId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {professionals
        .filter((p) => selectedProfessional === "all" || p.id === selectedProfessional)
        .map((prof) => {
          const profAppts = filtered
            .filter((a) => (a.professionalId ? a.professionalId === prof.id : a.professional === prof.name))
            .sort((a, b) => a.time.localeCompare(b.time));
          const isDragOver = dragOverProf === prof.id;
          return (
            <div
              key={prof.id}
              className={`bg-card rounded-xl border overflow-hidden shadow-card transition-all duration-300 ${
                isDragOver ? "border-primary shadow-glow-primary ring-2 ring-primary/20 scale-[1.02]" : "border-border hover:shadow-card-hover"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOverProf(prof.id); }}
              onDragLeave={() => setDragOverProf(null)}
              onDrop={(e) => handleDrop(e, prof)}
            >
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
              <div className={`p-2 space-y-1.5 max-h-[500px] overflow-y-auto min-h-[60px] transition-colors duration-200 ${isDragOver ? "bg-primary/5" : ""}`}>
                {profAppts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {isDragOver ? "Solte aqui para transferir" : "Sem consultas"}
                  </p>
                ) : (
                  profAppts.map((appt) => (
                    <AppointmentCard
                      key={appt.id}
                      appointment={appt}
                      onAtender={onAtender}
                      onUpdateStatus={onUpdateStatus}
                      onReschedule={onReschedule}
                      isTransferring={transferringId === appt.id}
                      justDropped={droppedId === appt.id}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}

/* ===================== LIST VIEW ===================== */
function ListView({ filtered, onAtender, onUpdateStatus, onReschedule }: { filtered: Appointment[]; onAtender: (a: Appointment) => void; onUpdateStatus: (id: string, status: string) => void; onReschedule: (id: string, date: string, time: string) => void }) {
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
                      {(a.status === "confirmado" || a.status === "aguardando") && (
                        <button
                          onClick={() => onAtender(a)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          title="Iniciar atendimento"
                        >
                          <Stethoscope className="h-3 w-3" />
                          <span className="text-[10px] font-medium">Atender</span>
                        </button>
                      )}
                      {a.status === "aguardando" && (
                        <button onClick={() => onUpdateStatus(a.id, "confirmado")} className="p-1.5 rounded-lg hover:bg-primary/10" title="Confirmar">
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
function CalendarView({ filtered, selectedProfessional, professionals: allProfessionals }: { filtered: Appointment[]; selectedProfessional: string; professionals: Professional[] }) {
  const professionals = allProfessionals.filter(
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
function AppointmentCard({ appointment: a, onAtender, onUpdateStatus, onReschedule, isTransferring, justDropped }: { appointment: Appointment; onAtender: (a: Appointment) => void; onUpdateStatus: (id: string, status: string) => void; onReschedule: (id: string, date: string, time: string) => void; isTransferring?: boolean; justDropped?: boolean }) {
  const cfg = statusConfig[a.status];
  const [showHistory, setShowHistory] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState(a.time);

  const historico = a.pacienteId ? getHistorico(a.pacienteId).slice(0, 4) : [];
  const alergias = a.pacienteId ? getAlergias(a.pacienteId) : [];
  const condicoes = a.pacienteId ? getCondicoesCriticas(a.pacienteId) : [];

  return (
    <div
      draggable={!isTransferring}
      onDragStart={(e) => {
        e.dataTransfer.setData("appointmentId", a.id);
        e.dataTransfer.setData("fromProfessional", a.professional);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`rounded-lg border border-border/50 p-2.5 space-y-2 hover-lift hover:shadow-glow-primary transition-all duration-300 ${
        isTransferring ? "opacity-50 pointer-events-none animate-pulse" : ""
      } ${justDropped ? "animate-scale-in ring-2 ring-primary/30 shadow-glow-primary" : ""} ${
        !isTransferring ? "cursor-grab active:cursor-grabbing" : ""
      } ${a.status === "faltou" ? "opacity-50" : ""}`}
    >
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
          {(a.status === "confirmado" || a.status === "aguardando") && (
            <button
              onClick={() => onAtender(a)}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              title="Iniciar atendimento"
            >
              <Stethoscope className="h-3 w-3" />
              <span className="text-[9px] font-medium">Atender</span>
            </button>
          )}
          {a.status === "aguardando" && (
            <button onClick={() => onUpdateStatus(a.id, "confirmado")} className="p-1 rounded hover:bg-primary/10" title="Confirmar">
              <UserCheck className="h-3 w-3 text-primary" />
            </button>
          )}
          {a.status !== "finalizado" && (
            <button onClick={() => setShowReschedule(!showReschedule)} className="p-1 rounded hover:bg-warning/10" title="Reagendar">
              <RefreshCw className={`h-3 w-3 ${a.status === "faltou" ? "text-warning" : "text-muted-foreground"}`} />
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

      {/* Reschedule popover */}
      {showReschedule && (
        <div className="bg-muted/50 rounded-lg p-2 space-y-2 border border-border/50 animate-fade-in">
          <p className="text-[10px] font-semibold text-foreground">Reagendar consulta</p>
          <div className="flex gap-2">
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="flex-1 h-7 px-2 rounded bg-background border border-border text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <select
              value={rescheduleTime}
              onChange={(e) => setRescheduleTime(e.target.value)}
              className="w-20 h-7 px-1 rounded bg-background border border-border text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {HORARIOS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setShowReschedule(false)} className="px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted rounded">
              Cancelar
            </button>
            <button
              onClick={() => {
                if (!rescheduleDate) { toast.error("Selecione a nova data"); return; }
                onReschedule(a.id, rescheduleDate, rescheduleTime);
                setShowReschedule(false);
              }}
              className="px-2.5 py-1 text-[10px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== NOVO AGENDAMENTO DIALOG ===================== */
const PROCEDIMENTOS = [
  "Consulta avaliação", "Profilaxia", "Restauração", "Extração",
  "Tratamento de canal", "Implante", "Manutenção ortodôntica",
  "Instalação aparelho", "Clareamento", "Cirurgia", "Prótese", "Outro",
];
const SALAS = ["Sala 1", "Sala 2", "Sala 3", "Sala 4"];
const HORARIOS = Array.from({ length: 26 }, (_, i) => {
  const h = Math.floor(i / 2) + 7;
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
}).filter((h) => parseInt(h.split(":")[0]) <= 19);

interface NovoAgendamentoForm {
  paciente_nome: string;
  paciente_id: string;
  telefone: string;
  dentista_id: string;
  data: string;
  hora: string;
  duracao: number;
  procedimento: string;
  sala: string;
  observacoes: string;
  enviar_whatsapp: boolean;
}

function NovoAgendamentoDialog({
  open, onOpenChange, defaultDate, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate: string;
  onCreated: () => void;
}) {
  const emptyForm: NovoAgendamentoForm = {
    paciente_nome: "", paciente_id: "", telefone: "",
    dentista_id: "",
    data: defaultDate, hora: "08:00", duracao: 30,
    procedimento: "Consulta avaliação", sala: "Sala 1",
    observacoes: "", enviar_whatsapp: true,
  };
  const [form, setForm] = useState<NovoAgendamentoForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pacientesList, setPacientesList] = useState<any[]>([]);
  const [pacientesFiltered, setPacientesFiltered] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [dentistasList, setDentistasList] = useState<Array<{ id: string; nome: string }>>([]);
  const [loadingDentistas, setLoadingDentistas] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Load patients + dentistas when opening
  useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, data: defaultDate }));
      pacientesApi.list().then(({ data }) => {
        if (Array.isArray(data)) setPacientesList(data);
      });
      setLoadingDentistas(true);
      dentistasApi.list()
        .then(({ data }) => {
          if (Array.isArray(data) && data.length > 0) {
            setDentistasList(data);
            setForm((f) => ({ ...f, dentista_id: f.dentista_id || data[0].id }));
          } else {
            setDentistasList([]);
          }
        })
        .finally(() => setLoadingDentistas(false));
    }
  }, [open, defaultDate]);

  const handlePatientSearch = (value: string) => {
    handleChange("paciente_nome", value);
    handleChange("paciente_id", "");
    if (value.length >= 2) {
      const q = value.toLowerCase();
      setPacientesFiltered(pacientesList.filter((p: any) => p.nome?.toLowerCase().includes(q)).slice(0, 6));
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const selectPaciente = (pac: any) => {
    setForm((f) => ({
      ...f,
      paciente_nome: pac.nome || "",
      paciente_id: pac.id || "",
      telefone: pac.telefone || f.telefone,
    }));
    setShowSuggestions(false);
  };

  const handleChange = (field: keyof NovoAgendamentoForm, value: string | number | boolean) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const formatDateBR = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  };

  const handleSubmit = async () => {
    // Nome
    if (!form.paciente_nome.trim()) { toast.error("Informe o nome do paciente"); return; }
    if (form.paciente_nome.trim().length < 2) { toast.error("Nome do paciente muito curto"); return; }

    // Profissional
    if (!form.dentista_id) { toast.error("Selecione o profissional"); return; }

    // Telefone (obrigatório se WhatsApp; se preenchido, valida formato)
    const telDigits = form.telefone.replace(/\D/g, "");
    if (form.enviar_whatsapp && !telDigits) {
      toast.error("Informe o telefone para enviar confirmação via WhatsApp");
      return;
    }
    if (telDigits && (telDigits.length < 10 || telDigits.length > 13)) {
      toast.error("Telefone inválido. Use DDD + número (ex: 55 11 99999-0000)");
      return;
    }

    // Data (formato YYYY-MM-DD e não pode ser passada)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.data)) {
      toast.error("Data inválida");
      return;
    }
    const dataObj = new Date(form.data + "T00:00:00");
    if (isNaN(dataObj.getTime())) {
      toast.error("Data inválida");
      return;
    }
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (dataObj < hoje) {
      toast.error("Não é possível agendar para uma data passada");
      return;
    }

    // Hora (HH:MM)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.hora)) {
      toast.error("Horário inválido. Use o formato HH:MM");
      return;
    }

    // Duração (5 a 480 min)
    if (!Number.isFinite(form.duracao) || form.duracao < 5 || form.duracao > 480) {
      toast.error("Duração deve estar entre 5 e 480 minutos");
      return;
    }

    // Sala
    if (!form.sala || !form.sala.trim()) {
      toast.error("Selecione a sala de atendimento");
      return;
    }

    // Procedimento
    if (!form.procedimento || !form.procedimento.trim()) {
      toast.error("Informe o procedimento");
      return;
    }

    // Dentista deve ser UUID válido (banco exige UUID na FK)
    if (!UUID_RE.test(form.dentista_id)) {
      toast.error("Cadastre um profissional em /dentistas antes de criar agendamentos. O ID do profissional precisa ser um UUID válido.");
      return;
    }
    // Paciente_id também precisa ser UUID se preenchido
    if (form.paciente_id && !UUID_RE.test(form.paciente_id)) {
      toast.error("Selecione o paciente na lista de sugestões para vincular um cadastro válido.");
      return;
    }
    if (!form.paciente_id) {
      toast.error("Selecione o paciente na lista de sugestões (clique em uma opção). É necessário um paciente cadastrado.");
      return;
    }

    setSaving(true);
    try {
      const profFromList = dentistasList.find((p) => p.id === form.dentista_id);
      const profFromMock = mockProfessionalsRaw.find((p) => p.id === form.dentista_id);
      const profName = profFromList?.nome || profFromMock?.name || "";
      let result;
      try {
        result = await agendaApi.create({
          paciente_id: form.paciente_id,
          paciente_nome: form.paciente_nome.trim(),
          dentista_id: form.dentista_id,
          dentista_nome: profName,
          data: form.data, hora: form.hora, duracao: form.duracao,
          procedimento: form.procedimento, sala: form.sala,
          observacoes: form.observacoes || undefined, status: "agendado",
        });
      } catch (netErr: any) {
        console.error("[agenda.create] network/exception:", netErr);
        toast.error("Falha de conexão com a API: " + (netErr?.message || "erro desconhecido"));
        return;
      }

      const { error } = result || {};
      if (error) {
        toast.error("Erro ao criar agendamento: " + error);
        return;
      }

      // Send WhatsApp confirmation
      if (form.enviar_whatsapp && form.telefone.replace(/\D/g, "")) {
        const phone = form.telefone.replace(/\D/g, "");
        const dataBR = formatDateBR(form.data);
        const msg = `✅ *Agendamento Confirmado*\n\nOlá, ${form.paciente_nome.split(" ")[0]}! 👋\n\nSeu agendamento foi confirmado:\n\n📅 *Data:* ${dataBR}\n⏰ *Horário:* ${form.hora}\n🦷 *Procedimento:* ${form.procedimento}\n👨‍⚕️ *Profissional:* ${profName || "—"}\n\nCaso precise reagendar, entre em contato conosco.\n\n_Odonto Connect_`;
        try {
          const { data: instances } = await whatsappApi.instances();
          const activeInstance = Array.isArray(instances)
            ? instances.find((i: any) => i.connectionStatus === "open" || i.state === "open")
            : null;
          if (activeInstance) {
            const instanceName = activeInstance.instance?.instanceName || activeInstance.instanceName || activeInstance.name;
            await whatsappApi.sendText(instanceName, phone, msg);
            toast.success("Confirmação enviada via WhatsApp! ✅");
          } else {
            toast.warning("Agendamento criado, mas nenhuma instância WhatsApp ativa para enviar confirmação.");
          }
        } catch (whatsErr: any) {
          toast.warning("Agendamento criado, mas falha ao enviar WhatsApp: " + (whatsErr?.message || "erro"));
        }
      } else {
        toast.success("Agendamento criado com sucesso!");
      }

      onOpenChange(false);
      setForm({ ...emptyForm, data: defaultDate });
      onCreated();
    } catch (err: any) {
      console.error("[agenda.handleSubmit] unexpected error:", err);
      toast.error("Erro inesperado: " + (err?.message || "tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full h-9 px-3 rounded-lg bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary";
  const labelCls = "text-xs font-medium text-foreground mb-1 block";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            Novo Agendamento
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Paciente + Telefone */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className={labelCls}>Paciente *</label>
              <input type="text" placeholder="Buscar paciente..." value={form.paciente_nome}
                onChange={(e) => handlePatientSearch(e.target.value)}
                onFocus={() => { if (form.paciente_nome.length >= 2) setShowSuggestions(true); }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className={inputCls} maxLength={100} autoComplete="off" />
              {showSuggestions && pacientesFiltered.length > 0 && (
                <div ref={suggestionsRef} className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {pacientesFiltered.map((pac: any) => (
                    <button key={pac.id} type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectPaciente(pac); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted transition-colors flex items-center gap-2 text-sm">
                      <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                        {(pac.nome || "").split(" ").filter((_: string, i: number, a: string[]) => i === 0 || i === a.length - 1).map((n: string) => n[0]).join("").toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{pac.nome}</p>
                        {pac.telefone && <p className="text-[10px] text-muted-foreground">{pac.telefone}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {form.paciente_id && (
                <p className="text-[10px] text-success mt-0.5">✓ Paciente vinculado</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Telefone (WhatsApp)</label>
              <input type="tel" placeholder="55 11 99999-0000" value={form.telefone}
                onChange={(e) => handleChange("telefone", e.target.value)} className={inputCls} maxLength={20} />
            </div>
          </div>

          {/* Data + Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Data *</label>
              <input type="date" value={form.data} onChange={(e) => handleChange("data", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Horário *</label>
              <select value={form.hora} onChange={(e) => handleChange("hora", e.target.value)} className={inputCls}>
                {HORARIOS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>

          {/* Profissional + Duração */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                Profissional *
                {loadingDentistas && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> carregando...
                  </span>
                )}
              </label>
              <select
                value={form.dentista_id}
                onChange={(e) => handleChange("dentista_id", e.target.value)}
                disabled={loadingDentistas}
                className={`${inputCls} ${loadingDentistas ? "opacity-60 cursor-wait" : ""}`}
              >
                {loadingDentistas ? (
                  <option value="" disabled>Carregando profissionais...</option>
                ) : dentistasList.length > 0 ? (
                  dentistasList.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)
                ) : (
                  <option value="" disabled>Nenhum profissional cadastrado — vá em /dentistas</option>
                )}
              </select>
            </div>
            <div>
              <label className={labelCls}>Duração</label>
              <select value={form.duracao} onChange={(e) => handleChange("duracao", parseInt(e.target.value))} className={inputCls}>
                {[15,30,45,60,90,120].map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
          </div>

          {/* Procedimento + Sala */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Procedimento</label>
              <select value={form.procedimento} onChange={(e) => handleChange("procedimento", e.target.value)} className={inputCls}>
                {PROCEDIMENTOS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Sala</label>
              <select value={form.sala} onChange={(e) => handleChange("sala", e.target.value)} className={inputCls}>
                {SALAS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className={labelCls}>Observações</label>
            <textarea placeholder="Observações opcionais..." value={form.observacoes}
              onChange={(e) => handleChange("observacoes", e.target.value)}
              className={`${inputCls} h-16 resize-none py-2`} maxLength={500} />
          </div>

          {/* WhatsApp toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.enviar_whatsapp}
              onChange={(e) => handleChange("enviar_whatsapp", e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <MessageSquare className="h-3.5 w-3.5 text-success" />
            <span className="text-xs text-foreground">Enviar confirmação via WhatsApp</span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => onOpenChange(false)}
              className="h-9 px-4 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={saving || loadingDentistas}
              title={loadingDentistas ? "Aguarde o carregamento dos profissionais..." : undefined}
              className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {(saving || loadingDentistas) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loadingDentistas ? "Carregando..." : saving ? "Salvando..." : "Criar Agendamento"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}