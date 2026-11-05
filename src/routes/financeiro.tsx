import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { useState, useEffect, useCallback } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownRight,
  Plus, Building2, Users, FileText, BarChart3, CheckCircle, Clock, AlertTriangle,
  CreditCard, Landmark, Receipt, XCircle, Loader2,
} from "lucide-react";
import {
  type FinanceCategory, categoryLabels,
} from "@/data/financeiroMockData";
import { FluxoCaixaChart, type FluxoMesPonto } from "@/components/charts/FluxoCaixaChart";
import { ReceitaDespesaChart, type EvolucaoMesPonto } from "@/components/charts/ReceitaDespesaChart";
import { DespesasCategoriaChart } from "@/components/charts/DespesasCategoriaChart";
import {
  finBanksApi, finEmployeesApi, finPayrollsApi, finBillsApi, finMovementsApi, finOverdueApi,
} from "@/lib/vpsApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { FinanceMovement, BankAccount, Employee, Payroll, Bill } from "@/data/financeiroMockData";


export const Route = createFileRoute("/financeiro")({
  ssr: false,
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

// ===== Datas =====
// O servidor guarda as datas do financeiro como texto "dd/mm/aaaa" (toLocaleDateString pt-BR).
// Aceita também "aaaa-mm-dd" por segurança. Devolve null se não der para ler.
function parseBrDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim());
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}
/** Chave "aaaa-mm" do mês; offset negativo = meses anteriores ao atual. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthKeyOffset(offset: number): string {
  const now = new Date();
  return monthKey(new Date(now.getFullYear(), now.getMonth() + offset, 1));
}
function movementsInMonth(movements: FinanceMovement[], key: string): FinanceMovement[] {
  return movements.filter((m) => {
    const d = parseBrDate(m.date);
    return d !== null && monthKey(d) === key;
  });
}
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** Entradas e saídas somadas por mês, dos últimos `n` meses (o atual incluso). */
function monthlyTotals(movements: FinanceMovement[], n = 7): { mes: string; entradas: number; saidas: number }[] {
  const now = new Date();
  const out: { key: string; mes: string; entradas: number; saidas: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: monthKey(d), mes: `${MESES_CURTOS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, entradas: 0, saidas: 0 });
  }
  const byKey = new Map(out.map((o) => [o.key, o]));
  for (const m of movements) {
    const d = parseBrDate(m.date);
    const slot = d ? byKey.get(monthKey(d)) : undefined;
    if (!slot) continue;
    if (m.type === "entrada") slot.entradas += m.value;
    else slot.saidas += m.value;
  }
  return out.map(({ mes, entradas, saidas }) => ({ mes, entradas, saidas }));
}
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Map API row to frontend types
function mapBank(r: any): BankAccount {
  return { id: r.id, name: r.name, bank: r.bank, agency: r.agency || '', account: r.account || '', type: r.type || 'corrente', balance: Number(r.balance) || 0, color: r.color || 'hsl(217,91%,60%)' };
}
function mapEmployee(r: any): Employee {
  return { id: r.id, name: r.name, role: r.role, cpf: r.cpf || '', admissionDate: r.admission_date || '', salary: Number(r.salary) || 0, benefits: Number(r.benefits) || 0, bankAccountId: r.bank_account_id || '', active: r.active !== false };
}
function mapPayroll(r: any): Payroll {
  return { id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, month: r.month, grossSalary: Number(r.gross_salary) || 0, benefits: Number(r.benefits) || 0, deductions: Number(r.deductions) || 0, netSalary: Number(r.net_salary) || 0, status: r.status || 'pendente', paymentDate: r.payment_date || undefined, bankAccountId: r.bank_account_id || undefined };
}
function mapBill(r: any): Bill {
  // O servidor não marca "vencido": calculamos aqui, a partir do vencimento (dd/mm/aaaa).
  const due = parseBrDate(r.due_date);
  const rawStatus: Bill["status"] = r.status || 'pendente';
  const status: Bill["status"] = rawStatus === 'pendente' && due !== null && due < startOfToday() ? 'vencido' : rawStatus;
  return { id: r.id, description: r.description, category: r.category, value: Number(r.value) || 0, dueDate: r.due_date, status, supplier: r.supplier || undefined, bankAccountId: r.bank_account_id || undefined, paymentDate: r.payment_date || undefined, recurrent: r.recurrent || false };
}
function mapMovement(r: any): FinanceMovement {
  return { id: r.id, type: r.type, description: r.description, category: r.category, value: Number(r.value) || 0, date: r.date, bankAccountId: r.bank_account_id || '', bankName: r.bank_name || '', patient: r.patient || undefined, billId: r.bill_id || undefined, payrollId: r.payroll_id || undefined };
}

function FinanceiroPage() {
  const [activeTab, setActiveTab] = useState<Tab>("visao-geral");
  const [movements, setMovements] = useState<FinanceMovement[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [overdue, setOverdue] = useState<{ patient: string; value: number; daysLate: number; procedure: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Modais
  const [showAddMovement, setShowAddMovement] = useState(false);
  const [showAddBill, setShowAddBill] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showAddBank, setShowAddBank] = useState(false);

  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [banksRes, empsRes, payRes, billsRes, movsRes, overdueRes] = await Promise.all([
      finBanksApi.list(),
      finEmployeesApi.list(),
      finPayrollsApi.list(),
      finBillsApi.list(),
      finMovementsApi.list(),
      finOverdueApi.list(),
    ]);
    // vpsApiFetch nunca lança: cada parte que falhar é listada no aviso da tela
    // e mantém os dados que já estavam carregados.
    const errors: string[] = [];
    const rows = (res: { data: unknown; error: string | null }, label: string): any[] | null => {
      if (res.error) { errors.push(`${label}: ${res.error}`); return null; }
      return Array.isArray(res.data) ? res.data : [];
    };
    const bk = rows(banksRes, "Bancos");
    const em = rows(empsRes, "Funcionários");
    const py = rows(payRes, "Folha de pagamento");
    const bl = rows(billsRes, "Contas a pagar");
    const mv = rows(movsRes, "Movimentações");
    const od = rows(overdueRes, "Inadimplência");
    if (bk) setBanks(bk.map(mapBank));
    if (em) setEmployees(em.map(mapEmployee));
    if (py) setPayrolls(py.map(mapPayroll));
    if (bl) setBills(bl.map(mapBill));
    if (mv) setMovements(mv.map(mapMovement));
    if (od) setOverdue(od.map((r: any) => ({ patient: r.patient, value: Number(r.value) || 0, daysLate: r.days_late || 0, procedure: r.procedure || '' })));
    setLoadErrors(errors);
    if (errors.length) toast.error("Parte do financeiro não carregou. Os valores podem estar incompletos.");
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // KPIs — só as movimentações do mês corrente (a data vem como dd/mm/aaaa)
  const movimentosMes = movementsInMonth(movements, monthKeyOffset(0));
  const totalEntradas = movimentosMes.filter((m) => m.type === "entrada").reduce((s, m) => s + m.value, 0);
  const totalSaidas = movimentosMes.filter((m) => m.type === "saida").reduce((s, m) => s + m.value, 0);
  const contasPendentes = bills.filter((b) => b.status === "pendente" || b.status === "vencido");
  const totalPendente = contasPendentes.reduce((s, b) => s + b.value, 0);
  const folhaPendente = payrolls.filter((p) => p.status === "pendente");
  const totalFolhaPendente = folhaPendente.reduce((s, p) => s + p.netSalary, 0);

  // Pagar conta
  const handlePayBill = async (billId: string, bankAccountId: string) => {
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return;
    if (!bankAccountId) { toast.error("Cadastre ou escolha uma conta bancária antes de pagar."); return; }
    const bank = banks.find((bk) => bk.id === bankAccountId);
    const now = new Date().toLocaleDateString("pt-BR");
    const upd = await finBillsApi.update(billId, { status: 'pago', bank_account_id: bankAccountId, payment_date: now });
    if (upd.error) { toast.error("Erro ao pagar conta: " + upd.error); return; }
    const mov = await finMovementsApi.create({
      type: 'saida', description: bill.description, category: bill.category,
      value: bill.value, date: now, bank_account_id: bankAccountId,
      bank_name: bank?.bank ?? '—', bill_id: bill.id,
    });
    if (mov.error) toast.error("Conta marcada como paga, mas a saída não foi lançada nas movimentações: " + mov.error);
    else toast.success("Conta paga e lançada nas movimentações");
    await loadAll();
  };

  // Pagar folha
  const handlePayPayroll = async (payrollId: string, bankAccountId: string) => {
    const pr = payrolls.find((p) => p.id === payrollId);
    if (!pr) return;
    if (!bankAccountId) { toast.error("Cadastre ou escolha uma conta bancária antes de pagar."); return; }
    const bank = banks.find((bk) => bk.id === bankAccountId);
    const now = new Date().toLocaleDateString("pt-BR");
    const upd = await finPayrollsApi.update(payrollId, { status: 'pago', bank_account_id: bankAccountId, payment_date: now });
    if (upd.error) { toast.error("Erro ao pagar folha: " + upd.error); return; }
    const mov = await finMovementsApi.create({
      type: 'saida', description: `Folha Pgto — ${pr.employeeName} (${pr.month})`,
      category: 'salario', value: pr.netSalary, date: now,
      bank_account_id: bankAccountId, bank_name: bank?.bank ?? '—', payroll_id: pr.id,
    });
    if (mov.error) toast.error("Folha marcada como paga, mas a saída não foi lançada nas movimentações: " + mov.error);
    else toast.success("Folha paga e lançada nas movimentações");
    await loadAll();
  };

  // Adicionar movimento manual — devolve true se salvou (o formulário só limpa nesse caso)
  const handleAddMovement = async (mov: Omit<FinanceMovement, "id">): Promise<boolean> => {
    const { error } = await finMovementsApi.create({
      type: mov.type, description: mov.description, category: mov.category,
      value: mov.value, date: mov.date, bank_account_id: mov.bankAccountId,
      bank_name: mov.bankName, patient: mov.patient || null,
    });
    if (error) { toast.error("Erro ao salvar movimentação: " + error); return false; }
    toast.success("Movimentação lançada");
    setShowAddMovement(false);
    await loadAll();
    return true;
  };

  // Adicionar conta a pagar
  const handleAddBill = async (bill: Omit<Bill, "id">): Promise<boolean> => {
    const { error } = await finBillsApi.create({
      description: bill.description, category: bill.category, value: bill.value,
      due_date: bill.dueDate, status: 'pendente', supplier: bill.supplier || null,
      recurrent: bill.recurrent,
    });
    if (error) { toast.error("Erro ao salvar conta: " + error); return false; }
    toast.success("Conta a pagar cadastrada");
    setShowAddBill(false);
    await loadAll();
    return true;
  };

  // Adicionar funcionário
  const handleAddEmployee = async (emp: Omit<Employee, "id">, deductions: number): Promise<boolean> => {
    const created = await finEmployeesApi.create({
      name: emp.name, role: emp.role, cpf: emp.cpf,
      admission_date: new Date().toLocaleDateString("pt-BR"),
      salary: emp.salary, benefits: emp.benefits,
      bank_account_id: banks[0]?.id || null,
    });
    if (created.error) { toast.error("Erro ao cadastrar funcionário: " + created.error); return false; }
    // Criar folha pendente do mês atual — descontos informados no cadastro (padrão 0)
    const folha = await finPayrollsApi.create({
      employee_id: (created.data as any)?.id ?? null, employee_name: emp.name,
      month: `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`,
      gross_salary: emp.salary, benefits: emp.benefits,
      deductions, net_salary: emp.salary + emp.benefits - deductions,
      status: 'pendente',
    });
    if (folha.error) toast.error("Funcionário cadastrado, mas a folha do mês não foi criada: " + folha.error);
    else toast.success("Funcionário cadastrado");
    setShowAddEmployee(false);
    await loadAll();
    return true;
  };

  // Adicionar banco
  const handleAddBank = async (bank: Omit<BankAccount, "id">): Promise<boolean> => {
    const { error } = await finBanksApi.create({
      name: bank.name, bank: bank.bank, agency: bank.agency, account: bank.account,
      type: bank.type, balance: bank.balance, color: bank.color,
    });
    if (error) { toast.error("Erro ao salvar conta bancária: " + error); return false; }
    toast.success("Conta bancária cadastrada");
    setShowAddBank(false);
    await loadAll();
    return true;
  };

  if (loading && loadErrors.length === 0 && banks.length === 0 && movements.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Financeiro" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

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
            <Link
              to="/financeiro/receber"
              className="flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border whitespace-nowrap"
            >
              Contas a receber
            </Link>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {loadErrors.length > 0 && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <div>
                <p className="font-semibold">Parte do financeiro não carregou — os totais abaixo podem estar incompletos.</p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {loadErrors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </div>
              <Button size="sm" variant="outline" onClick={loadAll} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Tentar de novo
              </Button>
            </div>
          )}
          {activeTab === "visao-geral" && (
            <TabVisaoGeral
              totalEntradas={totalEntradas}
              totalSaidas={totalSaidas}
              totalPendente={totalPendente}
              totalFolhaPendente={totalFolhaPendente}
              banks={banks}
              overdue={overdue}
              movements={movements}
              movimentosMes={movimentosMes}
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
          {activeTab === "dre" && <TabDRE movements={movements} />}
        </div>
      </main>
    </div>
  );
}

// ==================== TAB: VISÃO GERAL ====================

function TabVisaoGeral({
  totalEntradas, totalSaidas, totalPendente, totalFolhaPendente, banks, overdue, movements, movimentosMes,
}: {
  totalEntradas: number; totalSaidas: number; totalPendente: number; totalFolhaPendente: number;
  banks: BankAccount[]; overdue: { patient: string; value: number; daysLate: number; procedure: string }[]; movements: FinanceMovement[];
  movimentosMes: FinanceMovement[];
}) {
  const saldoTotal = banks.reduce((s, b) => s + b.balance, 0);
  const porMes = monthlyTotals(movements, 7);
  const fluxoData: FluxoMesPonto[] = porMes;
  const evolucaoData: EvolucaoMesPonto[] = porMes.map((p) => ({ mes: p.mes, receita: p.entradas, despesa: p.saidas, saldo: p.entradas - p.saidas }));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 animate-slide-up" style={{ animationFillMode: 'both' }}>
        <KpiCard title="Saldo Total" value={`R$ ${saldoTotal.toLocaleString("pt-BR")}`} icon={Wallet} />
        <KpiCard title="Entradas (Mês)" value={`R$ ${totalEntradas.toLocaleString("pt-BR")}`} change="Receitas" changeType="positive" icon={ArrowUpRight} />
        <KpiCard title="Saídas (Mês)" value={`R$ ${totalSaidas.toLocaleString("pt-BR")}`} change="Despesas" changeType="negative" icon={ArrowDownRight} />
        <KpiCard title="Contas Pendentes" value={`R$ ${totalPendente.toLocaleString("pt-BR")}`} change="A pagar" changeType="negative" icon={Clock} />
        <KpiCard title="Folha Pendente" value={`R$ ${totalFolhaPendente.toLocaleString("pt-BR")}`} change="Salários" changeType="neutral" icon={Users} />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FluxoCaixaChart data={fluxoData} />
        <ReceitaDespesaChart data={evolucaoData} />
        <DespesasCategoriaChart movements={movimentosMes} />
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
            {banks.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhum banco cadastrado</p>}
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
            {movements.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhuma movimentação</p>}
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
            {overdue.map((o, i) => (
              <div key={i} className="bg-destructive/5 rounded-lg p-3 border border-destructive/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">{o.patient}</span>
                  <span className="text-xs font-bold text-destructive">R$ {o.value.toLocaleString("pt-BR")}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{o.procedure} • {o.daysLate}d atraso</p>
              </div>
            ))}
            {overdue.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhum inadimplente 🎉</p>}
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
  onAdd: (m: Omit<FinanceMovement, "id">) => Promise<boolean>; banks: BankAccount[];
}) {
  const [form, setForm] = useState({
    type: "entrada" as "entrada" | "saida",
    description: "", category: "consulta" as FinanceCategory, value: "",
    bankAccountId: banks[0]?.id ?? "", patient: "",
  });

  const handleSubmit = async () => {
    if (!form.description || !form.value) { toast.error("Preencha descrição e valor."); return; }
    const bank = banks.find((b) => b.id === form.bankAccountId);
    const ok = await onAdd({
      type: form.type, description: form.description, category: form.category,
      value: parseFloat(form.value), date: new Date().toLocaleDateString("pt-BR"),
      bankAccountId: form.bankAccountId, bankName: bank?.bank ?? "—",
      patient: form.patient || undefined,
    });
    if (ok) setForm({ type: "entrada", description: "", category: "consulta", value: "", bankAccountId: banks[0]?.id ?? "", patient: "" });
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
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
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
                <td className="px-4 py-3 text-xs text-muted-foreground">{categoryLabels[m.category as FinanceCategory] ?? m.category}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{m.bankName}</td>
                <td className={`px-4 py-3 text-xs font-bold text-right ${m.type === "entrada" ? "text-success" : "text-destructive"}`}>
                  {m.type === "entrada" ? "+" : "-"}R$ {m.value.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{m.date}</td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-xs text-muted-foreground">Nenhuma movimentação registrada</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

// ==================== TAB: CONTAS A PAGAR ====================

function TabContasPagar({
  bills, showAdd, setShowAdd, onAdd, onPay, banks,
}: {
  bills: Bill[]; showAdd: boolean; setShowAdd: (v: boolean) => void;
  onAdd: (b: Omit<Bill, "id">) => Promise<boolean>; onPay: (billId: string, bankId: string) => void; banks: BankAccount[];
}) {
  const [form, setForm] = useState({
    description: "", category: "aluguel" as FinanceCategory, value: "",
    dueDate: "", supplier: "", recurrent: false,
  });
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payBankId, setPayBankId] = useState(banks[0]?.id ?? "");

  // Vencidas primeiro, depois por vencimento mais próximo (o texto dd/mm/aaaa não ordena sozinho)
  const dueTime = (b: Bill) => parseBrDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const pendentes = bills
    .filter((b) => b.status === "pendente" || b.status === "vencido")
    .sort((a, b) => dueTime(a) - dueTime(b));
  const vencidas = pendentes.filter((b) => b.status === "vencido").length;
  const pagos = bills.filter((b) => b.status === "pago");

  const handleSubmit = async () => {
    if (!form.description || !form.value || !form.dueDate) { toast.error("Preencha descrição, valor e vencimento."); return; }
    // O input de data devolve aaaa-mm-dd; o servidor guarda dd/mm/aaaa como as demais contas.
    const [yy, mm, dd] = form.dueDate.split("-");
    const ok = await onAdd({
      description: form.description, category: form.category, value: parseFloat(form.value),
      dueDate: `${dd}/${mm}/${yy}`, status: "pendente", supplier: form.supplier || undefined,
      recurrent: form.recurrent,
    });
    if (ok) setForm({ description: "", category: "aluguel", value: "", dueDate: "", supplier: "", recurrent: false });
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
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
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
          {vencidas > 0 && (
            <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
              {vencidas} vencida(s)
            </span>
          )}
        </div>
        <div className="divide-y divide-border/50">
          {pendentes.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex-1 min-w-[160px]">
                <div className="flex items-center gap-2">
                  {b.status === "vencido" && <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-label="Vencida" />}
                  <p className="text-xs font-medium text-foreground">{b.description}</p>
                  {b.recurrent && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">Recorrente</span>}
                </div>
                <p className={`text-[10px] ${b.status === "vencido" ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  {b.supplier ?? "—"} • {b.status === "vencido" ? "Venceu em" : "Venc:"} {b.dueDate}
                </p>
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
                    <button onClick={() => setPayingId(null)} aria-label="Cancelar pagamento" className="h-8 w-8 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted">✕</button>
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
          {pagos.length === 0 && (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">Nenhuma conta paga</div>
          )}
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
  onAdd: (e: Omit<Employee, "id">, deductions: number) => Promise<boolean>;
  onPayPayroll: (id: string, bankId: string) => void; banks: BankAccount[];
}) {
  const [form, setForm] = useState({ name: "", role: "", cpf: "", salary: "", benefits: "", deductions: "" });
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payBankId, setPayBankId] = useState(banks[0]?.id ?? "");

  const currentMonth = `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`;
  const folhaMesAtual = payrolls.filter((p) => p.month === currentMonth);

  const handleSubmit = async () => {
    if (!form.name || !form.role || !form.salary) { toast.error("Preencha nome, cargo e salário."); return; }
    const salary = parseFloat(form.salary);
    const benefits = parseFloat(form.benefits || "0") || 0;
    const deductions = parseFloat(form.deductions || "0") || 0;
    if (deductions < 0) { toast.error("Descontos não podem ser negativos."); return; }
    if (deductions > salary + benefits) { toast.error("Descontos não podem passar de salário + benefícios."); return; }
    const ok = await onAdd({
      name: form.name, role: form.role, cpf: form.cpf,
      admissionDate: new Date().toLocaleDateString("pt-BR"),
      salary, benefits,
      bankAccountId: banks[0]?.id ?? "", active: true,
    }, deductions);
    if (ok) setForm({ name: "", role: "", cpf: "", salary: "", benefits: "", deductions: "" });
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
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
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
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Benefícios (R$)</label>
              <input type="number" value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" placeholder="0" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Descontos (R$)</label>
              <input type="number" min="0" value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" placeholder="0" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleSubmit} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
              Salvar
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A folha deste mês é criada com o valor líquido = salário + benefícios − descontos. Informe INSS, IRRF e outros descontos no campo "Descontos".
          </p>
        </div>
      )}

      {/* Lista de funcionários */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-card-foreground">Equipe ({employees.length})</h3>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
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
            {employees.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-xs text-muted-foreground">Nenhum funcionário cadastrado</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Folha de pagamento do mês */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-card-foreground">Folha de Pagamento — {currentMonth}</h3>
          <span className="text-[10px] font-bold text-warning bg-warning/10 px-2.5 py-1 rounded-full">
            {folhaMesAtual.filter((p) => p.status === "pendente").length} pendente(s)
          </span>
        </div>
        <div className="divide-y divide-border/50">
          {folhaMesAtual.map((pr) => (
            <div key={pr.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex-1 min-w-[160px]">
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
                    <button onClick={() => setPayingId(null)} aria-label="Cancelar pagamento" className="h-8 w-8 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted">✕</button>
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
          {folhaMesAtual.length === 0 && (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">Nenhuma folha de pagamento para este mês</div>
          )}
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
  onAdd: (b: Omit<BankAccount, "id">) => Promise<boolean>;
}) {
  const [form, setForm] = useState({ name: "", bank: "", agency: "", account: "", type: "corrente" as BankAccount["type"], balance: "" });
  const colors = ["hsl(152, 60%, 42%)", "hsl(270, 60%, 55%)", "hsl(38, 92%, 50%)", "hsl(187, 85%, 43%)", "hsl(0, 72%, 51%)"];

  const handleSubmit = async () => {
    if (!form.name || !form.bank) { toast.error("Preencha nome e banco."); return; }
    const ok = await onAdd({
      name: form.name, bank: form.bank, agency: form.agency, account: form.account,
      type: form.type, balance: parseFloat(form.balance || "0"),
      color: colors[banks.length % colors.length],
    });
    if (ok) setForm({ name: "", bank: "", agency: "", account: "", type: "corrente", balance: "" });
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
        {banks.length === 0 && (
          <div className="col-span-full text-center py-8 text-xs text-muted-foreground">Nenhum banco cadastrado</div>
        )}
      </div>
    </>
  );
}

// ==================== TAB: DRE ====================

function dreTotals(movs: FinanceMovement[]) {
  const entradas = movs.filter((m) => m.type === "entrada");
  const saidas = movs.filter((m) => m.type === "saida");
  const sum = (list: FinanceMovement[], cats?: string[]) =>
    list.filter((e) => !cats || cats.includes(e.category)).reduce((s, e) => s + e.value, 0);
  const receitaTotal = sum(entradas);
  const despTotal = sum(saidas);
  return {
    hasData: movs.length > 0,
    receitaTotal,
    receitaConsultas: sum(entradas, ["consulta"]),
    receitaProcedimentos: sum(entradas, ["procedimento", "implante", "ortodontia", "protese"]),
    despTotal,
    despPessoal: sum(saidas, ["salario", "comissao"]),
    despMarketing: sum(saidas, ["marketing"]),
    despOcupacao: sum(saidas, ["aluguel", "energia", "agua", "internet"]),
    despMaterial: sum(saidas, ["material", "laboratorio"]),
    // "impostos" fica só aqui (não há linha de deduções separada, para não contar duas vezes)
    despAdmin: sum(saidas, ["software", "manutencao", "impostos"]),
    lucro: receitaTotal - despTotal,
    margem: receitaTotal > 0 ? Math.round(((receitaTotal - despTotal) / receitaTotal) * 100) : null,
  };
}

const NOMES_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function TabDRE({ movements }: { movements: FinanceMovement[] }) {
  const atualKey = monthKeyOffset(0);
  const anteriorKey = monthKeyOffset(-1);
  const atual = dreTotals(movementsInMonth(movements, atualKey));
  const anterior = dreTotals(movementsInMonth(movements, anteriorKey));
  const nomeMes = (key: string) => {
    const [y, m] = key.split("-");
    return `${NOMES_MESES[Number(m) - 1]}/${y}`;
  };

  type DreLine = { label: string; currentMonth: number; previousMonth: number | null; isBold?: boolean; isTotal?: boolean; indent?: number; isPercent?: boolean; isExpense?: boolean };
  // Sem lançamentos no mês anterior, a coluna mostra "—" (não inventamos comparação).
  const prev = (v: number) => (anterior.hasData ? v : null);
  const dreLines: DreLine[] = [
    { label: "RECEITA OPERACIONAL BRUTA", currentMonth: atual.receitaTotal, previousMonth: prev(anterior.receitaTotal), isBold: true, isTotal: true },
    { label: "Consultas e Avaliações", currentMonth: atual.receitaConsultas, previousMonth: prev(anterior.receitaConsultas), indent: 1 },
    { label: "Procedimentos e Tratamentos", currentMonth: atual.receitaProcedimentos, previousMonth: prev(anterior.receitaProcedimentos), indent: 1 },
    { label: "", currentMonth: 0, previousMonth: 0 },
    { label: "DESPESAS OPERACIONAIS", currentMonth: atual.despTotal, previousMonth: prev(anterior.despTotal), isBold: true, isTotal: true, isExpense: true },
    { label: "Pessoal (Salários + Comissões)", currentMonth: atual.despPessoal, previousMonth: prev(anterior.despPessoal), indent: 1, isExpense: true },
    { label: "Marketing e Publicidade", currentMonth: atual.despMarketing, previousMonth: prev(anterior.despMarketing), indent: 1, isExpense: true },
    { label: "Ocupação (Aluguel, Energia, Internet)", currentMonth: atual.despOcupacao, previousMonth: prev(anterior.despOcupacao), indent: 1, isExpense: true },
    { label: "Materiais e Laboratório", currentMonth: atual.despMaterial, previousMonth: prev(anterior.despMaterial), indent: 1, isExpense: true },
    { label: "Administrativas (Software, Manutenção, Impostos)", currentMonth: atual.despAdmin, previousMonth: prev(anterior.despAdmin), indent: 1, isExpense: true },
    { label: "", currentMonth: 0, previousMonth: 0 },
    { label: "RESULTADO OPERACIONAL", currentMonth: atual.lucro, previousMonth: prev(anterior.lucro), isBold: true, isTotal: true },
    { label: "Margem Operacional", currentMonth: atual.margem ?? 0, previousMonth: anterior.hasData ? anterior.margem : null, isBold: true, isPercent: true },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">DRE — Demonstração do Resultado</h2>
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {nomeMes(atualKey)} vs {nomeMes(anteriorKey)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-3">
        Calculado a partir das movimentações lançadas em cada mês. Impostos entram em despesas administrativas.
        {!anterior.hasData && " Não há lançamentos no mês anterior, por isso a comparação aparece como \u201c—\u201d."}
      </p>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-6 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Descrição</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Mês Atual</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Mês Anterior</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Var %</th>
            </tr>
          </thead>
          <tbody>
            {dreLines.map((line, i) => {
              if (!line.label) return <tr key={i}><td colSpan={4} className="h-3" /></tr>;

              const isMargin = !!line.isPercent;
              const hasPrev = line.previousMonth !== null;
              // Var % só faz sentido com base positiva no mês anterior
              const variation = hasPrev && line.previousMonth! > 0
                ? Math.round(((line.currentMonth - line.previousMonth!) / line.previousMonth!) * 100)
                : null;

              return (
                <tr key={i} className={`border-b border-border/30 ${line.isTotal ? "bg-muted/20" : ""} hover:bg-muted/30 transition-colors`}>
                  <td className={`px-6 py-3 text-xs ${line.isBold ? "font-bold text-foreground" : "text-foreground"}`}
                    style={{ paddingLeft: line.indent ? `${24 + line.indent * 20}px` : undefined }}>
                    {line.label}
                  </td>
                  <td className={`px-4 py-3 text-xs text-right ${line.isBold ? "font-bold" : ""} text-foreground`}>
                    {isMargin ? (atual.margem === null ? "—" : `${line.currentMonth}%`) : `R$ ${line.currentMonth.toLocaleString("pt-BR")}`}
                  </td>
                  <td className="px-4 py-3 text-xs text-right text-muted-foreground">
                    {!hasPrev ? "—" : isMargin ? `${line.previousMonth}%` : `R$ ${line.previousMonth!.toLocaleString("pt-BR")}`}
                  </td>
                  <td className={`px-4 py-3 text-xs text-right font-bold ${
                    isMargin || variation === null ? "text-muted-foreground" :
                    // Em despesa, subir é ruim (vermelho) e cair é bom (verde)
                    variation === 0 ? "text-muted-foreground" :
                    (variation > 0) !== !!line.isExpense ? "text-success" : "text-destructive"
                  }`}>
                    {isMargin || variation === null ? "—" : variation > 0 ? `+${variation}%` : `${variation}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}
