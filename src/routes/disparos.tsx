import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Send, Play, Pause, Plus, Eye, Clock,
  CalendarDays, Users, CheckCircle2, AlertCircle, Trash2,
  MessageSquare, RefreshCcw, Copy, Pencil, BarChart3, Loader2,
  Rocket, X,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { publicoOptions, type DisparoProgramado } from "@/data/disparosMockData";
import { NovoDisparoWizard } from "@/components/disparos/NovoDisparoWizard";
import { DisparoStatsPanel } from "@/components/disparos/DisparoStatsPanel";
import { campaignsApi } from "@/lib/vpsApi";
import { toast } from "sonner";

export const Route = createFileRoute("/disparos")({
  ssr: false,
  component: DisparosPage,
});

function DisparosPage() {
  const [disparos, setDisparos] = useState<DisparoProgramado[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingDisparo, setEditingDisparo] = useState<DisparoProgramado | null>(null);
  const [statsDisparo, setStatsDisparo] = useState<DisparoProgramado | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "ativos" | "inativos">("all");
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [jobsPanel, setJobsPanel] = useState<{ id: string; nome: string } | null>(null);

  const loadCampaigns = useCallback(async () => {
    const { data, error } = await campaignsApi.list();
    if (error) {
      toast.error("Erro ao carregar disparos: " + error);
    } else if (data) {
      setDisparos(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const filtered = filterStatus === "all" ? disparos : disparos.filter((d) => (filterStatus === "ativos" ? d.ativo : !d.ativo));

  const toggleAtivo = async (id: string) => {
    const { data, error } = await campaignsApi.toggle(id);
    if (error) { toast.error(error); return; }
    setDisparos((prev) => prev.map((d) => (d.id === id ? { ...d, ativo: data?.ativo ?? !d.ativo } : d)));
  };

  const removeDisparo = async (id: string) => {
    const { error } = await campaignsApi.remove(id);
    if (error) { toast.error(error); return; }
    setDisparos((prev) => prev.filter((d) => d.id !== id));
    toast.success("Disparo removido");
  };

  const handleSave = async (data: Omit<DisparoProgramado, "id" | "stats" | "criadoEm">) => {
    if (editingDisparo) {
      const { error } = await campaignsApi.update(editingDisparo.id, data);
      if (error) { toast.error(error); return; }
      toast.success("Disparo atualizado");
    } else {
      const { error } = await campaignsApi.create(data);
      if (error) { toast.error(error); return; }
      toast.success("Disparo criado");
    }
    setEditingDisparo(null);
    loadCampaigns();
  };

  const handleEdit = (disparo: DisparoProgramado) => {
    setEditingDisparo(disparo);
    setWizardOpen(true);
  };

  const handleDuplicate = async (disparo: DisparoProgramado) => {
    const { error } = await campaignsApi.duplicate(disparo.id);
    if (error) { toast.error(error); return; }
    toast.success("Disparo duplicado");
    loadCampaigns();
  };

  const handleExecute = async (disparo: DisparoProgramado) => {
    setExecutingId(disparo.id);
    const { data, error } = await campaignsApi.execute(disparo.id);
    setExecutingId(null);
    if (error) { toast.error("Erro ao executar: " + error); return; }
    if (data) {
      toast.success(`${data.enqueued} mensagens enfileiradas (${data.skipped} ignoradas pelo filtro anti-spam)`);
      loadCampaigns();
    }
  };

  const openNewWizard = () => {
    setEditingDisparo(null);
    setWizardOpen(true);
  };

  const totalEnviadas = disparos.reduce((a, d) => a + d.stats.enviadas, 0);
  const totalEntregues = disparos.reduce((a, d) => a + d.stats.entregues, 0);
  const totalRespondidas = disparos.reduce((a, d) => a + d.stats.respondidas, 0);
  const taxaEntrega = totalEnviadas > 0 ? ((totalEntregues / totalEnviadas) * 100).toFixed(1) : "0";

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Disparos Programados" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MiniKpi icon={Send} label="Total Enviadas" value={totalEnviadas.toString()} />
          <MiniKpi icon={CheckCircle2} label="Taxa de Entrega" value={`${taxaEntrega}%`} />
          <MiniKpi icon={MessageSquare} label="Respondidas" value={totalRespondidas.toString()} />
          <MiniKpi icon={RefreshCcw} label="Disparos Ativos" value={disparos.filter((d) => d.ativo).length.toString()} />
        </div>

        {/* Header + controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Disparos Programados</h2>
            <p className="text-sm text-muted-foreground">Configure mensagens automáticas em massa via WhatsApp</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-sm">
              {(["all", "ativos", "inativos"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    filterStatus === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "all" ? "Todos" : f === "ativos" ? "Ativos" : "Inativos"}
                </button>
              ))}
            </div>
            <button
              onClick={openNewWizard}
              className="flex items-center gap-2 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Novo disparo
            </button>
          </div>
        </div>

        {/* Spam control info */}
        <div className="bg-muted/50 rounded-xl border border-border p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-foreground">Controle de Spam Ativado</p>
            <p className="text-[11px] text-muted-foreground">
              Cada disparo respeita o intervalo configurado entre campanhas para o mesmo contato. Isso protege seu número e aumenta o impacto das mensagens.
            </p>
          </div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">Carregando disparos...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center justify-center text-center">
            <Send className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">Nenhum disparo encontrado</h3>
            <p className="text-xs text-muted-foreground">Crie seu primeiro disparo programado clicando em "Novo disparo".</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((disparo) => (
              <DisparoCard
                key={disparo.id}
                disparo={disparo}
                executing={executingId === disparo.id}
                onToggle={() => toggleAtivo(disparo.id)}
                onRemove={() => removeDisparo(disparo.id)}
                onEdit={() => handleEdit(disparo)}
                onDuplicate={() => handleDuplicate(disparo)}
                onStats={() => setStatsDisparo(disparo)}
                onExecute={() => handleExecute(disparo)}
                onViewJobs={() => setJobsPanel({ id: disparo.id, nome: disparo.nome })}
              />
            ))}
          </div>
        )}
      </main>

      <NovoDisparoWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setEditingDisparo(null); }}
        onSave={handleSave}
        editData={editingDisparo}
      />

      {statsDisparo && (
        <DisparoStatsPanel
          disparo={statsDisparo}
          onClose={() => setStatsDisparo(null)}
        />
      )}

      {jobsPanel && (
        <CampaignJobsPanel
          campaignId={jobsPanel.id}
          campaignName={jobsPanel.nome}
          onClose={() => setJobsPanel(null)}
        />
      )}
    </div>
  );
}

function MiniKpi({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function DisparoCard({
  disparo, executing, onToggle, onRemove, onEdit, onDuplicate, onStats, onExecute, onViewJobs,
}: {
  disparo: DisparoProgramado;
  executing: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onStats: () => void;
  onExecute: () => void;
  onViewJobs: () => void;
}) {
  const publicoLabel = publicoOptions.find((p) => p.id === disparo.publico)?.label || disparo.publico;
  const taxaLeitura = disparo.stats.enviadas > 0 ? ((disparo.stats.lidas / disparo.stats.enviadas) * 100).toFixed(0) : "0";

  return (
    <div className="bg-card rounded-xl border border-border p-5 transition-all hover:shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`h-2 w-2 rounded-full ${disparo.ativo ? "bg-success" : "bg-muted-foreground/40"}`} />
            <h3 className="text-sm font-semibold text-foreground truncate">{disparo.nome}</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
              disparo.tipo === "recorrente" ? "bg-primary/10 text-primary" : "bg-chart-3/15 text-chart-3"
            }`}>
              {disparo.tipo === "recorrente" ? "Recorrente" : "Único"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground mb-3">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {publicoLabel}</span>
            <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {disparo.contatosAlcancaveis} contatos</span>
            {disparo.tipo === "recorrente" && disparo.diasSemana && (
              <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {disparo.diasSemana.join(", ")}</span>
            )}
            {disparo.horarioInicio && (
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {disparo.horarioInicio} — {disparo.horarioFim}</span>
            )}
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <StatPill label="Enviadas" value={disparo.stats.enviadas} />
            <StatPill label="Entregues" value={disparo.stats.entregues} />
            <StatPill label="Lidas" value={disparo.stats.lidas} />
            <StatPill label="Respondidas" value={disparo.stats.respondidas} />
            {disparo.stats.erros > 0 && (
              <span className="text-destructive font-medium">{disparo.stats.erros} erros</span>
            )}
            {disparo.stats.enviadas > 0 && (
              <span className="text-muted-foreground ml-auto">Taxa de leitura: <span className="font-bold text-foreground">{taxaLeitura}%</span></span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onExecute}
            disabled={executing}
            className="p-2 rounded-lg bg-chart-3/15 text-chart-3 hover:bg-chart-3/25 transition-colors disabled:opacity-50"
            title="Executar agora"
          >
            {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          </button>
          <button
            onClick={onViewJobs}
            className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors"
            title="Ver fila de envio"
          >
            <Send className="h-4 w-4" />
          </button>
          <button
            onClick={onStats}
            className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors"
            title="Estatísticas"
          >
            <BarChart3 className="h-4 w-4" />
          </button>
          <button
            onClick={onEdit}
            className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors"
            title="Editar"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onDuplicate}
            className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors"
            title="Duplicar"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={onToggle}
            className={`p-2 rounded-lg transition-colors ${
              disparo.ativo
                ? "bg-success/15 text-success hover:bg-success/25"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title={disparo.ativo ? "Pausar" : "Ativar"}
          >
            {disparo.ativo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={onRemove}
            className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
            title="Remover"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-muted-foreground">
      {label}: <span className="font-semibold text-foreground">{value}</span>
    </span>
  );
}

// ─── Campaign Jobs Panel ────────────────────────────────────

function CampaignJobsPanel({ campaignId, campaignName, onClose }: { campaignId: string; campaignName: string; onClose: () => void }) {
  const [jobs, setJobs] = useState<{ summary: Record<string, number>; recent: Array<{ patient_name: string; patient_phone: string; status: string; sent_at: string; error: string; scheduled_at: string }> } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    const { data } = await campaignsApi.jobs(campaignId);
    if (data) setJobs(data);
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 5000); // auto-refresh every 5s
    return () => clearInterval(interval);
  }, [loadJobs]);

  const statusColors: Record<string, string> = {
    pending: "bg-warning/15 text-warning",
    sent: "bg-success/15 text-success",
    failed: "bg-destructive/15 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };

  const statusLabels: Record<string, string> = {
    pending: "Pendente",
    sent: "Enviado",
    failed: "Falhou",
    cancelled: "Cancelado",
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl border border-border w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Fila de Envio</h3>
            <p className="text-xs text-muted-foreground">{campaignName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
          </div>
        ) : !jobs ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Erro ao carregar fila</div>
        ) : (
          <>
            {/* Summary */}
            <div className="p-4 flex items-center gap-4 border-b border-border">
              {Object.entries(jobs.summary).map(([status, count]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[status] || "bg-muted text-muted-foreground"}`}>
                    {statusLabels[status] || status}
                  </span>
                  <span className="text-sm font-bold text-foreground">{count}</span>
                </div>
              ))}
              {Object.keys(jobs.summary).length === 0 && (
                <span className="text-xs text-muted-foreground">Nenhum envio registrado ainda</span>
              )}
            </div>

            {/* Recent jobs */}
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {jobs.recent.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum job encontrado</p>
              ) : jobs.recent.map((job, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-muted/50">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{job.patient_name || job.patient_phone}</p>
                    <p className="text-[10px] text-muted-foreground">{job.patient_phone}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {job.error && (
                      <span className="text-[10px] text-destructive max-w-[120px] truncate" title={job.error}>{job.error}</span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[job.status] || "bg-muted text-muted-foreground"}`}>
                      {statusLabels[job.status] || job.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {job.sent_at ? new Date(job.sent_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
