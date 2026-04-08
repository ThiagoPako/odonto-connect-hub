export interface DisparoTemplate {
  id: string;
  nome: string;
  mensagem: string;
  variaveis: string[];
  midia?: { tipo: "imagem" | "video"; url?: string };
}

export interface NumeroWhatsApp {
  id: string;
  numero: string;
  nome: string;
  status: "conectado" | "desconectado";
}

export const numerosDisponiveis: NumeroWhatsApp[] = [
  { id: "n1", numero: "+55 11 99999-0001", nome: "Principal — Clínica", status: "conectado" },
  { id: "n2", numero: "+55 11 99999-0002", nome: "Atendimento", status: "conectado" },
  { id: "n3", numero: "+55 11 99999-0003", nome: "Marketing", status: "desconectado" },
];

export interface DisparoProgramado {
  id: string;
  nome: string;
  template: DisparoTemplate;
  tipo: "recorrente" | "unico";
  diasSemana?: string[];
  horarioInicio?: string;
  horarioFim?: string;
  dataInicio?: string;
  dataFim?: string;
  campanhaPerpetua?: boolean;
  usarHorarioClinica?: boolean;
  publico: "todos" | "ativos" | "inativos" | "aniversariantes" | "custom";
  filtroCustom?: string;
  numeroEnvio: string; // id do número WhatsApp
  contatosAlcancaveis: number;
  capacidadeDiaria: number;
  intervaloSpam: number;
  ativo: boolean;
  stats: { enviadas: number; entregues: number; lidas: number; respondidas: number; erros: number };
  criadoEm: string;
}

export const diasSemanaOptions = [
  { id: "DOM", label: "DOM" },
  { id: "SEG", label: "SEG" },
  { id: "TER", label: "TER" },
  { id: "QUA", label: "QUA" },
  { id: "QUI", label: "QUI" },
  { id: "SEX", label: "SEX" },
  { id: "SAB", label: "SAB" },
];

export const publicoOptions = [
  { id: "todos" as const, label: "Todos os Contatos", desc: "Enviar para toda a base" },
  { id: "ativos" as const, label: "Pacientes Ativos", desc: "Pacientes com consulta nos últimos 6 meses" },
  { id: "inativos" as const, label: "Pacientes Inativos", desc: "Pacientes sem consulta há +90 dias" },
  { id: "aniversariantes" as const, label: "Aniversariantes do Mês", desc: "Pacientes que fazem aniversário este mês" },
  { id: "custom" as const, label: "Filtro Personalizado", desc: "Selecionar manualmente ou por critério" },
];

export const templatesProntos: DisparoTemplate[] = [
  {
    id: "tpl1",
    nome: "Lembrete de Retorno",
    mensagem: "Olá {{nome}}! 😊 Faz um tempo desde sua última visita na Odonto Connect. Que tal agendar seu retorno? Cuidar do sorriso é cuidar da saúde! 🦷\n\nAgende pelo WhatsApp ou ligue: (11) 99999-0001",
    variaveis: ["nome"],
  },
  {
    id: "tpl2",
    nome: "Promoção Clareamento",
    mensagem: "{{nome}}, temos uma novidade! ✨\n\nClareamento dental com 20% de desconto este mês. Resultado garantido em apenas 1 sessão!\n\nAgende sua avaliação gratuita. Vagas limitadas! 📅",
    variaveis: ["nome"],
  },
  {
    id: "tpl3",
    nome: "Aniversário",
    mensagem: "Parabéns, {{nome}}! 🎂🎉\n\nA equipe Odonto Connect deseja um feliz aniversário!\n\nComo presente, preparamos uma condição especial para você. Entre em contato e saiba mais! 🎁",
    variaveis: ["nome"],
  },
  {
    id: "tpl4",
    nome: "Avaliação Gratuita",
    mensagem: "Oi {{nome}}, tudo bem?\n\nEstamos oferecendo avaliação odontológica gratuita esta semana! 🦷\n\nAproveite para cuidar do seu sorriso sem compromisso. Agende agora!",
    variaveis: ["nome"],
  },
  {
    id: "tpl5",
    nome: "Confirmação de Consulta",
    mensagem: "Olá {{nome}}! 📋\n\nSua consulta está agendada para {{data}} às {{horario}} com {{dentista}}.\n\nConfirme respondendo ✅ ou ligue para remarcar.",
    variaveis: ["nome", "data", "horario", "dentista"],
  },
];

export const mockDisparos: DisparoProgramado[] = [
  {
    id: "dp1",
    nome: "Reativação Semanal",
    template: templatesProntos[0],
    tipo: "recorrente",
    diasSemana: ["SEG", "QUA", "SEX"],
    horarioInicio: "09:00",
    horarioFim: "18:00",
    dataInicio: "2026-03-01",
    campanhaPerpetua: true,
    usarHorarioClinica: false,
    publico: "inativos",
    numeroEnvio: "n1",
    contatosAlcancaveis: 89,
    capacidadeDiaria: 232,
    intervaloSpam: 7,
    ativo: true,
    stats: { enviadas: 267, entregues: 254, lidas: 198, respondidas: 34, erros: 13 },
    criadoEm: "01/03/2026",
  },
  {
    id: "dp2",
    nome: "Promo Clareamento Dezembro",
    template: templatesProntos[1],
    tipo: "unico",
    dataInicio: "2026-04-15",
    horarioInicio: "10:00",
    horarioFim: "17:00",
    publico: "ativos",
    numeroEnvio: "n2",
    contatosAlcancaveis: 156,
    capacidadeDiaria: 156,
    intervaloSpam: 30,
    ativo: false,
    stats: { enviadas: 0, entregues: 0, lidas: 0, respondidas: 0, erros: 0 },
    criadoEm: "05/04/2026",
  },
  {
    id: "dp3",
    nome: "Aniversariantes do Mês",
    template: templatesProntos[2],
    tipo: "recorrente",
    diasSemana: ["SEG"],
    horarioInicio: "08:00",
    horarioFim: "10:00",
    campanhaPerpetua: true,
    usarHorarioClinica: false,
    publico: "aniversariantes",
    numeroEnvio: "n1",
    contatosAlcancaveis: 12,
    capacidadeDiaria: 50,
    intervaloSpam: 30,
    ativo: true,
    stats: { enviadas: 45, entregues: 44, lidas: 38, respondidas: 15, erros: 1 },
    criadoEm: "15/01/2026",
  },
  {
    id: "dp4",
    nome: "Confirmação Dia Seguinte",
    template: templatesProntos[4],
    tipo: "recorrente",
    diasSemana: ["SEG", "TER", "QUA", "QUI", "SEX"],
    horarioInicio: "18:00",
    horarioFim: "20:00",
    campanhaPerpetua: true,
    usarHorarioClinica: false,
    publico: "custom",
    numeroEnvio: "n1",
    filtroCustom: "Pacientes com consulta no dia seguinte",
    contatosAlcancaveis: 8,
    capacidadeDiaria: 50,
    intervaloSpam: 1,
    ativo: true,
    stats: { enviadas: 520, entregues: 515, lidas: 480, respondidas: 312, erros: 5 },
    criadoEm: "10/01/2026",
  },
];
