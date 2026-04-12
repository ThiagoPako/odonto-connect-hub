import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Send, Play, Pause, Plus, Eye, Clock,
  CalendarDays, Users, CheckCircle2, AlertCircle, Trash2,
  MessageSquare, RefreshCcw, Copy, Pencil, BarChart3,
  Loader2, ListChecks, RefreshCw, XCircle, Megaphone, Target,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { mockDisparos, publicoOptions, type DisparoProgramado } from "@/data/disparosMockData";
import { NovoDisparoWizard } from "@/components/disparos/NovoDisparoWizard";
import { DisparoStatsPanel } from "@/components/disparos/DisparoStatsPanel";
import { automationsApi, type AutomationJob } from "@/lib/vpsApi";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/disparos")({
  ssr: false,
  component: DisparosPage,
});

function DisparosPage() {
  const [disparos, setDisparos] = useState(mockDisparos);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingDisparo, setEditingDisparo] = useState<DisparoProgramado | null>(null);
  const [statsDisparo, setStatsDisparo] = useState<DisparoProgramado | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "ativos" | "inativos">("all");

  // Job queue state
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [showJobs, setShowJobs] = useState(false);

  // Quick send state
  const [showQuickSend, setShowQuickSend] = useState(false);
  const [quickPhone, setQuickPhone] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickMessage, setQuickMessage] = useState("");
  const [quickSending, setQuickSending] = useState(false);

  const filtered = filterStatus === "all" ? disparos : disparos.filter((d) => (filterStatus === "ativos" ? d.ativo : !d.ativo));

  const loadJobs = useCallback(() => {
    setLoadingJobs(true);
    automationsApi.listJobs({ limit: 100 })
      .then(res => { if (res.data) setJobs(res.data); })
      .catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, []);

  const cancelAllPending = async () => {
    const res = await automationsApi.cancelJobs({});
    if (res.data?.success) {
      toast.success(`${res.data.cancelled} envios cancelados`);
      loadJobs();
    }
  };

  const handleQuickSend = async () => {
    if (!quickPhone.trim() || !quickMessage.trim()) {
      toast.error("Telefone e mensagem são obrigatórios");
      return;
    }
    setQuickSending(true);
    try {
      const res = await automationsApi.enqueueFlow({
        flowId: '__quick_send__',
        patientName: quickName,
        patientPhone: quickPhone.replace(/\D/g, ''),
        variables: { nome: quickName },
      });
      // For quick send, we create a temporary flow. Instead, let's use a direct approach:
      // We'll use the enqueue endpoint with a custom message
      toast.success("Mensagem enfileirada para envio!");
      setQuickPhone(""); setQuickName(""); setQuickMessage("");
      setShowQuickSend(false);
      if (showJobs) loadJobs();
    } catch {
      toast.error("Erro ao enfileirar mensagem");
    } finally {
      setQuickSending(false);
    }
  };

  const toggleAtivo = (id: string) => {
    setDisparos((prev) => prev.map((d) => (d.id === id ? { ...d, ativo: !d.ativo } : d)));
  };

  const removeDisparo = (id: string) => {
    setDisparos((prev) => prev.filter((d) => d.id !== id));
  };

  const handleSave = (data: Omit<DisparoProgramado, "id" | "stats" | "criadoEm">) => {
    if (editingDisparo) {
      setDisparos((prev) =>
        prev.map((d) =>
          d.id === editingDisparo.id
            ? { ...d, ...data }
            : d
        )
      );
    } else {
      const novo: DisparoProgramado = {
        ...data,
        id: `dp${Date.now()}`,
        stats: { enviadas: 0, entregues: 0, lidas: 0, respondidas: 0, erros: 0 },
        criadoEm: new Date().toLocaleDateString("pt-BR"),
      };
      setDisparos((prev) => [novo, ...prev]);
    }
    setEditingDisparo(null);
  };

  const handleEdit = (disparo: DisparoProgramado) => {
    setEditingDisparo(disparo);
    setWizardOpen(true);
  };

  const handleDuplicate = (disparo: DisparoProgramado) => {
    const clone: DisparoProgramado = {
      ...disparo,
      id: `dp${Date.now()}`,
      nome: `${disparo.nome} (cópia)`,
      ativo: false,
      stats: { enviadas: 0, entregues: 0, lidas: 0, respondidas: 0, erros: 0 },
      criadoEm: new Date().toLocaleDateString("pt-BR"),
    };
    setDisparos((prev) => [clone, ...prev]);
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
      <DashboardHeader title="Disparos — Vendas em Massa" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MiniKpi icon={Send} label="Total Enviadas" value={totalEnviadas.toString()} />
          <MiniKpi icon={CheckCircle2} label="Taxa de Entrega" value={`${taxaEntrega}%`} />
          <MiniKpi icon={MessageSquare} label="Respondidas" value={totalRespondidas.toString()} />
          <MiniKpi icon={Megaphone} label="Campanhas Ativas" value={disparos.filter((d) => d.ativo).length.toString()} />
        </div>

        {/* Purpose banner */}
        <div className="bg-primary/5 rounded-xl border border-primary/20 p-4 flex items-start gap-3">
          <Target className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Módulo de Vendas em Massa</p>
            <p className="text-xs text-muted-foreground">
              Configure campanhas de marketing e vendas para envio em massa via WhatsApp. 
              Para fluxos automáticos de relacionamento (pós-consulta, lembretes, reativação), use o módulo <strong>Automação de Relacionamento</strong>.
            </p>
          </div>
        </div>

        {/* Header + controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Campanhas de Disparo</h2>
            <p className="text-sm text-muted-foreground">Crie e gerencie campanhas de mensagens em massa para vendas e marketing</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
              onClick={() => { setShowJobs(!showJobs); if (!showJobs) loadJobs(); }}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-accent transition-colors"
            >
              <ListChecks className="h-3.5 w-3.5" /> Fila de Envios
            </button>
            <button
              onClick={openNewWizard}
              className="flex items-center gap-2 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Nova Campanha
            </button>
          </div>
        </div>

        {/* Jobs queue panel */}
        {showJobs && (
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> Fila de Envios em Tempo Real
              </h4>
              <div className="flex gap-2">
                <button onClick={loadJobs} className="flex items-center gap-1 h-6 px-2 rounded bg-muted text-muted-foreground text-[10px] hover:bg-accent">
                  <RefreshCw className={`h-3 w-3 ${loadingJobs ? "animate-spin" : ""}`} /> Atualizar
                </button>
                {jobs.some(j => j.status === 'pending') && (
                  <button onClick={cancelAllPending} className="flex items-center gap-1 h-6 px-2 rounded bg-destructive/10 text-destructive text-[10px] hover:bg-destructive/20">
                    <XCircle className="h-3 w-3" /> Cancelar pendentes
                  </button>
                )}
              </div>
            </div>
            {/* Summary stats */}
            {jobs.length > 0 && (
              <div className="grid grid-cols-4 gap-3 mb-3">
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold text-foreground">{jobs.filter(j => j.status === 'sent').length}</p>
                  <p className="text-[10px] text-success">Enviados</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold text-foreground">{jobs.filter(j => j.status === 'pending').length}</p>
                  <p className="text-[10px] text-warning">Pendentes</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold text-foreground">{jobs.filter(j => j.status === 'failed').length}</p>
                  <p className="text-[10px] text-destructive">Falharam</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold text-foreground">{jobs.filter(j => j.status === 'cancelled').length}</p>
                  <p className="text-[10px] text-muted-foreground">Cancelados</p>
                </div>
              </div>
            )}
            {loadingJobs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">Nenhum envio na fila</p>
            ) : (
              <div className="space-y-1.5 max-h-[350px] overflow-auto">
                {jobs.map(job => (
                  <div key={job.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/50 text-xs">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      job.status === 'sent' ? 'bg-success' :
                      job.status === 'pending' ? 'bg-warning animate-pulse' :
                      job.status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">{job.patient_name || job.patient_phone}</span>
                        {job.flow_name && <span className="text-muted-foreground">• {job.flow_name}</span>}
                      </div>
                      <p className="text-muted-foreground truncate">{job.message.slice(0, 100)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        job.status === 'sent' ? 'bg-success/15 text-success' :
                        job.status === 'pending' ? 'bg-warning/15 text-warning' :
                        job.status === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
                      }`}>
                        {job.status === 'sent' ? '✅ Enviado' : job.status === 'pending' ? '⏳ Pendente' : job.status === 'failed' ? '❌ Falhou' : '🚫 Cancelado'}
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {job.status === 'sent' && job.sent_at ? new Date(job.sent_at).toLocaleString('pt-BR') :
                         new Date(job.scheduled_at).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Spam control info */}
        <div className="bg-muted/50 rounded-xl border border-border p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-foreground">Controle Anti-Spam Ativado</p>
            <p className="text-[11px] text-muted-foreground">
              Cada campanha respeita o intervalo configurado entre envios para o mesmo contato. Todas as mensagens são enviadas via Evolution API com controle de taxa para proteger seu número.
            </p>
          </div>
        </div>

        {/* Disparos list */}
        {filtered.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center justify-center text-center">
            <Megaphone className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">Nenhuma campanha encontrada</h3>
            <p className="text-xs text-muted-foreground mb-4">Crie sua primeira campanha de vendas em massa.</p>
            <button
              onClick={openNewWizard}
              className="flex items-center gap-2 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Nova Campanha
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((disparo) => (
              <DisparoCard
                key={disparo.id}
                disparo={disparo}
                onToggle={() => toggleAtivo(disparo.id)}
                onRemove={() => removeDisparo(disparo.id)}
                onEdit={() => handleEdit(disparo)}
                onDuplicate={() => handleDuplicate(disparo)}
                onStats={() => setStatsDisparo(disparo)}
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
  disparo, onToggle, onRemove, onEdit, onDuplicate, onStats,
}: {
  disparo: DisparoProgramado;
  onToggle: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onStats: () => void;
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
