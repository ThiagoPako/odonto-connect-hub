export interface Dentista {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  cro: string;
  especialidade: string;
  comissao: number; // percentual
  avatar?: string;
  status: "ativo" | "inativo";
  criadoEm: Date;
}

export interface Atendimento {
  id: string;
  dentistaId: string;
  pacienteId?: string;
  pacienteNome: string;
  pacienteIniciais: string;
  horario: string;
  tipo: "consulta" | "retorno" | "procedimento" | "urgencia";
  status: "agendado" | "em_atendimento" | "concluido" | "cancelado";
  procedimento: string;
  valor?: number;
}

export interface AgendaDentista {
  id: string;
  dentistaId: string;
  pacienteId?: string;
  pacienteNome: string;
  data: Date;
  horario: string;
  duracao: number; // minutos
  tipo: "consulta" | "retorno" | "procedimento" | "urgencia";
  status: "agendado" | "confirmado" | "cancelado";
  observacao?: string;
}

export interface OrcamentoDentista {
  id: string;
  dentistaId: string;
  pacienteId?: string;
  pacienteNome: string;
  itens: { procedimento: string; valor: number; quantidade: number }[];
  total: number;
  status: "pendente" | "aprovado" | "recusado" | "em_andamento";
  criadoEm: Date;
}

export interface ProntuarioDentista {
  id: string;
  dentistaId: string;
  pacienteId?: string;
  pacienteNome: string;
  pacienteIniciais: string;
  ultimaConsulta: Date;
  diagnostico: string;
  tratamento: string;
  observacoes: string;
  alergias?: string[];
}

export const mockDentistas: Dentista[] = [
  {
    id: "d1",
    nome: "Dr. Carlos Mendes",
    email: "carlos@odontoconnect.tech",
    telefone: "(11) 99999-1111",
    cro: "CRO-SP 12345",
    especialidade: "Implantodontia",
    comissao: 40,
    status: "ativo",
    criadoEm: new Date("2024-01-15"),
  },
  {
    id: "d2",
    nome: "Dra. Ana Beatriz",
    email: "ana@odontoconnect.tech",
    telefone: "(11) 99999-2222",
    cro: "CRO-SP 23456",
    especialidade: "Ortodontia",
    comissao: 35,
    status: "ativo",
    criadoEm: new Date("2024-03-20"),
  },
  {
    id: "d3",
    nome: "Dr. Roberto Lima",
    email: "roberto@odontoconnect.tech",
    telefone: "(11) 99999-3333",
    cro: "CRO-SP 34567",
    especialidade: "Endodontia",
    comissao: 38,
    status: "ativo",
    criadoEm: new Date("2024-06-10"),
  },
  {
    id: "d4",
    nome: "Dra. Fernanda Costa",
    email: "fernanda@odontoconnect.tech",
    telefone: "(11) 99999-4444",
    cro: "CRO-SP 45678",
    especialidade: "Periodontia",
    comissao: 35,
    status: "inativo",
    criadoEm: new Date("2023-11-05"),
  },
];

const hoje = new Date();

export const mockAtendimentosHoje: Atendimento[] = [
  { id: "a1", dentistaId: "d1", pacienteNome: "Maria Silva", pacienteIniciais: "MS", horario: "08:00", tipo: "procedimento", status: "concluido", procedimento: "Implante unitário", valor: 3500 },
  { id: "a2", dentistaId: "d1", pacienteNome: "João Santos", pacienteIniciais: "JS", horario: "09:30", tipo: "consulta", status: "em_atendimento", procedimento: "Avaliação para implante" },
  { id: "a3", dentistaId: "d1", pacienteNome: "Pedro Costa", pacienteIniciais: "PC", horario: "11:00", tipo: "retorno", status: "agendado", procedimento: "Revisão pós-cirúrgica" },
  { id: "a4", dentistaId: "d1", pacienteNome: "Lucia Ferreira", pacienteIniciais: "LF", horario: "14:00", tipo: "procedimento", status: "agendado", procedimento: "Enxerto ósseo", valor: 2800 },
  { id: "a5", dentistaId: "d1", pacienteNome: "Carlos Oliveira", pacienteIniciais: "CO", horario: "15:30", tipo: "urgencia", status: "agendado", procedimento: "Dor aguda — avaliação" },
  { id: "a6", dentistaId: "d2", pacienteNome: "Ana Paula", pacienteIniciais: "AP", horario: "08:30", tipo: "procedimento", status: "concluido", procedimento: "Manutenção aparelho", valor: 250 },
  { id: "a7", dentistaId: "d2", pacienteNome: "Rafaela Dias", pacienteIniciais: "RD", horario: "10:00", tipo: "consulta", status: "em_atendimento", procedimento: "Planejamento ortodôntico" },
  { id: "a8", dentistaId: "d2", pacienteNome: "Bruno Martins", pacienteIniciais: "BM", horario: "11:30", tipo: "procedimento", status: "agendado", procedimento: "Instalação de bráquetes", valor: 3200 },
  { id: "a9", dentistaId: "d3", pacienteNome: "Cláudia Ramos", pacienteIniciais: "CR", horario: "09:00", tipo: "procedimento", status: "concluido", procedimento: "Tratamento de canal", valor: 1200 },
  { id: "a10", dentistaId: "d3", pacienteNome: "Felipe Souza", pacienteIniciais: "FS", horario: "10:30", tipo: "urgencia", status: "em_atendimento", procedimento: "Emergência — pulpite aguda" },
];

export const mockAgendaDentista: AgendaDentista[] = [
  { id: "ag1", dentistaId: "d1", pacienteNome: "Maria Silva", data: hoje, horario: "08:00", duracao: 60, tipo: "procedimento", status: "confirmado" },
  { id: "ag2", dentistaId: "d1", pacienteNome: "João Santos", data: hoje, horario: "09:30", duracao: 45, tipo: "consulta", status: "confirmado" },
  { id: "ag3", dentistaId: "d1", pacienteNome: "Pedro Costa", data: hoje, horario: "11:00", duracao: 30, tipo: "retorno", status: "agendado" },
  { id: "ag4", dentistaId: "d1", pacienteNome: "Lucia Ferreira", data: hoje, horario: "14:00", duracao: 90, tipo: "procedimento", status: "confirmado" },
  { id: "ag5", dentistaId: "d1", pacienteNome: "Carlos Oliveira", data: hoje, horario: "15:30", duracao: 30, tipo: "urgencia", status: "agendado" },
  { id: "ag6", dentistaId: "d1", pacienteNome: "Teresa Almeida", data: new Date(hoje.getTime() + 86400000), horario: "08:00", duracao: 60, tipo: "procedimento", status: "agendado" },
  { id: "ag7", dentistaId: "d1", pacienteNome: "Ricardo Nunes", data: new Date(hoje.getTime() + 86400000), horario: "10:00", duracao: 45, tipo: "consulta", status: "confirmado" },
];

export const mockOrcamentosDentista: OrcamentoDentista[] = [
  {
    id: "o1", dentistaId: "d1", pacienteNome: "Maria Silva",
    itens: [
      { procedimento: "Implante unitário", valor: 3500, quantidade: 2 },
      { procedimento: "Prótese sobre implante", valor: 2000, quantidade: 2 },
    ],
    total: 11000, status: "aprovado", criadoEm: new Date("2025-03-15"),
  },
  {
    id: "o2", dentistaId: "d1", pacienteNome: "João Santos",
    itens: [
      { procedimento: "Enxerto ósseo", valor: 2800, quantidade: 1 },
      { procedimento: "Implante unitário", valor: 3500, quantidade: 1 },
    ],
    total: 6300, status: "pendente", criadoEm: new Date("2025-04-01"),
  },
  {
    id: "o3", dentistaId: "d1", pacienteNome: "Pedro Costa",
    itens: [
      { procedimento: "Revisão pós-cirúrgica", valor: 200, quantidade: 1 },
    ],
    total: 200, status: "em_andamento", criadoEm: new Date("2025-04-05"),
  },
  {
    id: "o4", dentistaId: "d2", pacienteNome: "Ana Paula",
    itens: [
      { procedimento: "Aparelho ortodôntico", valor: 3200, quantidade: 1 },
      { procedimento: "Manutenção mensal (12x)", valor: 250, quantidade: 12 },
    ],
    total: 6200, status: "aprovado", criadoEm: new Date("2025-02-10"),
  },
];

export const mockProntuariosDentista: ProntuarioDentista[] = [
  {
    id: "p1", dentistaId: "d1", pacienteNome: "Maria Silva", pacienteIniciais: "MS",
    ultimaConsulta: new Date("2025-04-05"),
    diagnostico: "Edentulismo parcial posterior bilateral",
    tratamento: "Implantes osseointegrados + prótese fixa",
    observacoes: "Paciente com boa saúde geral. Hipertensa controlada.",
    alergias: ["Dipirona"],
  },
  {
    id: "p2", dentistaId: "d1", pacienteNome: "João Santos", pacienteIniciais: "JS",
    ultimaConsulta: new Date("2025-04-02"),
    diagnostico: "Reabsorção óssea moderada em região 36",
    tratamento: "Enxerto ósseo + implante em segundo tempo cirúrgico",
    observacoes: "Fumante — orientado sobre riscos. Retorno em 6 meses para implante.",
    alergias: [],
  },
  {
    id: "p3", dentistaId: "d1", pacienteNome: "Pedro Costa", pacienteIniciais: "PC",
    ultimaConsulta: new Date("2025-04-07"),
    diagnostico: "Pós-operatório de implante 46",
    tratamento: "Acompanhamento e proservação",
    observacoes: "Cicatrização dentro do esperado. Sem queixas.",
    alergias: ["Amoxicilina"],
  },
  {
    id: "p4", dentistaId: "d2", pacienteNome: "Rafaela Dias", pacienteIniciais: "RD",
    ultimaConsulta: new Date("2025-04-06"),
    diagnostico: "Má oclusão Classe II divisão 1",
    tratamento: "Ortodontia fixa — aparelho metálico",
    observacoes: "Extração de pré-molares indicada. Paciente em avaliação.",
    alergias: [],
  },
];

export const especialidades = [
  "Clínica Geral",
  "Implantodontia",
  "Ortodontia",
  "Endodontia",
  "Periodontia",
  "Prótese Dentária",
  "Odontopediatria",
  "Cirurgia Bucomaxilofacial",
  "Dentística",
  "Estética Dental",
];
