import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { vpsApiFetch } from "@/lib/vpsApi";
import { MetaAdsKpis } from "@/components/meta-ads/MetaAdsKpis";
import { MetaAdsCampaignTable } from "@/components/meta-ads/MetaAdsCampaignTable";
import { MetaAdsCharts } from "@/components/meta-ads/MetaAdsCharts";
import { MetaAdsAiInsight } from "@/components/meta-ads/MetaAdsAiInsight";
import {
  BarChart3,
  RefreshCw,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";

export interface MetaCampaign {
  campaign_id: string;
  name: string;
  status: string;
  objective: string;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  conversions: number;
  cost_per_lead: number | null;
  cost_per_conversion: number | null;
}

export interface MetaOverview {
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_leads: number;
  total_conversions: number;
  avg_ctr: number;
  avg_cpc: number;
  avg_cpl: number;
  campaigns: MetaCampaign[];
  ai_insight?: string;
  last_sync?: string;
  connected: boolean;
}

export function MetaAdsDashboard() {
  const [data, setData] = useState<MetaOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: result, error } = await vpsApiFetch<MetaOverview>("/ai/meta-ads/overview");
    if (error) {
      toast.error("Erro ao carregar dados do Meta Ads");
    } else if (result) {
      setData(result);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSync() {
    setSyncing(true);
    const { error } = await vpsApiFetch<{ success: boolean }>("/ai/meta-ads/sync", { method: "POST" });
    if (error) {
      toast.error(`Erro ao sincronizar: ${error}`);
    } else {
      toast.success("Dados sincronizados com sucesso");
      await loadData();
    }
    setSyncing(false);
  }

  if (loading) {
    return (
      <div className="bg-card rounded-2xl border border-border/60 p-8 shadow-card flex items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Carregando métricas do Meta Ads...</span>
      </div>
    );
  }

  const overview = data || {
    total_spend: 0,
    total_impressions: 0,
    total_clicks: 0,
    total_leads: 0,
    total_conversions: 0,
    avg_ctr: 0,
    avg_cpc: 0,
    avg_cpl: 0,
    campaigns: [],
    connected: false,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              Meta Ads — Manus AI
              {overview.connected ? (
                <Wifi className="h-3.5 w-3.5 text-success" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-destructive" />
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              {overview.last_sync
                ? `Última sincronização: ${overview.last_sync}`
                : "Configure a API key do Manus em Configurações → IA"}
            </p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Sincronizar
        </button>
      </div>

      {/* KPIs */}
      <MetaAdsKpis overview={overview} />

      {/* AI Insight */}
      {overview.ai_insight && <MetaAdsAiInsight insight={overview.ai_insight} />}

      {/* Charts */}
      {overview.campaigns.length > 0 && <MetaAdsCharts campaigns={overview.campaigns} />}

      {/* Campaign Table */}
      <MetaAdsCampaignTable campaigns={overview.campaigns} />
    </div>
  );
}
