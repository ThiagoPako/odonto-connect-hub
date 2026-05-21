import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, RefreshCw, CheckCircle2, AlertCircle, PlayCircle, Plug, ListChecks, Shield, Trash2, Plus, ChevronDown, ChevronRight, ExternalLink, User, Users, CalendarDays, History, Pencil, X, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  clinicorpApi,
  type ClinicorpSettings,
  type ClinicorpWebhookEvent,
  type ClinicorpSyncResult,
  type ClinicorpOverride,
  type ClinicorpConflict,
  type ClinicorpOverrideHistory,
} from "@/lib/clinicorpApi";
import { ClinicorpUserCredentials } from "@/components/ClinicorpUserCredentials";
import { ClinicorpIntegrationGuide } from "@/components/ClinicorpIntegrationGuide";
import { ClinicorpAuditLog } from "@/components/clinicorp/ClinicorpAuditLog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ClinicorpPanel() {
  const [settings, setSettings] = useState<ClinicorpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; auth: string; total_latency_ms: number; results: any[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    step: string;
    summary: Record<string, number>;
    errors: string[];
    startTime: number;
    completed: boolean;
  } | null>(null);
  const [events, setEvents] = useState<ClinicorpWebhookEvent[]>([]);
  const [lastSync, setLastSync] = useState<ClinicorpSyncResult | null>(null);

  // form state (apenas configurações de comportamento — credenciais ficam no ClinicorpUserCredentials)
  const [autoSync, setAutoSync] = useState(true);
  const [intervalMin, setIntervalMin] = useState(30);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [lookaheadDays, setLookaheadDays] = useState(60);
  const [conflictStrategy, setConflictStrategy] = useState<"clinicorp_wins" | "local_wins" | "newest_wins">("newest_wins");
  const [overrides, setOverrides] = useState<ClinicorpOverride[]>([]);
  const [conflicts, setConflicts] = useState<ClinicorpConflict[]>([]);
  const [conflictFilterEntity, setConflictFilterEntity] = useState<"" | "appointment" | "patient">("");
  const [conflictFilterDecision, setConflictFilterDecision] = useState<string>("");
  const [expandedConflicts, setExpandedConflicts] = useState<Set<number>>(new Set());

  async function reloadConflicts() {
    const cfs = await clinicorpApi.listConflicts({
      limit: 200,
      entity: conflictFilterEntity || undefined,
      decision: conflictFilterDecision || undefined,
    });
    setConflicts(cfs);
  }

  function toggleConflict(id: number) {
    setExpandedConflicts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const [newOvScope, setNewOvScope] = useState<"global" | "clinic" | "professional">("professional");
  const [newOvId, setNewOvId] = useState("");
  const [newOvLabel, setNewOvLabel] = useState("");
  const [newOvKeepLocal, setNewOvKeepLocal] = useState(true);
  const [newOvStrategy, setNewOvStrategy] = useState<"" | "clinicorp_wins" | "local_wins" | "newest_wins">("");
  const [newOvNote, setNewOvNote] = useState("");
  const [newOvErrors, setNewOvErrors] = useState<Record<string, string>>({});
  const [editingOvId, setEditingOvId] = useState<number | null>(null);
  const [clinicsList, setClinicsList] = useState<Array<{ id: string; name: string }>>([]);
  const [profsList, setProfsList] = useState<Array<{ id: string; name: string }>>([]);
  const [history, setHistory] = useState<ClinicorpOverrideHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const s = await clinicorpApi.getSettings();
      setSettings(s);
      setAutoSync(s.auto_sync_enabled ?? true);
      setIntervalMin(s.sync_interval_minutes ?? 30);
      setLookbackDays(s.sync_lookback_days ?? 30);
      setLookaheadDays(s.sync_lookahead_days ?? 60);
      setConflictStrategy(s.conflict_strategy ?? "newest_wins");
      const [evs, ovs, cfs, hist] = await Promise.all([
        clinicorpApi.listWebhookEvents(50),
        clinicorpApi.listOverrides(),
        clinicorpApi.listConflicts({ limit: 50 }),
        clinicorpApi.listOverrideHistory({ limit: 100 }).catch(() => []),
      ]);
      setEvents(evs);
      setOverrides(ovs);
      setConflicts(cfs);
      setHistory(hist);
      // tenta carregar clínicas e profissionais para os selects (não bloqueia)
      if (s.enabled) {
        clinicorpApi.listClinics().then((rows) => {
          setClinicsList(rows.map((r) => ({
            id: String((r as Record<string, unknown>).id ?? (r as Record<string, unknown>).Id ?? ''),
            name: String((r as Record<string, unknown>).name ?? (r as Record<string, unknown>).BusinessName ?? (r as Record<string, unknown>).Name ?? ''),
          })).filter((c) => c.id));
        }).catch(() => {});
        clinicorpApi.listProfessionals().then((rows) => {
          setProfsList(rows.map((r) => ({
            id: String((r as Record<string, unknown>).id ?? (r as Record<string, unknown>).Id ?? (r as Record<string, unknown>).Dentist_PersonId ?? ''),
            name: String((r as Record<string, unknown>).full_name ?? (r as Record<string, unknown>).FullName ?? (r as Record<string, unknown>).Name ?? ''),
          })).filter((p) => p.id));
        }).catch(() => {});
      }
    } catch (e) {
      toast.error(`Falha ao carregar configurações: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await clinicorpApi.saveSettings({
        auto_sync_enabled: autoSync,
        sync_interval_minutes: intervalMin,
        sync_lookback_days: lookbackDays,
        sync_lookahead_days: lookaheadDays,
        conflict_strategy: conflictStrategy,
      });
      toast.success("Configurações salvas");
      await load();
    } catch (e) {
      toast.error(`Erro ao salvar: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await clinicorpApi.testMyConnection({});
      setTestResult(r as any);
      if (r.ok) toast.success(`Conexão OK em ${r.total_latency_ms}ms`);
      else toast.error(r.error || "Falha na conexão");
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setLastSync(null);
    setSyncStatus({
      step: "Iniciando sincronização completa...",
      summary: {},
      errors: [],
      startTime: Date.now(),
      completed: false,
    });

    let polling = true;
    const poll = async () => {
      while (polling) {
        try {
          const s = await clinicorpApi.getMySettings();
          if (s.last_sync_status === 'syncing') {
            setSyncStatus(prev => ({
              ...prev!,
              step: s.last_sync_error || "Sincronizando dados...",
            }));
          } else if (s.last_sync_at && new Date(s.last_sync_at).getTime() > Date.now() - 5000) {
             // Sync finished according to settings
             polling = false;
          }
        } catch (e) { console.error("Poll error", e); }
        await new Promise(r => setTimeout(r, 2000));
      }
    };

    poll();

    try {
      // Usa endpoint per-user (multi-tenant SaaS) — sincroniza com as credenciais do usuário logado
      const r = await clinicorpApi.syncMyNow();
      polling = false;
      setLastSync(r);
      setSyncStatus(prev => ({
        ...prev!,
        step: "Sincronização concluída com sucesso!",
        summary: r.summary,
        errors: r.errors,
        completed: true,
      }));
      toast.success(`Sync ${r.status} — ${Object.values(r.summary).reduce((a, b) => a + b, 0)} registros processados`);
      await load();
    } catch (e) {
      polling = false;
      const msg = (e as Error).message;
      setSyncStatus(prev => ({
        ...prev!,
        step: "Erro durante a sincronização",
        errors: [msg],
        completed: true,
      }));
      toast.error(`Sync falhou: ${msg}`);
    } finally {
      setSyncing(false);
    }
  }

  // (credenciais e webhook ficam agora 100% no ClinicorpUserCredentials acima)


  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="integracao" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="integracao" className="gap-2">
            <Plug className="h-4 w-4" /> Configuração
          </TabsTrigger>
          <TabsTrigger value="auditoria" className="gap-2">
            <History className="h-4 w-4" /> Auditoria e Espelho
          </TabsTrigger>
        </TabsList>

        <TabsContent value="integracao" className="space-y-6">
          {/* Integration guide matching Clinicorp's UI flow */}
          <ClinicorpIntegrationGuide />

          {/* Per-user credentials (SaaS multi-tenant) */}
          <ClinicorpUserCredentials />



      {/* Status header — somente leitura, controles ficam em ClinicorpUserCredentials acima */}
      <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${settings?.enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
          <Plug className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">Status da integração</h3>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${settings?.enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {settings?.enabled ? "Ativo" : "Desativado"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Espelhamento em tempo real via webhook + sync periódico de agenda, profissionais, pacientes e financeiro.
          </p>
          {settings?.last_sync_at && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Última sincronização: {new Date(settings.last_sync_at).toLocaleString("pt-BR")} —{" "}
              <span className={settings.last_sync_status === "success" ? "text-success" : settings.last_sync_status === "partial" ? "text-warning" : "text-destructive"}>
                {settings.last_sync_status}
              </span>
              {settings.last_sync_error && <span className="block text-destructive mt-1">{settings.last_sync_error}</span>}
            </p>
          )}
        </div>
      </div>

      {/* Ações de sincronização e manutenção */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Ações de sincronização</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Use estas ações para forçar uma sincronização manual ou reconciliar dados. O espelhamento normal é automático
          (webhook em tempo real + job periódico configurado abaixo).
        </p>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Verificar conexão
          </Button>
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar agora
          </Button>

          <Button
            variant="outline"
            onClick={async () => {
              try {
                const r = await clinicorpApi.reproject();
                toast.success(`Reprojetado: ${r.patients} pacientes, ${r.appointments} agendamentos no CRM/Agenda`);
              } catch (e) {
                toast.error(`Falha ao reprojetar: ${(e as Error).message}`);
              }
            }}
            disabled={!settings?.enabled}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reprojetar no CRM/Agenda
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const r = await clinicorpApi.reconcileNow();
                if (r.skipped) toast.info("Reconciliação não foi disparada (integração desabilitada ou bloqueada)");
                else if (r.error) toast.error(`Reconciliação falhou: ${r.error}`);
                else toast.success(`Reconciliação ${r.status} concluída`);
                await load();
              } catch (e) { toast.error(`Falha: ${(e as Error).message}`); }
            }}
            disabled={!settings?.enabled}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reconciliar agora
          </Button>
        </div>
        
        {/* Sync Status Real-time Panel */}
        {(syncing || syncStatus) && (
          <div className="rounded-2xl border border-border bg-card/50 overflow-hidden animate-in fade-in slide-in-from-top-4">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : syncStatus?.errors.length ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                )}
                <span className="text-sm font-semibold">Status do Sync em Tempo Real</span>
              </div>
              {syncStatus && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  Tempo decorrido: {Math.round((Date.now() - syncStatus.startTime) / 1000)}s
                </span>
              )}
            </div>
            
            <div className="p-4 space-y-4">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{syncStatus?.step}</p>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all duration-500",
                      syncing ? "bg-primary animate-pulse w-2/3" : syncStatus?.completed ? "bg-success w-full" : "bg-primary w-full"
                    )} 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Clínicas", key: "clinics", icon: Building2 },
                  { label: "Profissionais", key: "professionals", icon: User },
                  { label: "Pacientes", key: "patients", icon: Users },
                  { label: "Agendamentos", key: "appointments", icon: CalendarDays },
                ].map((item) => (
                  <div key={item.key} className="p-3 rounded-xl bg-muted/40 border border-border/50 flex flex-col items-center gap-1">
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{item.label}</span>
                    <span className="text-lg font-bold">{syncStatus?.summary[item.key] || 0}</span>
                  </div>
                ))}
              </div>

              {syncStatus?.errors.length ? (
                <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3">
                  <p className="text-xs font-bold text-destructive flex items-center gap-1.5 mb-2">
                    <AlertCircle className="h-3.5 w-3.5" /> Erros encontrados:
                  </p>
                  <ul className="text-[11px] text-destructive/80 space-y-1 font-mono">
                    {syncStatus.errors.map((err, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="opacity-50">[{i+1}]</span>
                        <span className="break-all">{err}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : syncStatus?.completed && (
                <div className="text-center py-2">
                  <p className="text-xs text-success font-medium flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Todos os módulos processados com sucesso
                  </p>
                </div>
              )}
            </div>
            {syncStatus?.completed && (
              <div className="p-3 border-t border-border bg-muted/20 flex justify-end">
                <Button variant="ghost" size="sm" className="h-7 text-[10px] uppercase font-bold px-3" onClick={() => setSyncStatus(null)}>
                  Fechar relatório
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Test result panel (Global) */}
        {testResult && (
          <div className={`rounded-lg border p-3 space-y-2 mt-4 ${
            testResult.ok ? "border-emerald-500/30 bg-emerald-500/5"
            : testResult.auth === "invalid_token" ? "border-destructive/30 bg-destructive/5"
            : "border-amber-500/30 bg-amber-500/5"
          }`}>
            <div className="flex items-center gap-2 text-sm font-medium">
              {testResult.ok
                ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Conexão global validada</>
                : testResult.auth === "invalid_token"
                  ? <><AlertCircle className="h-4 w-4 text-destructive" /> Falha de autenticação global</>
                  : <><AlertCircle className="h-4 w-4 text-amber-600" /> Conexão global parcial</>}
              <span className="ml-auto text-xs text-muted-foreground">{testResult.total_latency_ms}ms</span>
            </div>
            {testResult.results?.length > 0 && (
              <ul className="text-xs space-y-1">
                {testResult.results.map((r: any) => (
                  <li key={r.key} className="flex items-center gap-2">
                    {r.ok
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      : <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                    <span className="font-medium">{r.label}</span>
                    <span className="text-muted-foreground">{r.latency_ms}ms</span>
                    {r.ok
                      ? <span className="text-muted-foreground">· {r.count ?? 0} reg.</span>
                      : <span className="text-destructive truncate">· {r.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Auto-reconciliação */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">Reconciliação automática</div>
              <div className="text-xs text-muted-foreground">
                Job interno garante que o Postgres fique consistente com a Clinicorp mesmo após interrupções (catch-up automático).
              </div>
            </div>
            <Switch checked={autoSync} onCheckedChange={setAutoSync} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Intervalo (min)</Label>
              <Input type="number" min={5} max={1440} value={intervalMin}
                onChange={(e) => setIntervalMin(Number(e.target.value) || 30)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Janela passada (dias)</Label>
              <Input type="number" min={1} max={365} value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value) || 30)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Janela futura (dias)</Label>
              <Input type="number" min={1} max={365} value={lookaheadDays}
                onChange={(e) => setLookaheadDays(Number(e.target.value) || 60)} />
            </div>
          </div>
          {settings?.next_sync_at && (
            <div className="text-xs text-muted-foreground">
              Próxima execução: <span className="text-foreground">{new Date(settings.next_sync_at).toLocaleString("pt-BR")}</span>
              {settings.sync_lock_until && new Date(settings.sync_lock_until) > new Date() && (
                <span className="ml-2 text-warning">• Lock ativo até {new Date(settings.sync_lock_until).toLocaleTimeString("pt-BR")}</span>
              )}
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar configurações
            </Button>
          </div>
        </div>

        {lastSync && (
          <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-1">
            <div className="font-medium text-foreground">Resultado do último sync ({lastSync.status})</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-muted-foreground">
              {Object.entries(lastSync.summary).map(([k, v]) => (
                <div key={k}><span className="text-foreground">{v}</span> {k}</div>
              ))}
            </div>
            {lastSync.errors.length > 0 && (
              <div className="text-destructive pt-1">{lastSync.errors.join(" • ")}</div>
            )}
          </div>
        )}
      </div>

      {/* Resolução de conflitos */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Resolução de conflitos</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Define o que acontece quando o mesmo registro foi editado nos dois lados desde o último sync.
          A precedência é: <strong>profissional &gt; clínica &gt; global &gt; padrão</strong>.
          “Manter local” congela o registro contra qualquer sobrescrita vinda da Clinicorp.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {([
            { v: "newest_wins",     t: "Mais recente vence", d: "Compara updated_at. Padrão recomendado." },
            { v: "clinicorp_wins",  t: "Clinicorp sempre",   d: "Sobrescreve o local em todo sync." },
            { v: "local_wins",      t: "Local sempre",       d: "Só atualiza se o local não foi tocado." },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setConflictStrategy(opt.v)}
              className={`text-left rounded-lg border p-3 transition ${
                conflictStrategy === opt.v
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <div className="text-sm font-medium text-foreground">{opt.t}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{opt.d}</div>
            </button>
          ))}
        </div>

        {/* Overrides — UI completa */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">Exceções por clínica / profissional</div>
              <p className="text-[11px] text-muted-foreground">
                Precedência: <strong>profissional &gt; clínica &gt; global</strong>. Exceções mais específicas vencem.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">{overrides.length} regra(s)</span>
              <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
                <History className="h-3.5 w-3.5 mr-1" />
                {showHistory ? "Ocultar histórico" : "Ver histórico"}
              </Button>
            </div>
          </div>

          {/* Lista atual de overrides */}
          {overrides.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Nenhuma exceção cadastrada — usando estratégia padrão acima.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3">Escopo</th>
                    <th className="py-2 pr-3">Identificador</th>
                    <th className="py-2 pr-3">Manter local</th>
                    <th className="py-2 pr-3">Estratégia</th>
                    <th className="py-2 pr-3">Atualizado</th>
                    <th className="py-2 pr-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {overrides
                    .slice()
                    .sort((a, b) => {
                      const order = { professional: 0, clinic: 1, global: 2 } as const;
                      return order[a.scope_type] - order[b.scope_type];
                    })
                    .map((o) => {
                      const list = o.scope_type === "clinic" ? clinicsList : o.scope_type === "professional" ? profsList : [];
                      const label = list.find((x) => x.id === o.scope_id)?.name;
                      return (
                        <tr key={o.id} className={`border-b border-border/40 ${editingOvId === o.id ? "bg-primary/5" : ""}`}>
                          <td className="py-2 pr-3">
                            <span className="inline-flex items-center gap-1">
                              {o.scope_type === "professional" ? <User className="h-3 w-3" /> :
                               o.scope_type === "clinic" ? <Building2 className="h-3 w-3" /> :
                               <Shield className="h-3 w-3" />}
                              {o.scope_type}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="font-mono text-[11px]">{o.scope_id || "—"}</div>
                            {label && <div className="text-[10px] text-muted-foreground">{label}</div>}
                          </td>
                          <td className="py-2 pr-3">
                            {o.keep_local
                              ? <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning text-[10px]">Sim</span>
                              : <span className="text-muted-foreground">Não</span>}
                          </td>
                          <td className="py-2 pr-3 font-mono text-[10px]">{o.conflict_strategy || "(herda)"}</td>
                          <td className="py-2 pr-3 text-muted-foreground text-[10px]">
                            {new Date(o.updated_at).toLocaleString("pt-BR")}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <Button size="sm" variant="ghost"
                              onClick={() => {
                                setEditingOvId(o.id);
                                setNewOvScope(o.scope_type);
                                setNewOvId(o.scope_id || "");
                                setNewOvLabel(label || "");
                                setNewOvKeepLocal(o.keep_local);
                                setNewOvStrategy(o.conflict_strategy || "");
                                setNewOvNote(o.note || "");
                                setNewOvErrors({});
                              }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost"
                              onClick={async () => {
                                if (!confirm("Remover esta exceção?")) return;
                                try { await clinicorpApi.deleteOverride(o.id); toast.success("Removido"); await load(); }
                                catch (e) { toast.error((e as Error).message); }
                              }}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Form: criar / editar override */}
          <div className="rounded-md border border-border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-foreground">
                {editingOvId ? "Editar exceção" : "Adicionar nova exceção"}
              </div>
              {editingOvId && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditingOvId(null);
                  setNewOvScope("professional"); setNewOvId(""); setNewOvLabel("");
                  setNewOvKeepLocal(true); setNewOvStrategy(""); setNewOvNote(""); setNewOvErrors({});
                }}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancelar
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Escopo *</Label>
                <select
                  value={newOvScope}
                  onChange={(e) => {
                    const v = e.target.value as "global" | "clinic" | "professional";
                    setNewOvScope(v);
                    if (v === "global") { setNewOvId(""); setNewOvLabel(""); }
                  }}
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="professional">Profissional</option>
                  <option value="clinic">Clínica</option>
                  <option value="global">Global (toda a clínica)</option>
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Específico vence o genérico. Use “global” como base.
                </p>
              </div>

              {newOvScope !== "global" && (
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs">{newOvScope === "clinic" ? "Clínica" : "Profissional"} *</Label>
                  {(newOvScope === "clinic" ? clinicsList : profsList).length > 0 ? (
                    <select
                      value={newOvId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setNewOvId(id);
                        const list = newOvScope === "clinic" ? clinicsList : profsList;
                        setNewOvLabel(list.find((x) => x.id === id)?.name || "");
                        setNewOvErrors((p) => ({ ...p, scope_id: "" }));
                      }}
                      className={`w-full h-9 rounded-md border bg-background px-2 text-sm ${newOvErrors.scope_id ? "border-destructive" : "border-border"}`}
                    >
                      <option value="">— selecione —</option>
                      {(newOvScope === "clinic" ? clinicsList : profsList).map((x) => (
                        <option key={x.id} value={x.id}>{x.name} (#{x.id})</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={newOvId}
                      onChange={(e) => { setNewOvId(e.target.value); setNewOvErrors((p) => ({ ...p, scope_id: "" })); }}
                      placeholder="ID Clinicorp (ex: 12345)"
                      className={newOvErrors.scope_id ? "border-destructive" : ""}
                    />
                  )}
                  {newOvErrors.scope_id && <p className="text-[10px] text-destructive">{newOvErrors.scope_id}</p>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
              <div className="space-y-1">
                <Label className="text-xs">Estratégia de conflito</Label>
                <select
                  value={newOvStrategy}
                  onChange={(e) => setNewOvStrategy(e.target.value as typeof newOvStrategy)}
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">(herdar do escopo superior)</option>
                  <option value="newest_wins">Mais recente vence</option>
                  <option value="clinicorp_wins">Clinicorp sempre</option>
                  <option value="local_wins">Local sempre</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Manter local (lock total)</Label>
                <div className="h-9 flex items-center gap-2 px-3 rounded-md border border-border bg-background">
                  <Switch checked={newOvKeepLocal} onCheckedChange={setNewOvKeepLocal} />
                  <span className="text-xs text-muted-foreground">
                    {newOvKeepLocal ? "Bloqueia sobrescritas" : "Segue a estratégia"}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nota (opcional)</Label>
                <Input
                  value={newOvNote}
                  maxLength={500}
                  onChange={(e) => { setNewOvNote(e.target.value); setNewOvErrors((p) => ({ ...p, note: "" })); }}
                  placeholder="Motivo / contexto"
                  className={newOvErrors.note ? "border-destructive" : ""}
                />
                <p className="text-[10px] text-muted-foreground text-right">{newOvNote.length}/500</p>
              </div>
            </div>

            {newOvErrors.rule && (
              <div className="text-[11px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {newOvErrors.rule}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1 border-t border-border">
              <Button
                onClick={async () => {
                  // Validação
                  const errs: Record<string, string> = {};
                  if (newOvScope !== "global") {
                    const id = newOvId.trim();
                    if (!id) errs.scope_id = "Selecione ou informe o ID";
                    else if (!/^[0-9A-Za-z_-]{1,64}$/.test(id)) errs.scope_id = "Use apenas letras, números, _ ou - (até 64)";
                  }
                  if (!newOvKeepLocal && !newOvStrategy) {
                    errs.rule = "Defina ao menos uma regra: ative “manter local” ou escolha uma estratégia.";
                  }
                  if (newOvNote.length > 500) errs.note = "Máx 500 caracteres";
                  setNewOvErrors(errs);
                  if (Object.keys(errs).length) return;

                  // Conflito de duplicidade no front
                  const dup = overrides.find((o) =>
                    o.scope_type === newOvScope &&
                    (o.scope_id || "") === (newOvScope === "global" ? "" : newOvId.trim()) &&
                    o.id !== editingOvId
                  );
                  if (dup) {
                    if (!confirm("Já existe uma regra para este escopo. Deseja sobrescrevê-la?")) return;
                  }

                  try {
                    await clinicorpApi.upsertOverride({
                      scope_type: newOvScope,
                      scope_id: newOvScope === "global" ? null : newOvId.trim(),
                      keep_local: newOvKeepLocal,
                      conflict_strategy: newOvStrategy || undefined,
                      note: newOvNote || undefined,
                      scope_label: newOvLabel || undefined,
                    });
                    toast.success(editingOvId ? "Exceção atualizada" : "Exceção criada");
                    setEditingOvId(null);
                    setNewOvId(""); setNewOvLabel(""); setNewOvNote("");
                    setNewOvStrategy(""); setNewOvKeepLocal(true);
                    await load();
                  } catch (e) { toast.error((e as Error).message); }
                }}
              >
                {editingOvId ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Salvar alterações</> : <><Plus className="h-4 w-4 mr-1" /> Adicionar exceção</>}
              </Button>
            </div>
          </div>

          {/* Histórico de mudanças */}
          {showHistory && (
            <div className="rounded-md border border-border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <History className="h-3.5 w-3.5" /> Histórico de alterações
                </div>
                <Button size="sm" variant="ghost"
                  onClick={async () => setHistory(await clinicorpApi.listOverrideHistory({ limit: 200 }))}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
                </Button>
              </div>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">Sem alterações registradas.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1">
                  {history.map((h) => {
                    const actionColor =
                      h.action === "create" ? "bg-success/15 text-success" :
                      h.action === "delete" ? "bg-destructive/15 text-destructive" :
                      "bg-primary/15 text-primary";
                    return (
                      <div key={h.id} className="flex items-start gap-2 p-2 rounded border border-border/40 text-[11px]">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${actionColor}`}>{h.action}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-foreground">
                            <span className="font-medium">{h.scope_type}</span>
                            {h.scope_id && <span className="font-mono text-muted-foreground"> · {h.scope_id}</span>}
                            {h.scope_label && <span className="text-muted-foreground"> ({h.scope_label})</span>}
                          </div>
                          {h.changed_fields && h.changed_fields.length > 0 && (
                            <div className="text-muted-foreground mt-0.5">
                              alterou: {h.changed_fields.map((f) => {
                                const b = (h.before_data as Record<string, unknown> | null)?.[f];
                                const a = (h.after_data as Record<string, unknown> | null)?.[f];
                                const fmt = (v: unknown) => v === null || v === undefined || v === "" ? "—" : String(v);
                                return (
                                  <span key={f} className="mr-2">
                                    <span className="font-medium">{f}</span>: <span className="text-warning">{fmt(b)}</span> → <span className="text-success">{fmt(a)}</span>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {h.note && <div className="text-muted-foreground italic mt-0.5">“{h.note}”</div>}
                        </div>
                        <div className="text-right text-muted-foreground shrink-0">
                          <div>{new Date(h.created_at).toLocaleString("pt-BR")}</div>
                          {h.changed_by && <div className="text-[10px]">por {h.changed_by}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Auditoria de conflitos com antes/depois */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">Auditoria de conflitos</div>
              <p className="text-[11px] text-muted-foreground">Histórico completo com snapshot antes/depois e link para o paciente/lead.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={conflictFilterEntity}
                onChange={(e) => setConflictFilterEntity(e.target.value as "" | "appointment" | "patient")}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="">Todas entidades</option>
                <option value="appointment">Agendamento</option>
                <option value="patient">Paciente</option>
              </select>
              <select
                value={conflictFilterDecision}
                onChange={(e) => setConflictFilterDecision(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="">Todas decisões</option>
                <option value="created">Criado</option>
                <option value="overwritten_by_clinicorp">Sobrescrito pela Clinicorp</option>
                <option value="kept_clinicorp_newer">Clinicorp mais recente</option>
                <option value="kept_local">Local preservado</option>
                <option value="kept_local_newer">Local mais recente</option>
              </select>
              <Button size="sm" variant="ghost" onClick={reloadConflicts}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
              </Button>
            </div>
          </div>

          {conflicts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">Nenhum conflito registrado.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-2">
              {conflicts.map((c) => {
                const expanded = expandedConflicts.has(c.id);
                const decisionColor =
                  c.decision.startsWith("kept_local") ? "bg-warning/15 text-warning" :
                  c.decision === "kept_clinicorp_newer" ? "bg-success/15 text-success" :
                  c.decision === "created" ? "bg-primary/15 text-primary" :
                  "bg-muted text-muted-foreground";
                const fields = c.changed_fields || [];
                return (
                  <div key={c.id} className="rounded-md border border-border bg-card">
                    <button
                      type="button"
                      onClick={() => toggleConflict(c.id)}
                      className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-muted/40"
                    >
                      {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className="text-[11px] text-muted-foreground tabular-nums">{new Date(c.created_at).toLocaleString("pt-BR")}</span>
                      <span className="text-xs font-medium flex items-center gap-1">
                        {c.entity === "appointment" ? <CalendarDays className="h-3 w-3" /> : <User className="h-3 w-3" />}
                        {c.entity === "appointment" ? "Agendamento" : "Paciente"}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${decisionColor}`}>{c.decision}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{c.strategy}</span>
                      {c.paciente_nome && (
                        <span className="text-xs text-foreground truncate max-w-[200px]">· {c.paciente_nome}</span>
                      )}
                      {fields.length > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {fields.length} campo{fields.length > 1 ? "s" : ""} alterado{fields.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </button>

                    {expanded && (
                      <div className="border-t border-border p-3 space-y-3 bg-muted/10">
                        {/* Links cruzados */}
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          {c.paciente_id && (
                            <Link
                              to="/pacientes"
                              search={{ pacienteId: c.paciente_id }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20"
                            >
                              <User className="h-3 w-3" /> Ver paciente
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                          {(c.lead_id || c.lead_id_resolved) && (
                            <Link
                              to="/crm"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent/40 text-foreground hover:bg-accent/60"
                            >
                              <ListChecks className="h-3 w-3" /> Ver no CRM
                              {c.lead_stage && <span className="text-[10px] text-muted-foreground">({c.lead_stage})</span>}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                          {c.agendamento_id && (
                            <Link
                              to="/agenda"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/40 text-foreground hover:bg-secondary/60"
                            >
                              <CalendarDays className="h-3 w-3" /> Abrir agenda
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            Escopo: {c.scope_type}{c.scope_id ? `:${c.scope_id}` : ""} · Clinicorp ID: {c.clinicorp_id || "—"}
                          </span>
                        </div>

                        {/* Timestamps */}
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div className="rounded border border-border/60 p-2">
                            <div className="text-muted-foreground">Última sync</div>
                            <div className="font-mono">{c.last_sync_at ? new Date(c.last_sync_at).toLocaleString("pt-BR") : "—"}</div>
                          </div>
                          <div className="rounded border border-border/60 p-2">
                            <div className="text-muted-foreground">Local atualizado</div>
                            <div className="font-mono">{c.local_updated_at ? new Date(c.local_updated_at).toLocaleString("pt-BR") : "—"}</div>
                          </div>
                          <div className="rounded border border-border/60 p-2">
                            <div className="text-muted-foreground">Clinicorp atualizado</div>
                            <div className="font-mono">{c.clinicorp_updated_at ? new Date(c.clinicorp_updated_at).toLocaleString("pt-BR") : "—"}</div>
                          </div>
                        </div>

                        {/* Diff antes/depois */}
                        {fields.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-left text-muted-foreground border-b border-border">
                                  <th className="py-1.5 pr-3">Campo</th>
                                  <th className="py-1.5 pr-3">Antes (local)</th>
                                  <th className="py-1.5 pr-3">Depois (Clinicorp)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fields.map((f) => {
                                  const before = (c.before_data as Record<string, unknown> | null)?.[f];
                                  const after = (c.after_data as Record<string, unknown> | null)?.[f];
                                  const fmt = (v: unknown) => v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
                                  return (
                                    <tr key={f} className="border-b border-border/30">
                                      <td className="py-1 pr-3 font-medium">{f}</td>
                                      <td className="py-1 pr-3 font-mono text-warning whitespace-pre-wrap break-all">{fmt(before)}</td>
                                      <td className="py-1 pr-3 font-mono text-success whitespace-pre-wrap break-all">{fmt(after)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">Sem campos alterados — registro de auditoria de decisão.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Webhook info — secret é gerenciado em "Minhas credenciais Clinicorp" acima */}


      {/* Eventos */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Últimos eventos recebidos</h4>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
          </Button>
        </div>

        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Nenhum evento recebido ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">External ID</th>
                  <th className="py-2 pr-3">Recebido</th>
                  <th className="py-2 pr-3">Erro</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="py-2 pr-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        ev.status === "processed" ? "bg-success/15 text-success" :
                        ev.status === "error" ? "bg-destructive/15 text-destructive" :
                        ev.status === "ignored" ? "bg-muted text-muted-foreground" :
                        "bg-warning/15 text-warning"
                      }`}>{ev.status}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono">{ev.event_type || "—"}</td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{ev.external_id || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{new Date(ev.received_at).toLocaleString("pt-BR")}</td>
                    <td className="py-2 pr-3 text-destructive truncate max-w-[200px]">{ev.error_message || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TabsContent>

    <TabsContent value="auditoria">
      <ClinicorpAuditLog />
    </TabsContent>
  </Tabs>
</div>
);
}
