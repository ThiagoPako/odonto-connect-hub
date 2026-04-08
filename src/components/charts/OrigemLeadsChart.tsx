import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { ClientOnly } from "@/components/ClientOnly";
import { mockPatients } from "@/data/crmMockData";

const COLORS = [
  "hsl(187, 85%, 43%)",  // primary
  "hsl(217, 91%, 60%)",  // chart-2
  "hsl(152, 60%, 42%)",  // chart-3
  "hsl(38, 92%, 50%)",   // chart-4
  "hsl(0, 72%, 51%)",    // chart-5
];

export function OrigemLeadsChart() {
  const originMap: Record<string, number> = {};
  mockPatients.forEach((p) => {
    originMap[p.origin] = (originMap[p.origin] || 0) + 1;
  });

  const data = Object.entries(originMap)
    .map(([origin, count]) => ({ origin, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card hover:shadow-card-hover transition-all">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-card-foreground">Origem dos Leads</h3>
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          {mockPatients.length} total
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">Pacientes por canal de aquisição</p>
      <div className="h-[220px]">
        <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-muted/30 rounded-lg" />}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis
              dataKey="origin"
              type="category"
              width={90}
              tick={{ fontSize: 11, fill: "hsl(200, 10%, 50%)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(220, 20%, 13%)",
                border: "1px solid hsl(220, 13%, 20%)",
                borderRadius: "12px",
                fontSize: "12px",
                color: "hsl(220, 10%, 95%)",
              }}
              formatter={(value: number) => [`${value} paciente(s)`, "Quantidade"]}
              cursor={{ fill: "hsl(187, 85%, 43%, 0.08)" }}
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
