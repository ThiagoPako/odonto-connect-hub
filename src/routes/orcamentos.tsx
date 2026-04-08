import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Plus, Search, DollarSign, CheckCircle2, XCircle, Clock, TrendingUp,
  FileText, ChevronRight, CreditCard,
} from "lucide-react";
import { useState } from "react";
import { mockBudgets, type Budget } from "@/data/orcamentoMockData";

export const Route = createFileRoute("/orcamentos")({
  component: OrcamentosPage,
});

const statusConfig: Record<Budget["status"], { label: string; color: string }> = {
  pendente: { label: "Pendente", color: "bg-warning/15 text-warning" },
  aprovado: { label: "Aprovado", color: "bg-success/15 text-success" },
  reprovado: { label: "Reprovado", color: "bg-destructive/15 text-destructive" },
  em_tratamento: { label: "Em Tratamento", color: "bg-primary/15 text-primary" },
  finalizado: { label: "Finalizado", color: "bg-muted text-muted-foreground" },
};

function OrcamentosPage() {
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = mockBudgets
    .filter((b) => filterStatus === "all" || b.status === filterStatus)
    .filter((b) => !searchTerm || b.patientName.toLowerCase().includes(searchTerm.toLowerCase()));

  const totalPending = mockBudgets.filter((b) => b.status === "pendente").reduce((a, b) => a + b.finalValue, 0);
  const totalApproved = mockBudgets.filter((b) => b.status === "aprovado" || b.status === "em_tratamento").reduce((a, b) => a + b.finalValue, 0);
  const conversionRate = mockBudgets.length > 0
    ? ((mockBudgets.filter((b) => ["aprovado", "em_tratamento", "finalizado"].includes(b.status)).length / mockBudgets.length) * 100).toFixed(0)
    : "0";

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Orçamentos e Vendas" />
      <main className="flex-1 p-6 space-y-5 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiMini icon={FileText} label="Total Orçamentos" value={mockBudgets.length.toString()} />
          <KpiMini icon={Clock} label="Valor Pendente" value={`R$ ${(totalPending / 1000).toFixed(1)}k`} />
          <KpiMini icon={DollarSign} label="Valor Aprovado" value={`R$ ${(totalApproved / 1000).toFixed(1)}k`} />
          <KpiMini icon={TrendingUp} label="Taxa Conversão" value={`${conversionRate}%`} />
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar paciente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
              />
            </div>
            <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-sm">
              {[{ id: "all", label: "Todos" }, { id: "pendente", label: "Pendentes" }, { id: "aprovado", label: "Aprovados" }, { id: "reprovado", label: "Reprovados" }].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterStatus(f.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterStatus === f.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <button className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> Novo Orçamento
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Budget list */}
          <div className="lg:col-span-1 space-y-2">
            {filtered.map((b) => {
              const cfg = statusConfig[b.status];
              return (
                <div
                  key={b.id}
                  onClick={() => setSelectedBudget(b)}
                  className={`bg-card rounded-xl border p-4 cursor-pointer transition-all ${
                    selectedBudget?.id === b.id ? "border-primary ring-1 ring-primary/20" : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-7 w-7 rounded-full ${b.avatarColor} flex items-center justify-center text-[9px] font-bold text-white`}>
                        {b.patientInitials}
                      </div>
                      <span className="text-xs font-medium text-foreground">{b.patientName}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{b.items.length} itens · {b.createdAt}</span>
                    <span className="text-sm font-bold text-foreground">R$ {b.finalValue.toLocaleString("pt-BR")}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Budget detail */}
          <div className="lg:col-span-2">
            {selectedBudget ? (
              <BudgetDetail budget={selectedBudget} />
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um orçamento</h3>
                <p className="text-xs text-muted-foreground">Clique em um orçamento para ver os detalhes.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiMini({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function BudgetDetail({ budget: b }: { budget: Budget }) {
  const cfg = statusConfig[b.status];
  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">{b.patientName}</h3>
            <p className="text-xs text-muted-foreground">Orçamento #{b.id} · {b.professional} · Criado em {b.createdAt}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
        </div>

        {/* Items table */}
        <table className="w-full mb-4">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase">Procedimento</th>
              <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-center">Dente</th>
              <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-center">Qtd</th>
              <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-right">Unit.</th>
              <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {b.items.map((item) => (
              <tr key={item.id} className="border-b border-border/30">
                <td className="py-2 text-xs text-foreground">{item.procedure}</td>
                <td className="py-2 text-xs text-muted-foreground text-center">{item.tooth || "—"}</td>
                <td className="py-2 text-xs text-foreground text-center">{item.quantity}</td>
                <td className="py-2 text-xs text-foreground text-right">R$ {item.unitPrice.toLocaleString("pt-BR")}</td>
                <td className="py-2 text-xs font-medium text-foreground text-right">R$ {item.totalPrice.toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Subtotal</span>
            <span>R$ {b.totalValue.toLocaleString("pt-BR")}</span>
          </div>
          {b.discount > 0 && (
            <div className="flex justify-between text-xs text-success">
              <span>Desconto</span>
              <span>- R$ {b.discount.toLocaleString("pt-BR")}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-foreground pt-1">
            <span>Total</span>
            <span>R$ {b.finalValue.toLocaleString("pt-BR")}</span>
          </div>
        </div>
      </div>

      {/* Payment & actions */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-card-foreground mb-3">Pagamento</h4>
        {b.paymentMethod ? (
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-foreground">{b.paymentMethod}</p>
              {b.installments && b.installments > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  {b.installments}x de R$ {(b.finalValue / b.installments).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Pagamento não definido</p>
        )}

        {b.status === "pendente" && (
          <div className="flex items-center gap-2 mt-4">
            <button className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-success text-white text-xs font-medium hover:bg-success/90">
              <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
            </button>
            <button className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-destructive text-white text-xs font-medium hover:bg-destructive/90">
              <XCircle className="h-3.5 w-3.5" /> Reprovar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
