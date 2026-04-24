import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  RefreshCcw, MessageSquare, Send, Clock, Users, Plus, X,
  Instagram, Facebook, Globe, Phone, Search,
  CheckCircle2, AlertCircle, Loader2, Trash2, PlayCircle, PauseCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  reativacaoApi,
  type ReactivationRule,
  type ReactivationOrigin,
  type ReactivationStatus,
  type ReactivationPatient,
  type ReactivationKpis,
} from "@/lib/vpsApi";
import { toast } from "sonner";

export const Route = createFileRoute("/reativacao")({
  ssr: false,
  component: ReativacaoPage,
});

const originConfig: Record<ReactivationOrigin, { label: string; icon: React.ElementType; color: string }> = {
  instagram: { label: "Instagram", icon: Instagram, color: "text-chart-3" },
  facebook: { label: "Facebook", icon: Facebook, color: "text-chart-1" },
  google: { label: "Google Ads", icon: Globe, color: "text-chart-4" },
  indicacao: { label: "Indicação", icon: Users, color: "text-chart-2" },
  whatsapp: { label: "WhatsApp", icon: Phone, color: "text-success" },
  site: { label: "Site", icon: Globe, color: "text-primary" },
  todos: { label: "Todos", icon: Users, color: "text-muted-foreground" },
};

const statusCfg: Record<ReactivationStatus, { label: string; color: string }> = {
  ativo: { label: "Ativo", color: "bg-success/15 text-success" },
  pausado: { label: "Pausado", color: "bg-warning/15 text-warning" },
  rascunho: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
};

const avatarColors = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

function ReativacaoPage() {
  const [rules, setRules] = useState<ReactivationRule[]>([]);
  const [kpis, setKpis] = useState<ReactivationKpis | null>(null);
  const [loadingRules, setLoadingRules] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRule, setSelectedRule] = useState<ReactivationRule | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const [patients, setPatients] = useState<ReactivationPatient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [sending, setSending] = useState(false);

  // New rule form state
  const [newName, setNewName] = useState("");
  const [newDays, setNewDays] = useState(180);
  const [newOrigin, setNewOrigin] = useState<ReactivationOrigin>("todos");
  const [newMessage, setNewMessage] = useState(
    "Olá {nome}! Sentimos sua falta 😊 Agende sua consulta de retorno!"
  );

  const loadAll = useCallback(async () => {
    setLoadingRules(true);
    setError(null);
    const [rulesRes, kpisRes] = await Promise.all([
      reativacaoApi.listRules(),
      reativacaoApi.kpis(),
    ]);
    if (rulesRes.error) setError(rulesRes.error);
    setRules(rulesRes.data || []);
    setKpis(kpisRes.data || null);
    setLoadingRules(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Reload selected rule's patients whenever selected changes
  useEffect(() => {
    if (!selectedRule) {
      setPatients([]);
      setSelectedIds(new Set());
      return;
    }
    let cancelled = false;
    setLoadingPatients(true);
    reativacaoApi.patients(selectedRule.id).then((res) => {
      if (cancelled) return;
      setPatients(res.data || []);
      setSelectedIds(new Set());
      setLoadingPatients(false);
      if (res.error) toast.error(res.error);
    });
    return () => { cancelled = true; };
  }, [selectedRule?.id]);

  const filteredPatients = useMemo(() => {
    if (!searchTerm) return patients;
    const q = searchTerm.toLowerCase();
    return patients.filter((p) => p.name.toLowerCase().includes(q) || p.phone.includes(q));
  }, [patients, searchTerm]);

  const selectedCount = selectedIds.size;

  const togglePatient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const visibleIds = filteredPatients.map((p) => p.id);
    const allSelected = visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleCreateRule = async () => {
    if (!newName.trim() || !newMessage.trim()) {
      toast.error("Preencha nome e mensagem");
      return;
    }
    const { data, error: err } = await reativacaoApi.createRule({
      name: newName.trim(),
      inactiveDays: newDays,
      origin: newOrigin,
      messageTemplate: newMessage,
      status: "rascunho",
    });
    if (err || !data) {
      toast.error(err || "Falha ao criar regra");
      return;
    }
    toast.success("Regra criada");
    setShowNewForm(false);
    setNewName("");
    setNewDays(180);
    setNewOrigin("todos");
    setNewMessage("Olá {nome}! Sentimos sua falta 😊 Agende sua consulta de retorno!");
    await loadAll();
  };

  const handleToggleStatus = async (rule: ReactivationRule) => {
    const next: ReactivationStatus = rule.status === "ativo" ? "pausado" : "ativo";
    const { error: err } = await reativacaoApi.updateRule(rule.id, { status: next });
    if (err) { toast.error(err); return; }
    toast.success(next === "ativo" ? "Regra ativada" : "Regra pausada");
    await loadAll();
    if (selectedRule?.id === rule.id) {
      setSelectedRule({ ...rule, status: next });
    }
  };

  const handleDeleteRule = async (rule: ReactivationRule) => {
    if (!window.confirm(`Excluir regra "${rule.name}"?`)) return;
    const { error: err } = await reativacaoApi.deleteRule(rule.id);
    if (err) { toast.error(err); return; }
    toast.success("Regra excluída");
    if (selectedRule?.id === rule.id) setSelectedRule(null);
    await loadAll();
  };

  const handleSend = async () => {
    if (!selectedRule) return;
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      toast.error("Selecione ao menos um paciente");
      return;
    }
    if (!window.confirm(`Enviar mensagem para ${ids.length} paciente(s)?`)) return;
    setSending(true);
    const { data, error: err } = await reativacaoApi.send(selectedRule.id, ids);
    setSending(false);
    if (err || !data) { toast.error(err || "Falha no envio"); return; }
    toast.success(`Enviadas: ${data.sent} • Falhas: ${data.failed}`);
    setSelectedIds(new Set());
    await loadAll();
    // refresh patients
    const r = await reativacaoApi.patients(selectedRule.id);
    setPatients(r.data || []);
  };

  const totalActive = kpis?.activeRules ?? 0;
  const totalMatched = kpis?.inactivePatients ?? 0;
  const totalSent = kpis?.messagesSent ?? 0;
  const avgResponse = kpis?.responseRate ?? 0;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Reativação Inteligente" />
      <main className="flex-1 p-6 overflow-auto space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiBox icon={RefreshCcw} label="Regras Ativas" value={String(totalActive)} color="text-primary" />
          <KpiBox icon={Users} label="Pacientes Inativos" value={String(totalMatched)} color="text-warning" />
          <KpiBox icon={Send} label="Mensagens Enviadas" value={String(totalSent)} color="text-chart-1" />
          <KpiBox icon={MessageSquare} label="Taxa de Resposta" value={`${avgResponse.toFixed(0)}%`} color="text-success" />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Rules list */}
          <div className="lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Regras de Reativação</h3>
              <button
                onClick={() => { setShowNewForm(true); setSelectedRule(null); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90"
              >
                <Plus className="h-3 w-3" /> Nova Regra
              </button>
            </div>

            {loadingRules && rules.length === 0 ? (
              <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
            ) : rules.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Nenhuma regra criada. Crie a primeira para reativar pacientes inativos.
              </div>
            ) : (
              rules.map((rule) => {
                const oCfg = originConfig[rule.origin];
                const sCfg = statusCfg[rule.status];
                return (
                  <div
                    key={rule.id}
                    className={`group w-full text-left px-3 py-3 rounded-xl border transition-all ${
                      selectedRule?.id === rule.id ? "bg-primary/5 border-primary/30" : "border-transparent hover:bg-muted"
                    }`}
                  >
                    <button
                      onClick={() => { setSelectedRule(rule); setShowNewForm(false); }}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-foreground truncate pr-2">{rule.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${sCfg.color}`}>{sCfg.label}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <oCfg.icon className={`h-2.5 w-2.5 ${oCfg.color}`} /> {oCfg.label}
                        </span>
                        <span>≥{rule.inactiveDays} dias</span>
                        <span>{rule.matchedPatients} pacientes</span>
                      </div>
                      {rule.sentCount > 0 && (
                        <div className="flex items-center gap-3 mt-1 text-[10px]">
                          <span className="text-chart-1">{rule.sentCount} enviadas</span>
                          <span className="text-success">{rule.responseRate}% resposta</span>
                        </div>
                      )}
                    </button>
                    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleStatus(rule); }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 text-muted-foreground flex items-center gap-1"
                        title={rule.status === "ativo" ? "Pausar" : "Ativar"}
                      >
                        {rule.status === "ativo" ? <PauseCircle className="h-3 w-3" /> : <PlayCircle className="h-3 w-3" />}
                        {rule.status === "ativo" ? "Pausar" : "Ativar"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteRule(rule); }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center gap-1"
                      >
                        <Trash2 className="h-3 w-3" /> Excluir
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Detail / Form */}
          <div className="lg:col-span-8 space-y-4">
            {showNewForm ? (
              <div className="bg-card rounded-xl border border-border p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Nova Regra de Reativação</h3>
                  <button onClick={() => setShowNewForm(false)} className="p-1 rounded-md hover:bg-muted">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Nome da Regra</label>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Ex: Inativos 6m — Instagram"
                      className="mt-1 w-full h-9 px-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Dias de Inatividade (mínimo)</label>
                    <input
                      type="number"
                      value={newDays}
                      onChange={(e) => setNewDays(Number(e.target.value))}
                      min={30}
                      className="mt-1 w-full h-9 px-3 rounded-lg bg-muted border-0 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Origem do Paciente</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(Object.keys(originConfig) as ReactivationOrigin[]).map((key) => {
                      const cfg = originConfig[key];
                      return (
                        <button
                          key={key}
                          onClick={() => setNewOrigin(key)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                            newOrigin === key
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <cfg.icon className="h-3 w-3" /> {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Modelo de Mensagem</label>
                  <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    rows={3}
                    placeholder="Use {nome} para personalizar..."
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                  <p className="text-[9px] text-muted-foreground mt-1">Variáveis: {"{nome}"}, {"{tratamento}"}, {"{dias_inativo}"}</p>
                </div>

                <div className="flex items-center justify-end pt-2 border-t border-border">
                  <button
                    onClick={handleCreateRule}
                    disabled={!newName.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-3.5 w-3.5" /> Criar Regra
                  </button>
                </div>
              </div>
            ) : selectedRule ? (
              <>
                {/* Rule detail header */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{selectedRule.name}</h3>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          {(() => { const C = originConfig[selectedRule.origin]; return <><C.icon className={`h-3 w-3 ${C.color}`} /> {C.label}</>; })()}
                        </span>
                        <span>≥ {selectedRule.inactiveDays} dias inativo</span>
                        {selectedRule.lastRun && (
                          <span>Último envio: {new Date(selectedRule.lastRun).toLocaleString("pt-BR")}</span>
                        )}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusCfg[selectedRule.status].color}`}>
                      {statusCfg[selectedRule.status].label}
                    </span>
                  </div>

                  <div className="bg-muted/50 rounded-lg p-3 mb-3">
                    <p className="text-[10px] text-muted-foreground uppercase font-medium mb-1">Mensagem</p>
                    <p className="text-xs text-foreground whitespace-pre-wrap">{selectedRule.messageTemplate}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Pacientes</p>
                      <p className="text-sm font-bold text-foreground">{selectedRule.matchedPatients}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Enviadas</p>
                      <p className="text-sm font-bold text-chart-1">{selectedRule.sentCount}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Resposta</p>
                      <p className="text-sm font-bold text-success">{selectedRule.responseRate}%</p>
                    </div>
                  </div>
                </div>

                {/* Patients list */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-foreground">Pacientes Correspondentes</h4>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <input
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Buscar..."
                          className="h-7 pl-6 pr-2 w-36 rounded-md bg-muted border-0 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <button
                        onClick={selectAll}
                        disabled={filteredPatients.length === 0}
                        className="px-2 py-1 rounded-md bg-muted text-[10px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {filteredPatients.length > 0 && filteredPatients.every((p) => selectedIds.has(p.id))
                          ? "Desmarcar"
                          : "Selecionar"} Todos
                      </button>
                    </div>
                  </div>

                  {loadingPatients ? (
                    <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
                  ) : (
                    <div className="space-y-1">
                      {filteredPatients.map((patient, idx) => {
                        const oCfg = originConfig[patient.origin] || originConfig.site;
                        const checked = selectedIds.has(patient.id);
                        const avatarColor = avatarColors[idx % avatarColors.length];
                        return (
                          <div
                            key={patient.id}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
                              checked ? "bg-primary/5" : "hover:bg-muted/50"
                            }`}
                            onClick={() => togglePatient(patient.id)}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePatient(patient.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
                            />
                            <div className={`h-7 w-7 rounded-full ${avatarColor} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
                              {patient.initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">{patient.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{patient.phone || "Sem telefone"}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] text-warning font-medium">{patient.daysSince} dias</p>
                              <p className="text-[9px] text-muted-foreground">
                                {patient.lastVisit
                                  ? new Date(patient.lastVisit).toLocaleDateString("pt-BR")
                                  : "—"}
                              </p>
                            </div>
                            <span className={`flex items-center gap-0.5 text-[9px] shrink-0 ${oCfg.color}`}>
                              <oCfg.icon className="h-2.5 w-2.5" /> {oCfg.label}
                            </span>
                          </div>
                        );
                      })}
                      {filteredPatients.length === 0 && (
                        <div className="py-8 text-center text-xs text-muted-foreground">
                          Nenhum paciente corresponde aos critérios desta regra.
                        </div>
                      )}
                    </div>
                  )}

                  {selectedCount > 0 && (
                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        <CheckCircle2 className="inline h-3 w-3 text-primary mr-1" />
                        {selectedCount} paciente{selectedCount > 1 ? "s" : ""} selecionado{selectedCount > 1 ? "s" : ""}
                      </p>
                      <button
                        onClick={handleSend}
                        disabled={sending || selectedRule.status === "pausado"}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success text-white text-xs font-medium hover:bg-success/90 disabled:opacity-50"
                      >
                        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        {sending ? "Enviando…" : "Enviar via WhatsApp"}
                      </button>
                    </div>
                  )}
                  {selectedRule.status === "pausado" && (
                    <p className="mt-2 text-[10px] text-warning flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Regra pausada — ative-a para enviar mensagens.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <RefreshCcw className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione ou crie uma regra</h3>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Crie regras para reativar pacientes inativos filtrados por origem (Instagram, Facebook, Google, etc.) e tempo sem visita.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiBox({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
