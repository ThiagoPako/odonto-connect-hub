import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { ClientOnly } from "@/components/ClientOnly";
import { chartTooltipStyle, chartTickFill, chartGridStroke } from "@/lib/chartTheme";

const monthlyData = [
  { mes: "Out", faturamento: 98000, meta: 120000 },
  { mes: "Nov", faturamento: 112000, meta: 120000 },
  { mes: "Dez", faturamento: 135000, meta: 130000 },
  { mes: "Jan", faturamento: 105000, meta: 130000 },
  { mes: "Fev", faturamento: 142000, meta: 140000 },
  { mes: "Mar", faturamento: 168000, meta: 150000 },
  { mes: "Abr", faturamento: 187500, meta: 160000 },
];

export function FaturamentoMensalChart() {
  const atual = monthlyData[monthlyData.length - 1];
  const anterior = monthlyData[monthlyData.length - 2];
  const crescimento = Math.round(((atual.faturamento - anterior.faturamento) / anterior.faturamento) * 100);

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card hover:shadow-card-hover transition-all">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold text-card-foreground">Faturamento Mensal</h3>
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
          crescimento >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
        }`}>
          {crescimento >= 0 ? "+" : ""}{crescimento}% vs mês anterior
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-1">Últimos 7 meses — faturamento vs meta</p>
      <p className="text-2xl font-bold text-foreground font-heading mb-4">
        R$ {atual.faturamento.toLocaleString("pt-BR")}
      </p>
      <div className="h-[200px]">
        <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-muted/30 rounded-lg" />}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={monthlyData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="gradFaturamento" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(187, 85%, 43%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(187, 85%, 43%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} strokeOpacity={0.5} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 11, fill: chartTickFill }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: chartTickFill }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              width={40}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number, name: string) => [
                `R$ ${value.toLocaleString("pt-BR")}`,
                name === "faturamento" ? "Faturamento" : "Meta",
              ]}
            />
            <Area
              type="monotone"
              dataKey="faturamento"
              stroke="hsl(187, 85%, 43%)"
              strokeWidth={2.5}
              fill="url(#gradFaturamento)"
              dot={{ r: 4, fill: "hsl(187, 85%, 43%)", strokeWidth: 0 }}
              activeDot={{ r: 6, fill: "hsl(187, 85%, 43%)", stroke: "hsl(0, 0%, 100%)", strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="meta"
              stroke="hsl(38, 92%, 50%)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              fill="none"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        </ClientOnly>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary" />
          Faturamento
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-warning" />
          Meta
        </div>
      </div>
    </div>
  );
}
