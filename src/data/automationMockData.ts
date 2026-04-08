export interface AutomationFlow {
  id: string;
  name: string;
  type: "pos_consulta" | "lembrete_retorno" | "reativacao" | "followup_orcamento";
  active: boolean;
  trigger: string;
  steps: AutomationStep[];
  stats: { sent: number; responded: number; converted: number };
  createdAt: string;
}

export interface AutomationStep {
  id: string;
  delay: string;
  channel: "whatsapp" | "sms" | "email";
  message: string;
  variables: string[];
}

export const automationTypes = [
  { id: "pos_consulta" as const, label: "Pós-Consulta", color: "bg-chart-1", description: "Mensagens automáticas após atendimento" },
  { id: "lembrete_retorno" as const, label: "Lembrete de Retorno", color: "bg-dental-cyan", description: "Lembrar pacientes de retornos agendados" },
  { id: "reativacao" as const, label: "Reativação", color: "bg-warning", description: "Reativar pacientes inativos há X dias" },
  { id: "followup_orcamento" as const, label: "Follow-up Orçamento", color: "bg-chart-3", description: "Acompanhar orçamentos não fechados" },
];

export const mockAutomationFlows: AutomationFlow[] = [
  {
    id: "af1",
    name: "Pós-Consulta — Agradecimento",
    type: "pos_consulta",
    active: true,
    trigger: "Após consulta finalizada",
    steps: [
      { id: "s1", delay: "2 horas", channel: "whatsapp", message: "Olá {{nome}}, obrigado por sua visita! Como você está se sentindo após o procedimento de {{procedimento}}?", variables: ["nome", "procedimento"] },
      { id: "s2", delay: "3 dias", channel: "whatsapp", message: "Oi {{nome}}, tudo bem? Passando para saber se está tudo certo com o {{procedimento}}. Qualquer dúvida, estamos à disposição! 😊", variables: ["nome", "procedimento"] },
    ],
    stats: { sent: 342, responded: 187, converted: 0 },
    createdAt: "15/01/2026",
  },
  {
    id: "af2",
    name: "Lembrete Retorno Semestral",
    type: "lembrete_retorno",
    active: true,
    trigger: "30 dias antes do retorno",
    steps: [
      { id: "s3", delay: "30 dias antes", channel: "whatsapp", message: "Olá {{nome}}! Seu retorno para {{procedimento}} está se aproximando. Vamos agendar? 📅", variables: ["nome", "procedimento"] },
      { id: "s4", delay: "7 dias antes", channel: "whatsapp", message: "{{nome}}, lembrete: seu retorno é em 7 dias. Confirme respondendo esta mensagem ✅", variables: ["nome"] },
      { id: "s5", delay: "1 dia antes", channel: "sms", message: "Lembrete: Consulta amanhã às {{horario}}. Clínica Odonto Connect.", variables: ["horario"] },
    ],
    stats: { sent: 156, responded: 98, converted: 72 },
    createdAt: "10/02/2026",
  },
  {
    id: "af3",
    name: "Reativação 90 dias",
    type: "reativacao",
    active: true,
    trigger: "Paciente inativo há 90+ dias",
    steps: [
      { id: "s6", delay: "Imediato", channel: "whatsapp", message: "Olá {{nome}}! Sentimos sua falta 😊 Já faz um tempo desde sua última visita. Que tal agendar um check-up?", variables: ["nome"] },
      { id: "s7", delay: "7 dias", channel: "whatsapp", message: "{{nome}}, sua saúde bucal é importante! Temos horários disponíveis esta semana. Posso agendar para você?", variables: ["nome"] },
      { id: "s8", delay: "15 dias", channel: "whatsapp", message: "Última chamada, {{nome}}! 🦷 Agende sua avaliação gratuita e cuide do seu sorriso.", variables: ["nome"] },
    ],
    stats: { sent: 89, responded: 34, converted: 18 },
    createdAt: "01/03/2026",
  },
  {
    id: "af4",
    name: "Follow-up Orçamento Pendente",
    type: "followup_orcamento",
    active: false,
    trigger: "Orçamento criado e não fechado",
    steps: [
      { id: "s9", delay: "2 dias", channel: "whatsapp", message: "Oi {{nome}}! Vi que você recebeu um orçamento para {{procedimento}}. Posso esclarecer alguma dúvida?", variables: ["nome", "procedimento"] },
      { id: "s10", delay: "5 dias", channel: "whatsapp", message: "{{nome}}, temos condições especiais de pagamento para o {{procedimento}}. Quer saber mais?", variables: ["nome", "procedimento"] },
      { id: "s11", delay: "10 dias", channel: "whatsapp", message: "{{nome}}, seu orçamento para {{procedimento}} ainda está disponível. Valor: R$ {{valor}}. Vamos agendar?", variables: ["nome", "procedimento", "valor"] },
    ],
    stats: { sent: 45, responded: 22, converted: 11 },
    createdAt: "20/03/2026",
  },
];
