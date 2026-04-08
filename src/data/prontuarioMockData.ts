export interface PatientRecord {
  id: string;
  pacienteId?: string;
  patientName: string;
  patientInitials: string;
  avatarColor: string;
  cpf: string;
  birthDate: string;
  phone: string;
  email: string;
  allergies: string[];
  medications: string[];
  conditions: string[];
  lastVisit: string;
  entries: ClinicalEntry[];
  documents: PatientDocument[];
}

export interface ClinicalEntry {
  id: string;
  date: string;
  professional: string;
  type: "anamnese" | "evolucao" | "procedimento" | "receita" | "atestado";
  title: string;
  description: string;
  tooth?: string;
}

export interface PatientDocument {
  id: string;
  name: string;
  type: "raio_x" | "foto" | "exame" | "documento";
  date: string;
  size: string;
}

export const mockPatientRecords: PatientRecord[] = [
  {
    id: "pr1", pacienteId: "pac1", patientName: "Maria Silva", patientInitials: "MS", avatarColor: "bg-chart-2",
    cpf: "***.***.***-01", birthDate: "15/03/1985", phone: "+55 11 99999-1001", email: "maria@email.com",
    allergies: ["Dipirona", "Látex"], medications: ["Losartana 50mg"], conditions: ["Hipertensão controlada"],
    lastVisit: "01/04/2026",
    entries: [
      { id: "e1", date: "01/04/2026", professional: "Dr. Ricardo Mendes", type: "procedimento", title: "Implante unitário — elemento 36", description: "Instalação de implante Straumann BLT 4.1x10mm em região do 36. Torque de inserção 35Ncm. Cicatrizador instalado. Paciente orientada quanto aos cuidados pós-operatórios.", tooth: "36" },
      { id: "e2", date: "01/04/2026", professional: "Dr. Ricardo Mendes", type: "receita", title: "Receituário pós-cirúrgico", description: "Amoxicilina 500mg 8/8h por 7 dias. Ibuprofeno 600mg 8/8h por 3 dias. Digluconato de Clorexidina 0,12% — bochecho 2x/dia por 10 dias." },
      { id: "e3", date: "15/01/2026", professional: "Dr. Ricardo Mendes", type: "evolucao", title: "Planejamento implante", description: "Tomografia avaliada. Osso em região do 36 com altura e espessura adequadas para implante de 4.1x10mm. Planejamento cirúrgico definido." },
      { id: "e4", date: "10/12/2025", professional: "Dr. Carlos Lima", type: "anamnese", title: "Anamnese inicial", description: "Paciente relata hipertensão controlada com Losartana. Alergia a Dipirona e Látex. Sem histórico de cirurgias prévias. Queixa: ausência do elemento 36 perdido há 2 anos." },
    ],
    documents: [
      { id: "d1", name: "Tomografia_mandibula.dcm", type: "raio_x", date: "10/12/2025", size: "12.4 MB" },
      { id: "d2", name: "Foto_pre_op_36.jpg", type: "foto", date: "01/04/2026", size: "2.1 MB" },
      { id: "d3", name: "Hemograma_completo.pdf", type: "exame", date: "20/12/2025", size: "450 KB" },
    ],
  },
  {
    id: "pr2", patientName: "Ana Beatriz", patientInitials: "AB", avatarColor: "bg-chart-3",
    cpf: "***.***.***-03", birthDate: "22/07/1992", phone: "+55 11 99999-1003", email: "ana@email.com",
    allergies: [], medications: [], conditions: [],
    lastVisit: "25/03/2026",
    entries: [
      { id: "e5", date: "25/03/2026", professional: "Dra. Ana Souza", type: "procedimento", title: "Manutenção ortodôntica", description: "Troca de fio superior para 0.019x0.025 NiTi. Ativação de elástico Classe II bilateral. Paciente relata boa adaptação." },
      { id: "e6", date: "25/02/2026", professional: "Dra. Ana Souza", type: "evolucao", title: "Acompanhamento ortodôntico", description: "Alinhamento dental progredindo conforme planejado. Mordida cruzada posterior corrigida. Manter elásticos." },
    ],
    documents: [
      { id: "d4", name: "Panoramica_inicial.jpg", type: "raio_x", date: "15/09/2025", size: "3.8 MB" },
      { id: "d5", name: "Foto_sorriso_evolucao.jpg", type: "foto", date: "25/03/2026", size: "1.9 MB" },
    ],
  },
  {
    id: "pr3", patientName: "Roberto Mendes", patientInitials: "RM", avatarColor: "bg-chart-4",
    cpf: "***.***.***-04", birthDate: "08/11/1978", phone: "+55 11 99999-1004", email: "roberto@email.com",
    allergies: ["Penicilina"], medications: ["Metformina 850mg"], conditions: ["Diabetes tipo 2"],
    lastVisit: "10/12/2025",
    entries: [
      { id: "e7", date: "10/12/2025", professional: "Dr. Carlos Lima", type: "anamnese", title: "Anamnese completa", description: "Paciente diabético tipo 2 controlado com Metformina. Alergia a Penicilina. Última HbA1c: 6.8%. Queixa: sensibilidade em molares inferiores." },
    ],
    documents: [
      { id: "d6", name: "Periapical_molares.jpg", type: "raio_x", date: "10/12/2025", size: "1.2 MB" },
    ],
  },
];
