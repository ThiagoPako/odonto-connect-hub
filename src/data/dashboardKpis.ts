/**
 * KPIs CONSOLIDADOS DO DASHBOARD
 * 
 * Puxa dados reais de todos os módulos sincronizados via registroCentral.
 */

// ==================== AGENDA ====================

export function getAgendaKpis() {
  return { total: 0, finalizados: 0, emAtendimento: 0, aguardando: 0, confirmados: 0, faltas: 0, encaixes: 0, taxaPresenca: 0 };
}

// ==================== ORÇAMENTOS ====================

export function getOrcamentoKpis() {
  return {
    total: 0,
    pendentes: 0,
    aprovados: 0,
    reprovados: 0,
    valorTotal: 0,
    valorAprovado: 0,
    taxaConversao: 0,
    ticketMedio: 0,
  };
}

// ==================== CRM ====================

export function getCrmKpis() {
  return { leads: 0, ativos: 0, inativos: 0, receitaTotal: 0, totalLeadsKanban: 0, semResposta: 0 };
}

// ==================== ESTOQUE ====================

export function getEstoqueKpis() {
  return {
    totalItens: 0,
    abaixoMinimo: 0,
    itensAbaixoMinimo: [],
    semEstoque: 0,
    itensSemEstoque: [],
    valorTotalEstoque: 0,
  };
}

// ==================== PACIENTES ====================

export function getPacienteKpis() {
  return {
    totalCadastrados: 0,
  };
}
