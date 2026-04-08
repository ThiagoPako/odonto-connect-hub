export interface Budget {
  id: string;
  pacienteId?: string;
  patientName: string;
  patientInitials: string;
  avatarColor: string;
  createdAt: string;
  validUntil: string;
  status: "pendente" | "aprovado" | "reprovado" | "em_tratamento" | "finalizado";
  items: BudgetItem[];
  totalValue: number;
  discount: number;
  finalValue: number;
  paymentMethod?: string;
  installments?: number;
  professional: string;
}

export interface BudgetItem {
  id: string;
  procedure: string;
  tooth?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export const mockBudgets: Budget[] = [
  {
    id: "b1", pacienteId: "pac1", patientName: "Maria Silva", patientInitials: "MS", avatarColor: "bg-chart-2",
    createdAt: "20/03/2026", validUntil: "20/04/2026", status: "aprovado", professional: "Dr. Ricardo Mendes",
    items: [
      { id: "bi1", procedure: "Implante unitário", tooth: "36", quantity: 1, unitPrice: 4500, totalPrice: 4500 },
      { id: "bi2", procedure: "Coroa de porcelana", tooth: "36", quantity: 1, unitPrice: 2800, totalPrice: 2800 },
      { id: "bi3", procedure: "Enxerto ósseo", tooth: "36", quantity: 1, unitPrice: 1200, totalPrice: 1200 },
    ],
    totalValue: 8500, discount: 0, finalValue: 8500, paymentMethod: "Cartão 10x", installments: 10,
  },
  {
    id: "b2", pacienteId: "pac5", patientName: "Carlos Oliveira", patientInitials: "CO", avatarColor: "bg-chart-1",
    createdAt: "05/04/2026", validUntil: "05/05/2026", status: "pendente", professional: "Dra. Ana Souza",
    items: [
      { id: "bi4", procedure: "Aparelho ortodôntico fixo", tooth: undefined, quantity: 1, unitPrice: 3500, totalPrice: 3500 },
      { id: "bi5", procedure: "Manutenção mensal (12x)", tooth: undefined, quantity: 12, unitPrice: 250, totalPrice: 3000 },
      { id: "bi6", procedure: "Documentação ortodôntica", tooth: undefined, quantity: 1, unitPrice: 350, totalPrice: 350 },
    ],
    totalValue: 6850, discount: 350, finalValue: 6500, paymentMethod: undefined, installments: undefined,
  },
  {
    id: "b3", patientName: "Lucia Ferreira", patientInitials: "LF", avatarColor: "bg-chart-5",
    createdAt: "01/04/2026", validUntil: "01/05/2026", status: "em_tratamento", professional: "Dra. Beatriz Rocha",
    items: [
      { id: "bi7", procedure: "Tratamento de canal", tooth: "14", quantity: 1, unitPrice: 1800, totalPrice: 1800 },
      { id: "bi8", procedure: "Restauração definitiva", tooth: "14", quantity: 1, unitPrice: 600, totalPrice: 600 },
      { id: "bi9", procedure: "Clareamento caseiro", tooth: undefined, quantity: 1, unitPrice: 800, totalPrice: 800 },
    ],
    totalValue: 3200, discount: 200, finalValue: 3000, paymentMethod: "Pix à vista", installments: 1,
  },
  {
    id: "b4", pacienteId: "pac3", patientName: "Pedro Costa", patientInitials: "PC", avatarColor: "bg-dental-cyan",
    createdAt: "28/03/2026", validUntil: "28/04/2026", status: "reprovado", professional: "Dr. Carlos Lima",
    items: [
      { id: "bi10", procedure: "Facetas de porcelana", tooth: "11-23", quantity: 6, unitPrice: 2200, totalPrice: 13200 },
    ],
    totalValue: 13200, discount: 0, finalValue: 13200, paymentMethod: undefined, installments: undefined,
  },
  {
    id: "b5", patientName: "Fernanda Lima", patientInitials: "FL", avatarColor: "bg-primary",
    createdAt: "02/04/2026", validUntil: "02/05/2026", status: "pendente", professional: "Dr. Ricardo Mendes",
    items: [
      { id: "bi11", procedure: "Implante duplo", tooth: "25-26", quantity: 2, unitPrice: 4500, totalPrice: 9000 },
      { id: "bi12", procedure: "Prótese fixa sobre implante", tooth: "25-26", quantity: 1, unitPrice: 5500, totalPrice: 5500 },
    ],
    totalValue: 14500, discount: 1500, finalValue: 13000, paymentMethod: undefined, installments: undefined,
  },
];
