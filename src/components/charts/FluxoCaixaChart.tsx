import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from "recharts";

const fluxoData = [
  { mes: "Out", entradas: 72000, saidas: 48000 },
  { mes: "Nov", entradas: 85000, saidas: 52000 },
  { mes: "Dez", entradas: 98000, saidas: 61000 },
  { mes: "Jan", entradas: 78000, saidas: 55000 },
  { mes: "Fev", entradas: 105000, saidas: 63000 },
  { mes: "Mar", entradas: 125000, saidas: 72000 },
  { mes: "Abr", entradas: 142000, saidas: 78000 },
];

export function FluxoCaixaChart() {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-card-foreground mb-1">Fluxo de Caixa</h3>
      <p className="text-[11px] text-muted-foreground mb-4">Entradas vs saídas — últimos 7 meses</p>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={fluxoData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "12px",
                fontSize: "12px",
                color: "hsl(var(--foreground))",
              }}
              formatter={(value: number, name: string) => [
                `R$ ${value.toLocaleString("pt-BR")}`,
                name === "entradas" ? "Entradas" : "Saídas",
              ]}
            />
            <Bar dataKey="entradas" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} barSize={16} />
            <Bar dataKey="saidas" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" />
          Entradas
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-destructive" />
          Saídas
        </div>
      </div>
    </div>
  );
}
