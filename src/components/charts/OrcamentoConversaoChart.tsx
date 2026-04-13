import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { ClientOnly } from "@/components/ClientOnly";
import { chartTooltipStyle } from "@/lib/chartTheme";
import { getOrcamentoKpis } from "@/data/dashboardKpis";

const COLORS = [
  "hsl(152, 60%, 42%)",  // success - aprovados
  "hsl(38, 92%, 50%)",   // warning - pendentes
  "hsl(0, 72%, 51%)",    // destructive - reprovados
];

export function OrcamentoConversaoChart() {
  const kpis = getOrcamentoKpis();

  const data = [
    { name: "Aprovados", value: kpis.aprovados, amount: kpis.valorAprovado },
    { name: "Pendentes", value: kpis.pendentes, amount: kpis.valorTotal - kpis.valorAprovado - (kpis.reprovados > 0 ? 13200 : 0) },
    { name: "Reprovados", value: kpis.reprovados, amount: 13200 },
  ].filter((d) => d.value > 0);

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card hover:shadow-card-hover transition-all">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-card-foreground">Conversão de Orçamentos</h3>
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          {kpis.taxaConversao}% taxa
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">Distribuição por status</p>
      <div className="h-[220px]">
        <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-muted/30 rounded-lg" />}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={4}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number, name: string) => [`${value} orçamento(s)`, name]}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              formatter={(value) => (
                <span className="text-xs text-muted-foreground">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
        </ClientOnly>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {data.map((d, i) => (
          <div key={d.name} className="px-2 py-2 rounded-xl bg-muted/40">
            <p className="text-lg font-bold" style={{ color: COLORS[i] }}>{d.value}</p>
            <p className="text-[10px] text-muted-foreground">{d.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
