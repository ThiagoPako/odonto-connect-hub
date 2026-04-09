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
  avatarUrl?: string | null;
  queueId?: string;
  queueName?: string;
  queueColor?: string;
}

export type MessageType =
  | "text"
  | "audio"
  | "image"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "poll"
  | "reaction"
  | "list";

export interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactData {
  fullName: string;
  phone: string;
  email?: string;
  company?: string;
  url?: string;
}

export interface PollData {
  question: string;
  options: { text: string; votes: number }[];
  allowMultiple?: boolean;
}

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
}

export interface ReactionData {
  emoji: string;
  count: number;
}

export interface ReplyData {
  messageId: string;
  content: string;
  sender: string;
}

export interface MentionData {
  userId: string;
  displayName: string;
}

export interface ListData {
  title: string;
  buttonText: string;
  sections: {
    title: string;
    rows: { id: string; title: string; description?: string }[];
  }[];
}

export interface ChatMessage {
  id: string;
  leadId: string;
  content: string;
  sender: "lead" | "attendant";
  type: MessageType;
  timestamp: Date;
  duration?: number;
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  location?: LocationData;
  contact?: ContactData;
  poll?: PollData;
  linkPreview?: LinkPreview;
  reactions?: ReactionData[];
  replyTo?: ReplyData;
  mentions?: MentionData[];
  stickerUrl?: string;
  list?: ListData;
  formatting?: "bold" | "italic" | "strikethrough" | "monospace";
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
      replyTo: { messageId: "m4", content: "Temos disponível terça-feira às 9h ou quarta às 10h.", sender: "Atendente" },
    },
    {
      id: "m6",
      leadId: "l5",
      content: "A avaliação inicial é cortesia! Inclui radiografia panorâmica e planejamento digital do tratamento. 😊",
      sender: "attendant",
      type: "text",
      timestamp: new Date(Date.now() - 10 * 60 * 1000),
      linkPreview: {
        url: "https://odonto-connect.com.br/avaliacao",
        title: "Avaliação Gratuita - Odonto Connect",
        description: "Agende sua avaliação gratuita com radiografia panorâmica inclusa.",
      },
    },
    {
      id: "m6b",
      leadId: "l5",
      content: "",
      sender: "attendant",
      type: "location",
      timestamp: new Date(Date.now() - 9 * 60 * 1000),
      location: {
        latitude: -23.5505,
        longitude: -46.6333,
        name: "Odonto Connect - Unidade Paulista",
        address: "Av. Paulista, 1000 - Bela Vista, São Paulo - SP",
      },
    },
    {
      id: "m6c",
      leadId: "l5",
      content: "",
      sender: "attendant",
      type: "contact",
      timestamp: new Date(Date.now() - 8 * 60 * 1000),
      contact: {
        fullName: "Dr. Ricardo Almeida",
        phone: "+55 11 98888-0001",
        email: "dr.ricardo@odontoconnect.com.br",
        company: "Odonto Connect",
        url: "https://odontoconnect.com.br",
      },
    },
    {
      id: "m7",
      leadId: "l5",
      content: "Que ótimo! Vou confirmar com minha esposa e já retorno.",
      sender: "lead",
      type: "text",
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      reactions: [{ emoji: "👍", count: 1 }],
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
      id: "m10b",
      leadId: "l6",
      content: "",
      sender: "attendant",
      type: "poll",
      timestamp: new Date(Date.now() - 7 * 60 * 1000),
      poll: {
        question: "Qual forma de pagamento você prefere?",
        options: [
          { text: "Cartão 12x sem juros", votes: 0 },
          { text: "Pix à vista (10% desc)", votes: 0 },
          { text: "Boleto 6x", votes: 0 },
        ],
      },
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
