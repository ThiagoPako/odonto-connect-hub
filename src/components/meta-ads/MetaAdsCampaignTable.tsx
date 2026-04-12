import { Megaphone } from "lucide-react";
import type { MetaCampaign } from "@/components/MetaAdsDashboard";

function fmtBrl(n: number) {
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const statusMap: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Ativa", cls: "bg-success/15 text-success" },
  PAUSED: { label: "Pausada", cls: "bg-warning/15 text-warning" },
  DELETED: { label: "Removida", cls: "bg-destructive/15 text-destructive" },
  ARCHIVED: { label: "Arquivada", cls: "bg-muted text-muted-foreground" },
};

export function MetaAdsCampaignTable({ campaigns }: { campaigns: MetaCampaign[] }) {
  if (campaigns.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border/60 p-8 text-center">
        <p className="text-sm text-muted-foreground">Nenhuma campanha encontrada. Sincronize os dados do Meta Ads.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border/60 overflow-hidden shadow-card">
      <div className="px-4 py-3 border-b border-border">
        <h4 className="text-sm font-semibold text-foreground">Campanhas Meta Ads</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left">
              {["Campanha", "Status", "Objetivo", "Investido", "Impressões", "Cliques", "CTR", "CPC", "Leads", "CPL"].map(
                (h) => (
                  <th key={h} className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const st = statusMap[c.status] || { label: c.status, cls: "bg-muted text-muted-foreground" };
              return (
                <tr key={c.campaign_id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Megaphone className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-sm font-medium text-foreground truncate max-w-[200px]">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{c.objective?.replace(/_/g, " ") || "—"}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{fmtBrl(c.spend)}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{c.impressions.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{c.clicks.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{c.ctr.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-sm text-foreground">{fmtBrl(c.cpc)}</td>
                  <td className="px-4 py-3 text-sm font-medium text-primary">{c.leads}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{c.cost_per_lead ? fmtBrl(c.cost_per_lead) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
