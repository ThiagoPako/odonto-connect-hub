import type { LucideIcon } from "lucide-react";

export interface Patient {
  id: string;
  pacienteId?: string;
  name: string;
  initials: string;
  phone: string;
  email: string;
  origin: string;
  status: "lead" | "ativo" | "inativo" | "paciente";
  lastVisit?: Date;
  createdAt: Date;
  totalSpent: number;
  avatarColor: string;
  avatarUrl?: string | null;
}

export interface KanbanLead {
  id: string;
  name: string;
  initials: string;
  phone: string;
  origin: string;
  value: number;
  assignedTo: string;
  assignedInitials: string;
  assignedAvatarUrl?: string | null;
  lastContact: Date;
  avatarColor: string;
  avatarUrl?: string | null;
  consciousnessLevel?: ConsciousnessLevel;
  budgetId?: string;
}

/* ── Kanban: Funil de Vendas ──────────────────────── */

export type SalesStage =
  | "lead"
  | "em_atendimento"
  | "orcamento"
  | "orcamento_enviado"
  | "orcamento_aprovado";

export const salesStages: { id: SalesStage; label: string; color: string; description: string }[] = [
  { id: "lead", label: "Lead", color: "bg-chart-1", description: "Primeiro contato com a empresa" },
  { id: "em_atendimento", label: "Em Atendimento", color: "bg-primary", description: "Sendo atendido no chat" },
  { id: "orcamento", label: "Orçamento", color: "bg-chart-3", description: "Orçamento em elaboração" },
  { id: "orcamento_enviado", label: "Orçamento Enviado", color: "bg-chart-4", description: "Orçamento enviado ao paciente" },
  { id: "orcamento_aprovado", label: "Orçamento Aprovado", color: "bg-success", description: "Orçamento aprovado — convertido em paciente" },
];

/* ── Kanban: Recuperação de Vendas ────────────────── */

export type RecoveryStage =
  | "followup"
  | "followup_2"
  | "followup_3"
  | "sem_resposta"
  | "orcamento_reprovado"
  | "desqualificado";

export const recoveryStages: { id: RecoveryStage; label: string; color: string; description: string }[] = [
  { id: "followup", label: "Follow-up 1", color: "bg-chart-4", description: "Primeiro follow-up após sem resposta" },
  { id: "followup_2", label: "Follow-up 2", color: "bg-warning", description: "Segundo follow-up" },
  { id: "followup_3", label: "Follow-up 3", color: "bg-chart-5", description: "Último follow-up antes de desqualificar" },
  { id: "sem_resposta", label: "Sem Resposta", color: "bg-chart-2", description: "Sem resposta após follow-ups" },
  { id: "orcamento_reprovado", label: "Orçamento Reprovado", color: "bg-destructive", description: "Orçamento rejeitado — recuperação" },
  { id: "desqualificado", label: "Desqualificado", color: "bg-muted-foreground", description: "Lead desqualificado" },
];

/* ── Níveis de Consciência (Tags) ────────────────── */

export type ConsciousnessLevel =
  | "inconsciente"
  | "consciente_problema"
  | "consciente_solucao"
  | "consciente_produto"
  | "consciente_total";

export const consciousnessLevels: { id: ConsciousnessLevel; label: string; color: string; icon: string; description: string }[] = [
  { id: "inconsciente", label: "Inconsciente", color: "#94A3B8", icon: "😶", description: "Não sabe que tem um problema" },
  { id: "consciente_problema", label: "Consciente do Problema", color: "#F59E0B", icon: "🤔", description: "Sabe que tem um problema, não sabe a solução" },
  { id: "consciente_solucao", label: "Consciente da Solução", color: "#3B82F6", icon: "💡", description: "Sabe que existe solução, não sabe qual produto" },
  { id: "consciente_produto", label: "Consciente do Produto", color: "#8B5CF6", icon: "🎯", description: "Conhece o produto/serviço, avaliando" },
  { id: "consciente_total", label: "Pronto para Comprar", color: "#10B981", icon: "🔥", description: "Totalmente convencido, pronto para fechar" },
];

/* ── Tipos unificados ────────────────────────────── */

export type KanbanStage = SalesStage | RecoveryStage;

// Keep legacy export for compatibility
export const kanbanStages = salesStages;

/* ── Mock Data ───────────────────────────────────── */

export const mockPatients: Patient[] = [
  { id: "p1", pacienteId: "pac1", name: "Maria Silva", initials: "MS", phone: "+55 11 99999-1001", email: "maria@email.com", origin: "Google Ads", status: "paciente", lastVisit: new Date(Date.now() - 7 * 86400000), createdAt: new Date(Date.now() - 90 * 86400000), totalSpent: 8500, avatarColor: "bg-chart-2" },
  { id: "p2", pacienteId: "pac5", name: "Carlos Oliveira", initials: "CO", phone: "+55 11 99999-1002", email: "carlos@email.com", origin: "Instagram", status: "lead", createdAt: new Date(Date.now() - 3 * 86400000), totalSpent: 0, avatarColor: "bg-chart-1" },
  { id: "p3", name: "Ana Beatriz", initials: "AB", phone: "+55 11 99999-1003", email: "ana@email.com", origin: "Indicação", status: "ativo", lastVisit: new Date(Date.now() - 14 * 86400000), createdAt: new Date(Date.now() - 180 * 86400000), totalSpent: 15200, avatarColor: "bg-chart-3" },
  { id: "p4", name: "Roberto Mendes", initials: "RM", phone: "+55 11 99999-1004", email: "roberto@email.com", origin: "Meta Ads", status: "inativo", lastVisit: new Date(Date.now() - 120 * 86400000), createdAt: new Date(Date.now() - 365 * 86400000), totalSpent: 3200, avatarColor: "bg-chart-4" },
  { id: "p5", name: "Lucia Ferreira", initials: "LF", phone: "+55 11 99999-1006", email: "lucia@email.com", origin: "Google Ads", status: "paciente", lastVisit: new Date(Date.now() - 2 * 86400000), createdAt: new Date(Date.now() - 60 * 86400000), totalSpent: 22000, avatarColor: "bg-chart-5" },
  { id: "p6", pacienteId: "pac3", name: "Pedro Costa", initials: "PC", phone: "+55 11 99999-1005", email: "pedro@email.com", origin: "Site", status: "lead", createdAt: new Date(Date.now() - 1 * 86400000), totalSpent: 0, avatarColor: "bg-dental-cyan" },
  { id: "p7", name: "Fernanda Lima", initials: "FL", phone: "+55 11 99999-1007", email: "fernanda@email.com", origin: "Instagram", status: "ativo", lastVisit: new Date(Date.now() - 30 * 86400000), createdAt: new Date(Date.now() - 200 * 86400000), totalSpent: 9800, avatarColor: "bg-primary" },
  { id: "p8", pacienteId: "pac2", name: "João Santos", initials: "JS", phone: "+55 11 99999-1008", email: "joao@email.com", origin: "Meta Ads", status: "inativo", lastVisit: new Date(Date.now() - 90 * 86400000), createdAt: new Date(Date.now() - 300 * 86400000), totalSpent: 4500, avatarColor: "bg-chart-2" },
];

export const mockSalesKanban: Record<SalesStage, KanbanLead[]> = {
  lead: [
    { id: "k1", name: "Carlos Oliveira", initials: "CO", phone: "+55 11 99999-1002", origin: "Instagram", value: 5000, assignedTo: "Ana", assignedInitials: "AR", lastContact: new Date(Date.now() - 1 * 86400000), avatarColor: "bg-chart-1", consciousnessLevel: "inconsciente" },
    { id: "k2", name: "Pedro Costa", initials: "PC", phone: "+55 11 99999-1005", origin: "Site", value: 3500, assignedTo: "Carla", assignedInitials: "CM", lastContact: new Date(Date.now() - 2 * 86400000), avatarColor: "bg-dental-cyan", consciousnessLevel: "consciente_problema" },
  ],
  em_atendimento: [
    { id: "k3", name: "Marcos Souza", initials: "MS", phone: "+55 11 99999-2001", origin: "Google Ads", value: 12000, assignedTo: "Ana", assignedInitials: "AR", lastContact: new Date(Date.now() - 3600000), avatarColor: "bg-chart-3", consciousnessLevel: "consciente_solucao" },
  ],
  orcamento: [
    { id: "k4", name: "Juliana Pires", initials: "JP", phone: "+55 11 99999-2002", origin: "Meta Ads", value: 8000, assignedTo: "Beatriz", assignedInitials: "BL", lastContact: new Date(Date.now() - 2 * 86400000), avatarColor: "bg-chart-4", consciousnessLevel: "consciente_produto" },
  ],
  orcamento_enviado: [
    { id: "k5", name: "Ricardo Alves", initials: "RA", phone: "+55 11 99999-2003", origin: "Indicação", value: 15000, assignedTo: "Ana", assignedInitials: "AR", lastContact: new Date(Date.now() - 86400000), avatarColor: "bg-chart-5", consciousnessLevel: "consciente_produto" },
  ],
  orcamento_aprovado: [],
};

export const mockRecoveryKanban: Record<RecoveryStage, KanbanLead[]> = {
  followup: [
    { id: "k6", name: "Camila Rocha", initials: "CR", phone: "+55 11 99999-2004", origin: "Instagram", value: 6000, assignedTo: "Carla", assignedInitials: "CM", lastContact: new Date(Date.now() - 3 * 86400000), avatarColor: "bg-primary", consciousnessLevel: "consciente_problema" },
  ],
  followup_2: [],
  followup_3: [],
  sem_resposta: [
    { id: "k7", name: "Diego Nunes", initials: "DN", phone: "+55 11 99999-2005", origin: "Google Ads", value: 4500, assignedTo: "Beatriz", assignedInitials: "BL", lastContact: new Date(Date.now() - 7 * 86400000), avatarColor: "bg-chart-2", consciousnessLevel: "inconsciente" },
  ],
  orcamento_reprovado: [],
  desqualificado: [],
};

// Legacy compat
export const mockKanbanLeads: Record<string, KanbanLead[]> = {
  ...mockSalesKanban,
  ...mockRecoveryKanban,
};
