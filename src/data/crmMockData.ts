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
  lastContact: Date;
  avatarColor: string;
  avatarUrl?: string | null;
}

export type KanbanStage =
  | "lead"
  | "em_contato"
  | "followup_1"
  | "followup_2"
  | "followup_3"
  | "sem_resposta"
  | "desqualificado";

export const kanbanStages: { id: KanbanStage; label: string; color: string }[] = [
  { id: "lead", label: "Lead", color: "bg-chart-1" },
  { id: "em_contato", label: "Em Contato", color: "bg-dental-cyan" },
  { id: "followup_1", label: "Follow-up 1", color: "bg-chart-3" },
  { id: "followup_2", label: "Follow-up 2", color: "bg-chart-4" },
  { id: "followup_3", label: "Follow-up 3", color: "bg-warning" },
  { id: "sem_resposta", label: "Sem Resposta", color: "bg-chart-5" },
  { id: "desqualificado", label: "Desqualificado", color: "bg-destructive" },
];

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

export const mockKanbanLeads: Record<KanbanStage, KanbanLead[]> = {
  lead: [
    { id: "k1", name: "Carlos Oliveira", initials: "CO", phone: "+55 11 99999-1002", origin: "Instagram", value: 5000, assignedTo: "Ana", assignedInitials: "AR", lastContact: new Date(Date.now() - 1 * 86400000), avatarColor: "bg-chart-1" },
    { id: "k2", name: "Pedro Costa", initials: "PC", phone: "+55 11 99999-1005", origin: "Site", value: 3500, assignedTo: "Carla", assignedInitials: "CM", lastContact: new Date(Date.now() - 2 * 86400000), avatarColor: "bg-dental-cyan" },
  ],
  em_contato: [
    { id: "k3", name: "Marcos Souza", initials: "MS", phone: "+55 11 99999-2001", origin: "Google Ads", value: 12000, assignedTo: "Ana", assignedInitials: "AR", lastContact: new Date(Date.now() - 3600000), avatarColor: "bg-chart-3" },
  ],
  followup_1: [
    { id: "k4", name: "Juliana Pires", initials: "JP", phone: "+55 11 99999-2002", origin: "Meta Ads", value: 8000, assignedTo: "Beatriz", assignedInitials: "BL", lastContact: new Date(Date.now() - 2 * 86400000), avatarColor: "bg-chart-4" },
    { id: "k5", name: "Ricardo Alves", initials: "RA", phone: "+55 11 99999-2003", origin: "Indicação", value: 15000, assignedTo: "Ana", assignedInitials: "AR", lastContact: new Date(Date.now() - 86400000), avatarColor: "bg-chart-5" },
  ],
  followup_2: [
    { id: "k6", name: "Camila Rocha", initials: "CR", phone: "+55 11 99999-2004", origin: "Instagram", value: 6000, assignedTo: "Carla", assignedInitials: "CM", lastContact: new Date(Date.now() - 3 * 86400000), avatarColor: "bg-primary" },
  ],
  followup_3: [],
  sem_resposta: [
    { id: "k7", name: "Diego Nunes", initials: "DN", phone: "+55 11 99999-2005", origin: "Google Ads", value: 4500, assignedTo: "Beatriz", assignedInitials: "BL", lastContact: new Date(Date.now() - 7 * 86400000), avatarColor: "bg-chart-2" },
  ],
  desqualificado: [],
};
