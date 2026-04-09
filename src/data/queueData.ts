export interface AttendanceQueue {
  id: string;
  name: string;
  color: string;
  icon: string;
  description: string;
  contactNumbers: string[];
  teamMembers: { id: string; name: string }[];
  whatsappButtonLabel: string;
  active: boolean;
}

const QUEUE_STORAGE_KEY = "odonto_queues";

const defaultQueues: AttendanceQueue[] = [
  {
    id: "q1",
    name: "Agendamento",
    color: "#3B82F6",
    icon: "📅",
    description: "Fila para agendamento de consultas",
    contactNumbers: ["+55 11 99999-0001"],
    teamMembers: [{ id: "t1", name: "Recepção" }],
    whatsappButtonLabel: "📅 Agendar Consulta",
    active: true,
  },
  {
    id: "q2",
    name: "Financeiro",
    color: "#10B981",
    icon: "💰",
    description: "Fila para questões financeiras e pagamentos",
    contactNumbers: ["+55 11 99999-0002"],
    teamMembers: [{ id: "t2", name: "Financeiro" }],
    whatsappButtonLabel: "💰 Financeiro",
    active: true,
  },
  {
    id: "q3",
    name: "Emergência",
    color: "#EF4444",
    icon: "🚨",
    description: "Fila para atendimento emergencial",
    contactNumbers: ["+55 11 99999-0003"],
    teamMembers: [{ id: "t3", name: "Dr. Ricardo" }],
    whatsappButtonLabel: "🚨 Emergência",
    active: true,
  },
];

export function getQueues(): AttendanceQueue[] {
  if (typeof window === "undefined") return defaultQueues;
  const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return defaultQueues;
    }
  }
  return defaultQueues;
}

export function saveQueues(queues: AttendanceQueue[]) {
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queues));
}

export function getQueueById(id: string): AttendanceQueue | undefined {
  return getQueues().find((q) => q.id === id);
}
