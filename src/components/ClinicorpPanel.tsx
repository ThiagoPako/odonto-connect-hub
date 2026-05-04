import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Copy, CheckCircle2, AlertCircle, KeyRound, Webhook, PlayCircle, Plug, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  clinicorpApi,
  buildWebhookUrl,
  generateWebhookSecret,
  type ClinicorpSettings,
  type ClinicorpWebhookEvent,
  type ClinicorpSyncResult,
} from "@/lib/clinicorpApi";

export function ClinicorpPanel() {
  const [settings, setSettings] = useState<ClinicorpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [events, setEvents] = useState<ClinicorpWebhookEvent[]>([]);
  const [lastSync, setLastSync] = useState<ClinicorpSyncResult | null>(null);

  // form state
  const [enabled, setEnabled] = useState(false);
  const [subscriberId, setSubscriberId] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.clinicorp.com/rest/v1");
  const [apiToken, setApiToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  async function load() {
    setLoading(true);
    try {
      const s = await clinicorpApi.getSettings();
      setSettings(s);
      setEnabled(s.enabled);
      setSubscriberId(s.subscriber_id || "");
      setBaseUrl(s.base_url || "https://api.clinicorp.com/rest/v1");
      const evs = await clinicorpApi.listWebhookEvents(50);
      setEvents(evs);
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
        enabled,
        subscriber_id: subscriberId,
        base_url: baseUrl,
        api_token: apiToken || undefined,
        webhook_secret: webhookSecret || undefined,
      });
      setApiToken("");
      setWebhookSecret("");
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
    try {
      const r = await clinicorpApi.testConnection();
      if (r.ok) toast.success(`Conexão OK — ${r.clinics_count} clínica(s) encontradas`);
      else toast.error(r.error || "Falha na conexão");
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setLastSync(null);
    try {
      const r = await clinicorpApi.sync();
      setLastSync(r);
      toast.success(`Sync ${r.status} — ${Object.values(r.summary).reduce((a, b) => a + b, 0)} registros processados`);
      await load();
    } catch (e) {
      toast.error(`Sync falhou: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  function copyWebhookUrl() {
    const url = buildWebhookUrl(webhookSecret || (settings?.has_webhook_secret ? "<seu-secret-salvo>" : ""));
    navigator.clipboard.writeText(url);
    toast.success("URL do webhook copiada");
  }

  function generateSecret() {
    const s = generateWebhookSecret(40);
    setWebhookSecret(s);
    toast.info("Novo secret gerado — clique em Salvar");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${settings?.enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
          <Plug className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">Clinicorp</h3>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${settings?.enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {settings?.enabled ? "Ativo" : "Desativado"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Integração com a API REST da Clinicorp + recebimento de webhooks em tempo real.
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
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      {/* Credenciais */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Credenciais da API</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cc-sub">Subscriber ID</Label>
            <Input id="cc-sub" value={subscriberId} onChange={(e) => setSubscriberId(e.target.value)} placeholder="ex: 123456" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-base">Base URL</Label>
            <Input id="cc-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="cc-token">
              API Token (Bearer){" "}
              {settings?.has_api_token && <span className="text-success text-[11px]">• já configurado</span>}
            </Label>
            <Input
              id="cc-token"
              type="password"
              autoComplete="new-password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={settings?.has_api_token ? "deixe em branco para manter o atual" : "cole o token gerado no Clinicorp"}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || !settings?.has_api_token}>
            {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Testar conexão
          </Button>
          <Button variant="outline" onClick={handleSync} disabled={syncing || !settings?.enabled}>
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

      {/* Webhook */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Webhook (receber eventos da Clinicorp)</h4>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cc-secret">
            Webhook Secret (validação por <code className="text-[11px]">?user_api=</code>){" "}
            {settings?.has_webhook_secret && (
              <span className="text-success text-[11px]">• atual: {settings.webhook_secret_preview}</span>
            )}
          </Label>
          <div className="flex gap-2">
            <Input
              id="cc-secret"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={settings?.has_webhook_secret ? "deixe em branco para manter o atual" : "gere ou cole um secret forte"}
              className="font-mono text-xs"
            />
            <Button variant="outline" onClick={generateSecret}>Gerar</Button>
          </div>
        </div>

        <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs">
          <div className="font-medium text-foreground mb-1">URL do endpoint para cadastrar no painel da Clinicorp:</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-[11px] text-muted-foreground">
              {buildWebhookUrl(webhookSecret || (settings?.has_webhook_secret ? "•••••••••••" : ""))}
            </code>
            <Button size="sm" variant="ghost" onClick={copyWebhookUrl}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-2 text-muted-foreground">
            No painel da Clinicorp: Acesso Externo e integrações → Adicionar webhook → cole essa URL com o seu secret.
          </p>
        </div>
      </div>

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
    </div>
  );
}
