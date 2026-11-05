import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { ClientOnly } from "@/components/ClientOnly";
import { chartTooltipStyle } from "@/lib/chartTheme";
import { getOrcamentoKpis } from "@/data/dashboardKpis";

const COLORS = [
  "var(--color-success)",  // success - aprovados
  "var(--color-chart-4)",   // warning - pendentes
  "var(--color-destructive)",    // destructive - reprovados
];

export function OrcamentoConversaoChart({ kpis: propKpis }: { kpis?: any }) {
  const kpis = propKpis || getOrcamentoKpis();

  const data = [
    { name: "Aprovados", value: kpis.aprovados, amount: kpis.valorAprovado || 0 },
    { name: "Pendentes", value: kpis.pendentes, amount: (kpis.valorTotal || 0) - (kpis.valorAprovado || 0) },
    { name: "Reprovados", value: kpis.reprovados, amount: 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-card-foreground">Conversão de Orçamentos</h3>
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          {kpis.taxaConversao}% taxa
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Distribuição por status</p>
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
          <div key={d.name} className="px-2 py-2 rounded-md bg-muted">
            <p className="text-lg font-semibold text-foreground tabular-nums">{d.value}</p>
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              {/* cor só como marcador ao lado do texto (âmbar como texto não passa 4,5:1) */}
              <span className="size-2 rounded-full" style={{ background: COLORS[i] }} aria-hidden="true" />
              {d.name}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
