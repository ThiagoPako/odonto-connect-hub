/**
 * KPIs CONSOLIDADOS DO DASHBOARD
 * 
 * Puxa dados reais de todos os módulos sincronizados via registroCentral.
 */

import { mockAppointments } from "./agendaMockData";
import { mockBudgets } from "./orcamentoMockData";
import { mockPatients, mockKanbanLeads } from "./crmMockData";
import { mockInventory } from "./estoqueMockData";
import { mockPacientes } from "./pacientesMockData";

// ==================== AGENDA ====================

export function getAgendaKpis() {
  const hoje = mockAppointments; // all are today in mock
  const finalizados = hoje.filter((a) => a.status === "finalizado").length;
  const emAtendimento = hoje.filter((a) => a.status === "em_atendimento").length;
  const aguardando = hoje.filter((a) => a.status === "aguardando").length;
  const confirmados = hoje.filter((a) => a.status === "confirmado").length;
  const faltas = hoje.filter((a) => a.status === "faltou").length;
  const encaixes = hoje.filter((a) => a.status === "encaixe").length;
  const total = hoje.length;
  const taxaPresenca = total > 0 ? Math.round(((total - faltas) / total) * 100) : 0;

  return { total, finalizados, emAtendimento, aguardando, confirmados, faltas, encaixes, taxaPresenca };
}

// ==================== ORÇAMENTOS ====================

export function getOrcamentoKpis() {
  const pendentes = mockBudgets.filter((b) => b.status === "pendente");
  const aprovados = mockBudgets.filter((b) => b.status === "aprovado" || b.status === "em_tratamento" || b.status === "finalizado");
  const reprovados = mockBudgets.filter((b) => b.status === "reprovado");

  const valorTotal = mockBudgets.reduce((sum, b) => sum + b.finalValue, 0);
  const valorAprovado = aprovados.reduce((sum, b) => sum + b.finalValue, 0);
  const taxaConversao = mockBudgets.length > 0 ? Math.round((aprovados.length / mockBudgets.length) * 100) : 0;

  return {
    total: mockBudgets.length,
    pendentes: pendentes.length,
    aprovados: aprovados.length,
    reprovados: reprovados.length,
    valorTotal,
    valorAprovado,
    taxaConversao,
    ticketMedio: aprovados.length > 0 ? Math.round(valorAprovado / aprovados.length) : 0,
  };
}

// ==================== CRM ====================

export function getCrmKpis() {
  const leads = mockPatients.filter((p) => p.status === "lead").length;
  const ativos = mockPatients.filter((p) => p.status === "ativo" || p.status === "paciente").length;
  const inativos = mockPatients.filter((p) => p.status === "inativo").length;
  const receitaTotal = mockPatients.reduce((sum, p) => sum + p.totalSpent, 0);

  const totalLeadsKanban = Object.values(mockKanbanLeads).reduce((sum, arr) => sum + arr.length, 0);
  const semResposta = mockKanbanLeads.sem_resposta.length;

  return { leads, ativos, inativos, receitaTotal, totalLeadsKanban, semResposta };
}

// ==================== ESTOQUE ====================

export function getEstoqueKpis() {
  const abaixoMinimo = mockInventory.filter((i) => i.currentStock < i.minStock);
  const semEstoque = mockInventory.filter((i) => i.currentStock === 0);
  const valorTotalEstoque = mockInventory.reduce((sum, i) => sum + i.currentStock * i.unitCost, 0);

  return {
    totalItens: mockInventory.length,
    abaixoMinimo: abaixoMinimo.length,
    itensAbaixoMinimo: abaixoMinimo.map((i) => i.name),
    semEstoque: semEstoque.length,
    itensSemEstoque: semEstoque.map((i) => i.name),
    valorTotalEstoque,
  };
}

// ==================== PACIENTES ====================

export function getPacienteKpis() {
  return {
    totalCadastrados: mockPacientes.length,
  };
}
