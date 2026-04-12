export type AutomationChannel = "whatsapp" | "sms" | "email";
export type AutomationType = "pos_consulta" | "lembrete_retorno" | "reativacao" | "followup_orcamento" | "aniversario" | "confirmacao_agenda" | "desmarcacao" | "faltas" | "faltas_primeira" | "inadimplencia" | "orcamento_aberto" | "tratamento_sem_agenda" | "custom";

export interface AutomationStep {
  id: string;
  delay: string;
  delayMinutes: number;
  channel: AutomationChannel;
  message: string;
  variables: string[];
}

export interface AutomationFlow {
  id: string;
  name: string;
  description?: string;
  type: AutomationType;
  active: boolean;
  trigger: string;
  steps: AutomationStep[];
  stats: { sent: number; responded: number; converted: number };
  createdAt: string;
  updatedAt?: string;
}

export interface PreConfiguredSolution {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: AutomationType;
  trigger: string;
  defaultSteps: AutomationStep[];
  totalPacientes?: number;
  hasDelay?: boolean;
}

export const automationTypes: { id: AutomationType; label: string; color: string; description: string; icon: string }[] = [
  { id: "pos_consulta", label: "Pós-Consulta", color: "bg-chart-1", description: "Mensagens automáticas após atendimento", icon: "🩺" },
  { id: "lembrete_retorno", label: "Lembrete de Retorno", color: "bg-dental-cyan", description: "Lembrar pacientes de retornos agendados", icon: "📅" },
  { id: "reativacao", label: "Reativação", color: "bg-warning", description: "Reativar pacientes inativos há X dias", icon: "🔄" },
  { id: "followup_orcamento", label: "Follow-up Orçamento", color: "bg-chart-3", description: "Acompanhar orçamentos não fechados", icon: "💰" },
  { id: "aniversario", label: "Aniversário", color: "bg-chart-5", description: "Parabenizar pacientes no aniversário", icon: "🎂" },
  { id: "confirmacao_agenda", label: "Confirmação Agenda", color: "bg-chart-2", description: "Confirmar agendamentos pendentes", icon: "❓" },
  { id: "desmarcacao", label: "Desmarcações", color: "bg-chart-4", description: "Recuperar pacientes que desmarcaram", icon: "📋" },
  { id: "faltas", label: "Faltas", color: "bg-destructive", description: "Recontatar pacientes que faltaram", icon: "⚠️" },
  { id: "faltas_primeira", label: "Faltas 1ª Consulta", color: "bg-destructive", description: "Recuperar faltantes da primeira consulta", icon: "🔔" },
  { id: "inadimplencia", label: "Inadimplência", color: "bg-warning", description: "Cobranças amigáveis automatizadas", icon: "💲" },
  { id: "orcamento_aberto", label: "Orçamento em Aberto", color: "bg-chart-3", description: "Follow-up de orçamentos pendentes", icon: "📄" },
  { id: "tratamento_sem_agenda", label: "Tratamento s/ Agenda", color: "bg-dental-cyan", description: "Pacientes com tratamento ativo sem retorno", icon: "🦷" },
  { id: "custom", label: "Personalizado", color: "bg-primary", description: "Fluxo customizado para sua necessidade", icon: "⚙️" },
];

export const preConfiguredSolutions: PreConfiguredSolution[] = [
  {
    id: "sol_confirmacao",
    name: "Agendamento sem Confirmação",
    description: "Envia mensagem automática para pacientes com consulta agendada que ainda não confirmaram presença",
    icon: "❓",
    type: "confirmacao_agenda",
    trigger: "Agendamento criado sem confirmação",
    totalPacientes: 57,
    defaultSteps: [
      { id: "sc1", delay: "1 dia antes", delayMinutes: 1440, channel: "whatsapp", message: "Olá {{nome}}! 😊 Lembrete: sua consulta está agendada para amanhã, {{data}}, às {{horario}} com {{dentista}}. Confirme respondendo ✅ ou ligue para reagendar.", variables: ["nome", "data", "horario", "dentista"] },
      { id: "sc2", delay: "3 horas antes", delayMinutes: 180, channel: "whatsapp", message: "{{primeiro_nome}}, sua consulta é HOJE às {{horario}}. Estamos te esperando! 🦷 Caso precise reagendar, avise-nos.", variables: ["primeiro_nome", "horario"] },
    ],
  },
  {
    id: "sol_aniversario",
    name: "Aniversariantes",
    description: "Envia mensagem de felicitação no dia do aniversário do paciente, fortalecendo o vínculo",
    icon: "🎂",
    type: "aniversario",
    trigger: "Data de aniversário do paciente",
    totalPacientes: 0,
    defaultSteps: [
      { id: "sa1", delay: "Imediato", delayMinutes: 0, channel: "whatsapp", message: "🎂 Feliz aniversário, {{nome}}! A equipe da {{clinica}} deseja um dia maravilhoso cheio de sorrisos! Como presente, preparamos uma condição especial para você. Fale conosco! 🎁", variables: ["nome", "clinica"] },
    ],
  },
  {
    id: "sol_desmarcacao",
    name: "Desmarcações",
    description: "Envia mensagem para reagendar pacientes que desmarcaram consultas, reduzindo desistências",
    icon: "📋",
    type: "desmarcacao",
    trigger: "Consulta desmarcada pelo paciente",
    totalPacientes: 0,
    defaultSteps: [
      { id: "sd1", delay: "1 hora", delayMinutes: 60, channel: "whatsapp", message: "Olá {{nome}}, notamos que sua consulta foi desmarcada. 😔 Sabemos que imprevistos acontecem! Vamos reagendar para um horário melhor? Temos vagas disponíveis esta semana.", variables: ["nome"] },
      { id: "sd2", delay: "3 dias", delayMinutes: 4320, channel: "whatsapp", message: "{{primeiro_nome}}, sua saúde bucal é muito importante! 🦷 Posso ajudar a encontrar um horário que funcione melhor para você?", variables: ["primeiro_nome"] },
    ],
  },
  {
    id: "sol_faltas",
    name: "Faltas",
    description: "Recontata pacientes que faltaram às consultas agendadas, incentivando o reagendamento",
    icon: "⚠️",
    type: "faltas",
    trigger: "Paciente não compareceu à consulta",
    totalPacientes: 0,
    hasDelay: true,
    defaultSteps: [
      { id: "sf1", delay: "2 horas", delayMinutes: 120, channel: "whatsapp", message: "Olá {{nome}}, sentimos sua falta hoje! 😊 Sabemos que imprevistos acontecem. Vamos reagendar sua consulta para o mais breve possível?", variables: ["nome"] },
      { id: "sf2", delay: "2 dias", delayMinutes: 2880, channel: "whatsapp", message: "{{primeiro_nome}}, lembramos que sua consulta de {{procedimento}} precisa ser realizada. Posso verificar os melhores horários para você?", variables: ["primeiro_nome", "procedimento"] },
      { id: "sf3", delay: "7 dias", delayMinutes: 10080, channel: "whatsapp", message: "{{nome}}, não queremos que seu tratamento fique pendente! 🦷 Temos condições especiais para reagendamento. Responda e agendamos para você.", variables: ["nome"] },
    ],
  },
  {
    id: "sol_faltas_primeira",
    name: "Faltas 1ª Consulta",
    description: "Recuperação especial para pacientes que faltaram à primeira consulta — maior risco de perda",
    icon: "🔔",
    type: "faltas_primeira",
    trigger: "Paciente faltou à primeira consulta",
    totalPacientes: 0,
    defaultSteps: [
      { id: "sfp1", delay: "1 hora", delayMinutes: 60, channel: "whatsapp", message: "Olá {{nome}}, sentimos sua falta! Era sua primeira consulta conosco e gostaríamos muito de te receber. 😊 Vamos remarcar? A avaliação é sem compromisso!", variables: ["nome"] },
      { id: "sfp2", delay: "3 dias", delayMinutes: 4320, channel: "whatsapp", message: "{{primeiro_nome}}, sabemos que a primeira visita ao dentista pode gerar dúvidas. Estamos aqui para ajudar! 🦷 Quer reagendar para um horário mais conveniente?", variables: ["primeiro_nome"] },
    ],
  },
  {
    id: "sol_inadimplencia",
    name: "Inadimplência",
    description: "Envio de lembretes amigáveis para pacientes com parcelas ou pagamentos em atraso",
    icon: "💲",
    type: "inadimplencia",
    trigger: "Parcela ou pagamento em atraso",
    totalPacientes: 0,
    defaultSteps: [
      { id: "si1", delay: "1 dia", delayMinutes: 1440, channel: "whatsapp", message: "Olá {{nome}}, tudo bem? Notamos que existe uma pendência financeira em seu cadastro. 😊 Gostaríamos de ajudar! Entre em contato para verificarmos as melhores condições de pagamento.", variables: ["nome"] },
      { id: "si2", delay: "7 dias", delayMinutes: 10080, channel: "whatsapp", message: "{{primeiro_nome}}, lembramos que sua pendência na {{clinica}} ainda está em aberto. Temos opções de parcelamento e desconto para pagamento à vista. Vamos resolver juntos?", variables: ["primeiro_nome", "clinica"] },
    ],
  },
  {
    id: "sol_orcamento_aberto",
    name: "Orçamentos em Aberto",
    description: "Follow-up automático para pacientes que receberam orçamento mas ainda não aprovaram",
    icon: "📄",
    type: "orcamento_aberto",
    trigger: "Orçamento criado e não aprovado",
    totalPacientes: 596,
    defaultSteps: [
      { id: "so1", delay: "2 dias", delayMinutes: 2880, channel: "whatsapp", message: "Olá {{nome}}! 😊 Vi que você recebeu um orçamento para {{procedimento}} no valor de {{valor}}. Ficou com alguma dúvida? Estou à disposição para esclarecer!", variables: ["nome", "procedimento", "valor"] },
      { id: "so2", delay: "5 dias", delayMinutes: 7200, channel: "whatsapp", message: "{{nome}}, temos condições especiais de pagamento para o {{procedimento}}. Que tal parcelar em até 12x? Fale conosco! 💳", variables: ["nome", "procedimento"] },
      { id: "so3", delay: "15 dias", delayMinutes: 21600, channel: "whatsapp", message: "{{primeiro_nome}}, seu orçamento para {{procedimento}} ainda está disponível! 🦷 Não deixe sua saúde bucal esperar. Agende agora com condições especiais.", variables: ["primeiro_nome", "procedimento"] },
    ],
  },
  {
    id: "sol_tratamento_sem_agenda",
    name: "Tratamento sem Agendamento",
    description: "Contata pacientes com tratamento em andamento que ainda não têm próxima sessão agendada",
    icon: "🦷",
    type: "tratamento_sem_agenda",
    trigger: "Tratamento ativo sem agendamento futuro",
    totalPacientes: 0,
    defaultSteps: [
      { id: "st1", delay: "Imediato", delayMinutes: 0, channel: "whatsapp", message: "Olá {{nome}}! Notamos que seu tratamento de {{procedimento}} está em andamento, mas ainda não temos a próxima sessão agendada. Vamos marcar? 📅", variables: ["nome", "procedimento"] },
      { id: "st2", delay: "5 dias", delayMinutes: 7200, channel: "whatsapp", message: "{{primeiro_nome}}, é importante manter a regularidade do tratamento de {{procedimento}} para melhores resultados! 🦷 Posso verificar os horários disponíveis para você.", variables: ["primeiro_nome", "procedimento"] },
    ],
  },
];

export const triggerOptions = [
  "Após consulta finalizada",
  "30 dias antes do retorno",
  "7 dias antes do retorno",
  "Paciente inativo há 60+ dias",
  "Paciente inativo há 90+ dias",
  "Paciente inativo há 180+ dias",
  "Orçamento criado e não fechado",
  "Data de aniversário do paciente",
  "Lead entrou no CRM",
  "Atendimento finalizado sem agendamento",
  "Agendamento criado sem confirmação",
  "Consulta desmarcada pelo paciente",
  "Paciente não compareceu à consulta",
  "Paciente faltou à primeira consulta",
  "Parcela ou pagamento em atraso",
  "Orçamento criado e não aprovado",
  "Tratamento ativo sem agendamento futuro",
  "Personalizado",
];

export const delayOptions = [
  { label: "Imediato", minutes: 0 },
  { label: "30 minutos", minutes: 30 },
  { label: "1 hora", minutes: 60 },
  { label: "2 horas", minutes: 120 },
  { label: "3 horas", minutes: 180 },
  { label: "6 horas", minutes: 360 },
  { label: "12 horas", minutes: 720 },
  { label: "1 dia", minutes: 1440 },
  { label: "2 dias", minutes: 2880 },
  { label: "3 dias", minutes: 4320 },
  { label: "5 dias", minutes: 7200 },
  { label: "7 dias", minutes: 10080 },
  { label: "15 dias", minutes: 21600 },
  { label: "30 dias", minutes: 43200 },
];

export const availableVariables = [
  { key: "nome", label: "Nome do paciente", example: "Maria Silva" },
  { key: "primeiro_nome", label: "Primeiro nome", example: "Maria" },
  { key: "procedimento", label: "Procedimento", example: "Limpeza" },
  { key: "valor", label: "Valor do orçamento", example: "R$ 1.500" },
  { key: "horario", label: "Horário da consulta", example: "14:30" },
  { key: "data", label: "Data da consulta", example: "15/04/2026" },
  { key: "dentista", label: "Nome do dentista", example: "Dr. João" },
  { key: "clinica", label: "Nome da clínica", example: "Odonto Connect" },
  { key: "link_agendamento", label: "Link de agendamento", example: "https://..." },
];

export const messageTemplates: { name: string; type: AutomationType; message: string; variables: string[] }[] = [
  { name: "Agradecimento pós-consulta", type: "pos_consulta", message: "Olá {{nome}}, obrigado por sua visita! Como você está se sentindo após o procedimento de {{procedimento}}?", variables: ["nome", "procedimento"] },
  { name: "Check-up pós-procedimento", type: "pos_consulta", message: "Oi {{primeiro_nome}}, tudo bem? Passando para saber se está tudo certo com o {{procedimento}}. Qualquer dúvida, estamos à disposição! 😊", variables: ["primeiro_nome", "procedimento"] },
  { name: "Lembrete de retorno", type: "lembrete_retorno", message: "Olá {{nome}}! Seu retorno está se aproximando. Vamos agendar? 📅 Acesse: {{link_agendamento}}", variables: ["nome", "link_agendamento"] },
  { name: "Confirmação de consulta", type: "lembrete_retorno", message: "{{nome}}, lembrete: sua consulta é amanhã às {{horario}} com {{dentista}}. Confirme respondendo ✅", variables: ["nome", "horario", "dentista"] },
  { name: "Reativação gentil", type: "reativacao", message: "Olá {{nome}}! Sentimos sua falta 😊 Já faz um tempo desde sua última visita. Que tal agendar um check-up?", variables: ["nome"] },
  { name: "Última chamada reativação", type: "reativacao", message: "{{primeiro_nome}}, sua saúde bucal é importante! 🦷 Agende sua avaliação gratuita e cuide do seu sorriso.", variables: ["primeiro_nome"] },
  { name: "Follow-up orçamento", type: "followup_orcamento", message: "Oi {{nome}}! Vi que você recebeu um orçamento para {{procedimento}} no valor de {{valor}}. Posso esclarecer alguma dúvida?", variables: ["nome", "procedimento", "valor"] },
  { name: "Condições especiais", type: "followup_orcamento", message: "{{nome}}, temos condições especiais de pagamento para o {{procedimento}}. Quer saber mais?", variables: ["nome", "procedimento"] },
  { name: "Feliz aniversário", type: "aniversario", message: "🎂 Feliz aniversário, {{nome}}! A equipe {{clinica}} deseja muitas felicidades! Como presente, temos uma surpresa especial para você.", variables: ["nome", "clinica"] },
];

export const mockAutomationFlows: AutomationFlow[] = [
  {
    id: "af1",
    name: "Pós-Consulta — Agradecimento",
    description: "Envia mensagem de agradecimento após a consulta e faz follow-up em 3 dias",
    type: "pos_consulta",
    active: true,
    trigger: "Após consulta finalizada",
    steps: [
      { id: "s1", delay: "2 horas", delayMinutes: 120, channel: "whatsapp", message: "Olá {{nome}}, obrigado por sua visita! Como você está se sentindo após o procedimento de {{procedimento}}?", variables: ["nome", "procedimento"] },
      { id: "s2", delay: "3 dias", delayMinutes: 4320, channel: "whatsapp", message: "Oi {{nome}}, tudo bem? Passando para saber se está tudo certo com o {{procedimento}}. Qualquer dúvida, estamos à disposição! 😊", variables: ["nome", "procedimento"] },
    ],
    stats: { sent: 342, responded: 187, converted: 0 },
    createdAt: "15/01/2026",
  },
  {
    id: "af2",
    name: "Lembrete Retorno Semestral",
    description: "Sequência de lembretes antes do retorno agendado: 30 dias, 7 dias e 1 dia antes",
    type: "lembrete_retorno",
    active: true,
    trigger: "30 dias antes do retorno",
    steps: [
      { id: "s3", delay: "30 dias antes", delayMinutes: 43200, channel: "whatsapp", message: "Olá {{nome}}! Seu retorno para {{procedimento}} está se aproximando. Vamos agendar? 📅", variables: ["nome", "procedimento"] },
      { id: "s4", delay: "7 dias antes", delayMinutes: 10080, channel: "whatsapp", message: "{{nome}}, lembrete: seu retorno é em 7 dias. Confirme respondendo esta mensagem ✅", variables: ["nome"] },
      { id: "s5", delay: "1 dia antes", delayMinutes: 1440, channel: "sms", message: "Lembrete: Consulta amanhã às {{horario}}. Clínica Odonto Connect.", variables: ["horario"] },
    ],
    stats: { sent: 156, responded: 98, converted: 72 },
    createdAt: "10/02/2026",
  },
  {
    id: "af3",
    name: "Reativação 90 dias",
    description: "Reativa pacientes inativos há mais de 90 dias com 3 mensagens progressivas",
    type: "reativacao",
    active: true,
    trigger: "Paciente inativo há 90+ dias",
    steps: [
      { id: "s6", delay: "Imediato", delayMinutes: 0, channel: "whatsapp", message: "Olá {{nome}}! Sentimos sua falta 😊 Já faz um tempo desde sua última visita. Que tal agendar um check-up?", variables: ["nome"] },
      { id: "s7", delay: "7 dias", delayMinutes: 10080, channel: "whatsapp", message: "{{nome}}, sua saúde bucal é importante! Temos horários disponíveis esta semana. Posso agendar para você?", variables: ["nome"] },
      { id: "s8", delay: "15 dias", delayMinutes: 21600, channel: "whatsapp", message: "Última chamada, {{nome}}! 🦷 Agende sua avaliação gratuita e cuide do seu sorriso.", variables: ["nome"] },
    ],
    stats: { sent: 89, responded: 34, converted: 18 },
    createdAt: "01/03/2026",
  },
  {
    id: "af4",
    name: "Follow-up Orçamento Pendente",
    description: "Acompanha orçamentos não fechados com mensagens em 2, 5 e 10 dias",
    type: "followup_orcamento",
    active: false,
    trigger: "Orçamento criado e não fechado",
    steps: [
      { id: "s9", delay: "2 dias", delayMinutes: 2880, channel: "whatsapp", message: "Oi {{nome}}! Vi que você recebeu um orçamento para {{procedimento}}. Posso esclarecer alguma dúvida?", variables: ["nome", "procedimento"] },
      { id: "s10", delay: "5 dias", delayMinutes: 7200, channel: "whatsapp", message: "{{nome}}, temos condições especiais de pagamento para o {{procedimento}}. Quer saber mais?", variables: ["nome", "procedimento"] },
      { id: "s11", delay: "10 dias", delayMinutes: 14400, channel: "whatsapp", message: "{{nome}}, seu orçamento para {{procedimento}} ainda está disponível. Valor: R$ {{valor}}. Vamos agendar?", variables: ["nome", "procedimento", "valor"] },
    ],
    stats: { sent: 45, responded: 22, converted: 11 },
    createdAt: "20/03/2026",
  },
];
