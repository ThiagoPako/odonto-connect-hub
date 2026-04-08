import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowUpRight, ArrowDownRight, RefreshCw, Link2, Unlink, TrendingUp,
  Users, DollarSign, Target, BarChart3, ExternalLink, Filter,
} from "lucide-react";
import { useState } from "react";
import {
  mockAdAccounts, mockAdCampaigns, mockCrmCrossData,
  type AdCampaign, type CrmCrossData,
} from "@/data/adsMockData";

export const Route = createFileRoute("/integracoes")({
  component: IntegracoesPage,
});

function PlatformIcon({ platform }: { platform: "meta" | "google" }) {
  return (
    <span className={`inline-flex items-center justify-center h-6 w-6 rounded-md text-[10px] font-bold ${
      platform === "google" ? "bg-chart-1/15 text-chart-1" : "bg-chart-3/15 text-chart-3"
    }`}>
      {platform === "google" ? "G" : "M"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = status === "ativa"
    ? "bg-success/15 text-success"
    : status === "pausada"
    ? "bg-warning/15 text-warning"
    : "bg-muted text-muted-foreground";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${styles}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function IntegracoesPage() {
  const [platformFilter, setPlatformFilter] = useState<"all" | "google" | "meta">("all");

  const filteredCampaigns = platformFilter === "all"
    ? mockAdCampaigns
    : mockAdCampaigns.filter((c) => c.platform === platformFilter);

  const filteredCross = platformFilter === "all"
    ? mockCrmCrossData
    : mockCrmCrossData.filter((c) => c.platform === platformFilter);

  const totalInvestment = filteredCampaigns.reduce((a, c) => a + c.investment, 0);
  const totalLeads = filteredCampaigns.reduce((a, c) => a + c.leads, 0);
  const avgCpl = totalLeads > 0 ? totalInvestment / totalLeads : 0;
  const totalRevenue = filteredCampaigns.reduce((a, c) => a + c.revenue, 0);
  const overallRoi = totalInvestment > 0 ? totalRevenue / totalInvestment : 0;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Integrações — Tráfego Pago" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Connected accounts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mockAdAccounts.map((acc) => (
            <div key={acc.accountId} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
              <PlatformIcon platform={acc.platform} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{acc.accountName}</p>
                <p className="text-[11px] text-muted-foreground">ID: {acc.accountId} · Sync: {acc.lastSync}</p>
              </div>
              <div className="flex items-center gap-2">
                {acc.connected ? (
                  <>
                    <span className="flex items-center gap-1 text-[11px] text-success font-medium"><Link2 className="h-3 w-3" /> Conectado</span>
                    <button className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Sincronizar"><RefreshCw className="h-3.5 w-3.5 text-muted-foreground" /></button>
                  </>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-destructive font-medium"><Unlink className="h-3 w-3" /> Desconectado</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiMini icon={DollarSign} label="Investimento Total" value={`R$ ${(totalInvestment / 1000).toFixed(1)}k`} />
          <KpiMini icon={Users} label="Leads Gerados" value={totalLeads.toString()} />
          <KpiMini icon={Target} label="CPL Médio" value={`R$ ${avgCpl.toFixed(2)}`} />
          <KpiMini icon={TrendingUp} label="ROI Geral" value={`${overallRoi.toFixed(1)}x`} />
        </div>

        {/* Platform filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-sm">
            {(["all", "google", "meta"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${platformFilter === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p === "all" ? "Todas" : p === "google" ? "Google Ads" : "Meta Ads"}
              </button>
            ))}
          </div>
        </div>

        <Tabs defaultValue="campaigns" className="space-y-4">
          <TabsList>
            <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
            <TabsTrigger value="crm-cross">Cruzamento CRM</TabsTrigger>
          </TabsList>

          {/* Campaigns tab */}
          <TabsContent value="campaigns">
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Campanha</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Investido</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Leads</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">CPL</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Conversões</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Receita</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((c) => (
                    <CampaignRow key={c.id} campaign={c} />
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* CRM cross tab */}
          <TabsContent value="crm-cross">
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Campanha</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Leads Ads</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">No CRM</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Contatados</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Agendados</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Convertidos</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Taxa Conv.</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Ticket Médio</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCross.map((c) => (
                    <CrmCrossRow key={c.campaignId} data={c} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Funnel visualization */}
            <div className="mt-4 bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-card-foreground mb-4">Funil Ads → CRM (Agregado)</h3>
              <FunnelViz data={filteredCross} />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function KpiMini({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
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

function CampaignRow({ campaign: c }: { campaign: AdCampaign }) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={c.platform} />
          <span className="text-sm font-medium text-foreground">{c.name}</span>
        </div>
      </td>
      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
      <td className="px-4 py-3 text-right text-sm text-foreground">R$ {c.investment.toLocaleString("pt-BR")}</td>
      <td className="px-4 py-3 text-right text-sm text-foreground">{c.leads}</td>
      <td className="px-4 py-3 text-right text-sm font-medium text-primary">R$ {c.cpl.toFixed(2)}</td>
      <td className="px-4 py-3 text-right text-sm text-foreground">{c.conversions}</td>
      <td className="px-4 py-3 text-right text-sm font-medium text-success">R$ {c.revenue.toLocaleString("pt-BR")}</td>
      <td className="px-4 py-3 text-right">
        <span className={`text-sm font-bold ${c.roi >= 10 ? "text-success" : c.roi >= 5 ? "text-warning" : "text-destructive"}`}>
          {c.roi}x
        </span>
      </td>
    </tr>
  );
}

function CrmCrossRow({ data: c }: { data: CrmCrossData }) {
  const matchRate = c.leadsGenerated > 0 ? ((c.leadsInCrm / c.leadsGenerated) * 100).toFixed(0) : "0";
  return (
    <tr className="border-b border-border/50 hover:bg-muted/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={c.platform} />
          <div>
            <span className="text-sm font-medium text-foreground">{c.campaignName}</span>
            <span className="ml-2 text-[10px] text-muted-foreground">({matchRate}% match)</span>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right text-sm text-foreground">{c.leadsGenerated}</td>
      <td className="px-4 py-3 text-right text-sm text-foreground">{c.leadsInCrm}</td>
      <td className="px-4 py-3 text-right text-sm text-foreground">{c.contacted}</td>
      <td className="px-4 py-3 text-right text-sm text-foreground">{c.scheduled}</td>
      <td className="px-4 py-3 text-right text-sm font-medium text-primary">{c.converted}</td>
      <td className="px-4 py-3 text-right">
        <span className={`text-sm font-bold ${c.conversionRate >= 15 ? "text-success" : c.conversionRate >= 10 ? "text-warning" : "text-destructive"}`}>
          {c.conversionRate}%
        </span>
      </td>
      <td className="px-4 py-3 text-right text-sm text-foreground">R$ {c.avgTicket.toLocaleString("pt-BR")}</td>
    </tr>
  );
}

function FunnelViz({ data }: { data: CrmCrossData[] }) {
  const totals = data.reduce(
    (acc, c) => ({
      leads: acc.leads + c.leadsGenerated,
      crm: acc.crm + c.leadsInCrm,
      contacted: acc.contacted + c.contacted,
      scheduled: acc.scheduled + c.scheduled,
      converted: acc.converted + c.converted,
    }),
    { leads: 0, crm: 0, contacted: 0, scheduled: 0, converted: 0 }
  );

  const steps = [
    { label: "Leads (Ads)", value: totals.leads, color: "bg-chart-1" },
    { label: "No CRM", value: totals.crm, color: "bg-dental-cyan" },
    { label: "Contatados", value: totals.contacted, color: "bg-chart-3" },
    { label: "Agendados", value: totals.scheduled, color: "bg-chart-4" },
    { label: "Convertidos", value: totals.converted, color: "bg-success" },
  ];

  const max = steps[0].value || 1;

  return (
    <div className="space-y-3">
      {steps.map((s, i) => {
        const pct = (s.value / max) * 100;
        const dropPct = i > 0 ? (((steps[i - 1].value - s.value) / steps[i - 1].value) * 100).toFixed(0) : null;
        return (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground font-medium">{s.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{s.value}</span>
                {dropPct && (
                  <span className="text-[10px] text-destructive">-{dropPct}%</span>
                )}
              </div>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${s.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
