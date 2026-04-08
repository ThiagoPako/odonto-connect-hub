/**
 * DADOS FINANCEIROS PROFISSIONAIS
 * Módulo financeiro completo: bancos, contas a pagar/receber, funcionários,
 * folha de pagamento, movimentações e DRE.
 */

// ==================== BANCOS ====================

export interface BankAccount {
  id: string;
  name: string;
  bank: string;
  agency: string;
  account: string;
  type: "corrente" | "poupanca" | "investimento";
  balance: number;
  color: string;
}

export const mockBankAccounts: BankAccount[] = [
  { id: "bk1", name: "Conta Principal", bank: "Itaú", agency: "1234", account: "56789-0", type: "corrente", balance: 87500, color: "hsl(217, 91%, 60%)" },
  { id: "bk2", name: "Conta Operacional", bank: "Bradesco", agency: "0567", account: "12345-6", type: "corrente", balance: 32400, color: "hsl(0, 72%, 51%)" },
  { id: "bk3", name: "Reserva", bank: "Nubank", agency: "0001", account: "98765-4", type: "poupanca", balance: 65000, color: "hsl(270, 60%, 55%)" },
  { id: "bk4", name: "Investimentos", bank: "XP", agency: "0001", account: "11111-1", type: "investimento", balance: 120000, color: "hsl(38, 92%, 50%)" },
];

// ==================== CATEGORIAS ====================

export type FinanceCategory =
  | "consulta" | "procedimento" | "implante" | "ortodontia" | "protese"
  | "salario" | "comissao" | "aluguel" | "energia" | "agua" | "internet"
  | "material" | "marketing" | "manutencao" | "impostos" | "laboratorio"
  | "software" | "outros_receita" | "outros_despesa";

export const categoryLabels: Record<FinanceCategory, string> = {
  consulta: "Consulta", procedimento: "Procedimento", implante: "Implante",
  ortodontia: "Ortodontia", protese: "Prótese", salario: "Salário",
  comissao: "Comissão", aluguel: "Aluguel", energia: "Energia",
  agua: "Água", internet: "Internet", material: "Material Odontológico",
  marketing: "Marketing/Ads", manutencao: "Manutenção", impostos: "Impostos",
  laboratorio: "Laboratório", software: "Software/Sistemas",
  outros_receita: "Outros (Receita)", outros_despesa: "Outros (Despesa)",
};

// ==================== FUNCIONÁRIOS ====================

export interface Employee {
  id: string;
  name: string;
  role: string;
  cpf: string;
  admissionDate: string;
  salary: number;
  benefits: number;
  bankAccountId: string;
  active: boolean;
}

export const mockEmployees: Employee[] = [
  { id: "emp1", name: "Ana Rodrigues", role: "Recepcionista", cpf: "123.456.789-00", admissionDate: "01/03/2024", salary: 2800, benefits: 600, bankAccountId: "bk1", active: true },
  { id: "emp2", name: "Carla Mendes", role: "Auxiliar de Dentista", cpf: "234.567.890-11", admissionDate: "15/06/2024", salary: 2200, benefits: 500, bankAccountId: "bk1", active: true },
  { id: "emp3", name: "Beatriz Lopes", role: "Recepcionista", cpf: "345.678.901-22", admissionDate: "01/01/2025", salary: 2600, benefits: 550, bankAccountId: "bk1", active: true },
  { id: "emp4", name: "Marcos Silva", role: "Administrador", cpf: "456.789.012-33", admissionDate: "01/08/2023", salary: 4500, benefits: 800, bankAccountId: "bk1", active: true },
  { id: "emp5", name: "Julia Oliveira", role: "Auxiliar de Limpeza", cpf: "567.890.123-44", admissionDate: "10/02/2025", salary: 1800, benefits: 400, bankAccountId: "bk1", active: true },
];

// ==================== FOLHA DE PAGAMENTO ====================

export interface Payroll {
  id: string;
  employeeId: string;
  employeeName: string;
  month: string; // "04/2026"
  grossSalary: number;
  benefits: number;
  deductions: number;
  netSalary: number;
  status: "pendente" | "pago";
  paymentDate?: string;
  bankAccountId?: string;
}

export let mockPayrolls: Payroll[] = [
  { id: "pr1", employeeId: "emp1", employeeName: "Ana Rodrigues", month: "04/2026", grossSalary: 2800, benefits: 600, deductions: 420, netSalary: 2980, status: "pendente" },
  { id: "pr2", employeeId: "emp2", employeeName: "Carla Mendes", month: "04/2026", grossSalary: 2200, benefits: 500, deductions: 330, netSalary: 2370, status: "pendente" },
  { id: "pr3", employeeId: "emp3", employeeName: "Beatriz Lopes", month: "04/2026", grossSalary: 2600, benefits: 550, deductions: 390, netSalary: 2760, status: "pendente" },
  { id: "pr4", employeeId: "emp4", employeeName: "Marcos Silva", month: "04/2026", grossSalary: 4500, benefits: 800, deductions: 675, netSalary: 4625, status: "pendente" },
  { id: "pr5", employeeId: "emp5", employeeName: "Julia Oliveira", month: "04/2026", grossSalary: 1800, benefits: 400, deductions: 270, netSalary: 1930, status: "pendente" },
  // Mês anterior — pagos
  { id: "pr6", employeeId: "emp1", employeeName: "Ana Rodrigues", month: "03/2026", grossSalary: 2800, benefits: 600, deductions: 420, netSalary: 2980, status: "pago", paymentDate: "05/03/2026", bankAccountId: "bk1" },
  { id: "pr7", employeeId: "emp2", employeeName: "Carla Mendes", month: "03/2026", grossSalary: 2200, benefits: 500, deductions: 330, netSalary: 2370, status: "pago", paymentDate: "05/03/2026", bankAccountId: "bk1" },
  { id: "pr8", employeeId: "emp3", employeeName: "Beatriz Lopes", month: "03/2026", grossSalary: 2600, benefits: 550, deductions: 390, netSalary: 2760, status: "pago", paymentDate: "05/03/2026", bankAccountId: "bk1" },
  { id: "pr9", employeeId: "emp4", employeeName: "Marcos Silva", month: "03/2026", grossSalary: 4500, benefits: 800, deductions: 675, netSalary: 4625, status: "pago", paymentDate: "05/03/2026", bankAccountId: "bk1" },
  { id: "pr10", employeeId: "emp5", employeeName: "Julia Oliveira", month: "03/2026", grossSalary: 1800, benefits: 400, deductions: 270, netSalary: 1930, status: "pago", paymentDate: "05/03/2026", bankAccountId: "bk1" },
];

// ==================== CONTAS A PAGAR ====================

export interface Bill {
  id: string;
  description: string;
  category: FinanceCategory;
  value: number;
  dueDate: string;
  status: "pendente" | "pago" | "vencido";
  supplier?: string;
  bankAccountId?: string;
  paymentDate?: string;
  recurrent: boolean;
}

export let mockBills: Bill[] = [
  { id: "bill1", description: "Aluguel — Abril", category: "aluguel", value: 8500, dueDate: "10/04/2026", status: "pago", supplier: "Imobiliária Central", bankAccountId: "bk1", paymentDate: "09/04/2026", recurrent: true },
  { id: "bill2", description: "Energia Elétrica — Abril", category: "energia", value: 1850, dueDate: "15/04/2026", status: "pendente", supplier: "CPFL", recurrent: true },
  { id: "bill3", description: "Google Ads — Abril", category: "marketing", value: 4200, dueDate: "20/04/2026", status: "pendente", supplier: "Google", recurrent: true },
  { id: "bill4", description: "Meta Ads — Abril", category: "marketing", value: 3800, dueDate: "20/04/2026", status: "pendente", supplier: "Meta", recurrent: true },
  { id: "bill5", description: "Material Odontológico", category: "material", value: 3200, dueDate: "12/04/2026", status: "pendente", supplier: "Dentsply", recurrent: false },
  { id: "bill6", description: "Laboratório Próteses", category: "laboratorio", value: 5600, dueDate: "18/04/2026", status: "pendente", supplier: "Lab Dental SP", recurrent: false },
  { id: "bill7", description: "Internet Fibra", category: "internet", value: 350, dueDate: "05/04/2026", status: "pago", supplier: "Vivo", bankAccountId: "bk2", paymentDate: "04/04/2026", recurrent: true },
  { id: "bill8", description: "Software Gestão", category: "software", value: 890, dueDate: "01/04/2026", status: "pago", supplier: "Odonto Connect", bankAccountId: "bk2", paymentDate: "01/04/2026", recurrent: true },
  { id: "bill9", description: "IPTU — Parcela 4/10", category: "impostos", value: 1200, dueDate: "25/04/2026", status: "pendente", supplier: "Prefeitura", recurrent: true },
  { id: "bill10", description: "Manutenção Ar Condicionado", category: "manutencao", value: 650, dueDate: "08/04/2026", status: "vencido", supplier: "RefriAr", recurrent: false },
];

// ==================== MOVIMENTAÇÕES ====================

export interface FinanceMovement {
  id: string;
  type: "entrada" | "saida";
  description: string;
  category: FinanceCategory;
  value: number;
  date: string;
  bankAccountId: string;
  bankName: string;
  patient?: string;
  billId?: string;
  payrollId?: string;
}

export let mockMovements: FinanceMovement[] = [
  // Entradas (receitas de pacientes)
  { id: "mv1", type: "entrada", description: "Implante — Parcela 3/12", category: "implante", value: 1833, date: "08/04/2026", bankAccountId: "bk1", bankName: "Itaú", patient: "Lucia Ferreira" },
  { id: "mv2", type: "entrada", description: "Clareamento — À vista (Pix)", category: "procedimento", value: 2800, date: "07/04/2026", bankAccountId: "bk1", bankName: "Itaú", patient: "Ana Beatriz" },
  { id: "mv3", type: "entrada", description: "Consulta + Radiografia", category: "consulta", value: 450, date: "05/04/2026", bankAccountId: "bk2", bankName: "Bradesco", patient: "Maria Silva" },
  { id: "mv4", type: "entrada", description: "Ortodontia — Parcela 1/24", category: "ortodontia", value: 650, date: "02/04/2026", bankAccountId: "bk1", bankName: "Itaú", patient: "Pedro Costa" },
  { id: "mv5", type: "entrada", description: "Prótese fixa — Parcela 2/6", category: "protese", value: 2200, date: "01/04/2026", bankAccountId: "bk1", bankName: "Itaú", patient: "Fernanda Lima" },
  { id: "mv6", type: "entrada", description: "Consulta avaliação", category: "consulta", value: 250, date: "28/03/2026", bankAccountId: "bk2", bankName: "Bradesco", patient: "Roberto Mendes" },
  // Saídas (despesas pagas)
  { id: "mv7", type: "saida", description: "Aluguel — Abril", category: "aluguel", value: 8500, date: "09/04/2026", bankAccountId: "bk1", bankName: "Itaú", billId: "bill1" },
  { id: "mv8", type: "saida", description: "Internet Fibra", category: "internet", value: 350, date: "04/04/2026", bankAccountId: "bk2", bankName: "Bradesco", billId: "bill7" },
  { id: "mv9", type: "saida", description: "Software Gestão", category: "software", value: 890, date: "01/04/2026", bankAccountId: "bk2", bankName: "Bradesco", billId: "bill8" },
  // Folha mês anterior
  { id: "mv10", type: "saida", description: "Folha Pgto — Ana Rodrigues (Mar)", category: "salario", value: 2980, date: "05/03/2026", bankAccountId: "bk1", bankName: "Itaú", payrollId: "pr6" },
  { id: "mv11", type: "saida", description: "Folha Pgto — Carla Mendes (Mar)", category: "salario", value: 2370, date: "05/03/2026", bankAccountId: "bk1", bankName: "Itaú", payrollId: "pr7" },
  { id: "mv12", type: "saida", description: "Folha Pgto — Beatriz Lopes (Mar)", category: "salario", value: 2760, date: "05/03/2026", bankAccountId: "bk1", bankName: "Itaú", payrollId: "pr8" },
  { id: "mv13", type: "saida", description: "Folha Pgto — Marcos Silva (Mar)", category: "salario", value: 4625, date: "05/03/2026", bankAccountId: "bk1", bankName: "Itaú", payrollId: "pr9" },
  { id: "mv14", type: "saida", description: "Folha Pgto — Julia Oliveira (Mar)", category: "salario", value: 1930, date: "05/03/2026", bankAccountId: "bk1", bankName: "Itaú", payrollId: "pr10" },
];

// ==================== DRE ====================

export interface DRELine {
  label: string;
  currentMonth: number;
  previousMonth: number;
  isBold?: boolean;
  isTotal?: boolean;
  indent?: number;
}

export function generateDRE(): DRELine[] {
  const entradas = mockMovements.filter((m) => m.type === "entrada");
  const saidas = mockMovements.filter((m) => m.type === "saida");

  const receitaConsultas = entradas.filter((e) => e.category === "consulta").reduce((s, e) => s + e.value, 0);
  const receitaProcedimentos = entradas.filter((e) => ["procedimento", "implante", "ortodontia", "protese"].includes(e.category)).reduce((s, e) => s + e.value, 0);
  const receitaTotal = entradas.reduce((s, e) => s + e.value, 0);

  const despPessoal = saidas.filter((e) => ["salario", "comissao"].includes(e.category)).reduce((s, e) => s + e.value, 0);
  const despMarketing = saidas.filter((e) => e.category === "marketing").reduce((s, e) => s + e.value, 0);
  const despOcupacao = saidas.filter((e) => ["aluguel", "energia", "agua", "internet"].includes(e.category)).reduce((s, e) => s + e.value, 0);
  const despMaterial = saidas.filter((e) => ["material", "laboratorio"].includes(e.category)).reduce((s, e) => s + e.value, 0);
  const despAdmin = saidas.filter((e) => ["software", "manutencao", "impostos"].includes(e.category)).reduce((s, e) => s + e.value, 0);
  const despTotal = saidas.reduce((s, e) => s + e.value, 0);

  const lucro = receitaTotal - despTotal;

  // Mês anterior (simulado com multiplicador)
  const mult = 0.88;

  return [
    { label: "RECEITA OPERACIONAL BRUTA", currentMonth: receitaTotal, previousMonth: Math.round(receitaTotal * mult), isBold: true, isTotal: true },
    { label: "Consultas e Avaliações", currentMonth: receitaConsultas, previousMonth: Math.round(receitaConsultas * 0.9), indent: 1 },
    { label: "Procedimentos e Tratamentos", currentMonth: receitaProcedimentos, previousMonth: Math.round(receitaProcedimentos * mult), indent: 1 },
    { label: "", currentMonth: 0, previousMonth: 0 },
    { label: "(-) DEDUÇÕES E IMPOSTOS", currentMonth: Math.round(receitaTotal * 0.08), previousMonth: Math.round(receitaTotal * mult * 0.08), indent: 0 },
    { label: "RECEITA OPERACIONAL LÍQUIDA", currentMonth: Math.round(receitaTotal * 0.92), previousMonth: Math.round(receitaTotal * mult * 0.92), isBold: true, isTotal: true },
    { label: "", currentMonth: 0, previousMonth: 0 },
    { label: "DESPESAS OPERACIONAIS", currentMonth: despTotal, previousMonth: Math.round(despTotal * 0.95), isBold: true, isTotal: true },
    { label: "Pessoal (Salários + Comissões)", currentMonth: despPessoal, previousMonth: Math.round(despPessoal * 0.95), indent: 1 },
    { label: "Marketing e Publicidade", currentMonth: despMarketing, previousMonth: Math.round(despMarketing * 1.1), indent: 1 },
    { label: "Ocupação (Aluguel, Energia, Internet)", currentMonth: despOcupacao, previousMonth: Math.round(despOcupacao * 0.98), indent: 1 },
    { label: "Materiais e Laboratório", currentMonth: despMaterial, previousMonth: Math.round(despMaterial * 0.85), indent: 1 },
    { label: "Administrativas (Software, Manutenção, Impostos)", currentMonth: despAdmin, previousMonth: Math.round(despAdmin * 1.05), indent: 1 },
    { label: "", currentMonth: 0, previousMonth: 0 },
    { label: "RESULTADO OPERACIONAL (EBITDA)", currentMonth: lucro, previousMonth: Math.round((receitaTotal * mult * 0.92) - (despTotal * 0.95)), isBold: true, isTotal: true },
    { label: "Margem Operacional", currentMonth: receitaTotal > 0 ? Math.round((lucro / receitaTotal) * 100) : 0, previousMonth: 0, isBold: true },
  ];
}

// ==================== INADIMPLENTES ====================

export const mockOverdue = [
  { patient: "Roberto Mendes", value: 2400, daysLate: 15, procedure: "Implante" },
  { patient: "João Santos", value: 850, daysLate: 8, procedure: "Clareamento" },
  { patient: "Fernanda Lima", value: 1200, daysLate: 3, procedure: "Ortodontia" },
];

// ==================== HELPERS ====================

let nextId = 100;
export function generateId() {
  return `fin_${++nextId}`;
}
