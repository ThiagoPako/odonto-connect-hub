import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

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
      <h3 className="text-sm font-semibold text-card-foreground mb-1">Fluxo de Caixa</h3>
      <p className="text-[11px] text-muted-foreground mb-4">Entradas vs saídas — últimos 7 meses</p>
      <div ref={ref} style={{ width: "100%", height: 220 }}>
        {size && (
          <BarChart width={size.w} height={size.h} data={fluxoData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" strokeOpacity={0.5} />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(200, 10%, 50%)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(200, 10%, 50%)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={40} />
            <Tooltip
              contentStyle={{ background: "hsl(220, 20%, 97%)", border: "1px solid hsl(220, 13%, 91%)", borderRadius: "12px", fontSize: "12px" }}
              formatter={(value: number, name: string) => [`R$ ${value.toLocaleString("pt-BR")}`, name === "entradas" ? "Entradas" : "Saídas"]}
            />
            <Bar dataKey="entradas" fill="hsl(152, 60%, 42%)" radius={[4, 4, 0, 0]} barSize={16} />
            <Bar dataKey="saidas" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} barSize={16} />
          </BarChart>
        )}
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
