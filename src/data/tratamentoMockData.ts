export interface Treatment {
  id: string;
  patientName: string;
  patientInitials: string;
  avatarColor: string;
  professional: string;
  startDate: string;
  estimatedEnd: string;
  status: "planejado" | "em_andamento" | "pausado" | "finalizado";
  totalValue: number;
  paidValue: number;
  steps: TreatmentStep[];
  budgetId?: string;
}

export interface TreatmentStep {
  id: string;
  order: number;
  procedure: string;
  tooth?: string;
  status: "pendente" | "agendado" | "realizado" | "cancelado";
  scheduledDate?: string;
  completedDate?: string;
  professional: string;
  notes?: string;
}

export type ToothStatus = "saudavel" | "carie" | "restaurado" | "ausente" | "implante" | "endodontia" | "protese" | "fratura";

export interface ToothData {
  number: number;
  status: ToothStatus;
  notes?: string;
}

export const toothStatusConfig: Record<ToothStatus, { label: string; color: string; fill: string }> = {
  saudavel: { label: "Saudável", color: "text-success", fill: "fill-success" },
  carie: { label: "Cárie", color: "text-destructive", fill: "fill-destructive" },
  restaurado: { label: "Restaurado", color: "text-chart-1", fill: "fill-chart-1" },
  ausente: { label: "Ausente", color: "text-muted-foreground", fill: "fill-muted" },
  implante: { label: "Implante", color: "text-primary", fill: "fill-primary" },
  endodontia: { label: "Endodontia", color: "text-chart-4", fill: "fill-chart-4" },
  protese: { label: "Prótese", color: "text-dental-cyan", fill: "fill-dental-cyan" },
  fratura: { label: "Fratura", color: "text-warning", fill: "fill-warning" },
};

// Upper: 18-11 (right to left), 21-28 (left to right)
// Lower: 48-41 (right to left), 31-38 (left to right)
export const upperRight = [18, 17, 16, 15, 14, 13, 12, 11];
export const upperLeft = [21, 22, 23, 24, 25, 26, 27, 28];
export const lowerRight = [48, 47, 46, 45, 44, 43, 42, 41];
export const lowerLeft = [31, 32, 33, 34, 35, 36, 37, 38];

export const mockOdontogram: ToothData[] = [
  { number: 11, status: "saudavel" }, { number: 12, status: "saudavel" }, { number: 13, status: "saudavel" },
  { number: 14, status: "endodontia", notes: "Canal realizado em 01/2026" }, { number: 15, status: "restaurado" },
  { number: 16, status: "carie", notes: "Cárie oclusal" }, { number: 17, status: "saudavel" }, { number: 18, status: "ausente", notes: "Extraído" },
  { number: 21, status: "saudavel" }, { number: 22, status: "saudavel" }, { number: 23, status: "saudavel" },
  { number: 24, status: "saudavel" }, { number: 25, status: "implante", notes: "Implante Straumann" },
  { number: 26, status: "implante", notes: "Implante Straumann" }, { number: 27, status: "restaurado" }, { number: 28, status: "ausente" },
  { number: 31, status: "saudavel" }, { number: 32, status: "saudavel" }, { number: 33, status: "saudavel" },
  { number: 34, status: "saudavel" }, { number: 35, status: "saudavel" }, { number: 36, status: "implante", notes: "Implante recente — Maria Silva" },
  { number: 37, status: "restaurado" }, { number: 38, status: "ausente" },
  { number: 41, status: "saudavel" }, { number: 42, status: "saudavel" }, { number: 43, status: "saudavel" },
  { number: 44, status: "fratura", notes: "Fratura cúspide MV" }, { number: 45, status: "saudavel" },
  { number: 46, status: "carie", notes: "Cárie proximal" }, { number: 47, status: "restaurado" }, { number: 48, status: "ausente" },
];

export const mockTreatments: Treatment[] = [
  {
    id: "t1", patientName: "Maria Silva", patientInitials: "MS", avatarColor: "bg-chart-2",
    professional: "Dr. Ricardo Mendes", startDate: "15/01/2026", estimatedEnd: "15/07/2026",
    status: "em_andamento", totalValue: 8500, paidValue: 4250, budgetId: "b1",
    steps: [
      { id: "ts1", order: 1, procedure: "Tomografia e planejamento", tooth: "36", status: "realizado", completedDate: "15/01/2026", professional: "Dr. Ricardo Mendes", notes: "Osso adequado para implante 4.1x10mm" },
      { id: "ts2", order: 2, procedure: "Cirurgia de implante", tooth: "36", status: "realizado", completedDate: "01/04/2026", professional: "Dr. Ricardo Mendes", notes: "Torque 35Ncm. Cicatrizador instalado." },
      { id: "ts3", order: 3, procedure: "Reabertura e moldagem", tooth: "36", status: "agendado", scheduledDate: "01/07/2026", professional: "Dr. Ricardo Mendes" },
      { id: "ts4", order: 4, procedure: "Instalação coroa definitiva", tooth: "36", status: "pendente", professional: "Dr. Ricardo Mendes" },
    ],
  },
  {
    id: "t2", patientName: "Ana Beatriz", patientInitials: "AB", avatarColor: "bg-chart-3",
    professional: "Dra. Ana Souza", startDate: "15/09/2025", estimatedEnd: "15/09/2027",
    status: "em_andamento", totalValue: 6500, paidValue: 3250,
    steps: [
      { id: "ts5", order: 1, procedure: "Documentação ortodôntica", status: "realizado", completedDate: "15/09/2025", professional: "Dra. Ana Souza" },
      { id: "ts6", order: 2, procedure: "Instalação aparelho fixo", status: "realizado", completedDate: "01/10/2025", professional: "Dra. Ana Souza" },
      { id: "ts7", order: 3, procedure: "Manutenção mensal (12x)", status: "em_andamento" as any, scheduledDate: "08/04/2026", professional: "Dra. Ana Souza", notes: "6/12 manutenções realizadas" },
      { id: "ts8", order: 4, procedure: "Remoção e contenção", status: "pendente", professional: "Dra. Ana Souza" },
    ],
  },
  {
    id: "t3", patientName: "Lucia Ferreira", patientInitials: "LF", avatarColor: "bg-chart-5",
    professional: "Dra. Beatriz Rocha", startDate: "01/04/2026", estimatedEnd: "30/04/2026",
    status: "em_andamento", totalValue: 3000, paidValue: 3000, budgetId: "b3",
    steps: [
      { id: "ts9", order: 1, procedure: "Tratamento de canal", tooth: "14", status: "agendado", scheduledDate: "08/04/2026", professional: "Dra. Beatriz Rocha" },
      { id: "ts10", order: 2, procedure: "Restauração definitiva", tooth: "14", status: "pendente", professional: "Dra. Beatriz Rocha" },
      { id: "ts11", order: 3, procedure: "Moldagem clareamento", status: "pendente", professional: "Dra. Beatriz Rocha" },
      { id: "ts12", order: 4, procedure: "Entrega kit clareamento", status: "pendente", professional: "Dra. Beatriz Rocha" },
    ],
  },
  {
    id: "t4", patientName: "Roberto Mendes", patientInitials: "RM", avatarColor: "bg-chart-4",
    professional: "Dr. Carlos Lima", startDate: "10/12/2025", estimatedEnd: "10/01/2026",
    status: "pausado", totalValue: 1200, paidValue: 600,
    steps: [
      { id: "ts13", order: 1, procedure: "Avaliação e diagnóstico", status: "realizado", completedDate: "10/12/2025", professional: "Dr. Carlos Lima" },
      { id: "ts14", order: 2, procedure: "Restauração molares inferiores", tooth: "46-47", status: "pendente", professional: "Dr. Carlos Lima", notes: "Paciente não retornou" },
    ],
  },
];
