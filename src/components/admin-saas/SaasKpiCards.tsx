import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Receipt, CreditCard, RotateCw, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface Props {
  mrr: number;
  arr: number;
  receitaMes: number;
  receitaMesAnterior: number;
  totalPix: number;
  totalPendente: number;
  receitaRecorrente: number;
}

const fmt = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SaasKpiCards = ({ mrr, arr, receitaMes, receitaMesAnterior, totalPix, totalPendente, receitaRecorrente }: Props) => {
  const variacao = receitaMesAnterior > 0 ? ((receitaMes - receitaMesAnterior) / receitaMesAnterior) * 100 : 0;
  const varPositive = variacao >= 0;

  const kpis = [
    { label: "MRR", value: fmt(mrr), icon: DollarSign, accent: "bg-primary/10 text-primary" },
    { label: "ARR", value: fmt(arr), icon: TrendingUp, accent: "bg-primary/10 text-primary" },
    { label: "Receita Mês Atual", value: fmt(receitaMes), icon: Receipt, accent: "bg-green-500/10 text-green-600" },
    { label: "Receita Mês Anterior", value: fmt(receitaMesAnterior), icon: Receipt, accent: "bg-muted text-muted-foreground" },
    {
      label: "Variação Mensal",
      value: `${varPositive ? "+" : ""}${variacao.toFixed(1)}%`,
      icon: varPositive ? ArrowUpRight : ArrowDownRight,
      accent: varPositive ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive",
    },
    { label: "Total PIX", value: fmt(totalPix), icon: CreditCard, accent: "bg-primary/10 text-primary" },
    { label: "Total Pendente", value: fmt(totalPendente), icon: TrendingDown, accent: "bg-amber-500/10 text-amber-600" },
    { label: "Receita Recorrente", value: fmt(receitaRecorrente), icon: RotateCw, accent: "bg-primary/10 text-primary" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {kpis.map((kpi) => (
        <Card key={kpi.label} className="bg-card shadow-card hover:shadow-md transition-shadow animate-in fade-in slide-in-from-bottom-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${kpi.accent}`}>
                <kpi.icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate font-medium uppercase tracking-wider">{kpi.label}</p>
                <p className="text-lg font-bold text-foreground leading-tight mt-0.5">{kpi.value}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default SaasKpiCards;