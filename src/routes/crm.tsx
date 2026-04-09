import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { mockPatients, type Patient, mockKanbanLeads, kanbanStages, type KanbanStage, type KanbanLead } from "@/data/crmMockData";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Search, Plus, Filter, Phone, Mail, Calendar, DollarSign,
  ChevronRight, MoreHorizontal, UserPlus, ExternalLink,
  Clock, MessageSquare, GripVertical, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { whatsappApi } from "@/lib/vpsApi";
import { LeadAvatar } from "@/components/LeadAvatar";

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

function SyncAvatarsButton() {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    toast.info("Sincronizando fotos de perfil do WhatsApp...");
    try {
      const { data, error } = await whatsappApi.syncProfilePictures("default");
      if (error) {
        toast.error("Erro ao sincronizar: " + error);
      } else if (data) {
        toast.success(`Fotos atualizadas: ${data.updated} de ${data.total} leads`);
      }
    } catch {
      toast.error("Erro de conexão ao sincronizar fotos");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className="h-9 px-3 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50"
      title="Sincronizar fotos do WhatsApp"
    >
      <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">{syncing ? "Sincronizando..." : "Sync Fotos"}</span>
    </button>
  );
}

function CrmPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="CRM — Pacientes & Funil" />
      <Tabs defaultValue="tabela" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-3 border-b border-border bg-card">
          <TabsList>
            <TabsTrigger value="tabela">Lista de Pacientes</TabsTrigger>
            <TabsTrigger value="kanban">Funil de Vendas</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="tabela" className="flex-1 flex overflow-hidden mt-0">
          <PatientTableView />
        </TabsContent>
        <TabsContent value="kanban" className="flex-1 flex flex-col overflow-hidden mt-0">
          <KanbanView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Patient Table View ──────────────────────────── */

function PatientTableView() {
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
    <main className="flex-1 flex overflow-hidden">
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
          <SyncAvatarsButton />
          <button className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5">
            <UserPlus className="h-4 w-4" /> Novo
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
                  originFilter === o ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >{o}</button>
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
                    statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >{label}</button>
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
                  <td className="px-4 py-3"><span className="text-xs text-muted-foreground">{patient.origin}</span></td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusLabels[patient.status].className}`}>
                      {statusLabels[patient.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3"><span className="text-sm font-medium text-foreground">R$ {patient.totalSpent.toLocaleString("pt-BR")}</span></td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">
                      {patient.lastVisit ? patient.lastVisit.toLocaleDateString("pt-BR") : "—"}
                    </span>
                  </td>
                  <td className="px-2"><ChevronRight className="h-4 w-4 text-muted-foreground/40" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPatient && (
        <PatientDetail patient={selectedPatient} onClose={() => setSelectedPatient(null)} />
      )}
    </main>
  );
}

/* ── Kanban View (merged from /funil) ────────────── */

function KanbanView() {
  const [leads, setLeads] = useState(mockKanbanLeads);
  const [draggedLead, setDraggedLead] = useState<{ lead: KanbanLead; fromStage: KanbanStage } | null>(null);
  const [assignedFilter, setAssignedFilter] = useState("Todos");

  const allLeadsList = Object.values(leads).flat();
  const assignees = ["Todos", ...Array.from(new Set(allLeadsList.map((l) => l.assignedTo)))];

  const handleDragStart = (lead: KanbanLead, fromStage: KanbanStage) => {
    setDraggedLead({ lead, fromStage });
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleDrop = (toStage: KanbanStage) => {
    if (!draggedLead || draggedLead.fromStage === toStage) return;
    setLeads((prev) => {
      const updated = { ...prev };
      updated[draggedLead.fromStage] = prev[draggedLead.fromStage].filter((l) => l.id !== draggedLead.lead.id);
      updated[toStage] = [...prev[toStage], draggedLead.lead];
      return updated;
    });
    setDraggedLead(null);
  };

  // Apply filter
  const filteredLeads: typeof leads = assignedFilter === "Todos"
    ? leads
    : Object.fromEntries(
        Object.entries(leads).map(([stage, list]) => [stage, list.filter((l) => l.assignedTo === assignedFilter)])
      ) as typeof leads;

  const visibleList = Object.values(filteredLeads).flat();
  const totalValue = visibleList.reduce((sum, l) => sum + l.value, 0);

  return (
    <>
      {/* Summary bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card flex-wrap gap-3">
        <div className="flex items-center gap-6">
          <div>
            <span className="text-xs text-muted-foreground">Total no funil</span>
            <p className="text-lg font-bold text-foreground">{visibleList.length} leads</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Valor total</span>
            <p className="text-lg font-bold text-foreground">R$ {totalValue.toLocaleString("pt-BR")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-1">
              {assignees.map((a) => (
                <button
                  key={a}
                  onClick={() => setAssignedFilter(a)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                    assignedFilter === a ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >{a}</button>
              ))}
            </div>
          </div>
          <button className="flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" /> Novo Lead
          </button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 flex gap-3 p-4 overflow-x-auto">
        {kanbanStages.map((stage) => {
          const stageLeads = filteredLeads[stage.id];
          const stageValue = stageLeads.reduce((sum, l) => sum + l.value, 0);
          return (
            <div
              key={stage.id}
              className="flex flex-col w-[280px] shrink-0 bg-muted/30 rounded-xl"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(stage.id)}
            >
              <div className="flex items-center gap-2 px-3 py-3 border-b border-border/50">
                <div className={`h-2.5 w-2.5 rounded-full ${stage.color}`} />
                <span className="text-sm font-semibold text-foreground flex-1">{stage.label}</span>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{stageLeads.length}</span>
              </div>
              {stageValue > 0 && (
                <div className="px-3 py-1.5">
                  <span className="text-[11px] text-muted-foreground">R$ {stageValue.toLocaleString("pt-BR")}</span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                {stageLeads.map((lead) => (
                  <KanbanCard key={lead.id} lead={lead} onDragStart={() => handleDragStart(lead, stage.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function KanbanCard({ lead, onDragStart }: { lead: KanbanLead; onDragStart: () => void }) {
  const navigate = useNavigate();
  const daysAgo = Math.floor((Date.now() - lead.lastContact.getTime()) / 86400000);
  const isStale = daysAgo > 3;

  const handleOpenChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate({ to: "/chat", search: { lead: lead.name } });
  };

  const handleCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanPhone = lead.phone.replace(/\D/g, "");
    const phoneWithPlus = cleanPhone.startsWith("55") ? `+${cleanPhone}` : `+55${cleanPhone}`;
    window.location.href = `tel:${phoneWithPlus}`;
    toast.success(`Ligando para ${lead.name}...`, { description: lead.phone });
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`bg-card rounded-lg border p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
        isStale ? "border-warning/50" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`h-8 w-8 rounded-full ${lead.avatarColor} flex items-center justify-center text-[10px] font-bold text-primary-foreground`}>
            {lead.initials}
          </div>
          <div>
            <p className="text-sm font-medium text-card-foreground leading-tight">{lead.name}</p>
            <p className="text-[11px] text-muted-foreground">{lead.origin}</p>
          </div>
        </div>
        <button className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-sm font-semibold text-primary mb-2">R$ {lead.value.toLocaleString("pt-BR")}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center text-[8px] font-bold text-primary">
            {lead.assignedInitials}
          </div>
          <span className="text-[11px] text-muted-foreground">{lead.assignedTo}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCall} className="p-1.5 rounded-lg hover:bg-chart-2/15 text-muted-foreground hover:text-chart-2 transition-colors" title={`Ligar: ${lead.phone}`}>
            <Phone className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleOpenChat} className="p-1.5 rounded-lg hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors" title={`Chat com ${lead.name}`}>
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <div className={`flex items-center gap-0.5 ${isStale ? "text-warning" : "text-muted-foreground/50"}`}>
            <Clock className="h-3 w-3" />
            <span className="text-[10px]">{daysAgo}d</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Patient Detail ──────────────────────────────── */

function PatientDetail({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  return (
    <div className="w-[45%] flex flex-col bg-background overflow-y-auto">
      <div className="p-6 space-y-6">
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

        <div className="flex gap-2">
          <button className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Phone className="h-4 w-4" /> Ligar
          </button>
          <button className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
            <Mail className="h-4 w-4" /> E-mail
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InfoCard icon={Phone} label="Telefone" value={patient.phone} />
          <InfoCard icon={Mail} label="E-mail" value={patient.email} />
          <InfoCard icon={Calendar} label="Cadastro" value={patient.createdAt.toLocaleDateString("pt-BR")} />
          <InfoCard icon={DollarSign} label="Faturamento" value={`R$ ${patient.totalSpent.toLocaleString("pt-BR")}`} />
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Origem do Lead</p>
          <p className="text-sm font-semibold text-foreground">{patient.origin}</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Histórico</h3>
          <div className="space-y-3">
            {[
              { action: "Consulta de avaliação", date: "Há 7 dias" },
              { action: "Orçamento enviado — Implante", date: "Há 7 dias" },
              { action: "Mensagem enviada via WhatsApp", date: "Há 5 dias" },
              { action: `Lead cadastrado via ${patient.origin}`, date: patient.createdAt.toLocaleDateString("pt-BR") },
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
