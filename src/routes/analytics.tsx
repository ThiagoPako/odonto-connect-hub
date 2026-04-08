import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { BarChart3, Target, DollarSign, TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react";

export const Route = createFileRoute("/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="ROI & Analytics" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="ROI Geral" value="15.1x" change="+2.3x vs mês anterior" changeType="positive" icon={BarChart3} />
          <KpiCard title="Custo por Lead" value="R$ 32,50" change="-12% vs mês anterior" changeType="positive" icon={Target} />
          <KpiCard title="Custo por Paciente" value="R$ 124,00" change="-8% vs mês anterior" changeType="positive" icon={DollarSign} />
          <KpiCard title="Ticket Médio" value="R$ 4.850" change="+5% vs mês anterior" changeType="positive" icon={TrendingUp} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ROI por Campanha */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-card-foreground mb-4">ROI por Campanha</h3>
            <div className="space-y-4">
              {[
                { name: "Google Ads — Implantes", invest: 4200, revenue: 82400, roi: 19.6 },
                { name: "Meta Ads — Clareamento", invest: 3800, revenue: 38200, roi: 10.1 },
                { name: "Instagram — Branding", invest: 2400, revenue: 15800, roi: 6.6 },
                { name: "Google Ads — Ortodontia", invest: 2000, revenue: 51100, roi: 25.6 },
              ].map((c) => (
                <div key={c.name} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground">{c.name}</span>
                    <span className="text-sm font-bold text-primary">{c.roi}x</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>Investido: R$ {c.invest.toLocaleString("pt-BR")}</span>
                    <span>→</span>
                    <span className="text-success font-medium">Receita: R$ {c.revenue.toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min((c.roi / 30) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Faturamento por Canal */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold text-card-foreground mb-4">Faturamento por Canal</h3>
            <div className="space-y-3">
              {[
                { channel: "Google Ads", revenue: 133500, pct: 71, trend: "up" as const },
                { channel: "Indicação", revenue: 45600, pct: 24, trend: "up" as const },
                { channel: "Meta Ads", revenue: 38200, pct: 20, trend: "down" as const },
                { channel: "Instagram", revenue: 15800, pct: 8, trend: "up" as const },
                { channel: "Site", revenue: 5500, pct: 3, trend: "down" as const },
              ].map((item) => (
                <div key={item.channel} className="flex items-center gap-3">
                  <span className="text-xs text-foreground w-24">{item.channel}</span>
                  <div className="flex-1 h-6 bg-muted rounded-lg overflow-hidden relative">
                    <div className="h-full bg-primary/20 rounded-lg flex items-center px-2" style={{ width: `${item.pct}%` }}>
                      <span className="text-[10px] font-bold text-primary whitespace-nowrap">{item.pct}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 w-28 justify-end">
                    {item.trend === "up" ? <ArrowUpRight className="h-3 w-3 text-success" /> : <ArrowDownRight className="h-3 w-3 text-destructive" />}
                    <span className="text-xs font-medium text-foreground">R$ {(item.revenue / 1000).toFixed(1)}k</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
