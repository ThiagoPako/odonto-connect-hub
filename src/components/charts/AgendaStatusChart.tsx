import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { ClientOnly } from "@/components/ClientOnly";
import { chartTooltipStyle } from "@/lib/chartTheme";
import { getAgendaKpis } from "@/data/dashboardKpis";

const STATUS_CONFIG = [
  { key: "finalizados", label: "Finalizados", color: "var(--color-success)" },
  { key: "emAtendimento", label: "Em Atendimento", color: "var(--color-chart-1)" },
  { key: "aguardando", label: "Aguardando", color: "var(--color-chart-4)" },
  { key: "confirmados", label: "Confirmados", color: "var(--color-chart-2)" },
  { key: "faltas", label: "Faltas", color: "var(--color-destructive)" },
  { key: "encaixes", label: "Encaixes", color: "var(--color-muted-foreground)" },
] as const;

export function AgendaStatusChart({ kpis: propKpis }: { kpis?: any }) {
  const kpis = propKpis || getAgendaKpis();

  const data = STATUS_CONFIG
    .map((s) => ({ name: s.label, value: (kpis as any)[s.key] || 0, color: s.color }))
    .filter((d) => d.value > 0);

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-card-foreground">Status da Agenda</h3>
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          Hoje
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Distribuição dos atendimentos</p>
      <div className="h-[220px]">
        <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-muted/30 rounded-lg" />}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number, name: string) => [`${value}`, name]}
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
    </div>
  );
}
