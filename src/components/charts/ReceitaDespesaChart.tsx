import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

const evolucaoData = [
  { mes: "Out", receita: 72000, despesa: 48000, saldo: 24000 },
  { mes: "Nov", receita: 85000, despesa: 52000, saldo: 33000 },
  { mes: "Dez", receita: 98000, despesa: 61000, saldo: 37000 },
  { mes: "Jan", receita: 78000, despesa: 55000, saldo: 23000 },
  { mes: "Fev", receita: 105000, despesa: 63000, saldo: 42000 },
  { mes: "Mar", receita: 125000, despesa: 72000, saldo: 53000 },
  { mes: "Abr", receita: 142000, despesa: 78000, saldo: 64000 },
];

export function ReceitaDespesaChart() {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-card-foreground mb-1">Evolução Receita vs Despesa</h3>
      <p className="text-[11px] text-muted-foreground mb-4">Tendência de crescimento — últimos 7 meses</p>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={evolucaoData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.25} />
                <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDespesa" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.15} />
                <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
              </linearGradient>
            </defs>
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
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = { receita: "Receita", despesa: "Despesa", saldo: "Saldo" };
                return [`R$ ${value.toLocaleString("pt-BR")}`, labels[name] || name];
              }}
            />
            <Area type="monotone" dataKey="receita" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#gradReceita)" dot={{ r: 3, fill: "hsl(var(--success))", strokeWidth: 0 }} />
            <Area type="monotone" dataKey="despesa" stroke="hsl(var(--destructive))" strokeWidth={2} fill="url(#gradDespesa)" dot={{ r: 3, fill: "hsl(var(--destructive))", strokeWidth: 0 }} />
            <Area type="monotone" dataKey="saldo" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="6 4" fill="none" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" />
          Receita
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-destructive" />
          Despesa
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary" />
          Saldo
        </div>
      </div>
    </div>
  );
}
