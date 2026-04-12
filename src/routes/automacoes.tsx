import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Play, Pause, Plus, Clock, MessageSquare, Mail, Smartphone,
  Zap, Settings2, Send, CheckCircle2, Edit2, Save, Loader2, RotateCcw,
  Trash2, Copy, GripVertical, ChevronDown, ChevronUp, X, Sparkles,
  AlertTriangle, Eye, EyeOff, BarChart3, Info, Rocket,
  CalendarCheck, Cake, CalendarX, UserX, Bell, DollarSign, FileText, Stethoscope,
  Users, ArrowRight, type LucideIcon, TrendingUp, Activity, Timer,
  Workflow, Target, ShieldCheck,
} from "lucide-react";
import { AutomationReportPanel } from "@/components/AutomationReportPanel";
import { useState, useEffect, useCallback } from "react";
import {
  mockAutomationFlows, automationTypes, triggerOptions, delayOptions,
  availableVariables, messageTemplates, preConfiguredSolutions,
  type AutomationFlow, type AutomationStep, type AutomationType, type AutomationChannel,
  type PreConfiguredSolution,
} from "@/data/automationMockData";
import { automationsApi, type FollowupAutomationConfig } from "@/lib/vpsApi";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/automacoes")({
  ssr: false,
  component: AutomacoesPage,
});

function AutomacoesPage() {
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<AutomationFlow | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [showFollowupConfig, setShowFollowupConfig] = useState(false);
  const [editingFlow, setEditingFlow] = useState<AutomationFlow | null>(null);
  const [loadingFlows, setLoadingFlows] = useState(true);
  const [activeTab, setActiveTab] = useState<"solutions" | "flows" | "report">("solutions");

  const [followupConfig, setFollowupConfig] = useState<FollowupAutomationConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [solutionCounts, setSolutionCounts] = useState<Record<string, number>>({});

  // Load flows from API, fallback to mock data
  useEffect(() => {
    automationsApi.listFlows()
      .then((res) => {
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          setFlows(res.data);
        } else {
          // Seed mock data to DB on first load
          setFlows(mockAutomationFlows);
          mockAutomationFlows.forEach(flow => {
            automationsApi.createFlow(flow).catch(() => {});
          });
        }
      })
      .catch(() => setFlows(mockAutomationFlows))
      .finally(() => setLoadingFlows(false));

    automationsApi.getFollowup()
      .then((res) => { if (res.data) setFollowupConfig(res.data); })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));

    // Load real patient counts for solutions
    automationsApi.getSolutionCounts()
      .then((res) => { if (res.data) setSolutionCounts(res.data); })
      .catch(() => {});
  }, []);

  const filtered = filterType === "all" ? flows : flows.filter((f) => f.type === filterType);

  const toggleActive = (id: string) => {
    setFlows((prev) => prev.map((f) => f.id === id ? { ...f, active: !f.active } : f));
    const flow = flows.find(f => f.id === id);
    toast.success(flow?.active ? `"${flow.name}" pausado` : `"${flow?.name}" ativado`);
    automationsApi.toggleFlow(id).catch(() => {
      // Rollback on failure
      setFlows((prev) => prev.map((f) => f.id === id ? { ...f, active: !f.active } : f));
      toast.error("Erro ao alterar status");
    });
  };

  const deleteFlow = (id: string) => {
    const flow = flows.find(f => f.id === id);
    setFlows((prev) => prev.filter((f) => f.id !== id));
    if (selectedFlow?.id === id) setSelectedFlow(null);
    if (editingFlow?.id === id) setEditingFlow(null);
    toast.success(`Fluxo "${flow?.name}" removido`);
    automationsApi.deleteFlow(id).catch(() => {
      if (flow) setFlows((prev) => [flow, ...prev]);
      toast.error("Erro ao excluir fluxo");
    });
  };

  const duplicateFlow = (flow: AutomationFlow) => {
    const newFlow: AutomationFlow = {
      ...flow,
      id: `af${Date.now()}`,
      name: `${flow.name} (cópia)`,
      active: false,
      stats: { sent: 0, responded: 0, converted: 0 },
      createdAt: new Date().toLocaleDateString("pt-BR"),
      steps: flow.steps.map(s => ({ ...s, id: `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
    };
    setFlows((prev) => [newFlow, ...prev]);
    setSelectedFlow(newFlow);
    toast.success(`Fluxo duplicado: "${newFlow.name}"`);
    automationsApi.createFlow(newFlow).catch(() => toast.error("Erro ao salvar cópia"));
  };

  const createNewFlow = () => {
    const newFlow: AutomationFlow = {
      id: `af${Date.now()}`,
      name: "Novo Fluxo",
      description: "",
      type: "custom",
      active: false,
      trigger: "Personalizado",
      steps: [
        { id: `s${Date.now()}`, delay: "Imediato", delayMinutes: 0, channel: "whatsapp", message: "Olá {{nome}}!", variables: ["nome"] },
      ],
      stats: { sent: 0, responded: 0, converted: 0 },
      createdAt: new Date().toLocaleDateString("pt-BR"),
    };
    setFlows((prev) => [newFlow, ...prev]);
    setEditingFlow(newFlow);
    setSelectedFlow(newFlow);
    toast.success("Novo fluxo criado! Edite os detalhes.");
    automationsApi.createFlow(newFlow).catch(() => toast.error("Erro ao criar fluxo"));
  };

  const activateSolution = (solution: PreConfiguredSolution) => {
    // Check if a flow for this solution type already exists
    const existing = flows.find(f => f.type === solution.type);
    if (existing) {
      setActiveTab("flows");
      setSelectedFlow(existing);
      setEditingFlow({ ...existing, steps: existing.steps.map(s => ({ ...s })) });
      toast.info(`Fluxo "${existing.name}" já existe. Abrindo para edição.`);
      return;
    }
    const newFlow: AutomationFlow = {
      id: `af${Date.now()}`,
      name: solution.name,
      description: solution.description,
      type: solution.type,
      active: false,
      trigger: solution.trigger,
      steps: solution.defaultSteps.map(s => ({ ...s, id: `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
      stats: { sent: 0, responded: 0, converted: 0 },
      createdAt: new Date().toLocaleDateString("pt-BR"),
    };
    setFlows((prev) => [newFlow, ...prev]);
    setActiveTab("flows");
    setSelectedFlow(newFlow);
    setEditingFlow(newFlow);
    toast.success(`Solução "${solution.name}" ativada! Personalize as mensagens.`);
    automationsApi.createFlow(newFlow).catch(() => toast.error("Erro ao salvar fluxo"));
  };

  const saveEditedFlow = (updated: AutomationFlow) => {
    const withUpdate = { ...updated, updatedAt: new Date().toLocaleDateString("pt-BR") };
    setFlows((prev) => prev.map((f) => f.id === updated.id ? withUpdate : f));
    setSelectedFlow(withUpdate);
    setEditingFlow(null);
    toast.success(`Fluxo "${updated.name}" salvo`);
    automationsApi.updateFlow(updated.id, {
      name: updated.name,
      description: updated.description,
      type: updated.type,
      trigger: updated.trigger,
      steps: updated.steps,
      active: updated.active,
    }).catch(() => toast.error("Erro ao salvar no servidor"));
  };

  const totalSent = flows.reduce((a, f) => a + f.stats.sent, 0);
  const totalResponded = flows.reduce((a, f) => a + f.stats.responded, 0);
  const totalConverted = flows.reduce((a, f) => a + f.stats.converted, 0);
  const responseRate = totalSent > 0 ? ((totalResponded / totalSent) * 100).toFixed(1) : "0";

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Automação de Relacionamento" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Hero header with gradient */}
        <div className="relative overflow-hidden rounded-2xl gradient-primary p-6 shadow-glow-primary">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-4 right-8 animate-float" style={{ animationDelay: '0s' }}>
              <Workflow className="h-16 w-16 text-primary-foreground" strokeWidth={0.8} />
            </div>
            <div className="absolute bottom-4 right-32 animate-float" style={{ animationDelay: '1s' }}>
              <Target className="h-10 w-10 text-primary-foreground" strokeWidth={0.8} />
            </div>
            <div className="absolute top-2 right-56 animate-float" style={{ animationDelay: '2s' }}>
              <Activity className="h-8 w-8 text-primary-foreground" strokeWidth={0.8} />
            </div>
          </div>
          <div className="relative z-10">
            <h1 className="text-xl font-bold text-primary-foreground font-heading mb-1">Automação Inteligente</h1>
            <p className="text-sm text-primary-foreground/80 max-w-md">
              Engaje pacientes automaticamente com fluxos personalizados de WhatsApp, SMS e e-mail.
            </p>
          </div>
        </div>

        {/* Tab switcher — pill style */}
        <div className="flex items-center gap-1.5 bg-card rounded-2xl p-1.5 w-fit border border-border shadow-card">
          {([
            { key: "solutions" as const, label: "Soluções", icon: Rocket, count: preConfiguredSolutions.length },
            { key: "flows" as const, label: "Fluxos", icon: Zap, count: flows.length },
            { key: "report" as const, label: "Relatórios", icon: BarChart3 },
          ]).map(tab => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-300 ${
                  isActive
                    ? "gradient-primary text-primary-foreground shadow-glow-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <TabIcon className="h-4 w-4" strokeWidth={isActive ? 2.2 : 1.8} />
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content with transition */}
        <div key={activeTab} className="animate-tab-content">
          {activeTab === "solutions" ? (
            <SolutionsGrid
              solutions={preConfiguredSolutions}
              flows={flows}
              onActivate={activateSolution}
              onToggleActive={toggleActive}
              counts={solutionCounts}
            />
            />
          ) : activeTab === "report" ? (
            <AutomationReportPanel />
          ) : (
            <div className="space-y-6">
        {/* KPIs — vibrant cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCardVibrant icon={Zap} label="Fluxos Ativos" value={flows.filter((f) => f.active).length.toString()} total={flows.length.toString()} color="from-primary to-primary-glow" />
          <KpiCardVibrant icon={Send} label="Mensagens Enviadas" value={totalSent.toString()} color="from-chart-2 to-info" />
          <KpiCardVibrant icon={TrendingUp} label="Taxa de Resposta" value={`${responseRate}%`} color="from-chart-3 to-success" highlight={Number(responseRate) > 40} />
          <KpiCardVibrant icon={CheckCircle2} label="Conversões" value={totalConverted.toString()} color="from-warning to-chart-4" />
        </div>

        {/* Best practices — more subtle */}
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-card border border-border shadow-card">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 icon-bounce">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground mb-1 font-heading">Boas Práticas</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>• Use <strong>no máximo 3 etapas</strong> por fluxo para não saturar o paciente</li>
              <li>• Espaçe as mensagens com <strong>intervalos de 2-7 dias</strong> entre cada etapa</li>
              <li>• Sempre inclua uma <strong>opção de resposta</strong> clara na mensagem</li>
              <li>• Personalize com variáveis como <code className="px-1.5 py-0.5 bg-primary/10 rounded-md text-primary font-mono text-[10px]">{"{{nome}}"}</code></li>
            </ul>
          </div>
        </div>

        {/* Follow-up CRM Automation Card */}
        <FollowupAutomationCard
          config={followupConfig}
          loading={loadingConfig}
          isOpen={showFollowupConfig}
          onToggleOpen={() => setShowFollowupConfig(!showFollowupConfig)}
          onUpdate={setFollowupConfig}
        />

        {/* Header + filter */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground font-heading">Fluxos de Automação</h2>
            <p className="text-sm text-muted-foreground">Crie, edite e gerencie seus fluxos de relacionamento</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex h-9 items-center rounded-xl bg-card border border-border p-1 text-sm shadow-card">
              <button
                onClick={() => setFilterType("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${filterType === "all" ? "gradient-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Todos ({flows.length})
              </button>
              {automationTypes.slice(0, 6).map((t) => {
                const count = flows.filter(f => f.type === t.id).length;
                if (count === 0) return null;
                const iconInfo = solutionIconMap[t.id];
                const TIcon = iconInfo?.icon || Zap;
                return (
                  <button
                    key={t.id}
                    onClick={() => setFilterType(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${filterType === t.id ? "gradient-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <TIcon className="h-3 w-3" /> {t.label} ({count})
                  </button>
                );
              })}
            </div>
            <button
              onClick={createNewFlow}
              className="flex items-center gap-2 h-9 px-5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-all shadow-glow-primary hover-lift"
            >
              <Plus className="h-4 w-4" /> Novo Fluxo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Flow list */}
          <div className="lg:col-span-1 space-y-3">
            {filtered.length === 0 && (
              <div className="bg-card rounded-2xl border-2 border-dashed border-border p-8 text-center">
                <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4 animate-float">
                  <Zap className="h-7 w-7 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-3">Nenhum fluxo encontrado</p>
                <button onClick={createNewFlow} className="text-xs text-primary hover:underline font-semibold">
                  + Criar primeiro fluxo
                </button>
              </div>
            )}
            {filtered.map((flow, i) => (
              <div key={flow.id} className="animate-slide-up" style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'both' }}>
                <FlowCard
                  flow={flow}
                  isSelected={selectedFlow?.id === flow.id}
                  onSelect={() => { setSelectedFlow(flow); setEditingFlow(null); }}
                  onToggle={() => toggleActive(flow.id)}
                  onDelete={() => deleteFlow(flow.id)}
                  onDuplicate={() => duplicateFlow(flow)}
                  onEdit={() => { setSelectedFlow(flow); setEditingFlow({ ...flow, steps: flow.steps.map(s => ({ ...s })) }); }}
                />
              </div>
            ))}
          </div>

          {/* Flow detail / editor */}
          <div className="lg:col-span-2">
            {editingFlow ? (
              <FlowEditor
                flow={editingFlow}
                onChange={setEditingFlow}
                onSave={saveEditedFlow}
                onCancel={() => setEditingFlow(null)}
              />
            ) : selectedFlow ? (
              <FlowDetail
                flow={selectedFlow}
                onEdit={() => setEditingFlow({ ...selectedFlow, steps: selectedFlow.steps.map(s => ({ ...s })) })}
                onDelete={() => deleteFlow(selectedFlow.id)}
              />
            ) : (
              <div className="bg-card rounded-2xl border border-border p-10 flex flex-col items-center justify-center text-center h-full min-h-[400px] shadow-card">
                <div className="h-16 w-16 rounded-2xl gradient-primary flex items-center justify-center mb-5 animate-float shadow-glow-primary">
                  <Zap className="h-8 w-8 text-primary-foreground" />
                </div>
                <h3 className="text-base font-bold text-foreground mb-2 font-heading">Selecione um fluxo</h3>
                <p className="text-xs text-muted-foreground max-w-xs mb-5">
                  Clique em um fluxo ao lado para visualizar detalhes, métricas e editar mensagens.
                </p>
                <button onClick={createNewFlow} className="flex items-center gap-2 h-9 px-5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-all shadow-glow-primary hover-lift">
                  <Plus className="h-4 w-4" /> Criar Novo Fluxo
                </button>
              </div>
            )}
          </div>
        </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Follow-up CRM Automation Card ─────────────────────────

function FollowupAutomationCard({
  config, loading, isOpen, onToggleOpen, onUpdate,
}: {
  config: FollowupAutomationConfig | null;
  loading: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  onUpdate: (c: FollowupAutomationConfig) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [editMessages, setEditMessages] = useState<Record<string, string>>({});
  const [editDelay, setEditDelay] = useState<number>(30);
  const [editDelayDays, setEditDelayDays] = useState<Record<string, number>>({});
  const [editReturnOnReply, setEditReturnOnReply] = useState(true);

  useEffect(() => {
    if (config) {
      setEditMessages(config.messages);
      setEditDelay(config.delaySeconds);
      setEditDelayDays(config.delayDays || {});
      setEditReturnOnReply(config.returnToQueueOnReply !== false);
    }
  }, [config]);

  const handleToggle = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await automationsApi.updateFollowup({ enabled: !config.enabled });
      if (res.data) {
        onUpdate(res.data);
        toast.success(res.data.enabled ? "Automação ativada" : "Automação desativada");
      } else {
        toast.error(res.error || "Erro ao alterar automação");
      }
    } catch {
      toast.error("Erro ao alterar automação");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await automationsApi.updateFollowup({
        messages: editMessages,
        delaySeconds: editDelay,
        delayDays: editDelayDays,
        returnToQueueOnReply: editReturnOnReply,
      });
      if (res.data) {
        onUpdate(res.data);
        toast.success("Configurações salvas");
      } else {
        toast.error(res.error || "Erro ao salvar");
      }
    } catch {
      toast.error("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const stageLabels: Record<string, string> = {
    followup: "Follow-up 1",
    followup_2: "Follow-up 2",
    followup_3: "Follow-up 3",
  };

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Carregando automação de follow-up...</span>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="bg-card rounded-xl border border-primary/30 overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                Follow-up Automático — CRM
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  config.enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                }`}>
                  {config.enabled ? "Ativo" : "Inativo"}
                </span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Envia mensagem WhatsApp automaticamente quando lead entra na coluna Follow-up do CRM
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={config.enabled} onCheckedChange={handleToggle} disabled={saving} />
            <button
              onClick={onToggleOpen}
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings2 className="h-3 w-3" /> {isOpen ? "Fechar" : "Configurar"}
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-border p-5 space-y-5 bg-muted/30">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Delay antes de enviar (segundos)</label>
            <Input
              type="number"
              value={editDelay}
              onChange={(e) => setEditDelay(Number(e.target.value))}
              className="max-w-[200px] h-8 text-sm"
              min={0}
              max={3600}
            />
            <p className="text-[11px] text-muted-foreground">Tempo de espera antes do envio (permite cancelamento manual)</p>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-foreground">Mensagens por Etapa</h4>
            {(config.stages || []).map((stage) => (
              <div key={stage} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">{stageLabels[stage] || stage}</label>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-muted-foreground">Dias após setagem:</label>
                    <Input
                      type="number"
                      value={editDelayDays[stage] ?? 0}
                      onChange={(e) => setEditDelayDays((prev) => ({ ...prev, [stage]: Number(e.target.value) }))}
                      className="w-16 h-6 text-xs"
                      min={0}
                      max={365}
                    />
                  </div>
                </div>
                <Textarea
                  value={editMessages[stage] || ""}
                  onChange={(e) => setEditMessages((prev) => ({ ...prev, [stage]: e.target.value }))}
                  rows={3}
                  className="text-xs resize-none"
                  placeholder={`Mensagem para ${stageLabels[stage] || stage}...`}
                />
                <p className="text-[10px] text-muted-foreground">Variáveis: {"{{nome}}"}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs font-medium text-foreground">Retorno automático à fila</p>
                <p className="text-[10px] text-muted-foreground">Quando o cliente responder, retorna à fila com prioridade + tag "Recuperação de Lead"</p>
              </div>
            </div>
            <Switch checked={editReturnOnReply} onCheckedChange={setEditReturnOnReply} />
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Salvar Configurações
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KPI Card Vibrant ───────────────────────────────────────

function KpiCardVibrant({ icon: Icon, label, value, total, color, highlight }: {
  icon: React.ElementType; label: string; value: string; total?: string; color: string; highlight?: boolean;
}) {
  return (
    <div className="group bg-card rounded-2xl border border-border p-4 shadow-card hover-lift hover:shadow-card-hover transition-all duration-300">
      <div className="flex items-center gap-3">
        <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shrink-0 icon-bounce shadow-sm`}>
          <Icon className="h-5 w-5 text-primary-foreground" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
          <div className="flex items-baseline gap-1.5">
            <p className="text-xl font-bold font-heading text-foreground">{value}</p>
            {total && <span className="text-xs text-muted-foreground font-medium">/ {total}</span>}
          </div>
        </div>
      </div>
      {highlight && (
        <div className="mt-2 h-1 rounded-full bg-gradient-to-r from-chart-3 to-success opacity-60" />
      )}
    </div>
  );
}

// ─── Flow Card ──────────────────────────────────────────────

function FlowCard({
  flow, isSelected, onSelect, onToggle, onDelete, onDuplicate, onEdit,
}: {
  flow: AutomationFlow; isSelected: boolean; onSelect: () => void; onToggle: () => void;
  onDelete: () => void; onDuplicate: () => void; onEdit: () => void;
}) {
  const iconData = solutionIconMap[flow.type] || { icon: Zap, gradient: "from-primary to-primary-glow", bg: "bg-primary/10" };
  const TypeIcon = iconData.icon;
  const [showActions, setShowActions] = useState(false);
  const responseRate = flow.stats.sent > 0 ? ((flow.stats.responded / flow.stats.sent) * 100).toFixed(0) : "0";

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className={`group bg-card rounded-2xl border p-4 cursor-pointer transition-all duration-200 hover:shadow-card-hover ${
        isSelected ? "border-primary shadow-card ring-1 ring-primary/20" : "border-border hover:border-primary/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${iconData.gradient} flex items-center justify-center shrink-0`}>
          <TypeIcon className="h-4 w-4 text-primary-foreground" strokeWidth={1.8} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate font-heading">{flow.name}</span>
            {flow.active && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
              </span>
            )}
          </div>
          {flow.description && (
            <p className="text-[11px] text-muted-foreground mb-2 line-clamp-1">{flow.description}</p>
          )}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><Send className="h-3 w-3" /> {flow.stats.sent}</span>
            <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" /> {responseRate}%</span>
            <span className="text-[10px] text-muted-foreground/70">{flow.steps.length} etapas</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {showActions && (
            <>
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Editar">
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Duplicar">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button onClick={(e) => e.stopPropagation()} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Excluir">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir fluxo</AlertDialogTitle>
                    <AlertDialogDescription>Tem certeza que deseja excluir "{flow.name}"? Esta ação não pode ser desfeita.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`p-1.5 rounded-xl transition-colors ${flow.active ? "bg-success/15 text-success hover:bg-success/25" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            title={flow.active ? "Pausar" : "Ativar"}
          >
            {flow.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
// ─── Flow Detail (read-only view) ──────────────────────────

function FlowDetail({ flow, onEdit, onDelete }: { flow: AutomationFlow; onEdit: () => void; onDelete: () => void }) {
  const iconData = solutionIconMap[flow.type] || { icon: Zap, gradient: "from-primary to-primary-glow", bg: "bg-primary/10" };
  const TypeIcon = iconData.icon;
  const responseRate = flow.stats.sent > 0 ? ((flow.stats.responded / flow.stats.sent) * 100).toFixed(1) : "0";
  const conversionRate = flow.stats.responded > 0 ? ((flow.stats.converted / flow.stats.responded) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${iconData.gradient} flex items-center justify-center shrink-0`}>
              <TypeIcon className="h-5 w-5 text-primary-foreground" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base font-semibold text-foreground font-heading">{flow.name}</h3>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                  flow.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                }`}>
                  {flow.active ? "● Ativo" : "Inativo"}
                </span>
              </div>
              {flow.description && <p className="text-xs text-muted-foreground mb-1.5">{flow.description}</p>}
              <p className="text-xs text-muted-foreground">Gatilho: <span className="text-foreground font-medium">{flow.trigger}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onEdit} className="flex items-center gap-1.5 h-8 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
              <Edit2 className="h-3.5 w-3.5" /> Editar
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir fluxo</AlertDialogTitle>
                  <AlertDialogDescription>Tem certeza que deseja excluir "{flow.name}"?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-muted/50 rounded-xl p-3 text-center">
            <Send className="h-3.5 w-3.5 text-muted-foreground mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground font-heading">{flow.stats.sent}</p>
            <p className="text-[10px] text-muted-foreground">Enviadas</p>
          </div>
          <div className="bg-muted/50 rounded-xl p-3 text-center">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground font-heading">{flow.stats.responded}</p>
            <p className="text-[10px] text-muted-foreground">Respondidas</p>
          </div>
          <div className="bg-chart-2/10 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-chart-2 font-heading">{responseRate}%</p>
            <p className="text-[10px] text-muted-foreground">Taxa Resposta</p>
          </div>
          <div className="bg-success/10 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-success font-heading">{conversionRate}%</p>
            <p className="text-[10px] text-muted-foreground">Conversões</p>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
        <h4 className="text-sm font-semibold text-card-foreground mb-5 font-heading flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" /> Etapas do Fluxo ({flow.steps.length})
        </h4>
        <div className="space-y-0">
          {flow.steps.map((step, i) => (
            <StepItem key={step.id} step={step} isLast={i === flow.steps.length - 1} index={i} />
          ))}
        </div>
      </div>

      {flow.steps.length > 5 && (
        <div className="flex items-start gap-2.5 p-4 rounded-xl bg-warning/10 border border-warning/30">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning"><strong>Atenção:</strong> {flow.steps.length} etapas — recomendamos no máximo 3-5.</p>
        </div>
      )}

      {/* Variables */}
      <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
        <h4 className="text-sm font-semibold text-card-foreground mb-3 font-heading">Variáveis Utilizadas</h4>
        <div className="flex flex-wrap gap-2">
          {Array.from(new Set(flow.steps.flatMap((s) => s.variables))).map((v) => {
            const info = availableVariables.find(av => av.key === v);
            return (
              <span key={v} className="px-3 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-mono border border-primary/20" title={info?.label}>
                {"{{" + v + "}}"}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
// ─── Flow Editor ────────────────────────────────────────────

function FlowEditor({
  flow, onChange, onSave, onCancel,
}: {
  flow: AutomationFlow;
  onChange: (f: AutomationFlow) => void;
  onSave: (f: AutomationFlow) => void;
  onCancel: () => void;
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [previewStep, setPreviewStep] = useState<number | null>(null);

  const updateField = <K extends keyof AutomationFlow>(key: K, value: AutomationFlow[K]) => {
    onChange({ ...flow, [key]: value });
  };

  const updateStep = (stepId: string, updates: Partial<AutomationStep>) => {
    onChange({
      ...flow,
      steps: flow.steps.map(s => s.id === stepId ? { ...s, ...updates } : s),
    });
  };

  const addStep = () => {
    const newStep: AutomationStep = {
      id: `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      delay: "1 dia",
      delayMinutes: 1440,
      channel: "whatsapp",
      message: "",
      variables: [],
    };
    onChange({ ...flow, steps: [...flow.steps, newStep] });
  };

  const removeStep = (stepId: string) => {
    if (flow.steps.length <= 1) {
      toast.error("O fluxo precisa ter pelo menos 1 etapa");
      return;
    }
    onChange({ ...flow, steps: flow.steps.filter(s => s.id !== stepId) });
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    const newSteps = [...flow.steps];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    onChange({ ...flow, steps: newSteps });
  };

  const applyTemplate = (template: typeof messageTemplates[0], stepId: string) => {
    updateStep(stepId, { message: template.message, variables: template.variables });
    setShowTemplates(false);
    toast.success(`Template "${template.name}" aplicado`);
  };

  const extractVariables = (message: string): string[] => {
    const matches = message.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, "")))];
  };

  const handleMessageChange = (stepId: string, message: string) => {
    const vars = extractVariables(message);
    updateStep(stepId, { message, variables: vars });
  };

  const isValid = flow.name.trim().length > 0 && flow.steps.length > 0 && flow.steps.every(s => s.message.trim().length > 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-card rounded-xl border border-primary/30 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Edit2 className="h-4 w-4 text-primary" /> Editando Fluxo
          </h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              <X className="h-3.5 w-3.5 mr-1.5" /> Cancelar
            </Button>
            <Button size="sm" onClick={() => onSave(flow)} disabled={!isValid}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> Salvar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Nome do Fluxo *</label>
            <Input
              value={flow.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Ex: Pós-Consulta — Agradecimento"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Tipo</label>
            <Select value={flow.type} onValueChange={(v) => updateField("type", v as AutomationType)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {automationTypes.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.icon} {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Gatilho</label>
            <Select value={flow.trigger} onValueChange={(v) => updateField("trigger", v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {triggerOptions.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Descrição</label>
            <Input
              value={flow.description || ""}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Breve descrição do fluxo..."
              className="h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Steps editor */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-card-foreground">
            Etapas do Fluxo ({flow.steps.length})
          </h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Sparkles className="h-3 w-3" /> Templates
            </button>
            <button
              onClick={addStep}
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <Plus className="h-3 w-3" /> Etapa
            </button>
          </div>
        </div>

        {/* Template selector */}
        {showTemplates && (
          <div className="mb-4 p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            <p className="text-xs font-medium text-foreground mb-2">Modelos prontos — clique para aplicar a uma etapa:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {messageTemplates.filter(t => t.type === flow.type || flow.type === "custom").map((template, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (flow.steps.length > 0) applyTemplate(template, flow.steps[flow.steps.length - 1].id);
                  }}
                  className="text-left p-2.5 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors"
                >
                  <p className="text-xs font-medium text-foreground mb-1">{template.name}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{template.message}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {flow.steps.length > 5 && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-warning/10 border border-warning/30 mb-4">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
            <p className="text-[11px] text-warning">Muitas etapas. Recomendamos no máximo 3-5 para melhor engajamento.</p>
          </div>
        )}

        <div className="space-y-4">
          {flow.steps.map((step, i) => (
            <div key={step.id} className="relative">
              <div className="flex gap-3">
                {/* Step number + connector */}
                <div className="flex flex-col items-center">
                  <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  {i < flow.steps.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
                </div>

                {/* Step content */}
                <div className="flex-1 pb-2">
                  <div className="bg-muted/30 rounded-lg border border-border p-3 space-y-3">
                    {/* Step controls */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select
                        value={step.delay}
                        onValueChange={(v) => {
                          const opt = delayOptions.find(d => d.label === v);
                          updateStep(step.id, { delay: v, delayMinutes: opt?.minutes ?? 0 });
                        }}
                      >
                        <SelectTrigger className="h-7 w-[130px] text-xs">
                          <Clock className="h-3 w-3 mr-1 text-muted-foreground" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {delayOptions.map(d => (
                            <SelectItem key={d.label} value={d.label}>{d.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={step.channel}
                        onValueChange={(v) => updateStep(step.id, { channel: v as AutomationChannel })}
                      >
                        <SelectTrigger className="h-7 w-[120px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="whatsapp">📱 WhatsApp</SelectItem>
                          <SelectItem value="sms">💬 SMS</SelectItem>
                          <SelectItem value="email">📧 E-mail</SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="flex-1" />

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setPreviewStep(previewStep === i ? null : i)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Pré-visualizar"
                        >
                          {previewStep === i ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => moveStep(i, "up")}
                          disabled={i === 0}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                          title="Mover para cima"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => moveStep(i, "down")}
                          disabled={i === flow.steps.length - 1}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                          title="Mover para baixo"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => removeStep(step.id)}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Remover etapa"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Message textarea */}
                    <Textarea
                      value={step.message}
                      onChange={(e) => handleMessageChange(step.id, e.target.value)}
                      placeholder="Digite a mensagem... Use {{nome}} para variáveis"
                      rows={3}
                      className="text-xs resize-none"
                    />

                    {/* Quick variable buttons */}
                    <div className="flex flex-wrap gap-1">
                      {availableVariables.map(v => (
                        <button
                          key={v.key}
                          onClick={() => handleMessageChange(step.id, step.message + `{{${v.key}}}`)}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-mono"
                          title={`${v.label} — Ex: ${v.example}`}
                        >
                          {`{{${v.key}}}`}
                        </button>
                      ))}
                    </div>

                    {/* Preview */}
                    {previewStep === i && step.message && (
                      <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                        <p className="text-[10px] font-medium text-success mb-1.5">Pré-visualização:</p>
                        <p className="text-xs text-foreground leading-relaxed">
                          {step.message.replace(/\{\{(\w+)\}\}/g, (_, key) => {
                            const v = availableVariables.find(av => av.key === key);
                            return v?.example || `[${key}]`;
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add step button at the bottom */}
        <button
          onClick={addStep}
          className="w-full mt-4 py-2.5 border-2 border-dashed border-border rounded-lg text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar Etapa
        </button>
      </div>

      {/* Save / Cancel bar at bottom */}
      <div className="flex items-center justify-between bg-card rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground">
          {!isValid && <span className="text-warning">⚠ Preencha o nome e todas as mensagens para salvar</span>}
          {isValid && <span className="text-success">✅ Fluxo pronto para salvar</span>}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" onClick={() => onSave(flow)} disabled={!isValid}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Salvar Fluxo
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared components ──────────────────────────────────────

function StepItem({ step, isLast, index }: { step: AutomationStep; isLast: boolean; index: number }) {
  const channelIcon = step.channel === "whatsapp" ? MessageSquare : step.channel === "sms" ? Smartphone : Mail;
  const channelLabel = step.channel === "whatsapp" ? "WhatsApp" : step.channel === "sms" ? "SMS" : "E-mail";
  const channelColor = step.channel === "whatsapp" ? "text-success" : step.channel === "sms" ? "text-chart-2" : "text-chart-4";

  return (
    <div className="flex gap-4 animate-slide-up" style={{ animationDelay: `${index * 80}ms`, animationFillMode: 'both' }}>
      <div className="flex flex-col items-center">
        <div className="h-9 w-9 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0 shadow-sm">
          {index + 1}
        </div>
        {!isLast && <div className="w-0.5 flex-1 my-1.5 bg-gradient-to-b from-primary/30 to-border rounded-full" />}
      </div>
      <div className={`flex-1 ${!isLast ? "pb-5" : ""}`}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted text-[11px] font-medium text-muted-foreground">
            <Clock className="h-3 w-3" /> {step.delay}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted text-[11px] font-medium ${channelColor}`}>
            {(() => { const Icon = channelIcon; return <Icon className="h-3 w-3" />; })()}
            {channelLabel}
          </span>
        </div>
        <div className="bg-muted/40 rounded-2xl rounded-tl-md p-4 text-xs text-foreground leading-relaxed border border-border/50">
          {step.message.split(/(\{\{[^}]+\}\})/).map((part, i) =>
            part.startsWith("{{") ? (
              <span key={i} className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-mono text-[11px] font-medium">{part}</span>
            ) : (
              <span key={i}>{part}</span>
            )
          )}
        </div>
      </div>
    </div>
  );
}
// ─── Solution Icon Map ──────────────────────────────────────

const solutionIconMap: Record<string, { icon: LucideIcon; gradient: string; bg: string }> = {
  confirmacao_agenda: { icon: CalendarCheck, gradient: "from-chart-2 to-info", bg: "bg-chart-2/10" },
  aniversario: { icon: Cake, gradient: "from-chart-5 to-chart-4", bg: "bg-chart-5/10" },
  desmarcacao: { icon: CalendarX, gradient: "from-warning to-chart-4", bg: "bg-warning/10" },
  faltas: { icon: UserX, gradient: "from-destructive to-chart-5", bg: "bg-destructive/10" },
  faltas_primeira: { icon: Bell, gradient: "from-chart-4 to-destructive", bg: "bg-chart-4/10" },
  inadimplencia: { icon: DollarSign, gradient: "from-warning to-chart-3", bg: "bg-warning/10" },
  orcamento_aberto: { icon: FileText, gradient: "from-chart-3 to-primary", bg: "bg-chart-3/10" },
  tratamento_sem_agenda: { icon: Stethoscope, gradient: "from-primary to-dental-cyan", bg: "bg-primary/10" },
  pos_consulta: { icon: ShieldCheck, gradient: "from-chart-1 to-primary-glow", bg: "bg-chart-1/10" },
  lembrete_retorno: { icon: Timer, gradient: "from-dental-cyan to-chart-2", bg: "bg-dental-cyan/10" },
  reativacao: { icon: RotateCcw, gradient: "from-warning to-chart-4", bg: "bg-warning/10" },
  followup_orcamento: { icon: Target, gradient: "from-chart-3 to-chart-1", bg: "bg-chart-3/10" },
  custom: { icon: Settings2, gradient: "from-muted-foreground to-foreground", bg: "bg-muted" },
};

// ─── Solutions Grid ─────────────────────────────────────────

function SolutionsGrid({
  solutions, flows, onActivate, onToggleActive, counts,
}: {
  solutions: PreConfiguredSolution[];
  flows: AutomationFlow[];
  onActivate: (s: PreConfiguredSolution) => void;
  onToggleActive: (id: string) => void;
  counts: Record<string, number>;
}) {
  const [hoursConfig, setHoursConfig] = useState({ inicio: '08:00', fim: '18:00', diasSemana: ['SEG','TER','QUA','QUI','SEX'] });
  const [savingHours, setSavingHours] = useState(false);
  const [showHoursConfig, setShowHoursConfig] = useState(false);

  const allDays = ['SEG','TER','QUA','QUI','SEX','SAB','DOM'];
  const dayLabels: Record<string, string> = { SEG: 'Seg', TER: 'Ter', QUA: 'Qua', QUI: 'Qui', SEX: 'Sex', SAB: 'Sáb', DOM: 'Dom' };

  useEffect(() => {
    automationsApi.getSolutionHours()
      .then(res => { if (res.data) setHoursConfig(res.data); })
      .catch(() => {});
  }, []);

  const saveHours = async () => {
    setSavingHours(true);
    try {
      const res = await automationsApi.updateSolutionHours(hoursConfig);
      if (res.data) { setHoursConfig(res.data); toast.success('Horário de envio salvo'); }
      else toast.error(res.error || 'Erro ao salvar');
    } catch { toast.error('Erro ao salvar'); }
    finally { setSavingHours(false); }
  };

  const toggleDay = (day: string) => {
    setHoursConfig(prev => ({
      ...prev,
      diasSemana: prev.diasSemana.includes(day)
        ? prev.diasSemana.filter(d => d !== day)
        : [...prev.diasSemana, day],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground font-heading">Soluções Inteligentes</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automações prontas para os cenários mais comuns da sua clínica
          </p>
        </div>
        <button
          onClick={() => setShowHoursConfig(!showHoursConfig)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all hover:shadow-sm"
        >
          <Clock className="h-4 w-4 text-primary" />
          {hoursConfig.inicio} — {hoursConfig.fim}
          {showHoursConfig ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Business Hours Config */}
      {showHoursConfig && (
        <div className="bg-card rounded-xl border border-primary/20 p-5 space-y-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center">
              <Clock className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Horário Comercial</h3>
              <p className="text-xs text-muted-foreground">Mensagens só serão enviadas dentro do horário configurado</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Início</label>
              <Input
                type="time"
                value={hoursConfig.inicio}
                onChange={e => setHoursConfig(prev => ({ ...prev, inicio: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Fim</label>
              <Input
                type="time"
                value={hoursConfig.fim}
                onChange={e => setHoursConfig(prev => ({ ...prev, fim: e.target.value }))}
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Dias da Semana</label>
            <div className="flex gap-1.5 flex-wrap">
              {allDays.map(day => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    hoursConfig.diasSemana.includes(day)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {dayLabels[day]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <p className="text-[11px] text-muted-foreground">Fuso: América/São Paulo (BRT)</p>
            <Button size="sm" onClick={saveHours} disabled={savingHours}>
              {savingHours ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Salvar
            </Button>
          </div>
        </div>
      )}

      {/* Solutions Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {solutions.map((sol, index) => {
          const existingFlow = flows.find(f => f.type === sol.type);
          const isActive = existingFlow?.active;
          const isConfigured = !!existingFlow;
          const iconData = solutionIconMap[sol.type] || { icon: Zap, gradient: "from-primary to-primary-glow", bg: "bg-primary/10" };
          const IconComp = iconData.icon;
          const patientCount = counts[sol.type] ?? sol.totalPacientes ?? 0;

          const handleToggle = () => {
            if (!isConfigured) {
              // First activation — create the flow
              onActivate(sol);
            } else if (existingFlow) {
              // Toggle existing flow active/inactive
              onToggleActive(existingFlow.id);
            }
          };

          return (
            <div
              key={sol.id}
              className={`group relative bg-card rounded-2xl border p-5 transition-all duration-500 hover-lift card-glow animate-slide-up ${
                isActive
                  ? "border-primary/50 shadow-[0_0_20px_-4px_hsl(var(--primary)/0.35),0_0_40px_-8px_hsl(var(--primary)/0.2)] ring-1 ring-primary/20"
                  : "border-border hover:border-primary/30 hover:shadow-card-hover"
              }`}
              style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'both' }}
            >
              {/* Top bar: switch + edit button */}
              <div className="flex items-center justify-between mb-4">
                <Switch
                  checked={!!isActive}
                  onCheckedChange={handleToggle}
                  className="data-[state=checked]:bg-primary"
                />
                {isActive && (
                  <button
                    onClick={() => onActivate(sol)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-all duration-200 animate-fade-in"
                  >
                    <Settings2 className="h-3 w-3" />
                    Configurar
                  </button>
                )}
              </div>

              {/* Status indicator */}
              {isActive && (
                <div className="absolute top-4 right-4">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/15 text-success">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
                    </span>
                    Ativa
                  </span>
                </div>
              )}

              {sol.hasDelay && !isConfigured && (
                <span className="absolute top-4 right-4 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning/15 text-warning">
                  <AlertTriangle className="h-2.5 w-2.5" /> Atraso
                </span>
              )}

              {/* Icon with glow */}
              <div className={`relative h-12 w-12 rounded-2xl bg-gradient-to-br ${iconData.gradient} flex items-center justify-center mb-4 shadow-sm icon-bounce ${isActive ? 'shadow-[0_0_16px_-2px_hsl(var(--primary)/0.4)]' : ''}`}>
                <IconComp className="h-6 w-6 text-primary-foreground" strokeWidth={1.6} />
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${iconData.gradient} opacity-0 group-hover:opacity-30 blur-xl transition-opacity duration-500`} />
              </div>

              {/* Title */}
              <h3 className="font-bold text-foreground text-sm mb-1 font-heading group-hover:text-primary transition-colors duration-200">{sol.name}</h3>

              {/* Description */}
              <p className="text-[11px] text-muted-foreground mb-3 line-clamp-2 leading-relaxed">{sol.description}</p>

              {/* Patient count */}
              <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-muted/50">
                <Users className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">
                  <span className="font-bold text-foreground">{patientCount}</span> pacientes elegíveis
                </span>
              </div>

              {/* Steps preview */}
              <div className="flex items-center gap-0.5">
                {sol.defaultSteps.map((step, i) => {
                  const StepIcon = step.channel === "whatsapp" ? MessageSquare : step.channel === "sms" ? Smartphone : Mail;
                  const stepColor = step.channel === "whatsapp" ? "text-success bg-success/10" : step.channel === "sms" ? "text-chart-2 bg-chart-2/10" : "text-chart-4 bg-chart-4/10";
                  return (
                    <div key={step.id} className="flex items-center gap-0.5">
                      <span className={`inline-flex items-center justify-center h-6 w-6 rounded-lg text-[10px] font-medium ${stepColor}`}>
                        <StepIcon className="h-3 w-3" />
                      </span>
                      {i < sol.defaultSteps.length - 1 && (
                        <div className="w-3 h-px bg-border" />
                      )}
                    </div>
                  );
                })}
                <span className="text-[10px] text-muted-foreground ml-1.5 font-medium">{sol.defaultSteps.length} etapas</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}