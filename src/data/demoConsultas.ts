import type { ConsultationRecord } from "@/lib/vpsApi";

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

/** Consultas demo por paciente (id) */
export const demoConsultasPorPaciente: Record<string, ConsultationRecord[]> = {
  pac1: [
    {
      id: "demo-c1-1",
      patient_name: "Maria Silva",
      dentist_name: "Dr. Carlos Mendes",
      queixa_principal: "Dor ao mastigar do lado direito",
      procedimento: "Avaliação clínica + radiografia periapical",
      dente_regiao: "16",
      observacoes: "Paciente apresenta sensibilidade em 16. Indicado tratamento endodôntico. Hipertensa controlada — sem contraindicações.",
      prescricoes: [
        { medicamento: "Ibuprofeno 600mg", dosagem: "1 comprimido", posologia: "8/8h", duracao: "3 dias" },
      ],
      duration_seconds: 1820,
      gravacoes_count: 2,
      clinical_report_id: null,
      status: "finalizado",
      started_at: daysAgo(15),
      finished_at: daysAgo(15),
    },
    {
      id: "demo-c1-2",
      patient_name: "Maria Silva",
      dentist_name: "Dr. Carlos Mendes",
      queixa_principal: "Retorno — instalação de prótese sobre implante",
      procedimento: "Instalação de coroa protética sobre implante 36",
      dente_regiao: "36",
      observacoes: "Coroa adaptada com sucesso. Oclusão ajustada. Paciente orientado sobre higienização.",
      prescricoes: [],
      duration_seconds: 2700,
      gravacoes_count: 1,
      clinical_report_id: null,
      status: "finalizado",
      started_at: daysAgo(3),
      finished_at: daysAgo(3),
    },
  ],
  pac2: [
    {
      id: "demo-c2-1",
      patient_name: "João Santos",
      dentist_name: "Dr. Carlos Mendes",
      queixa_principal: "Avaliação para implante região 46",
      procedimento: "Anamnese + tomografia + planejamento cirúrgico",
      dente_regiao: "46",
      observacoes: "Paciente fumante — orientado sobre riscos de osseointegração. Reabsorção óssea moderada — necessário enxerto prévio.",
      prescricoes: [
        { medicamento: "Amoxicilina 500mg", dosagem: "1 cápsula", posologia: "8/8h", duracao: "7 dias" },
      ],
      duration_seconds: 2400,
      gravacoes_count: 3,
      clinical_report_id: null,
      status: "finalizado",
      started_at: daysAgo(10),
      finished_at: daysAgo(10),
    },
  ],
  pac3: [
    {
      id: "demo-c3-1",
      patient_name: "Pedro Costa",
      dentist_name: "Dr. Carlos Mendes",
      queixa_principal: "Pós-operatório de implante 46",
      procedimento: "Acompanhamento e proservação — 7 dias",
      dente_regiao: "46",
      observacoes: "Cicatrização dentro do esperado. Sem sinais de infecção. Sutura removida. Próximo retorno em 30 dias.",
      prescricoes: [],
      duration_seconds: 900,
      gravacoes_count: 1,
      clinical_report_id: null,
      status: "finalizado",
      started_at: daysAgo(5),
      finished_at: daysAgo(5),
    },
  ],
  pac4: [
    {
      id: "demo-c4-1",
      patient_name: "Ana Paula Ferreira",
      dentist_name: "Dra. Ana Beatriz",
      queixa_principal: "Manutenção mensal aparelho ortodôntico",
      procedimento: "Troca de borrachinhas + ajuste de arco",
      dente_regiao: "Arcada superior e inferior",
      observacoes: "Evolução conforme planejado. Paciente colaborativa. Próxima manutenção em 30 dias.",
      prescricoes: [],
      duration_seconds: 1500,
      gravacoes_count: 0,
      clinical_report_id: null,
      status: "finalizado",
      started_at: daysAgo(7),
      finished_at: daysAgo(7),
    },
  ],
  pac5: [
    {
      id: "demo-c5-1",
      patient_name: "Carlos Oliveira",
      dentist_name: "Dr. Roberto Lima",
      queixa_principal: "Dor aguda — pulpite irreversível",
      procedimento: "Tratamento endodôntico de urgência — 1ª sessão",
      dente_regiao: "26",
      observacoes: "Pulpectomia realizada. Curativo de demora com hidróxido de cálcio. Retorno agendado para finalização.",
      prescricoes: [
        { medicamento: "Nimesulida 100mg", dosagem: "1 comprimido", posologia: "12/12h", duracao: "5 dias" },
        { medicamento: "Dipirona 500mg", dosagem: "1 comprimido", posologia: "6/6h", duracao: "SOS dor" },
      ],
      duration_seconds: 3600,
      gravacoes_count: 2,
      clinical_report_id: null,
      status: "finalizado",
      started_at: daysAgo(2),
      finished_at: daysAgo(2),
    },
  ],
};

export function getDemoConsultas(pacienteId: string): ConsultationRecord[] {
  return demoConsultasPorPaciente[pacienteId] ?? [];
}
