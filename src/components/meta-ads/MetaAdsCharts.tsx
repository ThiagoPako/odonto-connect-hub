import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import type { MetaCampaign } from "@/components/MetaAdsDashboard";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
  "hsl(var(--accent))",
  "hsl(var(--muted-foreground))",
];

export function MetaAdsCharts({ campaigns }: { campaigns: MetaCampaign[] }) {
  const spendData = campaigns
    .slice(0, 8)
    .map((c) => ({ name: c.name.length > 20 ? c.name.slice(0, 20) + "…" : c.name, spend: c.spend, leads: c.leads }));

  const pieData = campaigns
    .filter((c) => c.spend > 0)
    .slice(0, 6)
    .map((c) => ({ name: c.name.length > 18 ? c.name.slice(0, 18) + "…" : c.name, value: c.spend }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Spend by Campaign */}
      <div className="bg-card rounded-xl border border-border/60 p-5 shadow-card">
        <h4 className="text-sm font-semibold text-foreground mb-4">Investimento por Campanha</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={spendData} margin={{ left: 0, right: 8 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="spend" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Investido" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Spend Distribution */}
      <div className="bg-card rounded-xl border border-border/60 p-5 shadow-card">
        <h4 className="text-sm font-semibold text-foreground mb-4">Distribuição de Investimento</h4>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              outerRadius={80}
              dataKey="value"
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
