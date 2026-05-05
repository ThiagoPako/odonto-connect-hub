import { useEffect, useState } from "react";
import { clinicorpApi, type ClinicorpUserSettings, type ClinicorpConnectionTest, generateWebhookSecret, buildWebhookUrl } from "@/lib/clinicorpApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Copy, RefreshCw, Trash2, Loader2, Lock, PlugZap, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

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
            <Label htmlFor="cc-sub">Subscriber ID</Label>
            <Input id="cc-sub" placeholder="Ex.: 12345" value={subscriberId} onChange={(e) => setSubscriberId(e.target.value)} maxLength={128} />
            <p className="text-xs text-muted-foreground">ID do assinante na Clinicorp.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-url">URL base da API</Label>
            <Input id="cc-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={DEFAULT_BASE} />
            <p className="text-xs text-muted-foreground">Padrão: {DEFAULT_BASE}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cc-token">API Token</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="cc-token"
                type={showToken ? "text" : "password"}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder={settings?.has_api_token ? "•••••••• (já configurado — preencha para substituir)" : "Cole o Bearer token do Swagger Clinicorp"}
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
          <Label htmlFor="cc-secret">Webhook Secret</Label>
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
              <code className="text-xs truncate">{buildWebhookUrl(webhookSecret)}</code>
              <Button type="button" variant="ghost" size="sm" onClick={() => copy(buildWebhookUrl(webhookSecret), "URL")}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <Button variant="ghost" size="sm" onClick={remove} className="text-destructive hover:text-destructive" disabled={!settings?.has_api_token && !settings?.enabled}>
            <Trash2 className="h-4 w-4 mr-1" /> Remover credenciais
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar credenciais
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
