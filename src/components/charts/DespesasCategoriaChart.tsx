import { ClientOnly } from "@/components/ClientOnly";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { FinanceMovement } from "@/data/financeiroMockData";
import { categoryLabels } from "@/data/financeiroMockData";

const CATEGORY_COLORS: Record<string, string> = {
  salario: "hsl(217, 91%, 60%)",
  comissao: "hsl(230, 60%, 55%)",
  aluguel: "hsl(187, 85%, 43%)",
  energia: "hsl(50, 80%, 50%)",
  agua: "hsl(200, 80%, 55%)",
  internet: "hsl(260, 50%, 55%)",
  marketing: "hsl(38, 92%, 50%)",
  laboratorio: "hsl(270, 60%, 55%)",
  material: "hsl(152, 60%, 42%)",
  impostos: "hsl(0, 72%, 51%)",
  manutencao: "hsl(200, 70%, 50%)",
  software: "hsl(160, 50%, 45%)",
  outros_despesa: "hsl(210, 20%, 55%)",
};

interface Props {
  movements: FinanceMovement[];
}

export function DespesasCategoriaChart({ movements }: Props) {
  // Aggregate saidas by category from real movements
  const categoryMap = new Map<string, number>();
  movements
    .filter((m) => m.type === "saida")
    .forEach((m) => {
      const current = categoryMap.get(m.category) || 0;
      categoryMap.set(m.category, current + m.value);
    });

  const despesasData = Array.from(categoryMap.entries())
    .map(([cat, value]) => ({
      name: categoryLabels[cat as keyof typeof categoryLabels] || cat,
      value,
      color: CATEGORY_COLORS[cat] || "hsl(210, 20%, 55%)",
    }))
    .sort((a, b) => b.value - a.value);

  const total = despesasData.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-card-foreground mb-1">Composição das Despesas</h3>
        <p className="text-[11px] text-muted-foreground mb-4">Distribuição por categoria — mês atual</p>
        <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground">
          Nenhuma despesa registrada
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-card-foreground mb-1">Composição das Despesas</h3>
      <p className="text-[11px] text-muted-foreground mb-4">Distribuição por categoria — mês atual</p>
      <div style={{ width: "100%", height: 240 }}>
        <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-muted/30 rounded-lg" />}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={despesasData}
                cx="50%"
                cy="45%"
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
          </ResponsiveContainer>
        </ClientOnly>
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