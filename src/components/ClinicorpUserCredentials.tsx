import { useEffect, useState, useRef } from "react";
import { clinicorpApi, type ClinicorpUserSettings, type ClinicorpConnectionTest, generateWebhookSecret, buildWebhookUrl } from "@/lib/clinicorpApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Copy, RefreshCw, Trash2, Loader2, Lock, PlugZap, CheckCircle2, XCircle, AlertCircle, RefreshCcw, Building2, User, Users, CalendarDays, Settings2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_BASE = "https://api.clinicorp.com/rest/v1";

export function ClinicorpUserCredentials() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ClinicorpUserSettings | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [subscriberId, setSubscriberId] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE);
  const [apiToken, setApiToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ClinicorpConnectionTest | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    step: string;
    summary: Record<string, number>;
    startTime: number;
    completed: boolean;
    errors: string[];
  } | null>(null);
  const pollingRef = useRef(false);
  const [cooldown, setCooldown] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let timer: any;
    if (cooldown > 0) {
      timer = setInterval(() => {
        setCooldown(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  async function load() {
    setLoading(true);
    try {
      const s = await clinicorpApi.getMySettings();
      setSettings(s);
      setEnabled(s.enabled);
      setSubscriberId(s.subscriber_id || "");
      setBaseUrl(s.base_url || DEFAULT_BASE);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar credenciais");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function validate(): string | null {
    if (subscriberId && subscriberId.length > 128) return "subscriber_id muito longo";
    if (baseUrl) {
      try { new URL(baseUrl); } catch { return "URL base inválida"; }
    }
    if (apiToken && (apiToken.startsWith('http://') || apiToken.startsWith('https://'))) return "O campo API Token deve conter apenas o Token (chave), não o link completo do Webhook.";
    if (apiToken && (apiToken.length < 8 || apiToken.length > 2048)) return "API token deve ter entre 8 e 2048 caracteres";
    if (webhookSecret && (webhookSecret.length < 8 || webhookSecret.length > 256)) return "Webhook secret deve ter entre 8 e 256 caracteres";

    return null;
  }

  function formatRetryAfter(seconds?: number | null) {
    if (!seconds || seconds < 60) return "alguns instantes";
    return `${Math.ceil(seconds / 60)} min`;
  }

  async function save() {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await clinicorpApi.saveMySettings({
        enabled,
        subscriber_id: subscriberId,
        base_url: baseUrl,
        api_token: apiToken,
        webhook_secret: webhookSecret,
      });
      setApiToken("");
      setWebhookSecret("");
      toast.success("Credenciais salvas com segurança");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remover suas credenciais Clinicorp? Você precisará reconectar para sincronizar novamente.")) return;
    try {
      await clinicorpApi.deleteMySettings();
      toast.success("Credenciais removidas");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

  async function testConnection() {
    const err = validate();
    if (err) { toast.error(err); return; }
    if (!apiToken && !settings?.has_api_token) { toast.error("Informe o API Token para testar"); return; }
    if (!subscriberId) { toast.error("Informe o Subscriber ID para testar"); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await clinicorpApi.testMyConnection({
        api_token: apiToken || undefined,
        subscriber_id: subscriberId,
        base_url: baseUrl,
      });
      setTestResult(result);
      if (result.ok) toast.success(`Conexão OK em ${result.total_latency_ms}ms`);
      else if (result.auth === "rate_limited") {
        setCooldown(result.retry_after_seconds || 60);
        toast.warning(`Clinicorp em limite de chamadas — aguarde ${formatRetryAfter(result.retry_after_seconds)}`);
      }
      else if (result.auth === "invalid_token") toast.error("Token inválido ou sem permissão");
      else toast.warning("Alguns endpoints falharam — veja detalhes");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao testar";
      setTestResult({ ok: false, auth: "invalid_token", total_latency_ms: 0, base_url: baseUrl, subscriber_id: subscriberId, error: msg, results: [] });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    const startTime = Date.now();
    setSyncStatus({
      step: "Iniciando sincronização...",
      summary: { clinics: 0, professionals: 0, patients: 0, appointments: 0 },
      startTime,
      completed: false,
      errors: [],
    });

    pollingRef.current = true;
    const poll = async () => {
      while (pollingRef.current) {
        try {
          const s = await clinicorpApi.getMySettings();
          if (s.sync_progress) {
            setSyncStatus(prev => ({
              ...prev!,
              step: s.sync_progress.step || prev?.step || "Sincronizando...",
              summary: s.sync_progress.summary || prev?.summary || { clinics: 0, professionals: 0, patients: 0, appointments: 0 },
            }));
          }
          if (s.last_sync_status !== 'syncing' && s.last_sync_at && new Date(s.last_sync_at).getTime() > startTime) {
            pollingRef.current = false;
          }
        } catch (e) {
          console.error("Poll error", e);
        }
        if (pollingRef.current) await new Promise(r => setTimeout(r, 2000));
      }
    };

    poll();

    try {
      const result = await clinicorpApi.syncMyNow({ force_metadata: true });
      pollingRef.current = false;
      setSyncStatus(prev => ({
        ...prev!,
        step: "Sincronização concluída!",
        summary: result.summary,
        completed: true,
        errors: result.errors || [],
      }));
      toast.success(`Sincronização concluída: ${Object.values(result.summary).reduce((a, b) => a + b, 0)} itens processados`);
      await load();
    } catch (e) {
      pollingRef.current = false;
      const msg = e instanceof Error ? e.message : "Erro ao sincronizar";
      setSyncStatus(prev => ({
        ...prev!,
        step: "Erro na sincronização",
        completed: true,
        errors: [msg],
      }));
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`));
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Minhas credenciais Clinicorp
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5 mt-1">
              <Lock className="h-3 w-3" /> Privadas — só você acessa essas chaves nesta conta.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {settings?.has_api_token && <Badge variant="secondary">Token ativo</Badge>}
            {settings?.enabled && <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Conectado</Badge>}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/30">
          <div>
            <Label htmlFor="cc-enabled" className="text-sm font-medium">Sincronização ativa</Label>
            <p className="text-xs text-muted-foreground">Quando ligado, o sistema usa suas credenciais para sincronizar.</p>
          </div>
          <Switch id="cc-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid gap-4 md:grid-cols-12">
          <div className="md:col-span-4 space-y-1.5">
            <Label htmlFor="cc-sub">ID Central / Usuário API</Label>
            <div className="relative">
              <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input 
                id="cc-sub" 
                placeholder="Ex.: sua-clinica" 
                className="pl-9 h-11"
                value={subscriberId} 
                onChange={(e) => setSubscriberId(e.target.value)} 
                maxLength={128} 
              />
            </div>
            <p className="text-[10px] text-muted-foreground px-1">O "Usuário API" do painel Clinicorp.</p>
          </div>

          <div className="md:col-span-8 space-y-1.5">
            <Label htmlFor="cc-token">Token API</Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="cc-token"
                type={showToken ? "text" : "password"}
                className="pl-9 pr-10 h-11"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder={settings?.has_api_token ? "•••••••• (já configurado)" : "Cole o Token API gerado"}
                autoComplete="off"
              />
              <button 
                type="button" 
                onClick={() => setShowToken((v) => !v)} 
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground" 
                aria-label="Mostrar token"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {apiToken && (apiToken.startsWith('http://') || apiToken.startsWith('https://')) && (
              <div className="mt-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="text-[11px] text-destructive leading-tight font-medium">
                  Parece que você colou um Link em vez do Token.
                </div>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground px-1">Criptografado e seguro.</p>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Configurações Avançadas
            {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showAdvanced && (
            <div className="mt-3 p-4 rounded-lg border border-dashed border-border/60 bg-muted/20 space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="space-y-1.5">
                <Label htmlFor="cc-url" className="text-xs">URL base da API</Label>
                <Input 
                  id="cc-url" 
                  type="url" 
                  className="h-8 text-xs"
                  value={baseUrl} 
                  onChange={(e) => setBaseUrl(e.target.value)} 
                  placeholder={DEFAULT_BASE} 
                />
                <p className="text-[10px] text-muted-foreground">Padrão: {DEFAULT_BASE}. Altere apenas se instruído pelo suporte.</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cc-secret">Chave de Segurança do Webhook (Secret)</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="cc-secret"
                type={showSecret ? "text" : "password"}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder={settings?.has_webhook_secret ? `Atual: ${settings.webhook_secret_preview} (preencha para substituir)` : "Gere um secret e cole na Clinicorp"}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Mostrar secret">
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setWebhookSecret(generateWebhookSecret(40))}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Gerar
            </Button>
          </div>
          {webhookSecret && (
            <div className="mt-2 p-2 rounded border border-border/60 bg-muted/30 flex items-center justify-between gap-2">
              <div className="flex-1 overflow-hidden">
                <p className="text-[10px] text-muted-foreground font-medium uppercase mb-1">Cole este Endpoint na Clinicorp:</p>
                <code className="text-xs truncate block">{buildWebhookUrl(webhookSecret)}</code>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => copy(buildWebhookUrl(webhookSecret), "URL")}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Test result panel */}
        {testResult && (
          <div className={`rounded-lg border p-3 space-y-2 ${
            testResult.ok ? "border-emerald-500/30 bg-emerald-500/5"
            : testResult.auth === "invalid_token" ? "border-destructive/30 bg-destructive/5"
            : "border-amber-500/30 bg-amber-500/5"
          }`}>
            <div className="flex items-center gap-2 text-sm font-medium">
              {testResult.ok
                ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Conexão validada</>
                : testResult.auth === "rate_limited"
                  ? <><AlertCircle className="h-4 w-4 text-amber-600" /> Limite temporário da Clinicorp</>
                  : testResult.auth === "invalid_token"
                  ? <><XCircle className="h-4 w-4 text-destructive" /> Falha de autenticação</>
                  : <><AlertCircle className="h-4 w-4 text-amber-600" /> Conexão parcial</>}
              <span className="ml-auto text-xs text-muted-foreground">{testResult.total_latency_ms}ms</span>
            </div>
            {testResult.error && <p className="text-xs text-destructive">{testResult.error}</p>}
            {testResult.results.length > 0 && (
              <ul className="text-xs space-y-1">
                {testResult.results.map((r) => (
                  <li key={r.key} className="flex items-center gap-2">
                    {r.ok
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
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

        {/* Sync Status Real-time Panel */}
        {(syncing || syncStatus) && (
          <div className="rounded-xl border border-border bg-card/50 overflow-hidden animate-in fade-in slide-in-from-top-4">
            <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : syncStatus?.errors.length ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                )}
                <span className="text-xs font-semibold uppercase tracking-wider">Status da Sincronização</span>
              </div>
              {syncStatus && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {Math.round((Date.now() - syncStatus.startTime) / 1000)}s decorridos
                </span>
              )}
            </div>
            
            <div className="p-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-foreground">{syncStatus?.step}</span>
                  {syncStatus?.completed && (
                    <span className={cn(
                      "font-bold px-1.5 py-0.5 rounded",
                      syncStatus.errors.length ? "text-destructive" : "text-success"
                    )}>
                      {syncStatus.errors.length ? "CONCLUÍDO COM ALERTAS" : "CONCLUÍDO"}
                    </span>
                  )}
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all duration-500",
                      syncing ? "bg-primary animate-pulse w-2/3" : syncStatus?.completed ? "bg-success w-full" : "bg-primary w-full"
                    )} 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Clínicas", key: "clinics", icon: Building2 },
                  { label: "Profissionais", key: "professionals", icon: User },
                  { label: "Pacientes", key: "patients", icon: Users },
                  { label: "Agenda", key: "appointments", icon: CalendarDays },
                ].map((item) => (
                  <div key={item.key} className="p-2.5 rounded-lg bg-muted/40 border border-border/50 flex flex-col items-center gap-1">
                    <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider">{item.label}</span>
                    <span className="text-base font-bold tabular-nums">{syncStatus?.summary[item.key] || 0}</span>
                  </div>
                ))}
              </div>

              {syncStatus?.errors.length ? (
                <div className="p-2 rounded bg-destructive/10 border border-destructive/20">
                  <p className="text-[10px] font-bold text-destructive uppercase mb-1">Alertas recentes:</p>
                  <ul className="text-[10px] text-destructive/90 list-disc list-inside space-y-0.5 max-h-20 overflow-y-auto">
                    {syncStatus.errors.slice(0, 3).map((err, i) => (
                      <li key={i} className="truncate">{err}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
          <Button variant="ghost" size="sm" onClick={remove} className="text-destructive hover:text-destructive" disabled={!settings?.has_api_token && !settings?.enabled}>
            <Trash2 className="h-4 w-4 mr-1" /> Remover credenciais
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button 
              variant="outline" 
              onClick={testConnection} 
              disabled={testing || saving || cooldown > 0}
            >
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : cooldown > 0 ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
              {cooldown > 0 ? `Aguarde ${cooldown}s` : "Testar conexão"}
            </Button>
            <Button 
              variant="default" 
              onClick={syncNow} 
              disabled={syncing || !settings?.has_api_token || !settings?.enabled || cooldown > 0}
              className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
            >
              {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : cooldown > 0 ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
              {cooldown > 0 ? `Aguarde ${cooldown}s (Rate Limit)` : (syncing ? "Sincronizando..." : "Sincronizar dados agora")}
            </Button>
            <Button 
              onClick={save} 
              disabled={saving || testing || cooldown > 0}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar credenciais
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
