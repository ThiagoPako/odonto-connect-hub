export interface Lead {
  id: string;
  name: string;
  initials: string;
  phone: string;
  lastMessage: string;
  lastMessageTime: Date;
  unreadCount: number;
  status: "waiting" | "active" | "closed";
  assignedTo?: string;
  avatarColor?: string;
}

export interface ChatMessage {
  id: string;
  leadId: string;
  content: string;
  sender: "lead" | "attendant";
  type: "text" | "audio" | "image" | "file";
  timestamp: Date;
  duration?: number; // audio duration in seconds
  fileName?: string;
}

export const mockLeadsQueue: Lead[] = [
  {
    id: "l1",
    name: "Maria Silva",
    initials: "MS",
    phone: "+55 11 99999-1001",
    lastMessage: "Olá, gostaria de saber o valor do implante dentário",
    lastMessageTime: new Date(Date.now() - 2 * 60 * 1000),
    unreadCount: 3,
    status: "waiting",
    avatarColor: "bg-chart-2",
  },
  {
    id: "l2",
    name: "Carlos Oliveira",
    initials: "CO",
    phone: "+55 11 99999-1002",
    lastMessage: "Vocês atendem pelo convênio Amil?",
    lastMessageTime: new Date(Date.now() - 5 * 60 * 1000),
    unreadCount: 1,
    status: "waiting",
    avatarColor: "bg-chart-1",
  },
  {
    id: "l3",
    name: "Ana Beatriz",
    initials: "AB",
    phone: "+55 11 99999-1003",
    lastMessage: "Preciso remarcar minha consulta de sexta",
    lastMessageTime: new Date(Date.now() - 8 * 60 * 1000),
    unreadCount: 2,
    status: "waiting",
    avatarColor: "bg-chart-3",
  },
  {
    id: "l4",
    name: "Roberto Mendes",
    initials: "RM",
    phone: "+55 11 99999-1004",
    lastMessage: "Quanto custa um clareamento?",
    lastMessageTime: new Date(Date.now() - 12 * 60 * 1000),
    unreadCount: 1,
    status: "waiting",
    avatarColor: "bg-chart-4",
  },
];

export const mockLeadsActive: Lead[] = [
  {
    id: "l5",
    name: "Pedro Costa",
    initials: "PC",
    phone: "+55 11 99999-1005",
    lastMessage: "Ok, vou confirmar o horário com minha esposa",
    lastMessageTime: new Date(Date.now() - 1 * 60 * 1000),
    unreadCount: 0,
    status: "active",
    assignedTo: "current",
    avatarColor: "bg-dental-cyan",
  },
  {
    id: "l6",
    name: "Lucia Ferreira",
    initials: "LF",
    phone: "+55 11 99999-1006",
    lastMessage: "Posso parcelar em 12x?",
    lastMessageTime: new Date(Date.now() - 3 * 60 * 1000),
    unreadCount: 1,
    status: "active",
    assignedTo: "current",
    avatarColor: "bg-chart-5",
  },
];

export const mockMessages: Record<string, ChatMessage[]> = {
  l5: [
    {
      id: "m1",
      leadId: "l5",
      content: "Olá, boa tarde! Gostaria de agendar uma avaliação para implante.",
      sender: "lead",
      type: "text",
      timestamp: new Date(Date.now() - 30 * 60 * 1000),
    },
    {
      id: "m2",
      leadId: "l5",
      content: "Boa tarde, Pedro! Claro, temos horários disponíveis esta semana. Você tem preferência de dia e horário?",
      sender: "attendant",
      type: "text",
      timestamp: new Date(Date.now() - 28 * 60 * 1000),
    },
    {
      id: "m3",
      leadId: "l5",
      content: "Prefiro pela manhã, se possível terça ou quarta.",
      sender: "lead",
      type: "text",
      timestamp: new Date(Date.now() - 25 * 60 * 1000),
    },
    {
      id: "m4",
      leadId: "l5",
      content: "Temos disponível terça-feira às 9h ou quarta às 10h. Qual prefere?",
      sender: "attendant",
      type: "text",
      timestamp: new Date(Date.now() - 20 * 60 * 1000),
    },
    {
      id: "m5",
      leadId: "l5",
      content: "Terça às 9h seria perfeito! Quanto custa a avaliação?",
      sender: "lead",
      type: "text",
      timestamp: new Date(Date.now() - 15 * 60 * 1000),
    },
    {
      id: "m6",
      leadId: "l5",
      content: "A avaliação inicial é cortesia! Inclui radiografia panorâmica e planejamento digital do tratamento. 😊",
      sender: "attendant",
      type: "text",
      timestamp: new Date(Date.now() - 10 * 60 * 1000),
    },
    {
      id: "m7",
      leadId: "l5",
      content: "Que ótimo! Vou confirmar com minha esposa e já retorno.",
      sender: "lead",
      type: "text",
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
    },
    {
      id: "m8",
      leadId: "l5",
      content: "Ok, vou confirmar o horário com minha esposa",
      sender: "lead",
      type: "text",
      timestamp: new Date(Date.now() - 1 * 60 * 1000),
    },
  ],
  l6: [
    {
      id: "m9",
      leadId: "l6",
      content: "Oi! Recebi o orçamento por e-mail. Posso parcelar em 12x?",
      sender: "lead",
      type: "text",
      timestamp: new Date(Date.now() - 10 * 60 * 1000),
    },
    {
      id: "m10",
      leadId: "l6",
      content: "Olá Lucia! Sim, parcelamos em até 12x no cartão sem juros. Também aceitamos Pix com 10% de desconto à vista!",
      sender: "attendant",
      type: "text",
      timestamp: new Date(Date.now() - 8 * 60 * 1000),
    },
    {
      id: "m11",
      leadId: "l6",
      content: "Posso parcelar em 12x?",
      sender: "lead",
      type: "text",
      timestamp: new Date(Date.now() - 3 * 60 * 1000),
    },
  ],
};
