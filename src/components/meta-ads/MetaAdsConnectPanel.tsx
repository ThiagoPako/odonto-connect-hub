import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Key, Loader2, Plug, RefreshCw, Check, Wifi, WifiOff, ExternalLink } from "lucide-react";
import { vpsApiFetch } from "@/lib/vpsApi";

interface AISetting {
  provider: string;
  api_key: string;
  model: string;
  enabled: boolean;
  config?: { ad_account_id?: string } | null;
}

interface OverviewMini {
  connected: boolean;
  last_sync?: string;
  campaigns?: unknown[];
}

export function MetaAdsConnectPanel({ onSynced }: { onSynced?: () => void }) {
  const [token, setToken] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<string | undefined>();
  const [campaignsCount, setCampaignsCount] = useState(0);

  useEffect(() => {
    void loadCurrent();
  }, []);

  async function loadCurrent() {
    setLoading(true);
    const [{ data: settings }, { data: overview }] = await Promise.all([
      vpsApiFetch<AISetting[]>("/ai/settings"),
      vpsApiFetch<OverviewMini>("/ai/meta-ads/overview"),
    ]);

    if (Array.isArray(settings)) {
      const manus = settings.find((s) => s.provider === "manus");
      if (manus) {
        setToken(manus.api_key || "");
        setAdAccountId(manus.config?.ad_account_id || "");
      }
    }
    if (overview) {
      setConnected(!!overview.connected);
      setLastSync(overview.last_sync);
      setCampaignsCount(overview.campaigns?.length || 0);
    }
    setLoading(false);
  }

  async function handleConnectAndSync() {
    if (!token.trim()) {
      toast.error("Cole o token de acesso do Meta Ads");
      return;
    }
    if (!adAccountId.trim()) {
      toast.error("Informe o ID da conta de anúncios (ex: act_1234567890)");
      return;
    }

    // 1. Salvar token + ad_account_id em ai_settings
    setSaving(true);
    const normalizedId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const { error: saveError } = await vpsApiFetch("/ai/settings", {
      method: "POST",
      body: {
        provider: "manus",
        api_key: token.trim(),
        model: "",
        enabled: true,
        config: { ad_account_id: normalizedId },
      },
    });
    setSaving(false);

    if (saveError) {
      toast.error(`Erro ao salvar credenciais: ${saveError}`);
      return;
    }
    toast.success("Credenciais salvas. Sincronizando campanhas...");

    // 2. Disparar sync imediato
    setSyncing(true);
    const { error: syncError } = await vpsApiFetch<{ success: boolean }>("/ai/meta-ads/sync", {
      method: "POST",
    });
    setSyncing(false);

    if (syncError) {
      toast.error(`Erro ao sincronizar: ${syncError}`);
      return;
    }
    toast.success("Campanhas sincronizadas com sucesso!");
    setAdAccountId(normalizedId);
    await loadCurrent();
    onSynced?.();
  }

  async function handleResync() {
    setSyncing(true);
    const { error } = await vpsApiFetch<{ success: boolean }>("/ai/meta-ads/sync", { method: "POST" });
    setSyncing(false);
    if (error) {
      toast.error(`Erro: ${error}`);
    } else {
      toast.success("Re-sincronizado");
      await loadCurrent();
      onSynced?.();
    }
  }

  if (loading) {
    return (
      <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Carregando integração...</span>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              Conectar Meta Ads
              {connected ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                  <Wifi className="h-3 w-3" /> Conectado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <WifiOff className="h-3 w-3" /> Desconectado
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              Cole o token e o ID da conta — Manus AI puxa as campanhas automaticamente
            </p>
          </div>
        </div>
        {connected && (
          <button
            onClick={handleResync}
            disabled={syncing}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-sincronizar
          </button>
        )}
      </div>

      {connected && (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground">Campanhas sincronizadas</p>
            <p className="text-base font-bold text-foreground">{campaignsCount}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground">Última sincronização</p>
            <p className="text-sm font-semibold text-foreground">{lastSync || "—"}</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Key className="h-3 w-3" /> Token de Acesso (Meta Graph API)
        </label>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAG... (token com permissões ads_read, ads_management)"
            className="w-full h-10 rounded-lg border border-border bg-background px-3 pr-20 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showToken ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        <a
          href="https://business.facebook.com/settings/system-users"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Gerar token (Business Manager → Usuários do sistema) <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground">ID da Conta de Anúncios</label>
        <input
          type="text"
          value={adAccountId}
          onChange={(e) => setAdAccountId(e.target.value)}
          placeholder="act_1234567890"
          className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
        />
        <p className="text-[11px] text-muted-foreground">
          Encontre em: Gerenciador de Anúncios → menu superior → o ID começa com <code className="px-1 rounded bg-muted">act_</code>
        </p>
      </div>

      <button
        onClick={handleConnectAndSync}
        disabled={saving || syncing}
        className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saving || syncing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {saving ? "Salvando credenciais..." : "Sincronizando campanhas..."}
          </>
        ) : (
          <>
            <Check className="h-4 w-4" />
            {connected ? "Atualizar credenciais e sincronizar" : "Conectar e sincronizar campanhas"}
          </>
        )}
      </button>

      <div className="bg-muted/30 rounded-lg p-3 border border-border/30">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong>Como funciona:</strong> ao clicar em "Conectar", o token é salvo no servidor (criptografado),
          a Manus AI valida o acesso à conta <code className="px-1 rounded bg-background">{adAccountId || "act_..."}</code> e
          puxa todas as campanhas + métricas dos últimos 30 dias via Meta Graph API v19.0.
        </p>
      </div>
    </div>
  );
}
