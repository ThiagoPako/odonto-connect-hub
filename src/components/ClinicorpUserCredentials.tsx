import { useEffect, useState } from "react";
import { clinicorpApi, type ClinicorpUserSettings, type ClinicorpConnectionTest, generateWebhookSecret, buildWebhookUrl } from "@/lib/clinicorpApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Copy, RefreshCw, Trash2, Loader2, Lock, PlugZap, CheckCircle2, XCircle, AlertCircle, RefreshCcw } from "lucide-react";

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
      else if (result.auth === "rate_limited") toast.warning(`Clinicorp em limite de chamadas — aguarde ${formatRetryAfter(result.retry_after_seconds)}`);
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
    setSyncing(true);
    try {
      const result = await clinicorpApi.syncMyNow({ force_metadata: true });
      toast.success(`Sincronização ${result.status}: ${Object.values(result.summary).reduce((a, b) => a + b, 0)} itens processados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao sincronizar");
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

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cc-sub">ID Central / Usuário API</Label>
            <Input id="cc-sub" placeholder="Ex.: sua-clinica" value={subscriberId} onChange={(e) => setSubscriberId(e.target.value)} maxLength={128} />
            <p className="text-xs text-muted-foreground">O campo "Usuário API" exibido no painel da Clinicorp.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-url">URL base da API</Label>
            <Input id="cc-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={DEFAULT_BASE} />
            <p className="text-xs text-muted-foreground">Padrão: {DEFAULT_BASE}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cc-token">Token API</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="cc-token"
                type={showToken ? "text" : "password"}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder={settings?.has_api_token ? "•••••••• (já configurado — preencha para substituir)" : "Cole o Token API gerado na Clinicorp"}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowToken((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Mostrar token">
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Armazenado criptografado no banco. Nunca aparece no frontend após salvar.</p>
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

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
          <Button variant="ghost" size="sm" onClick={remove} className="text-destructive hover:text-destructive" disabled={!settings?.has_api_token && !settings?.enabled}>
            <Trash2 className="h-4 w-4 mr-1" /> Remover credenciais
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={syncNow} disabled={syncing || !settings?.has_api_token || !settings?.enabled}>
              {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
              Sincronizar dados agora
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={testing || saving}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
              Testar conexão
            </Button>
            <Button onClick={save} disabled={saving || testing}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar credenciais
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
