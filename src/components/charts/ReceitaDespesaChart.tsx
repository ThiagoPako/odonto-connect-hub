import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

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
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const measure = () => {
      const { width, height } = ref.current!.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ w: Math.floor(width), h: Math.floor(height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-card-foreground mb-1">Evolução Receita vs Despesa</h3>
      <p className="text-[11px] text-muted-foreground mb-4">Tendência de crescimento — últimos 7 meses</p>
      <div ref={ref} style={{ width: "100%", height: 220 }}>
        {size && (
          <AreaChart width={size.w} height={size.h} data={evolucaoData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="gradReceitaFin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(152, 60%, 42%)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="hsl(152, 60%, 42%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDespesaFin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" strokeOpacity={0.5} />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(200, 10%, 50%)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(200, 10%, 50%)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={40} />
            <Tooltip
              contentStyle={{ background: "hsl(220, 20%, 97%)", border: "1px solid hsl(220, 13%, 91%)", borderRadius: "12px", fontSize: "12px" }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = { receita: "Receita", despesa: "Despesa", saldo: "Saldo" };
                return [`R$ ${value.toLocaleString("pt-BR")}`, labels[name] || name];
              }}
            />
            <Area type="monotone" dataKey="receita" stroke="hsl(152, 60%, 42%)" strokeWidth={2} fill="url(#gradReceitaFin)" dot={{ r: 3, fill: "hsl(152, 60%, 42%)", strokeWidth: 0 }} />
            <Area type="monotone" dataKey="despesa" stroke="hsl(0, 72%, 51%)" strokeWidth={2} fill="url(#gradDespesaFin)" dot={{ r: 3, fill: "hsl(0, 72%, 51%)", strokeWidth: 0 }} />
            <Area type="monotone" dataKey="saldo" stroke="hsl(187, 85%, 43%)" strokeWidth={2} strokeDasharray="6 4" fill="none" dot={false} />
          </AreaChart>
        )}
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
