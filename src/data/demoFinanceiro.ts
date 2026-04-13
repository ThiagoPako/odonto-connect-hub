/**
 * Dados de demonstração — Financeiro (movimentações, bancos, funcionários, contas)
 */
import type { FinanceMovement, BankAccount, Employee, Payroll, Bill } from "@/data/financeiroMockData";

export const demoBanks: BankAccount[] = [
  { id: "bk1", name: "Conta Principal", bank: "Itaú", agency: "1234", account: "56789-0", type: "corrente", balance: 87500, color: "hsl(25,95%,53%)" },
  { id: "bk2", name: "Conta Reserva", bank: "Bradesco", agency: "5678", account: "12345-6", type: "poupanca", balance: 45000, color: "hsl(348,83%,47%)" },
  { id: "bk3", name: "Conta PJ", bank: "Nubank", agency: "0001", account: "99887-1", type: "corrente", balance: 23800, color: "hsl(270,60%,55%)" },
];

export const demoEmployees: Employee[] = [
  { id: "emp1", name: "Dr. Carlos Mendes", role: "Dentista — Implantodontia", cpf: "111.222.333-44", admissionDate: "2020-03-15", salary: 12000, benefits: 1500, bankAccountId: "bk1", active: true },
  { id: "emp2", name: "Dra. Ana Beatriz", role: "Dentista — Ortodontia", cpf: "222.333.444-55", admissionDate: "2021-06-01", salary: 10000, benefits: 1200, bankAccountId: "bk1", active: true },
  { id: "emp3", name: "Dr. Roberto Lima", role: "Dentista — Cirurgia", cpf: "333.444.555-66", admissionDate: "2022-01-10", salary: 11000, benefits: 1300, bankAccountId: "bk1", active: true },
  { id: "emp4", name: "Carla Moreira", role: "Recepcionista", cpf: "444.555.666-77", admissionDate: "2023-02-20", salary: 3500, benefits: 800, bankAccountId: "bk1", active: true },
  { id: "emp5", name: "Beatriz Lopes", role: "Auxiliar de Saúde Bucal", cpf: "555.666.777-88", admissionDate: "2023-05-15", salary: 3000, benefits: 700, bankAccountId: "bk1", active: true },
];

const hoje = new Date();
const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

export const demoPayrolls: Payroll[] = demoEmployees.map((emp, i) => ({
  id: `pay${i + 1}`,
  employeeId: emp.id,
  employeeName: emp.name,
  month: mesAtual,
  grossSalary: emp.salary,
  benefits: emp.benefits,
  deductions: Math.round(emp.salary * 0.11),
  netSalary: emp.salary + emp.benefits - Math.round(emp.salary * 0.11),
  status: i < 2 ? "pago" : "pendente",
  paymentDate: i < 2 ? `${hoje.getDate()}/${hoje.getMonth() + 1}/${hoje.getFullYear()}` : undefined,
  bankAccountId: "bk1",
}));

export const demoBills: Bill[] = [
  { id: "bill1", description: "Aluguel clínica", category: "aluguel", value: 8500, dueDate: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-10`, status: "pago", supplier: "Imobiliária Central", bankAccountId: "bk1", recurrent: true },
  { id: "bill2", description: "Material descartável — luvas e máscaras", category: "material", value: 2800, dueDate: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-15`, status: "pendente", supplier: "Dental Cremer", bankAccountId: "bk1", recurrent: false },
  { id: "bill3", description: "Energia elétrica", category: "energia", value: 1200, dueDate: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-20`, status: "pendente", supplier: "Enel", bankAccountId: "bk1", recurrent: true },
  { id: "bill4", description: "Software de gestão", category: "software", value: 450, dueDate: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-05`, status: "pago", supplier: "Odonto Connect", bankAccountId: "bk3", recurrent: true },
  { id: "bill5", description: "Manutenção autoclave", category: "manutencao", value: 1500, dueDate: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-25`, status: "pendente", supplier: "Gnatus", recurrent: false },
  { id: "bill6", description: "Internet fibra óptica", category: "internet", value: 350, dueDate: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-08`, status: "pago", supplier: "Vivo", bankAccountId: "bk1", recurrent: true },
];

function dateStr(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toLocaleDateString("pt-BR");
}

export const demoMovements: FinanceMovement[] = [
  { id: "mov1", type: "entrada", description: "Implante unitário — Maria Silva", category: "procedimento", value: 3500, date: dateStr(1), bankAccountId: "bk1", bankName: "Itaú", patient: "Maria Silva Santos" },
  { id: "mov2", type: "entrada", description: "Manutenção ortodôntica — Ana Beatriz", category: "procedimento", value: 450, date: dateStr(1), bankAccountId: "bk1", bankName: "Itaú", patient: "Ana Beatriz Ferreira" },
  { id: "mov3", type: "entrada", description: "Clareamento dental — Juliana Pereira", category: "procedimento", value: 1200, date: dateStr(2), bankAccountId: "bk1", bankName: "Itaú", patient: "Juliana Martins Pereira" },
  { id: "mov4", type: "entrada", description: "Restauração em resina — Rafael Martins", category: "procedimento", value: 350, date: dateStr(3), bankAccountId: "bk1", bankName: "Itaú", patient: "Rafael Souza Martins" },
  { id: "mov5", type: "entrada", description: "Extração — Thiago Dias", category: "procedimento", value: 800, date: dateStr(3), bankAccountId: "bk1", bankName: "Itaú", patient: "Thiago Henrique Dias" },
  { id: "mov6", type: "entrada", description: "Prótese fixa — Carlos Mendes", category: "procedimento", value: 4500, date: dateStr(5), bankAccountId: "bk1", bankName: "Itaú", patient: "Carlos Eduardo Mendes" },
  { id: "mov7", type: "entrada", description: "Consulta avaliação — Isabela Rodrigues", category: "consulta", value: 200, date: dateStr(5), bankAccountId: "bk1", bankName: "Itaú", patient: "Isabela Rodrigues" },
  { id: "mov8", type: "entrada", description: "Periodontia — Roberto Campos", category: "procedimento", value: 600, date: dateStr(7), bankAccountId: "bk1", bankName: "Itaú", patient: "Roberto Campos Silva" },
  { id: "mov9", type: "saida", description: "Aluguel clínica", category: "aluguel", value: 8500, date: dateStr(10), bankAccountId: "bk1", bankName: "Itaú", billId: "bill1" },
  { id: "mov10", type: "saida", description: "Software de gestão", category: "tecnologia", value: 450, date: dateStr(5), bankAccountId: "bk3", bankName: "Nubank", billId: "bill4" },
  { id: "mov11", type: "saida", description: "Internet", category: "utilidades", value: 350, date: dateStr(8), bankAccountId: "bk1", bankName: "Itaú", billId: "bill6" },
  { id: "mov12", type: "entrada", description: "Facetas em resina (6 unidades) — Juliana Pereira", category: "procedimento", value: 6000, date: dateStr(10), bankAccountId: "bk1", bankName: "Itaú", patient: "Juliana Martins Pereira" },
  { id: "mov13", type: "saida", description: "Folha — Dr. Carlos Mendes", category: "folha", value: 12180, date: dateStr(0), bankAccountId: "bk1", bankName: "Itaú", payrollId: "pay1" },
  { id: "mov14", type: "saida", description: "Folha — Dra. Ana Beatriz", category: "folha", value: 10100, date: dateStr(0), bankAccountId: "bk1", bankName: "Itaú", payrollId: "pay2" },
];

export const demoOverdue = [
  { patient: "João Pedro Oliveira", value: 1500, daysLate: 15, procedure: "Implante — 2ª parcela" },
  { patient: "Patrícia Nunes Barbosa", value: 800, daysLate: 7, procedure: "Prótese parcial — saldo" },
];
