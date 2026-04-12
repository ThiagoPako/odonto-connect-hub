import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Play, Pause, Plus, Clock, MessageSquare, Mail, Smartphone,
  Zap, Settings2, Send, CheckCircle2, Edit2, Save, Loader2, RotateCcw,
  Trash2, Copy, GripVertical, ChevronDown, ChevronUp, X, Sparkles,
  AlertTriangle, Eye, EyeOff, BarChart3,
} from "lucide-react";
import { AutomationReportPanel } from "@/components/AutomationReportPanel";
import { useState, useEffect, useCallback } from "react";
import {
  mockAutomationFlows, automationTypes, triggerOptions, delayOptions,
  availableVariables, messageTemplates,
  type AutomationFlow, type AutomationStep, type AutomationType, type AutomationChannel,
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
  const [activeTab, setActiveTab] = useState<"flows" | "report">("flows");

  const [followupConfig, setFollowupConfig] = useState<FollowupAutomationConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

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
        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 w-fit">
          <button
            onClick={() => setActiveTab("flows")}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === "flows" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Zap className="h-3.5 w-3.5 inline mr-1.5" />Fluxos
          </button>
          <button
            onClick={() => setActiveTab("report")}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === "report" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <BarChart3 className="h-3.5 w-3.5 inline mr-1.5" />Relatórios
          </button>
        </div>

        {activeTab === "report" ? (
          <AutomationReportPanel />
        ) : (
        <>
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">

        {/* Best practices tip */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
          <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Dicas de Boas Práticas</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>• Use <strong>no máximo 3 etapas</strong> por fluxo para não saturar o paciente</li>
              <li>• Espaçe as mensagens com <strong>intervalos de 2-7 dias</strong> entre cada etapa</li>
              <li>• Sempre inclua uma <strong>opção de resposta</strong> clara na mensagem (ex: "Responda SIM")</li>
              <li>• Personalize com variáveis como <code className="px-1 py-0.5 bg-muted rounded text-primary">{"{{nome}}"}</code> para maior engajamento</li>
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
            <h2 className="text-lg font-semibold text-foreground">Fluxos de Automação</h2>
            <p className="text-sm text-muted-foreground">Crie, edite e gerencie seus fluxos de relacionamento</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-sm">
              <button
                onClick={() => setFilterType("all")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterType === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Todos ({flows.length})
              </button>
              {automationTypes.map((t) => {
                const count = flows.filter(f => f.type === t.id).length;
                return (
                  <button
                    key={t.id}
                    onClick={() => setFilterType(t.id)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterType === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t.icon} {t.label} {count > 0 ? `(${count})` : ""}
                  </button>
                );
              })}
            </div>
            <button
              onClick={createNewFlow}
              className="flex items-center gap-2 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Novo Fluxo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Flow list */}
          <div className="lg:col-span-1 space-y-3">
            {filtered.length === 0 && (
              <div className="bg-card rounded-xl border border-dashed border-border p-8 text-center">
                <Zap className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">Nenhum fluxo encontrado</p>
                <button onClick={createNewFlow} className="text-xs text-primary hover:underline font-medium">
                  + Criar primeiro fluxo
                </button>
              </div>
            )}
            {filtered.map((flow) => (
              <FlowCard
                key={flow.id}
                flow={flow}
                isSelected={selectedFlow?.id === flow.id}
                onSelect={() => { setSelectedFlow(flow); setEditingFlow(null); }}
                onToggle={() => toggleActive(flow.id)}
                onDelete={() => deleteFlow(flow.id)}
                onDuplicate={() => duplicateFlow(flow)}
                onEdit={() => { setSelectedFlow(flow); setEditingFlow({ ...flow, steps: flow.steps.map(s => ({ ...s })) }); }}
              />
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
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center h-full min-h-[400px]">
                <Zap className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um fluxo</h3>
                <p className="text-xs text-muted-foreground max-w-xs mb-4">
                  Clique em um fluxo ao lado para visualizar, editar ou criar novos fluxos de relacionamento.
                </p>
                <button onClick={createNewFlow} className="flex items-center gap-2 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                  <Plus className="h-3.5 w-3.5" /> Criar Novo Fluxo
                </button>
              </div>
            )}
          </div>
        </div>
        </>
        )}
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

// ─── Mini KPI ───────────────────────────────────────────────

function MiniKpi({ icon: Icon, label, value, total, highlight }: { icon: React.ElementType; label: string; value: string; total?: string; highlight?: boolean }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <p className={`text-lg font-bold ${highlight ? "text-success" : "text-foreground"}`}>{value}</p>
        {total && <span className="text-xs text-muted-foreground">/ {total}</span>}
      </div>
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
  const typeInfo = automationTypes.find((t) => t.id === flow.type);
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className={`bg-card rounded-xl border p-4 cursor-pointer transition-all ${
        isSelected ? "border-primary ring-1 ring-primary/20" : "border-border hover:border-primary/40"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${flow.active ? "bg-success" : "bg-muted-foreground/40"}`} />
          <span className="text-sm font-medium text-foreground truncate">{flow.name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {showActions && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Editar"
              >
                <Edit2 className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Duplicar"
              >
                <Copy className="h-3 w-3" />
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir fluxo</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tem certeza que deseja excluir "{flow.name}"? Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`p-1.5 rounded-lg transition-colors ${
              flow.active ? "bg-success/15 text-success hover:bg-success/25" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title={flow.active ? "Pausar" : "Ativar"}
          >
            {flow.active ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {flow.description && (
        <p className="text-[11px] text-muted-foreground mb-2 line-clamp-1">{flow.description}</p>
      )}
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
          {typeInfo?.icon} {typeInfo?.label}
        </span>
        <span className="text-[10px] text-muted-foreground">{flow.steps.length} etapas</span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Send className="h-3 w-3" /> {flow.stats.sent}</span>
        <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" /> {flow.stats.responded}</span>
        <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {flow.stats.converted}</span>
      </div>
    </div>
  );
}

// ─── Flow Detail (read-only view) ──────────────────────────

function FlowDetail({ flow, onEdit, onDelete }: { flow: AutomationFlow; onEdit: () => void; onDelete: () => void }) {
  const typeInfo = automationTypes.find((t) => t.id === flow.type);
  const responseRate = flow.stats.sent > 0 ? ((flow.stats.responded / flow.stats.sent) * 100).toFixed(1) : "0";
  const conversionRate = flow.stats.responded > 0 ? ((flow.stats.converted / flow.stats.responded) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-semibold text-foreground">{flow.name}</h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                flow.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
              }`}>
                {flow.active ? "Ativo" : "Inativo"}
              </span>
            </div>
            {flow.description && (
              <p className="text-xs text-muted-foreground mb-2">{flow.description}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Gatilho: <span className="text-foreground font-medium">{flow.trigger}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
              <Edit2 className="h-3 w-3" /> Editar
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors">
                  <Trash2 className="h-3 w-3" /> Excluir
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir fluxo</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tem certeza que deseja excluir "{flow.name}"? Esta ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 mt-4">
          <StatBox label="Enviadas" value={flow.stats.sent.toString()} />
          <StatBox label="Respondidas" value={flow.stats.responded.toString()} />
          <StatBox label="Taxa Resposta" value={`${responseRate}%`} />
          <StatBox label="Conversões" value={`${conversionRate}%`} />
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-card-foreground mb-4">Etapas do Fluxo ({flow.steps.length})</h4>
        <div className="space-y-0">
          {flow.steps.map((step, i) => (
            <StepItem key={step.id} step={step} isLast={i === flow.steps.length - 1} index={i} />
          ))}
        </div>
      </div>

      {/* Warnings / best practices */}
      {flow.steps.length > 5 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning">
            <strong>Atenção:</strong> Este fluxo possui {flow.steps.length} etapas. Recomendamos no máximo 3-5 etapas para evitar saturação.
          </p>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-card-foreground mb-3">Variáveis Utilizadas</h4>
        <div className="flex flex-wrap gap-2">
          {Array.from(new Set(flow.steps.flatMap((s) => s.variables))).map((v) => {
            const info = availableVariables.find(av => av.key === v);
            return (
              <span key={v} className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-mono" title={info?.label}>
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

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function StepItem({ step, isLast, index }: { step: AutomationStep; isLast: boolean; index: number }) {
  const channelIcon = step.channel === "whatsapp" ? MessageSquare : step.channel === "sms" ? Smartphone : Mail;
  const channelLabel = step.channel === "whatsapp" ? "WhatsApp" : step.channel === "sms" ? "SMS" : "E-mail";

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold shrink-0">
          {index + 1}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border my-1" />}
      </div>
      <div className={`flex-1 ${!isLast ? "pb-4" : ""}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Clock className="h-3 w-3" /> {step.delay}
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            {(() => { const Icon = channelIcon; return <Icon className="h-3 w-3" />; })()}
            {channelLabel}
          </span>
        </div>
        <div className="bg-muted/50 rounded-lg p-3 text-xs text-foreground leading-relaxed border border-border/50">
          {step.message.split(/(\{\{[^}]+\}\})/).map((part, i) =>
            part.startsWith("{{") ? (
              <span key={i} className="px-1 py-0.5 rounded bg-primary/10 text-primary font-mono text-[11px]">
                {part}
              </span>
            ) : (
              <span key={i}>{part}</span>
            )
          )}
        </div>
      </div>
    </div>
  );
}
