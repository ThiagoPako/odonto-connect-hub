export interface Appointment {
  id: string;
  pacienteId?: string;
  patientName: string;
  patientInitials: string;
  avatarColor: string;
  professional: string;
  professionalInitials: string;
  room: string;
  procedure: string;
  date: string;
  time: string;
  duration: number;
  status: "confirmado" | "aguardando" | "em_atendimento" | "finalizado" | "faltou" | "encaixe";
  phone: string;
  confirmed: boolean;
}

export interface Professional {
  id: string;
  name: string;
  initials: string;
  specialty: string;
  color: string;
}

export const mockProfessionals: Professional[] = [
  { id: "pr1", name: "Dr. Ricardo Mendes", initials: "RM", specialty: "Implantodontia", color: "bg-chart-1" },
  { id: "pr2", name: "Dra. Ana Souza", initials: "AS", specialty: "Ortodontia", color: "bg-chart-3" },
  { id: "pr3", name: "Dr. Carlos Lima", initials: "CL", specialty: "Clínico Geral", color: "bg-dental-cyan" },
  { id: "pr4", name: "Dra. Beatriz Rocha", initials: "BR", specialty: "Endodontia", color: "bg-chart-4" },
];

export const mockAppointments: Appointment[] = [
  { id: "a1", pacienteId: "pac1", patientName: "Maria Silva", patientInitials: "MS", avatarColor: "bg-chart-2", professional: "Dr. Ricardo Mendes", professionalInitials: "RM", room: "Sala 1", procedure: "Implante unitário", date: "08/04/2026", time: "08:00", duration: 90, status: "finalizado", phone: "+55 11 99999-1001", confirmed: true },
  { id: "a2", pacienteId: "pac5", patientName: "Carlos Oliveira", patientInitials: "CO", avatarColor: "bg-chart-1", professional: "Dra. Ana Souza", professionalInitials: "AS", room: "Sala 2", procedure: "Manutenção ortodôntica", date: "08/04/2026", time: "08:30", duration: 30, status: "em_atendimento", phone: "+55 11 99999-1002", confirmed: true },
  { id: "a3", patientName: "Ana Beatriz", patientInitials: "AB", avatarColor: "bg-chart-3", professional: "Dr. Carlos Lima", professionalInitials: "CL", room: "Sala 3", procedure: "Profilaxia", date: "08/04/2026", time: "09:00", duration: 45, status: "aguardando", phone: "+55 11 99999-1003", confirmed: true },
  { id: "a4", patientName: "Roberto Mendes", patientInitials: "RM", avatarColor: "bg-chart-4", professional: "Dr. Ricardo Mendes", professionalInitials: "RM", room: "Sala 1", procedure: "Consulta avaliação", date: "08/04/2026", time: "10:00", duration: 30, status: "confirmado", phone: "+55 11 99999-1004", confirmed: true },
  { id: "a5", patientName: "Lucia Ferreira", patientInitials: "LF", avatarColor: "bg-chart-5", professional: "Dra. Beatriz Rocha", professionalInitials: "BR", room: "Sala 4", procedure: "Tratamento de canal", date: "08/04/2026", time: "10:00", duration: 60, status: "confirmado", phone: "+55 11 99999-1006", confirmed: false },
  { id: "a6", pacienteId: "pac3", patientName: "Pedro Costa", patientInitials: "PC", avatarColor: "bg-dental-cyan", professional: "Dra. Ana Souza", professionalInitials: "AS", room: "Sala 2", procedure: "Instalação aparelho", date: "08/04/2026", time: "11:00", duration: 60, status: "aguardando", phone: "+55 11 99999-1005", confirmed: true },
  { id: "a7", patientName: "Fernanda Lima", patientInitials: "FL", avatarColor: "bg-primary", professional: "Dr. Carlos Lima", professionalInitials: "CL", room: "Sala 3", procedure: "Restauração", date: "08/04/2026", time: "11:00", duration: 45, status: "encaixe", phone: "+55 11 99999-1007", confirmed: false },
  { id: "a8", pacienteId: "pac2", patientName: "João Santos", patientInitials: "JS", avatarColor: "bg-chart-2", professional: "Dr. Ricardo Mendes", professionalInitials: "RM", room: "Sala 1", procedure: "Carga imediata", date: "08/04/2026", time: "14:00", duration: 120, status: "confirmado", phone: "+55 11 99999-1008", confirmed: true },
  { id: "a9", patientName: "Camila Rocha", patientInitials: "CR", avatarColor: "bg-primary", professional: "Dra. Beatriz Rocha", professionalInitials: "BR", room: "Sala 4", procedure: "Retratamento endodôntico", date: "08/04/2026", time: "14:00", duration: 90, status: "confirmado", phone: "+55 11 99999-2004", confirmed: true },
  { id: "a10", patientName: "Diego Nunes", patientInitials: "DN", avatarColor: "bg-chart-2", professional: "Dr. Carlos Lima", professionalInitials: "CL", room: "Sala 3", procedure: "Extração", date: "08/04/2026", time: "15:00", duration: 45, status: "faltou", phone: "+55 11 99999-2005", confirmed: false },
];
