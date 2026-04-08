import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownRight,
  Plus, Building2, Users, FileText, BarChart3, CheckCircle, Clock, AlertTriangle,
  CreditCard, Landmark, Receipt, XCircle,
} from "lucide-react";
import {
  mockBankAccounts, mockEmployees, mockPayrolls, mockBills, mockMovements,
  mockOverdue, generateDRE, categoryLabels, generateId,
  type BankAccount, type Employee, type Payroll, type Bill, type FinanceMovement, type FinanceCategory,
} from "@/data/financeiroMockData";

export const Route = createFileRoute("/financeiro")({
  component: FinanceiroPage,
});

type Tab = "visao-geral" | "movimentacoes" | "contas-pagar" | "funcionarios" | "bancos" | "dre";

const tabs: { id: Tab; label: string; icon: typeof DollarSign }[] = [
  { id: "visao-geral", label: "Visão Geral", icon: BarChart3 },
  { id: "movimentacoes", label: "Movimentações", icon: ArrowUpRight },
  { id: "contas-pagar", label: "Contas a Pagar", icon: Receipt },
  { id: "funcionarios", label: "Funcionários", icon: Users },
  { id: "bancos", label: "Bancos", icon: Landmark },
  { id: "dre", label: "DRE", icon: FileText },
];

function FinanceiroPage() {
  const [activeTab, setActiveTab] = useState<Tab>("visao-geral");
  const [movements, setMovements] = useState<FinanceMovement[]>([...mockMovements]);
  const [bills, setBills] = useState<Bill[]>([...mockBills]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([...mockPayrolls]);
  const [employees, setEmployees] = useState<Employee[]>([...mockEmployees]);
  const [banks, setBanks] = useState<BankAccount[]>([...mockBankAccounts]);

  // Modais
  const [showAddMovement, setShowAddMovement] = useState(false);
  const [showAddBill, setShowAddBill] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showAddBank, setShowAddBank] = useState(false);

  // KPIs
  const totalEntradas = movements.filter((m) => m.type === "entrada").reduce((s, m) => s + m.value, 0);
  const totalSaidas = movements.filter((m) => m.type === "saida").reduce((s, m) => s + m.value, 0);
  const contasPendentes = bills.filter((b) => b.status === "pendente" || b.status === "vencido");
  const totalPendente = contasPendentes.reduce((s, b) => s + b.value, 0);
  const folhaPendente = payrolls.filter((p) => p.status === "pendente");
  const totalFolhaPendente = folhaPendente.reduce((s, p) => s + p.netSalary, 0);

  // Pagar conta
  const handlePayBill = (billId: string, bankAccountId: string) => {
    setBills((prev) =>
      prev.map((b) =>
        b.id === billId ? { ...b, status: "pago" as const, bankAccountId, paymentDate: new Date().toLocaleDateString("pt-BR") } : b
      )
    );
    const bill = bills.find((b) => b.id === billId);
    if (bill) {
      const bank = banks.find((bk) => bk.id === bankAccountId);
      const newMov: FinanceMovement = {
        id: generateId(),
        type: "saida",
        description: bill.description,
        category: bill.category,
        value: bill.value,
        date: new Date().toLocaleDateString("pt-BR"),
        bankAccountId,
        bankName: bank?.bank ?? "—",
        billId: bill.id,
      };
      setMovements((prev) => [newMov, ...prev]);
      setBanks((prev) => prev.map((bk) => bk.id === bankAccountId ? { ...bk, balance: bk.balance - bill.value } : bk));
    }
  };

  // Pagar folha
  const handlePayPayroll = (payrollId: string, bankAccountId: string) => {
    setPayrolls((prev) =>
      prev.map((p) =>
        p.id === payrollId ? { ...p, status: "pago" as const, bankAccountId, paymentDate: new Date().toLocaleDateString("pt-BR") } : p
      )
    );
    const pr = payrolls.find((p) => p.id === payrollId);
    if (pr) {
      const bank = banks.find((bk) => bk.id === bankAccountId);
      const newMov: FinanceMovement = {
        id: generateId(),
        type: "saida",
        description: `Folha Pgto — ${pr.employeeName} (${pr.month})`,
        category: "salario",
        value: pr.netSalary,
        date: new Date().toLocaleDateString("pt-BR"),
        bankAccountId,
        bankName: bank?.bank ?? "—",
        payrollId: pr.id,
      };
      setMovements((prev) => [newMov, ...prev]);
      setBanks((prev) => prev.map((bk) => bk.id === bankAccountId ? { ...bk, balance: bk.balance - pr.netSalary } : bk));
    }
  };

  // Adicionar movimento manual
  const handleAddMovement = (mov: Omit<FinanceMovement, "id">) => {
    const newMov = { ...mov, id: generateId() };
    setMovements((prev) => [newMov, ...prev]);
    if (mov.type === "entrada") {
      setBanks((prev) => prev.map((bk) => bk.id === mov.bankAccountId ? { ...bk, balance: bk.balance + mov.value } : bk));
    } else {
      setBanks((prev) => prev.map((bk) => bk.id === mov.bankAccountId ? { ...bk, balance: bk.balance - mov.value } : bk));
    }
    setShowAddMovement(false);
  };

  // Adicionar conta a pagar
  const handleAddBill = (bill: Omit<Bill, "id">) => {
    setBills((prev) => [{ ...bill, id: generateId() }, ...prev]);
    setShowAddBill(false);
  };

  // Adicionar funcionário
  const handleAddEmployee = (emp: Omit<Employee, "id">) => {
    const newEmp = { ...emp, id: generateId() };
    setEmployees((prev) => [...prev, newEmp]);
    // Criar folha pendente do mês atual
    const newPr: Payroll = {
      id: generateId(),
      employeeId: newEmp.id,
      employeeName: newEmp.name,
      month: "04/2026",
      grossSalary: newEmp.salary,
      benefits: newEmp.benefits,
      deductions: Math.round(newEmp.salary * 0.15),
      netSalary: newEmp.salary + newEmp.benefits - Math.round(newEmp.salary * 0.15),
      status: "pendente",
    };
    setPayrolls((prev) => [...prev, newPr]);
    setShowAddEmployee(false);
  };

  // Adicionar banco
  const handleAddBank = (bank: Omit<BankAccount, "id">) => {
    setBanks((prev) => [...prev, { ...bank, id: generateId() }]);
    setShowAddBank(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Financeiro" />
      <main className="flex-1 overflow-auto">
        {/* Tabs */}
        <div className="border-b border-border bg-card/80 sticky top-0 z-30 backdrop-blur-md">
          <div className="flex gap-1 px-6 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                    activeTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {activeTab === "visao-geral" && (
            <TabVisaoGeral
              totalEntradas={totalEntradas}
              totalSaidas={totalSaidas}
              totalPendente={totalPendente}
              totalFolhaPendente={totalFolhaPendente}
              banks={banks}
              overdue={mockOverdue}
              movements={movements}
            />
          )}
          {activeTab === "movimentacoes" && (
            <TabMovimentacoes
              movements={movements}
              showAdd={showAddMovement}
              setShowAdd={setShowAddMovement}
              onAdd={handleAddMovement}
              banks={banks}
            />
          )}
          {activeTab === "contas-pagar" && (
            <TabContasPagar
              bills={bills}
              showAdd={showAddBill}
              setShowAdd={setShowAddBill}
              onAdd={handleAddBill}
              onPay={handlePayBill}
              banks={banks}
            />
          )}
          {activeTab === "funcionarios" && (
            <TabFuncionarios
              employees={employees}
              payrolls={payrolls}
              showAdd={showAddEmployee}
              setShowAdd={setShowAddEmployee}
              onAdd={handleAddEmployee}
              onPayPayroll={handlePayPayroll}
              banks={banks}
            />
          )}
          {activeTab === "bancos" && (
            <TabBancos
              banks={banks}
              movements={movements}
              showAdd={showAddBank}
              setShowAdd={setShowAddBank}
              onAdd={handleAddBank}
            />
          )}
          {activeTab === "dre" && <TabDRE />}
        </div>
      </main>
    </div>
  );
}

// ==================== TAB: VISÃO GERAL ====================

function TabVisaoGeral({
  totalEntradas, totalSaidas, totalPendente, totalFolhaPendente, banks, overdue, movements,
}: {
  totalEntradas: number; totalSaidas: number; totalPendente: number; totalFolhaPendente: number;
  banks: BankAccount[]; overdue: typeof mockOverdue; movements: FinanceMovement[];
}) {
  const saldoTotal = banks.reduce((s, b) => s + b.balance, 0);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard title="Saldo Total" value={`R$ ${saldoTotal.toLocaleString("pt-BR")}`} icon={Wallet} />
        <KpiCard title="Entradas (Mês)" value={`R$ ${totalEntradas.toLocaleString("pt-BR")}`} change="Receitas" changeType="positive" icon={ArrowUpRight} />
        <KpiCard title="Saídas (Mês)" value={`R$ ${totalSaidas.toLocaleString("pt-BR")}`} change="Despesas" changeType="negative" icon={ArrowDownRight} />
        <KpiCard title="Contas Pendentes" value={`R$ ${totalPendente.toLocaleString("pt-BR")}`} change="A pagar" changeType="negative" icon={Clock} />
        <KpiCard title="Folha Pendente" value={`R$ ${totalFolhaPendente.toLocaleString("pt-BR")}`} change="Salários" changeType="neutral" icon={Users} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bancos resumo */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-card-foreground mb-4 flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" /> Contas Bancárias
          </h3>
          <div className="space-y-3">
            {banks.map((bk) => (
              <div key={bk.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold text-primary-foreground" style={{ background: bk.color }}>
                    {bk.bank.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground">{bk.name}</p>
                    <p className="text-[10px] text-muted-foreground">{bk.bank} • {bk.type}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-foreground">R$ {bk.balance.toLocaleString("pt-BR")}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Movimentações recentes */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-card-foreground mb-4">Últimas Movimentações</h3>
          <div className="space-y-2">
            {movements.slice(0, 6).map((m) => (
              <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-2">
                  {m.type === "entrada" ? (
                    <ArrowUpRight className="h-4 w-4 text-success shrink-0" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div>
                    <p className="text-xs text-foreground">{m.description}</p>
                    <p className="text-[10px] text-muted-foreground">{m.bankName} • {m.date}</p>
                  </div>
                </div>
                <span className={`text-xs font-bold ${m.type === "entrada" ? "text-success" : "text-destructive"}`}>
                  {m.type === "entrada" ? "+" : "-"}R$ {m.value.toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Inadimplentes */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-card-foreground">Inadimplentes</h3>
            <span className="text-[10px] uppercase font-bold tracking-wider text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
              {overdue.length}
            </span>
          </div>
          <div className="space-y-3">
            {overdue.map((o) => (
              <div key={o.patient} className="bg-destructive/5 rounded-lg p-3 border border-destructive/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">{o.patient}</span>
                  <span className="text-xs font-bold text-destructive">R$ {o.value.toLocaleString("pt-BR")}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{o.procedure} • {o.daysLate}d atraso</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ==================== TAB: MOVIMENTAÇÕES ====================

function TabMovimentacoes({
  movements, showAdd, setShowAdd, onAdd, banks,
}: {
  movements: FinanceMovement[]; showAdd: boolean; setShowAdd: (v: boolean) => void;
  onAdd: (m: Omit<FinanceMovement, "id">) => void; banks: BankAccount[];
}) {
  const [form, setForm] = useState({
    type: "entrada" as "entrada" | "saida",
    description: "", category: "consulta" as FinanceCategory, value: "",
    bankAccountId: banks[0]?.id ?? "", patient: "",
  });

  const handleSubmit = () => {
    if (!form.description || !form.value) return;
    const bank = banks.find((b) => b.id === form.bankAccountId);
    onAdd({
      type: form.type, description: form.description, category: form.category,
      value: parseFloat(form.value), date: new Date().toLocaleDateString("pt-BR"),
      bankAccountId: form.bankAccountId, bankName: bank?.bank ?? "—",
      patient: form.patient || undefined,
    });
    setForm({ type: "entrada", description: "", category: "consulta", value: "", bankAccountId: banks[0]?.id ?? "", patient: "" });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Movimentações</h2>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" /> Nova Movimentação
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-5 space-y-4 animate-fade-in">
          <h3 className="text-sm font-semibold text-card-foreground">Adicionar Movimentação</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Tipo</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "entrada" | "saida" })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground">
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Descrição</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" placeholder="Ex: Consulta avaliação" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Categoria</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as FinanceCategory })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground">
                {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Valor (R$)</label>
              <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" placeholder="0,00" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Banco</label>
              <select value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground">
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.bank})</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Paciente (opcional)</label>
              <input value={form.patient} onChange={(e) => setForm({ ...form, patient: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" placeholder="Nome do paciente" />
            </div>
            <div className="flex items-end">
              <button onClick={handleSubmit} className="h-9 px-6 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50 text-left">
              <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Tipo</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Descrição</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Categoria</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Banco</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Valor</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Data</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                <td className="px-5 py-3">
                  {m.type === "entrada" ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">
                      <ArrowUpRight className="h-3 w-3" /> Entrada
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                      <ArrowDownRight className="h-3 w-3" /> Saída
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-xs text-foreground">{m.description}</p>
                  {m.patient && <p className="text-[10px] text-muted-foreground">{m.patient}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{categoryLabels[m.category] ?? m.category}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{m.bankName}</td>
                <td className={`px-4 py-3 text-xs font-bold text-right ${m.type === "entrada" ? "text-success" : "text-destructive"}`}>
                  {m.type === "entrada" ? "+" : "-"}R$ {m.value.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{m.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ==================== TAB: CONTAS A PAGAR ====================

function TabContasPagar({
  bills, showAdd, setShowAdd, onAdd, onPay, banks,
}: {
  bills: Bill[]; showAdd: boolean; setShowAdd: (v: boolean) => void;
  onAdd: (b: Omit<Bill, "id">) => void; onPay: (billId: string, bankId: string) => void; banks: BankAccount[];
}) {
  const [form, setForm] = useState({
    description: "", category: "aluguel" as FinanceCategory, value: "",
    dueDate: "", supplier: "", recurrent: false,
  });
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payBankId, setPayBankId] = useState(banks[0]?.id ?? "");

  const pendentes = bills.filter((b) => b.status === "pendente" || b.status === "vencido");
  const pagos = bills.filter((b) => b.status === "pago");

  const handleSubmit = () => {
    if (!form.description || !form.value || !form.dueDate) return;
    onAdd({
      description: form.description, category: form.category, value: parseFloat(form.value),
      dueDate: form.dueDate, status: "pendente", supplier: form.supplier || undefined,
      recurrent: form.recurrent,
    });
    setForm({ description: "", category: "aluguel", value: "", dueDate: "", supplier: "", recurrent: false });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Contas a Pagar</h2>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" /> Nova Conta
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-5 space-y-4 animate-fade-in">
          <h3 className="text-sm font-semibold text-card-foreground">Cadastrar Conta a Pagar</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Descrição</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Categoria</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as FinanceCategory })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground">
                {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Valor (R$)</label>
              <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Vencimento</label>
              <input value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" placeholder="DD/MM/AAAA" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Fornecedor</label>
              <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input type="checkbox" checked={form.recurrent} onChange={(e) => setForm({ ...form, recurrent: e.target.checked })}
                  className="rounded border-border" />
                Recorrente
              </label>
            </div>
            <div className="flex items-end">
              <button onClick={handleSubmit} className="h-9 px-6 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pendentes */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Clock className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold text-card-foreground">Pendentes ({pendentes.length})</h3>
        </div>
        <div className="divide-y divide-border/50">
          {pendentes.map((b) => (
            <div key={b.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {b.status === "vencido" && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                  <p className="text-xs font-medium text-foreground">{b.description}</p>
                  {b.recurrent && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">Recorrente</span>}
                </div>
                <p className="text-[10px] text-muted-foreground">{b.supplier ?? "—"} • Venc: {b.dueDate}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-foreground">R$ {b.value.toLocaleString("pt-BR")}</span>
                {payingId === b.id ? (
                  <div className="flex items-center gap-2 animate-fade-in">
                    <select value={payBankId} onChange={(e) => setPayBankId(e.target.value)}
                      className="h-8 rounded-lg border border-border bg-background px-2 text-[10px] text-foreground">
                      {banks.map((bk) => <option key={bk.id} value={bk.id}>{bk.name}</option>)}
                    </select>
                    <button onClick={() => { onPay(b.id, payBankId); setPayingId(null); }}
                      className="h-8 px-3 rounded-lg bg-success text-success-foreground text-[10px] font-bold hover:bg-success/90 transition-colors">
                      Confirmar
                    </button>
                    <button onClick={() => setPayingId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setPayingId(b.id); setPayBankId(banks[0]?.id ?? ""); }}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 transition-colors">
                    <CreditCard className="h-3.5 w-3.5" /> Pagar
                  </button>
                )}
              </div>
            </div>
          ))}
          {pendentes.length === 0 && (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">Nenhuma conta pendente 🎉</div>
          )}
        </div>
      </div>

      {/* Pagos */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-success" />
          <h3 className="text-sm font-semibold text-card-foreground">Pagos ({pagos.length})</h3>
        </div>
        <div className="divide-y divide-border/50">
          {pagos.map((b) => (
            <div key={b.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors opacity-70">
              <div>
                <p className="text-xs text-foreground">{b.description}</p>
                <p className="text-[10px] text-muted-foreground">{b.supplier ?? "—"} • Pago em {b.paymentDate}</p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">R$ {b.value.toLocaleString("pt-BR")}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ==================== TAB: FUNCIONÁRIOS ====================

function TabFuncionarios({
  employees, payrolls, showAdd, setShowAdd, onAdd, onPayPayroll, banks,
}: {
  employees: Employee[]; payrolls: Payroll[];
  showAdd: boolean; setShowAdd: (v: boolean) => void;
  onAdd: (e: Omit<Employee, "id">) => void;
  onPayPayroll: (id: string, bankId: string) => void; banks: BankAccount[];
}) {
  const [form, setForm] = useState({ name: "", role: "", cpf: "", salary: "", benefits: "" });
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payBankId, setPayBankId] = useState(banks[0]?.id ?? "");

  const folhaMesAtual = payrolls.filter((p) => p.month === "04/2026");

  const handleSubmit = () => {
    if (!form.name || !form.role || !form.salary) return;
    onAdd({
      name: form.name, role: form.role, cpf: form.cpf,
      admissionDate: new Date().toLocaleDateString("pt-BR"),
      salary: parseFloat(form.salary), benefits: parseFloat(form.benefits || "0"),
      bankAccountId: banks[0]?.id ?? "", active: true,
    });
    setForm({ name: "", role: "", cpf: "", salary: "", benefits: "" });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Funcionários & Folha de Pagamento</h2>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" /> Novo Funcionário
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-5 space-y-4 animate-fade-in">
          <h3 className="text-sm font-semibold text-card-foreground">Cadastrar Funcionário</h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Cargo</label>
              <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">CPF</label>
              <input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" placeholder="000.000.000-00" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Salário (R$)</label>
              <input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Benefícios</label>
                <input type="number" value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })}
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
              </div>
              <button onClick={handleSubmit} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lista de funcionários */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-card-foreground">Equipe ({employees.length})</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50 text-left">
              <th className="px-5 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Nome</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Cargo</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Admissão</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Salário</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Benefícios</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Custo Total</th>
            </tr>
          </thead>
          <tbody>
            {employees.filter((e) => e.active).map((emp) => (
              <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                <td className="px-5 py-3 text-xs font-medium text-foreground">{emp.name}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{emp.role}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{emp.admissionDate}</td>
                <td className="px-4 py-3 text-xs text-foreground text-right">R$ {emp.salary.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground text-right">R$ {emp.benefits.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3 text-xs font-bold text-foreground text-right">R$ {(emp.salary + emp.benefits).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Folha de pagamento do mês */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-card-foreground">Folha de Pagamento — Abril/2026</h3>
          <span className="text-[10px] font-bold text-warning bg-warning/10 px-2.5 py-1 rounded-full">
            {folhaMesAtual.filter((p) => p.status === "pendente").length} pendente(s)
          </span>
        </div>
        <div className="divide-y divide-border/50">
          {folhaMesAtual.map((pr) => (
            <div key={pr.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex-1">
                <p className="text-xs font-medium text-foreground">{pr.employeeName}</p>
                <p className="text-[10px] text-muted-foreground">
                  Bruto: R$ {pr.grossSalary.toLocaleString("pt-BR")} + Benef: R$ {pr.benefits.toLocaleString("pt-BR")} - Desc: R$ {pr.deductions.toLocaleString("pt-BR")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-foreground">R$ {pr.netSalary.toLocaleString("pt-BR")}</span>
                {pr.status === "pago" ? (
                  <span className="text-[10px] font-bold text-success bg-success/10 px-2.5 py-1 rounded-full flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Pago {pr.paymentDate}
                  </span>
                ) : payingId === pr.id ? (
                  <div className="flex items-center gap-2 animate-fade-in">
                    <select value={payBankId} onChange={(e) => setPayBankId(e.target.value)}
                      className="h-8 rounded-lg border border-border bg-background px-2 text-[10px] text-foreground">
                      {banks.map((bk) => <option key={bk.id} value={bk.id}>{bk.name}</option>)}
                    </select>
                    <button onClick={() => { onPayPayroll(pr.id, payBankId); setPayingId(null); }}
                      className="h-8 px-3 rounded-lg bg-success text-success-foreground text-[10px] font-bold hover:bg-success/90">Confirmar</button>
                    <button onClick={() => setPayingId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setPayingId(pr.id); setPayBankId(banks[0]?.id ?? ""); }}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 transition-colors">
                    <CreditCard className="h-3.5 w-3.5" /> Pagar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ==================== TAB: BANCOS ====================

function TabBancos({
  banks, movements, showAdd, setShowAdd, onAdd,
}: {
  banks: BankAccount[]; movements: FinanceMovement[];
  showAdd: boolean; setShowAdd: (v: boolean) => void;
  onAdd: (b: Omit<BankAccount, "id">) => void;
}) {
  const [form, setForm] = useState({ name: "", bank: "", agency: "", account: "", type: "corrente" as BankAccount["type"], balance: "" });
  const colors = ["hsl(152, 60%, 42%)", "hsl(270, 60%, 55%)", "hsl(38, 92%, 50%)", "hsl(187, 85%, 43%)", "hsl(0, 72%, 51%)"];

  const handleSubmit = () => {
    if (!form.name || !form.bank) return;
    onAdd({
      name: form.name, bank: form.bank, agency: form.agency, account: form.account,
      type: form.type, balance: parseFloat(form.balance || "0"),
      color: colors[banks.length % colors.length],
    });
    setForm({ name: "", bank: "", agency: "", account: "", type: "corrente", balance: "" });
  };

  const saldoTotal = banks.reduce((s, b) => s + b.balance, 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Contas Bancárias</h2>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" /> Novo Banco
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-5 space-y-4 animate-fade-in">
          <h3 className="text-sm font-semibold text-card-foreground">Adicionar Conta Bancária</h3>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Nome da Conta</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Banco</label>
              <input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" placeholder="Ex: Itaú" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Agência</label>
              <input value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Conta</label>
              <input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Saldo Inicial</label>
              <input type="number" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
            </div>
            <div className="flex items-end">
              <button onClick={handleSubmit} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saldo total */}
      <div className="bg-card rounded-xl border border-border p-6 text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Saldo Total Consolidado</p>
        <p className="text-3xl font-bold text-foreground font-heading">R$ {saldoTotal.toLocaleString("pt-BR")}</p>
      </div>

      {/* Cards dos bancos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {banks.map((bk) => {
          const bankMovs = movements.filter((m) => m.bankAccountId === bk.id);
          const entradas = bankMovs.filter((m) => m.type === "entrada").reduce((s, m) => s + m.value, 0);
          const saidas = bankMovs.filter((m) => m.type === "saida").reduce((s, m) => s + m.value, 0);

          return (
            <div key={bk.id} className="bg-card rounded-xl border border-border p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1" style={{ background: bk.color }} />
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold text-primary-foreground" style={{ background: bk.color }}>
                  {bk.bank.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">{bk.name}</p>
                  <p className="text-[10px] text-muted-foreground">{bk.bank} • Ag {bk.agency} • CC {bk.account}</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground font-heading mb-3">R$ {bk.balance.toLocaleString("pt-BR")}</p>
              <div className="flex gap-4 text-[10px]">
                <span className="text-success">↑ R$ {entradas.toLocaleString("pt-BR")}</span>
                <span className="text-destructive">↓ R$ {saidas.toLocaleString("pt-BR")}</span>
              </div>
              {/* Últimas movimentações do banco */}
              <div className="mt-4 pt-3 border-t border-border/50 space-y-1.5">
                {bankMovs.slice(0, 3).map((m) => (
                  <div key={m.id} className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground truncate mr-2">{m.description}</span>
                    <span className={`text-[10px] font-bold ${m.type === "entrada" ? "text-success" : "text-destructive"}`}>
                      {m.type === "entrada" ? "+" : "-"}{m.value.toLocaleString("pt-BR")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ==================== TAB: DRE ====================

function TabDRE() {
  const dreLines = generateDRE();

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">DRE — Demonstração do Resultado</h2>
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
          Comparativo Abr vs Mar/2026
        </span>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-6 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Descrição</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Abr/2026</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Mar/2026</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Var %</th>
            </tr>
          </thead>
          <tbody>
            {dreLines.map((line, i) => {
              if (!line.label) return <tr key={i}><td colSpan={4} className="h-3" /></tr>;

              const isMargin = line.label.includes("Margem");
              const variation = line.previousMonth > 0
                ? Math.round(((line.currentMonth - line.previousMonth) / line.previousMonth) * 100)
                : 0;

              return (
                <tr key={i} className={`border-b border-border/30 ${line.isTotal ? "bg-muted/20" : ""} hover:bg-muted/30 transition-colors`}>
                  <td className={`px-6 py-3 text-xs ${line.isBold ? "font-bold text-foreground" : "text-foreground"}`}
                    style={{ paddingLeft: line.indent ? `${24 + line.indent * 20}px` : undefined }}>
                    {line.label}
                  </td>
                  <td className={`px-4 py-3 text-xs text-right ${line.isBold ? "font-bold" : ""} text-foreground`}>
                    {isMargin ? `${line.currentMonth}%` : `R$ ${line.currentMonth.toLocaleString("pt-BR")}`}
                  </td>
                  <td className="px-4 py-3 text-xs text-right text-muted-foreground">
                    {isMargin ? "—" : `R$ ${line.previousMonth.toLocaleString("pt-BR")}`}
                  </td>
                  <td className={`px-4 py-3 text-xs text-right font-bold ${
                    isMargin ? "text-muted-foreground" :
                    variation > 0 ? "text-success" : variation < 0 ? "text-destructive" : "text-muted-foreground"
                  }`}>
                    {isMargin ? "—" : variation > 0 ? `+${variation}%` : `${variation}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
