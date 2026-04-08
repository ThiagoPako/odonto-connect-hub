export interface Professional {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  specialty: string;
  commissionRate: number; // percentage
}

export interface CommissionEntry {
  id: string;
  professionalId: string;
  patientName: string;
  procedure: string;
  procedureDate: string;
  procedureValue: number;
  commissionRate: number;
  commissionValue: number;
  status: "pendente" | "aprovado" | "pago";
  paymentDate?: string;
}

export const mockProfessionals: Professional[] = [
  { id: "p1", name: "Dr. Ricardo Mendes", initials: "RM", avatarColor: "bg-chart-1", specialty: "Implantodontia", commissionRate: 40 },
  { id: "p2", name: "Dra. Ana Souza", initials: "AS", avatarColor: "bg-chart-2", specialty: "Ortodontia", commissionRate: 35 },
  { id: "p3", name: "Dra. Beatriz Rocha", initials: "BR", avatarColor: "bg-chart-3", specialty: "Endodontia", commissionRate: 38 },
  { id: "p4", name: "Dr. Carlos Lima", initials: "CL", avatarColor: "bg-chart-4", specialty: "Clínico Geral", commissionRate: 30 },
];

export const mockCommissions: CommissionEntry[] = [
  { id: "c1", professionalId: "p1", patientName: "Maria Silva", procedure: "Cirurgia de Implante", procedureDate: "01/04/2026", procedureValue: 4500, commissionRate: 40, commissionValue: 1800, status: "aprovado" },
  { id: "c2", professionalId: "p1", patientName: "João Pereira", procedure: "Coroa sobre implante", procedureDate: "28/03/2026", procedureValue: 2800, commissionRate: 40, commissionValue: 1120, status: "pago", paymentDate: "05/04/2026" },
  { id: "c3", professionalId: "p1", patientName: "Ana Costa", procedure: "Enxerto ósseo", procedureDate: "25/03/2026", procedureValue: 3200, commissionRate: 40, commissionValue: 1280, status: "pago", paymentDate: "05/04/2026" },
  { id: "c4", professionalId: "p2", patientName: "Ana Beatriz", procedure: "Manutenção ortodôntica", procedureDate: "05/04/2026", procedureValue: 350, commissionRate: 35, commissionValue: 122.5, status: "pendente" },
  { id: "c5", professionalId: "p2", patientName: "Pedro Santos", procedure: "Instalação aparelho", procedureDate: "01/04/2026", procedureValue: 2500, commissionRate: 35, commissionValue: 875, status: "aprovado" },
  { id: "c6", professionalId: "p2", patientName: "Lucia Mendes", procedure: "Manutenção ortodôntica", procedureDate: "20/03/2026", procedureValue: 350, commissionRate: 35, commissionValue: 122.5, status: "pago", paymentDate: "05/04/2026" },
  { id: "c7", professionalId: "p3", patientName: "Lucia Ferreira", procedure: "Tratamento de canal", procedureDate: "03/04/2026", procedureValue: 1800, commissionRate: 38, commissionValue: 684, status: "pendente" },
  { id: "c8", professionalId: "p3", patientName: "Roberto Alves", procedure: "Retratamento endodôntico", procedureDate: "28/03/2026", procedureValue: 2200, commissionRate: 38, commissionValue: 836, status: "aprovado" },
  { id: "c9", professionalId: "p4", patientName: "Marcos Oliveira", procedure: "Restauração composta", procedureDate: "04/04/2026", procedureValue: 450, commissionRate: 30, commissionValue: 135, status: "pendente" },
  { id: "c10", professionalId: "p4", patientName: "Carla Dias", procedure: "Profilaxia", procedureDate: "02/04/2026", procedureValue: 250, commissionRate: 30, commissionValue: 75, status: "aprovado" },
  { id: "c11", professionalId: "p4", patientName: "Fernando Silva", procedure: "Exodontia simples", procedureDate: "15/03/2026", procedureValue: 350, commissionRate: 30, commissionValue: 105, status: "pago", paymentDate: "01/04/2026" },
];
