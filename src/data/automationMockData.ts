export type AutomationChannel = "whatsapp" | "sms" | "email";
export type AutomationType = "pos_consulta" | "lembrete_retorno" | "reativacao" | "followup_orcamento" | "aniversario" | "custom";

export interface AutomationStep {
  id: string;
  delay: string;
  delayMinutes: number; // canonical delay in minutes for sorting/logic
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

export const automationTypes: { id: AutomationType; label: string; color: string; description: string; icon: string }[] = [
  { id: "pos_consulta", label: "Pós-Consulta", color: "bg-chart-1", description: "Mensagens automáticas após atendimento", icon: "🩺" },
  { id: "lembrete_retorno", label: "Lembrete de Retorno", color: "bg-dental-cyan", description: "Lembrar pacientes de retornos agendados", icon: "📅" },
  { id: "reativacao", label: "Reativação", color: "bg-warning", description: "Reativar pacientes inativos há X dias", icon: "🔄" },
  { id: "followup_orcamento", label: "Follow-up Orçamento", color: "bg-chart-3", description: "Acompanhar orçamentos não fechados", icon: "💰" },
  { id: "aniversario", label: "Aniversário", color: "bg-chart-5", description: "Parabenizar pacientes no aniversário", icon: "🎂" },
  { id: "custom", label: "Personalizado", color: "bg-primary", description: "Fluxo customizado para sua necessidade", icon: "⚙️" },
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
  "Personalizado",
];

export const delayOptions = [
  { label: "Imediato", minutes: 0 },
  { label: "30 minutos", minutes: 30 },
  { label: "1 hora", minutes: 60 },
  { label: "2 horas", minutes: 120 },
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
