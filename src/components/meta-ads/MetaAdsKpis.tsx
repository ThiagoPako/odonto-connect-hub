import { DollarSign, Eye, MousePointer, Users, Target, TrendingUp } from "lucide-react";
import type { MetaOverview } from "@/components/MetaAdsDashboard";

function fmt(n: number, prefix = "") {
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}K`;
  return `${prefix}${n.toLocaleString("pt-BR")}`;
}

function fmtBrl(n: number) {
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const kpis = (o: MetaOverview) => [
  { label: "Investimento", value: fmtBrl(o.total_spend), icon: DollarSign, color: "text-destructive" },
  { label: "Impressões", value: fmt(o.total_impressions), icon: Eye, color: "text-primary" },
  { label: "Cliques", value: fmt(o.total_clicks), icon: MousePointer, color: "text-accent-foreground" },
  { label: "Leads", value: fmt(o.total_leads), icon: Users, color: "text-success" },
  { label: "CTR Médio", value: `${o.avg_ctr.toFixed(2)}%`, icon: Target, color: "text-warning" },
  { label: "CPL Médio", value: fmtBrl(o.avg_cpl), icon: TrendingUp, color: "text-primary" },
];

export function MetaAdsKpis({ overview }: { overview: MetaOverview }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {kpis(overview).map((k) => (
        <div
          key={k.label}
          className="bg-card rounded-xl border border-border/60 p-4 shadow-card hover:shadow-card-hover transition-all"
        >
          <div className="flex items-center gap-2 mb-2">
            <k.icon className={`h-4 w-4 ${k.color}`} />
            <span className="text-[11px] text-muted-foreground font-medium">{k.label}</span>
          </div>
          <p className="text-lg font-bold text-foreground">{k.value}</p>
        </div>
      ))}
    </div>
  );
}
