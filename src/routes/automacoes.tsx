import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Play, Pause, Plus, Clock, MessageSquare, Mail, Smartphone,
  Zap, Settings2, Send, CheckCircle2, Edit2, Save, Loader2, RotateCcw,
} from "lucide-react";
import { useState, useEffect } from "react";
import {
  mockAutomationFlows, automationTypes,
  type AutomationFlow, type AutomationStep,
} from "@/data/automationMockData";
import { automationsApi, type FollowupAutomationConfig } from "@/lib/vpsApi";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/automacoes")({
  ssr: false,
  component: AutomacoesPage,
});

function AutomacoesPage() {
  const [flows, setFlows] = useState(mockAutomationFlows);
  const [selectedFlow, setSelectedFlow] = useState<AutomationFlow | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [showFollowupConfig, setShowFollowupConfig] = useState(false);

  // Follow-up automation config from API
  const [followupConfig, setFollowupConfig] = useState<FollowupAutomationConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    automationsApi.getFollowup()
      .then((res) => { if (res.data) setFollowupConfig(res.data); })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, []);

  const filtered = filterType === "all" ? flows : flows.filter((f) => f.type === filterType);

  const toggleActive = (id: string) => {
    setFlows((prev) => prev.map((f) => f.id === id ? { ...f, active: !f.active } : f));
  };

  const totalSent = flows.reduce((a, f) => a + f.stats.sent, 0);
  const totalResponded = flows.reduce((a, f) => a + f.stats.responded, 0);
  const totalConverted = flows.reduce((a, f) => a + f.stats.converted, 0);
  const responseRate = totalSent > 0 ? ((totalResponded / totalSent) * 100).toFixed(1) : "0";

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Automação de Relacionamento" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MiniKpi icon={Zap} label="Fluxos Ativos" value={flows.filter((f) => f.active).length.toString()} />
          <MiniKpi icon={Send} label="Mensagens Enviadas" value={totalSent.toString()} />
          <MiniKpi icon={MessageSquare} label="Taxa de Resposta" value={`${responseRate}%`} />
          <MiniKpi icon={CheckCircle2} label="Conversões" value={totalConverted.toString()} />
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
            <p className="text-sm text-muted-foreground">Configure mensagens automáticas por gatilho</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-sm">
              <button
                onClick={() => setFilterType("all")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterType === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Todos
              </button>
              {automationTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFilterType(t.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterType === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                const newFlow: AutomationFlow = {
                  id: `af${Date.now()}`,
                  name: "Novo Fluxo",
                  type: "pos_consulta",
                  active: false,
                  trigger: "Definir gatilho...",
                  steps: [
                    { id: `s${Date.now()}`, delay: "Imediato", channel: "whatsapp", message: "Olá {{nome}}!", variables: ["nome"] },
                  ],
                  stats: { sent: 0, responded: 0, converted: 0 },
                  createdAt: new Date().toLocaleDateString("pt-BR"),
                };
                setFlows((prev) => [newFlow, ...prev]);
                setSelectedFlow(newFlow);
                toast.success("Novo fluxo criado! Edite os detalhes.");
              }}
              className="flex items-center gap-2 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Novo Fluxo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Flow list */}
          <div className="lg:col-span-1 space-y-3">
            {filtered.map((flow) => (
              <FlowCard
                key={flow.id}
                flow={flow}
                isSelected={selectedFlow?.id === flow.id}
                onSelect={() => setSelectedFlow(flow)}
                onToggle={() => toggleActive(flow.id)}
              />
            ))}
          </div>

          {/* Flow detail */}
          <div className="lg:col-span-2">
            {selectedFlow ? (
              <FlowDetail flow={selectedFlow} />
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center h-full min-h-[400px]">
                <Zap className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um fluxo</h3>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Clique em um fluxo ao lado para visualizar as etapas, mensagens e métricas.
                </p>
              </div>
            )}
          </div>
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

// ─── Existing components ────────────────────────────────────

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

function FlowCard({
  flow, isSelected, onSelect, onToggle,
}: {
  flow: AutomationFlow; isSelected: boolean; onSelect: () => void; onToggle: () => void;
}) {
  const typeInfo = automationTypes.find((t) => t.id === flow.type);
  return (
    <div
      onClick={onSelect}
      className={`bg-card rounded-xl border p-4 cursor-pointer transition-all ${
        isSelected ? "border-primary ring-1 ring-primary/20" : "border-border hover:border-primary/40"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${flow.active ? "bg-success" : "bg-muted-foreground/40"}`} />
          <span className="text-sm font-medium text-foreground">{flow.name}</span>
        </div>
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
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${typeInfo?.color}/15 text-foreground`}>
          {typeInfo?.label}
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

function FlowDetail({ flow }: { flow: AutomationFlow }) {
  const typeInfo = automationTypes.find((t) => t.id === flow.type);
  const responseRate = flow.stats.sent > 0 ? ((flow.stats.responded / flow.stats.sent) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">{flow.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gatilho: <span className="text-foreground font-medium">{flow.trigger}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Edit2 className="h-3 w-3" /> Editar
            </button>
            <button className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Settings2 className="h-3 w-3" /> Configurar
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <StatBox label="Enviadas" value={flow.stats.sent.toString()} />
          <StatBox label="Respondidas" value={flow.stats.responded.toString()} />
          <StatBox label="Taxa Resposta" value={`${responseRate}%`} />
          <StatBox label="Conversões" value={flow.stats.converted.toString()} />
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-card-foreground mb-4">Etapas do Fluxo</h4>
        <div className="space-y-0">
          {flow.steps.map((step, i) => (
            <StepItem key={step.id} step={step} isLast={i === flow.steps.length - 1} index={i} />
          ))}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-card-foreground mb-3">Variáveis Disponíveis</h4>
        <div className="flex flex-wrap gap-2">
          {Array.from(new Set(flow.steps.flatMap((s) => s.variables))).map((v) => (
            <span key={v} className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-mono">
              {"{{" + v + "}}"}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

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
