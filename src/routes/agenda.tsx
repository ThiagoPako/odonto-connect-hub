import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Clock, CheckCircle2, XCircle, UserCheck, Plus, ChevronLeft, ChevronRight,
  Phone, MessageSquare, AlertTriangle, RefreshCw, Search, ExternalLink, History,
} from "lucide-react";
import { useState } from "react";
import { mockAppointments, mockProfessionals, type Appointment } from "@/data/agendaMockData";
import { mockHistoricos, mockAnamneses } from "@/data/pacientesMockData";

export const Route = createFileRoute("/agenda")({
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

function AgendaPage() {
  const [selectedProfessional, setSelectedProfessional] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = mockAppointments
    .filter((a) => selectedProfessional === "all" || a.professional.includes(selectedProfessional))
    .filter((a) => !searchTerm || a.patientName.toLowerCase().includes(searchTerm.toLowerCase()));

  const countByStatus = (status: Appointment["status"]) => mockAppointments.filter((a) => a.status === status).length;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Agenda e Recepção" />
      <main className="flex-1 p-6 space-y-5 overflow-auto">
        {/* Stats bar */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {(["confirmado", "aguardando", "em_atendimento", "finalizado", "faltou", "encaixe"] as const).map((s) => {
            const cfg = statusConfig[s];
            const Icon = cfg.icon;
            return (
              <div key={s} className="bg-card rounded-xl border border-border p-3 flex items-center gap-2">
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${cfg.color}`}>
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
            <button className="p-1.5 rounded-lg hover:bg-muted"><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>
            <span className="text-sm font-semibold text-foreground">08 de Abril, 2026 — Quarta-feira</span>
            <button className="p-1.5 rounded-lg hover:bg-muted"><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>
          </div>
          <div className="flex items-center gap-2">
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

        {/* Professional columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {mockProfessionals
            .filter((p) => selectedProfessional === "all" || p.name.includes(selectedProfessional))
            .map((prof) => {
              const profAppts = filtered.filter((a) => a.professional === prof.name).sort((a, b) => a.time.localeCompare(b.time));
              return (
                <div key={prof.id} className="bg-card rounded-xl border border-border overflow-hidden">
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
                      profAppts.map((appt) => <AppointmentCard key={appt.id} appointment={appt} />)
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </main>
    </div>
  );
}

function AppointmentCard({ appointment: a }: { appointment: Appointment }) {
  const cfg = statusConfig[a.status];
  const [showHistory, setShowHistory] = useState(false);

  const historico = a.pacienteId
    ? mockHistoricos
        .filter((h) => h.pacienteId === a.pacienteId)
        .sort((x, y) => y.data.getTime() - x.data.getTime())
        .slice(0, 4)
    : [];

  const anamnese = a.pacienteId ? mockAnamneses[a.pacienteId] : undefined;
  const alergias = anamnese?.alergias ?? [];

  return (
    <div className={`rounded-lg border border-border/50 p-2.5 space-y-2 ${a.status === "faltou" ? "opacity-50" : ""}`}>
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
                    ⚠ {alergias.join(", ")}
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
