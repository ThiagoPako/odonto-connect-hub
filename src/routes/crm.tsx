import { createFileRoute, Link } from "@tanstack/react-router";
import { getAlergias } from "@/data/registroCentral";
import { useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { mockPatients, type Patient } from "@/data/crmMockData";
import {
  Search, Plus, Filter, Phone, Mail, Calendar, DollarSign,
  ChevronRight, MoreHorizontal, UserPlus, ExternalLink
} from "lucide-react";

export const Route = createFileRoute("/crm")({
  ssr: false,
  component: CrmPage,
});

const statusLabels: Record<Patient["status"], { label: string; className: string }> = {
  lead: { label: "Lead", className: "bg-chart-1/15 text-chart-1" },
  ativo: { label: "Ativo", className: "bg-success/15 text-success" },
  inativo: { label: "Inativo", className: "bg-warning/15 text-warning" },
  paciente: { label: "Paciente", className: "bg-primary/15 text-primary" },
};

const origins = ["Todos", "Google Ads", "Meta Ads", "Instagram", "Indicação", "Site"];
const statuses = ["Todos", "lead", "ativo", "inativo", "paciente"];

function CrmPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [originFilter, setOriginFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const filtered = mockPatients.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.phone.includes(searchTerm) || p.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchOrigin = originFilter === "Todos" || p.origin === originFilter;
    const matchStatus = statusFilter === "Todos" || p.status === statusFilter;
    return matchSearch && matchOrigin && matchStatus;
  });

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="CRM — Pacientes" />
      <main className="flex-1 flex overflow-hidden">
        {/* Patient List */}
        <div className={`flex flex-col border-r border-border bg-card ${selectedPatient ? "w-[55%]" : "flex-1"}`}>
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por nome, telefone ou e-mail..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-9 pl-9 pr-4 rounded-lg bg-muted border-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5">
              <UserPlus className="h-4 w-4" />
              Novo
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 overflow-x-auto">
            <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-1">
              {origins.map((o) => (
                <button
                  key={o}
                  onClick={() => setOriginFilter(o)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                    originFilter === o
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
            <div className="h-4 w-px bg-border mx-1" />
            <div className="flex items-center gap-1">
              {statuses.map((s) => {
                const label = s === "Todos" ? "Todos" : statusLabels[s as Patient["status"]].label;
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                      statusFilter === s
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Count */}
          <div className="px-4 py-2 text-xs text-muted-foreground">
            {filtered.length} paciente{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Paciente</th>
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Origem</th>
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Faturamento</th>
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Última Visita</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient) => (
                  <tr
                    key={patient.id}
                    onClick={() => setSelectedPatient(patient)}
                    className={`border-b border-border/50 cursor-pointer transition-colors ${
                      selectedPatient?.id === patient.id ? "bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`h-9 w-9 rounded-full ${patient.avatarColor} flex items-center justify-center text-xs font-bold text-primary-foreground`}>
                          {patient.initials}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{patient.name}</p>
                          <p className="text-[11px] text-muted-foreground">{patient.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">{patient.origin}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusLabels[patient.status].className}`}>
                        {statusLabels[patient.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-foreground">
                        R$ {patient.totalSpent.toLocaleString("pt-BR")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">
                        {patient.lastVisit
                          ? patient.lastVisit.toLocaleDateString("pt-BR")
                          : "—"}
                      </span>
                    </td>
                    <td className="px-2">
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Patient Detail */}
        {selectedPatient && (
          <PatientDetail patient={selectedPatient} onClose={() => setSelectedPatient(null)} />
        )}
      </main>
    </div>
  );
}

function PatientDetail({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  return (
    <div className="w-[45%] flex flex-col bg-background overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className={`h-14 w-14 rounded-full ${patient.avatarColor} flex items-center justify-center text-lg font-bold text-primary-foreground`}>
              {patient.initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">{patient.name}</h2>
                {patient.pacienteId && (
                  <Link to="/pacientes" search={{ pacienteId: patient.pacienteId }} className="p-1 rounded-lg hover:bg-primary/10" title="Ver ficha completa">
                    <ExternalLink className="h-4 w-4 text-primary" />
                  </Link>
                )}
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusLabels[patient.status].className}`}>
                {statusLabels[patient.status].label}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted text-muted-foreground">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2">
          <button className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Phone className="h-4 w-4" /> Ligar
          </button>
          <button className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
            <Mail className="h-4 w-4" /> E-mail
          </button>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-2 gap-3">
          <InfoCard icon={Phone} label="Telefone" value={patient.phone} />
          <InfoCard icon={Mail} label="E-mail" value={patient.email} />
          <InfoCard icon={Calendar} label="Cadastro" value={patient.createdAt.toLocaleDateString("pt-BR")} />
          <InfoCard icon={DollarSign} label="Faturamento" value={`R$ ${patient.totalSpent.toLocaleString("pt-BR")}`} />
        </div>

        {/* Origin */}
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Origem do Lead</p>
          <p className="text-sm font-semibold text-foreground">{patient.origin}</p>
        </div>

        {/* Timeline placeholder */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Histórico</h3>
          <div className="space-y-3">
            {[
              { action: "Consulta de avaliação", date: "Há 7 dias", type: "visit" },
              { action: "Orçamento enviado — Implante", date: "Há 7 dias", type: "budget" },
              { action: "Mensagem enviada via WhatsApp", date: "Há 5 dias", type: "message" },
              { action: "Lead cadastrado via " + patient.origin, date: patient.createdAt.toLocaleDateString("pt-BR"), type: "lead" },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-primary/40 shrink-0" />
                <div>
                  <p className="text-sm text-foreground">{item.action}</p>
                  <p className="text-[11px] text-muted-foreground">{item.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-sm font-medium text-foreground truncate">{value}</p>
    </div>
  );
}
