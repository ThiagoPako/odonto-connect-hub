import { useState, useEffect, useRef } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

const despesasData = [
  { name: "Pessoal", value: 14665, color: "hsl(217, 91%, 60%)" },
  { name: "Ocupação", value: 10700, color: "hsl(187, 85%, 43%)" },
  { name: "Marketing", value: 8000, color: "hsl(38, 92%, 50%)" },
  { name: "Laboratório", value: 5600, color: "hsl(270, 60%, 55%)" },
  { name: "Material", value: 3200, color: "hsl(152, 60%, 42%)" },
  { name: "Administrativo", value: 2740, color: "hsl(0, 72%, 51%)" },
];

const total = despesasData.reduce((s, d) => s + d.value, 0);

export function DespesasCategoriaChart() {
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
      <h3 className="text-sm font-semibold text-card-foreground mb-1">Composição das Despesas</h3>
      <p className="text-[11px] text-muted-foreground mb-4">Distribuição por categoria — mês atual</p>
      <div ref={ref} style={{ width: "100%", height: 240 }}>
        {size && (
          <PieChart width={size.w} height={size.h}>
            <Pie
              data={despesasData}
              cx={size.w / 2}
              cy={110}
              innerRadius={55}
              outerRadius={90}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {despesasData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "hsl(220, 20%, 97%)", border: "1px solid hsl(220, 13%, 91%)", borderRadius: "12px", fontSize: "12px" }}
              formatter={(value: number, name: string) => [
                `R$ ${value.toLocaleString("pt-BR")} (${Math.round((value / total) * 100)}%)`,
                name,
              ]}
            />
          </PieChart>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {despesasData.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="truncate">{d.name}</span>
            <span className="ml-auto font-medium text-foreground">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
