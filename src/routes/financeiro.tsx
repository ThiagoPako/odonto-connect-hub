import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { DollarSign, TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownRight, Calendar } from "lucide-react";

export const Route = createFileRoute("/financeiro")({
  component: FinanceiroPage,
});

const transactions = [
  { id: "1", patient: "Lucia Ferreira", type: "receita" as const, description: "Implante — Parcela 3/12", value: 1833, date: "08/04/2026", origin: "Google Ads" },
  { id: "2", patient: "Ana Beatriz", type: "receita" as const, description: "Clareamento — À vista (Pix)", value: 2800, date: "07/04/2026", origin: "Indicação" },
  { id: "3", patient: "—", type: "despesa" as const, description: "Google Ads — Abril", value: 4200, date: "05/04/2026", origin: "—" },
  { id: "4", patient: "Maria Silva", type: "receita" as const, description: "Consulta + Radiografia", value: 450, date: "05/04/2026", origin: "Instagram" },
  { id: "5", patient: "—", type: "despesa" as const, description: "Meta Ads — Abril", value: 3800, date: "03/04/2026", origin: "—" },
  { id: "6", patient: "Pedro Costa", type: "receita" as const, description: "Ortodontia — Parcela 1/24", value: 650, date: "02/04/2026", origin: "Site" },
];

const overdue = [
  { patient: "Roberto Mendes", value: 2400, daysLate: 15, procedure: "Implante" },
  { patient: "João Santos", value: 850, daysLate: 8, procedure: "Clareamento" },
  { patient: "Fernanda Lima", value: 1200, daysLate: 3, procedure: "Ortodontia" },
];

function FinanceiroPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Financeiro" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Faturamento Mês" value="R$ 187.500" change="+18% vs mês anterior" changeType="positive" icon={DollarSign} />
          <KpiCard title="Recebido" value="R$ 142.300" change="76% do faturado" changeType="neutral" icon={Wallet} />
          <KpiCard title="A Receber" value="R$ 45.200" change="12 parcelas pendentes" changeType="neutral" icon={TrendingUp} />
          <KpiCard title="Inadimplência" value="R$ 4.450" change="3 pacientes" changeType="negative" icon={TrendingDown} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Movimentações */}
          <div className="lg:col-span-2 bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-card-foreground">Movimentações Recentes</h3>
              <button className="text-xs text-primary font-medium hover:underline">Ver todas</button>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50 text-left">
                  <th className="px-5 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Descrição</th>
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Paciente</th>
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Origem</th>
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Valor</th>
                  <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Data</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {t.type === "receita" ? (
                          <ArrowUpRight className="h-4 w-4 text-success shrink-0" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <span className="text-sm text-foreground">{t.description}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{t.patient}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{t.origin}</td>
                    <td className={`px-4 py-3 text-sm font-semibold text-right ${t.type === "receita" ? "text-success" : "text-destructive"}`}>
                      {t.type === "receita" ? "+" : "-"} R$ {t.value.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{t.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inadimplentes */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-card-foreground">Inadimplentes</h3>
              <span className="text-[10px] uppercase font-bold tracking-wider text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                {overdue.length} pacientes
              </span>
            </div>
            <div className="space-y-3">
              {overdue.map((o) => (
                <div key={o.patient} className="bg-destructive/5 rounded-lg p-3 border border-destructive/10">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{o.patient}</span>
                    <span className="text-sm font-bold text-destructive">R$ {o.value.toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{o.procedure}</span>
                    <span className="text-xs text-destructive">{o.daysLate} dias em atraso</span>
                  </div>
                  <button className="mt-2 w-full h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                    Enviar Cobrança
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
