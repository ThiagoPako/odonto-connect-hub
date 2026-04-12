import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  type Patient, type KanbanLead,
  type SalesStage, type RecoveryStage,
  salesStages, recoveryStages,
  consciousnessLevels, type ConsciousnessLevel,
} from "@/data/crmMockData";
import { crmApi, sessionsApi } from "@/lib/vpsApi";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Search, Plus, Filter, Phone, Mail, Calendar, DollarSign,
  ChevronRight, MoreHorizontal, UserPlus, ExternalLink,
  Clock, MessageSquare, GripVertical, RefreshCw, RotateCcw,
  TrendingUp, Target, Loader2,
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
      if (error) toast.error("Erro ao sincronizar: " + error);
      else if (data) toast.success(`Fotos atualizadas: ${data.updated} de ${data.total} leads`);
    } catch { toast.error("Erro de conexão ao sincronizar fotos"); }
    finally { setSyncing(false); }
  };
  return (
    <button onClick={handleSync} disabled={syncing}
      className="h-9 px-3 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50"
      title="Sincronizar fotos do WhatsApp">
      <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">{syncing ? "Sincronizando..." : "Sync Fotos"}</span>
    </button>
  );
}

function CrmPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="CRM — Pacientes & Funil" />
      <Tabs defaultValue="kanban_vendas" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-3 border-b border-border bg-card">
          <TabsList>
            <TabsTrigger value="kanban_vendas" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Funil de Vendas
            </TabsTrigger>
            <TabsTrigger value="kanban_recuperacao" className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Recuperação
            </TabsTrigger>
            <TabsTrigger value="tabela">Lista de Pacientes</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="kanban_vendas" className="flex-1 flex flex-col overflow-hidden mt-0">
          <SalesKanbanView />
        </TabsContent>
        <TabsContent value="kanban_recuperacao" className="flex-1 flex flex-col overflow-hidden mt-0">
          <RecoveryKanbanView />
        </TabsContent>
        <TabsContent value="tabela" className="flex-1 flex overflow-hidden mt-0">
          <PatientTableView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Generic Kanban Board ────────────────────────── */

function GenericKanbanBoard<T extends string>({
  stages,
  leads,
  setLeads,
  title,
}: {
  stages: { id: T; label: string; color: string; description: string }[];
  leads: Record<T, KanbanLead[]>;
  setLeads: React.Dispatch<React.SetStateAction<Record<T, KanbanLead[]>>>;
  title: string;
}) {
  const [draggedLead, setDraggedLead] = useState<{ lead: KanbanLead; fromStage: T } | null>(null);
  const [assignedFilter, setAssignedFilter] = useState("Todos");

  const allLeadsList = Object.values(leads).flat() as KanbanLead[];
  const assignees = ["Todos", ...Array.from(new Set(allLeadsList.map((l) => l.assignedTo)))];

  const handleDragStart = (lead: KanbanLead, fromStage: T) => setDraggedLead({ lead, fromStage });
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = (toStage: T) => {
    if (!draggedLead || draggedLead.fromStage === toStage) return;
    const movedLead = draggedLead.lead;
    const fromStage = draggedLead.fromStage;
    setLeads((prev) => {
      const updated = { ...prev };
      updated[fromStage] = prev[fromStage].filter((l) => l.id !== movedLead.id);
      updated[toStage] = [...prev[toStage], movedLead];
      return updated;
    });
    setDraggedLead(null);

    // Persist to API
    crmApi.updateStage(movedLead.id, toStage as string).then(({ error }) => {
      if (error) {
        toast.error("Erro ao mover lead: " + error);
        // Rollback
        setLeads((prev) => {
          const updated = { ...prev };
          updated[toStage] = prev[toStage].filter((l) => l.id !== movedLead.id);
          updated[fromStage] = [...prev[fromStage], movedLead];
          return updated;
        });
      } else {
        toast.success(`${movedLead.name} movido para ${stages.find(s => s.id === toStage)?.label || toStage}`);
      }
    });
  };

  const filteredLeads = assignedFilter === "Todos"
    ? leads
    : Object.fromEntries(
        Object.entries(leads).map(([stage, list]) => [stage, (list as KanbanLead[]).filter((l) => l.assignedTo === assignedFilter)])
      ) as Record<T, KanbanLead[]>;

  const visibleList = (Object.values(filteredLeads) as KanbanLead[][]).flat();
  const totalValue = visibleList.reduce((sum, l) => sum + l.value, 0);

  return (
    <>
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
                <button key={a} onClick={() => setAssignedFilter(a)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                    assignedFilter === a ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}>{a}</button>
              ))}
            </div>
          </div>
          <button className="flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" /> Novo Lead
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-3 p-4 overflow-x-auto">
        {stages.map((stage) => {
          const stageLeads = filteredLeads[stage.id] || [];
          const stageValue = stageLeads.reduce((sum, l) => sum + l.value, 0);
          return (
            <div key={stage.id} className="flex flex-col w-[280px] shrink-0 bg-muted/30 rounded-xl"
              onDragOver={handleDragOver} onDrop={() => handleDrop(stage.id)}>
              <div className="flex items-center gap-2 px-3 py-3 border-b border-border/50">
                <div className={`h-2.5 w-2.5 rounded-full ${stage.color}`} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-foreground">{stage.label}</span>
                  <p className="text-[9px] text-muted-foreground truncate">{stage.description}</p>
                </div>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{stageLeads.length}</span>
              </div>
              {stageValue > 0 && (
                <div className="px-3 py-1.5">
                  <span className="text-[11px] text-muted-foreground">R$ {stageValue.toLocaleString("pt-BR")}</span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                {stageLeads.map((lead) => (
                  <KanbanCard
                    key={lead.id}
                    lead={lead}
                    onDragStart={() => handleDragStart(lead, stage.id)}
                    onLeadAssigned={(leadId, userName, userInitials, avatarUrl) => {
                      // Move lead to em_atendimento and update assigned info
                      setLeads((prev) => {
                        const updated = { ...prev };
                        // Remove from current stage
                        for (const key of Object.keys(updated) as T[]) {
                          updated[key] = updated[key].filter((l) => l.id !== leadId);
                        }
                        // Add to em_atendimento with updated info
                        const targetStage = ("em_atendimento" in updated ? "em_atendimento" : stage.id) as T;
                        const updatedLead = { ...lead, assignedTo: userName, assignedInitials: userInitials, assignedAvatarUrl: avatarUrl };
                        updated[targetStage] = [...(updated[targetStage] || []), updatedLead];
                        return updated;
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Sales Kanban ────────────────────────────────── */

function normalizeLead(raw: any): KanbanLead {
  return {
    ...raw,
    lastContact: raw.lastContact instanceof Date ? raw.lastContact : new Date(raw.lastContact),
    value: raw.value ?? 0,
    assignedAvatarUrl: raw.assignedAvatarUrl ?? raw.assigned_avatar_url ?? null,
  };
}

function SalesKanbanView() {
  const emptyStages: Record<SalesStage, KanbanLead[]> = {
    lead: [], em_atendimento: [], orcamento: [], orcamento_enviado: [], orcamento_aprovado: [],
  };
  const [leads, setLeads] = useState<Record<SalesStage, KanbanLead[]>>(emptyStages);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    crmApi.kanban().then(({ data }) => {
      if (data && typeof data === 'object') {
        const raw = data as Record<string, any[]>;
        const result = { ...emptyStages };
        for (const key of Object.keys(result) as SalesStage[]) {
          if (Array.isArray(raw[key])) {
            result[key] = raw[key].map(normalizeLead);
          }
        }
        setLeads(result);
      }
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  return <GenericKanbanBoard stages={salesStages} leads={leads} setLeads={setLeads} title="Funil de Vendas" />;
}

/* ── Recovery Kanban ─────────────────────────────── */

function RecoveryKanbanView() {
  const emptyStages: Record<RecoveryStage, KanbanLead[]> = {
    followup: [], followup_2: [], followup_3: [], sem_resposta: [], orcamento_reprovado: [], desqualificado: [],
  };
  const [leads, setLeads] = useState<Record<RecoveryStage, KanbanLead[]>>(emptyStages);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    crmApi.kanban().then(({ data }) => {
      if (data && typeof data === 'object') {
        const raw = data as Record<string, any[]>;
        const result = { ...emptyStages };
        for (const key of Object.keys(result) as RecoveryStage[]) {
          if (Array.isArray(raw[key])) {
            result[key] = raw[key].map(normalizeLead);
          }
        }
        setLeads(result);
      }
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  return <GenericKanbanBoard stages={recoveryStages} leads={leads} setLeads={setLeads} title="Recuperação de Vendas" />;
}

/* ── Kanban Card ─────────────────────────────────── */

function KanbanCard({ lead, onDragStart, onLeadAssigned }: { lead: KanbanLead; onDragStart: () => void; onLeadAssigned?: (leadId: string, userName: string, userInitials: string, avatarUrl?: string | null) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showLevelMenu, setShowLevelMenu] = useState(false);
  const [currentLevel, setCurrentLevel] = useState<ConsciousnessLevel | undefined>(lead.consciousnessLevel);
  const [assuming, setAssuming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const lastContactDate = lead.lastContact instanceof Date ? lead.lastContact : new Date(lead.lastContact);
  const daysAgo = Math.floor((Date.now() - lastContactDate.getTime()) / 86400000);
  const isStale = daysAgo > 3;

  const handleOpenChat = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    setAssuming(true);
    try {
      // 1. Assign attendance session
      await sessionsApi.assign({ leadId: lead.id });
      // 2. Move to "em_atendimento" stage
      await crmApi.updateStage(lead.id, "em_atendimento", "Assumiu atendimento via Kanban");
      // 3. Assign lead to current user
      const userInitials = user.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
      await crmApi.assign(lead.id, user.id, user.name);
      // Notify parent to update the kanban state
      onLeadAssigned?.(lead.id, user.name, userInitials, user.avatar_url);
      toast.success(`Atendimento de ${lead.name} iniciado`);
    } catch {
      toast.error("Erro ao assumir atendimento");
    } finally {
      setAssuming(false);
    }
    // Navigate to chat
    navigate({ to: "/chat", search: { lead: lead.name } });
  };

  const handleCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanPhone = lead.phone.replace(/\D/g, "");
    const phoneWithPlus = cleanPhone.startsWith("55") ? `+${cleanPhone}` : `+55${cleanPhone}`;
    window.location.href = `tel:${phoneWithPlus}`;
    toast.success(`Ligando para ${lead.name}...`, { description: lead.phone });
  };

  const handleSetLevel = (levelId: ConsciousnessLevel) => {
    setCurrentLevel(levelId);
    setShowLevelMenu(false);
    crmApi.updateConsciousness(lead.id, levelId).then(({ error }) => {
      if (error) {
        toast.error("Erro ao atualizar nível: " + error);
        setCurrentLevel(lead.consciousnessLevel);
      }
    });
  };

  // Close menu on outside click
  useEffect(() => {
    if (!showLevelMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowLevelMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLevelMenu]);

  const level = currentLevel ? consciousnessLevels.find((l) => l.id === currentLevel) : null;

  return (
    <div draggable onDragStart={onDragStart}
      className={`bg-card rounded-lg border p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
        isStale ? "border-warning/50" : "border-border"
      }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <LeadAvatar initials={lead.initials} avatarUrl={lead.avatarUrl} avatarColor={lead.avatarColor} size="sm" />
          <div>
            <p className="text-sm font-medium text-card-foreground leading-tight">{lead.name}</p>
            <p className="text-[11px] text-muted-foreground">{lead.origin}</p>
          </div>
        </div>
        <button className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Nível de Consciência — clickable */}
      <div className="relative mb-2" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setShowLevelMenu(!showLevelMenu); }}
          className={`flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
            level ? "" : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          style={level ? { backgroundColor: `${level.color}15`, color: level.color } : undefined}
        >
          <Target className="h-3 w-3" />
          <span>{level ? `${level.icon} ${level.label}` : "Definir nível"}</span>
        </button>
        {showLevelMenu && (
          <div className="absolute z-50 top-full left-0 mt-1 bg-popover border border-border rounded-lg shadow-lg py-1 w-48">
            {consciousnessLevels.map((cl) => (
              <button key={cl.id} onClick={(e) => { e.stopPropagation(); handleSetLevel(cl.id); }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-[11px] hover:bg-muted transition-colors text-left ${
                  currentLevel === cl.id ? "bg-muted font-semibold" : ""
                }`}>
                <span>{cl.icon}</span>
                <span style={{ color: cl.color }}>{cl.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-sm font-semibold text-primary mb-2">R$ {lead.value.toLocaleString("pt-BR")}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {lead.assignedAvatarUrl ? (
            <img src={lead.assignedAvatarUrl} alt={lead.assignedTo} className="h-5 w-5 rounded-full object-cover" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center text-[8px] font-bold text-primary">
              {lead.assignedInitials}
            </div>
          )}
          <span className="text-[11px] text-muted-foreground">{lead.assignedTo}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCall} className="p-1.5 rounded-lg hover:bg-chart-2/15 text-muted-foreground hover:text-chart-2 transition-colors" title={`Ligar: ${lead.phone}`}>
            <Phone className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleOpenChat} disabled={assuming} className="p-1.5 rounded-lg hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50" title={assuming ? "Assumindo..." : `Assumir e atender ${lead.name}`}>
            {assuming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
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

/* ── Patient Table View ──────────────────────────── */

const PAGE_SIZE = 25;

function PatientTableView() {
  const [searchTerm, setSearchTerm] = useState("");
  const [originFilter, setOriginFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        limit: String(PAGE_SIZE),
        offset: String((safePage - 1) * PAGE_SIZE),
      };
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (statusFilter !== "Todos") params.status = statusFilter;
      if (originFilter !== "Todos") params.origin = originFilter;
      const { data } = await crmApi.list(params);
      if (data && data.rows && Array.isArray(data.rows)) {
        setTotal(data.total);
        setPatients(data.rows.map((r: any) => ({
          id: r.id,
          name: r.nome,
          initials: (r.nome || '').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
          phone: r.telefone || '',
          email: r.email || '',
          origin: r.origem || 'WhatsApp',
          status: r.status === 'em_contato' ? 'ativo' : (r.status === 'novo' ? 'lead' : r.status) as Patient["status"],
          lastVisit: r.updated_at ? new Date(r.updated_at) : undefined,
          createdAt: new Date(r.created_at),
          totalSpent: 0,
          avatarColor: 'bg-chart-1',
          avatarUrl: r.avatar_url,
        })));
      }
    } catch (err) {
      console.error("Erro ao carregar pacientes:", err);
      toast.error("Erro ao carregar lista de pacientes");
    } finally {
      setLoading(false);
    }
  }, [searchTerm, statusFilter, originFilter, safePage]);

  useEffect(() => {
    const timer = setTimeout(() => void loadPatients(), 300);
    return () => clearTimeout(timer);
  }, [loadPatients]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [searchTerm, originFilter, statusFilter]);

  const filtered = patients.filter((p) => {
    const matchOrigin = originFilter === "Todos" || p.origin === originFilter;
    return matchOrigin;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <main className="flex-1 flex overflow-hidden">
      <div className={`flex flex-col border-r border-border bg-card ${selectedPatient ? "w-[55%]" : "flex-1"}`}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input type="text" placeholder="Buscar por nome, telefone ou e-mail..." value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg bg-muted border-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <SyncAvatarsButton />
          <button className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5">
            <UserPlus className="h-4 w-4" /> Novo
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 overflow-x-auto">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-1">
            {origins.map((o) => (
              <button key={o} onClick={() => setOriginFilter(o)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                  originFilter === o ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}>{o}</button>
            ))}
          </div>
          <div className="h-4 w-px bg-border mx-1" />
          <div className="flex items-center gap-1">
            {statuses.map((s) => {
              const label = s === "Todos" ? "Todos" : statusLabels[s as Patient["status"]].label;
              return (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                    statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}>{label}</button>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-2 text-xs text-muted-foreground flex items-center justify-between">
          <span>{filtered.length} paciente{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}</span>
          {totalPages > 1 && (
            <span>Página {safePage} de {totalPages}</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Carregando pacientes...</span>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Nenhum paciente encontrado
            </div>
          )}
          {!loading && paginated.length > 0 && (
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
              {paginated.map((patient) => (
                <tr key={patient.id} onClick={() => setSelectedPatient(patient)}
                  className={`border-b border-border/50 cursor-pointer transition-colors ${
                    selectedPatient?.id === patient.id ? "bg-primary/5" : "hover:bg-muted/50"
                  }`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <LeadAvatar initials={patient.initials} avatarUrl={patient.avatarUrl} avatarColor={patient.avatarColor} size="sm" />
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
          )}
        </div>

        {/* Pagination controls */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-card">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Anterior
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (safePage <= 4) {
                  pageNum = i + 1;
                } else if (safePage >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = safePage - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`min-w-[28px] h-7 rounded text-xs font-medium transition-colors ${
                      pageNum === safePage
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Próxima →
            </button>
          </div>
        )}
      </div>

      {selectedPatient && (
        <PatientDetail patient={selectedPatient} onClose={() => setSelectedPatient(null)} />
      )}
    </main>
  );
}

/* ── Patient Detail ──────────────────────────────── */

function PatientDetail({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  return (
    <div className="w-[45%] flex flex-col bg-background overflow-y-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <LeadAvatar initials={patient.initials} avatarUrl={patient.avatarUrl} avatarColor={patient.avatarColor} size="lg" />
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
