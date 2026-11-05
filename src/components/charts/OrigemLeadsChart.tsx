import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { ClientOnly } from "@/components/ClientOnly";
import { chartTooltipStyle, chartTickFill } from "@/lib/chartTheme";


const COLORS = [
  "var(--color-chart-1)",  // primary
  "var(--color-chart-2)",  // chart-2
  "var(--color-success)",  // chart-3
  "var(--color-chart-4)",   // chart-4
  "var(--color-destructive)",    // chart-5
];

export function OrigemLeadsChart({ data: propData }: { data?: any[] }) {
  const data = propData ? propData.map(d => ({ origin: d.origin, count: d.leads })) : [];

  const total = data.reduce((acc, d) => acc + d.count, 0);

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-card-foreground">Origem dos Leads</h3>
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          {total} total
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Pacientes por canal de aquisição</p>
      <div className="h-[220px]">
        <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-muted/30 rounded-lg" />}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis
              dataKey="origin"
              type="category"
              width={90}
              tick={{ fontSize: 11, fill: chartTickFill }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number) => [`${value} paciente(s)`, "Quantidade"]}
              cursor={{ fill: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}
            />
            <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={24}>
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </ClientOnly>
      </div>
    </div>
  );
}
