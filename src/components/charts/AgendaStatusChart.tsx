import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { getAgendaKpis } from "@/data/dashboardKpis";

const STATUS_CONFIG = [
  { key: "finalizados", label: "Finalizados", color: "hsl(152, 60%, 42%)" },
  { key: "emAtendimento", label: "Em Atendimento", color: "hsl(187, 85%, 43%)" },
  { key: "aguardando", label: "Aguardando", color: "hsl(38, 92%, 50%)" },
  { key: "confirmados", label: "Confirmados", color: "hsl(217, 91%, 60%)" },
  { key: "faltas", label: "Faltas", color: "hsl(0, 72%, 51%)" },
  { key: "encaixes", label: "Encaixes", color: "hsl(190, 70%, 55%)" },
] as const;

export function AgendaStatusChart() {
  const kpis = getAgendaKpis();

  const data = STATUS_CONFIG
    .map((s) => ({ name: s.label, value: kpis[s.key], color: s.color }))
    .filter((d) => d.value > 0);

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card hover:shadow-card-hover transition-all">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-card-foreground">Status da Agenda</h3>
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          Hoje
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">Distribuição dos atendimentos</p>
      <div className="h-[220px]">
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
              contentStyle={{
                background: "hsl(220, 20%, 13%)",
                border: "1px solid hsl(220, 13%, 20%)",
                borderRadius: "12px",
                fontSize: "12px",
                color: "hsl(220, 10%, 95%)",
              }}
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
      </div>
    </div>
  );
}
