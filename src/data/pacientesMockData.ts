export interface Paciente {
  id: string;
  nome: string;
  cpf: string;
  dataNascimento: Date;
  sexo: "masculino" | "feminino" | "outro";
  telefone: string;
  email: string;
  endereco: string;
  convenio?: string;
  foto?: string;
  criadoEm: Date;
}

export interface Anamnese {
  pacienteId: string;
  doencasPreexistentes: string[];
  medicamentos: string[];
  alergias: string[];
  cirurgiasAnteriores: string[];
  fumante: boolean;
  etilista: boolean;
  gestante: boolean;
  pressaoArterial: string;
  diabetes: boolean;
  cardiopatia: boolean;
  hepatite: boolean;
  hiv: boolean;
  hemofilia: boolean;
  epilepsia: boolean;
  observacoes: string;
  atualizadoEm: Date;
}

export type StatusDente =
  | "saudavel"
  | "carie"
  | "restaurado"
  | "ausente"
  | "implante"
  | "protese"
  | "canal"
  | "fratura"
  | "selante";

export interface DenteInfo {
  numero: number;
  status: StatusDente;
  observacao?: string;
}

export interface Odontograma {
  pacienteId: string;
  dentes: DenteInfo[];
  atualizadoEm: Date;
}

export interface HistoricoPaciente {
  id: string;
  pacienteId: string;
  data: Date;
  tipo: "consulta" | "procedimento" | "retorno" | "urgencia";
  dentista: string;
  procedimento: string;
  observacoes: string;
  valor?: number;
}

export const statusDenteConfig: Record<StatusDente, { label: string; color: string; bgColor: string }> = {
  saudavel: { label: "Saudável", color: "hsl(152,60%,42%)", bgColor: "bg-success/20" },
  carie: { label: "Cárie", color: "hsl(0,72%,51%)", bgColor: "bg-destructive/20" },
  restaurado: { label: "Restaurado", color: "hsl(217,91%,60%)", bgColor: "bg-info/20" },
  ausente: { label: "Ausente", color: "hsl(220,10%,50%)", bgColor: "bg-muted" },
  implante: { label: "Implante", color: "hsl(187,85%,43%)", bgColor: "bg-primary/20" },
  protese: { label: "Prótese", color: "hsl(270,60%,55%)", bgColor: "bg-purple-200" },
  canal: { label: "Canal", color: "hsl(38,92%,50%)", bgColor: "bg-warning/20" },
  fratura: { label: "Fratura", color: "hsl(16,82%,51%)", bgColor: "bg-orange-200" },
  selante: { label: "Selante", color: "hsl(152,40%,60%)", bgColor: "bg-emerald-100" },
};

// Nomes dos dentes
export const nomesDentes: Record<number, string> = {
  18: "3M Sup Dir", 17: "2M Sup Dir", 16: "1M Sup Dir", 15: "2PM Sup Dir",
  14: "1PM Sup Dir", 13: "C Sup Dir", 12: "IL Sup Dir", 11: "IC Sup Dir",
  21: "IC Sup Esq", 22: "IL Sup Esq", 23: "C Sup Esq", 24: "1PM Sup Esq",
  25: "2PM Sup Esq", 26: "1M Sup Esq", 27: "2M Sup Esq", 28: "3M Sup Esq",
  48: "3M Inf Dir", 47: "2M Inf Dir", 46: "1M Inf Dir", 45: "2PM Inf Dir",
  44: "1PM Inf Dir", 43: "C Inf Dir", 42: "IL Inf Dir", 41: "IC Inf Dir",
  31: "IC Inf Esq", 32: "IL Inf Esq", 33: "C Inf Esq", 34: "1PM Inf Esq",
  35: "2PM Inf Esq", 36: "1M Inf Esq", 37: "2M Inf Esq", 38: "3M Inf Esq",
};

function gerarOdontograma(pacienteId: string, overrides: Partial<Record<number, StatusDente>> = {}): Odontograma {
  const todosOsDentes = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
  return {
    pacienteId,
    dentes: todosOsDentes.map((n) => ({
      numero: n,
      status: overrides[n] ?? "saudavel",
    })),
    atualizadoEm: new Date(),
  };
}

export const mockPacientes: Paciente[] = [
  {
    id: "pac1", nome: "Maria Silva", cpf: "123.456.789-00", dataNascimento: new Date("1985-03-15"),
    sexo: "feminino", telefone: "(11) 99999-1111", email: "maria@email.com",
    endereco: "Rua das Flores, 123 — São Paulo, SP", convenio: "Amil Dental",
    criadoEm: new Date("2024-01-10"),
  },
  {
    id: "pac2", nome: "João Santos", cpf: "987.654.321-00", dataNascimento: new Date("1978-07-22"),
    sexo: "masculino", telefone: "(11) 99999-2222", email: "joao@email.com",
    endereco: "Av. Paulista, 1000 — São Paulo, SP",
    criadoEm: new Date("2024-02-05"),
  },
  {
    id: "pac3", nome: "Pedro Costa", cpf: "456.789.123-00", dataNascimento: new Date("1992-11-03"),
    sexo: "masculino", telefone: "(11) 99999-3333", email: "pedro@email.com",
    endereco: "Rua Augusta, 500 — São Paulo, SP", convenio: "Bradesco Dental",
    criadoEm: new Date("2024-03-18"),
  },
  {
    id: "pac4", nome: "Ana Paula Ferreira", cpf: "321.654.987-00", dataNascimento: new Date("2000-01-30"),
    sexo: "feminino", telefone: "(11) 99999-4444", email: "anapaula@email.com",
    endereco: "Rua Oscar Freire, 200 — São Paulo, SP",
    criadoEm: new Date("2024-05-12"),
  },
  {
    id: "pac5", nome: "Carlos Oliveira", cpf: "654.321.987-00", dataNascimento: new Date("1965-09-10"),
    sexo: "masculino", telefone: "(11) 99999-5555", email: "carlos.o@email.com",
    endereco: "Rua Consolação, 800 — São Paulo, SP", convenio: "SulAmérica",
    criadoEm: new Date("2023-11-20"),
  },
];

export const mockAnamneses: Record<string, Anamnese> = {
  pac1: {
    pacienteId: "pac1", doencasPreexistentes: ["Hipertensão arterial"],
    medicamentos: ["Losartana 50mg"], alergias: ["Dipirona"],
    cirurgiasAnteriores: ["Apendicectomia (2010)"], fumante: false, etilista: false,
    gestante: false, pressaoArterial: "130/85", diabetes: false, cardiopatia: false,
    hepatite: false, hiv: false, hemofilia: false, epilepsia: false,
    observacoes: "Paciente relata medo de procedimentos invasivos. Prefere anestesia local reforçada.",
    atualizadoEm: new Date("2025-04-05"),
  },
  pac2: {
    pacienteId: "pac2", doencasPreexistentes: [], medicamentos: [],
    alergias: [], cirurgiasAnteriores: [], fumante: true, etilista: true,
    gestante: false, pressaoArterial: "120/80", diabetes: false, cardiopatia: false,
    hepatite: false, hiv: false, hemofilia: false, epilepsia: false,
    observacoes: "Fumante há 15 anos — orientado sobre impacto na cicatrização de implantes.",
    atualizadoEm: new Date("2025-04-02"),
  },
  pac3: {
    pacienteId: "pac3", doencasPreexistentes: ["Diabetes tipo 2"],
    medicamentos: ["Metformina 850mg", "Insulina NPH"], alergias: ["Amoxicilina"],
    cirurgiasAnteriores: [], fumante: false, etilista: false,
    gestante: false, pressaoArterial: "125/80", diabetes: true, cardiopatia: false,
    hepatite: false, hiv: false, hemofilia: false, epilepsia: false,
    observacoes: "Controle glicêmico irregular. Solicitar HbA1c antes de procedimentos.",
    atualizadoEm: new Date("2025-04-07"),
  },
  pac5: {
    pacienteId: "pac5", doencasPreexistentes: ["Cardiopatia isquêmica", "Hipertensão"],
    medicamentos: ["AAS 100mg", "Atenolol 50mg", "Enalapril 10mg"],
    alergias: ["Latex"], cirurgiasAnteriores: ["Revascularização miocárdica (2018)"],
    fumante: false, etilista: false, gestante: false, pressaoArterial: "140/90",
    diabetes: false, cardiopatia: true, hepatite: false, hiv: false,
    hemofilia: false, epilepsia: false,
    observacoes: "ATENÇÃO: Cardiopata. Solicitar liberação do cardiologista para procedimentos cirúrgicos. Evitar vasoconstritores com adrenalina.",
    atualizadoEm: new Date("2025-03-28"),
  },
};

export const mockOdontogramas: Record<string, Odontograma> = {
  pac1: gerarOdontograma("pac1", { 36: "restaurado", 46: "implante", 26: "carie", 17: "canal" }),
  pac2: gerarOdontograma("pac2", { 36: "ausente", 46: "ausente", 16: "carie", 26: "carie", 37: "restaurado" }),
  pac3: gerarOdontograma("pac3", { 46: "restaurado", 36: "restaurado", 11: "fratura" }),
  pac5: gerarOdontograma("pac5", { 18: "ausente", 28: "ausente", 38: "ausente", 48: "ausente", 16: "protese", 26: "protese", 36: "canal", 46: "implante", 35: "restaurado", 45: "restaurado" }),
};

export const mockHistoricos: HistoricoPaciente[] = [
  { id: "h1", pacienteId: "pac1", data: new Date("2025-04-05"), tipo: "procedimento", dentista: "Dr. Carlos Mendes", procedimento: "Implante unitário — dente 46", observacoes: "Procedimento realizado sem intercorrências. Prescrito antibiótico.", valor: 3500 },
  { id: "h2", pacienteId: "pac1", data: new Date("2025-03-20"), tipo: "consulta", dentista: "Dr. Carlos Mendes", procedimento: "Avaliação para implante", observacoes: "Solicitado tomografia cone beam da região 46." },
  { id: "h3", pacienteId: "pac1", data: new Date("2025-02-10"), tipo: "procedimento", dentista: "Dra. Ana Beatriz", procedimento: "Restauração dente 36", observacoes: "Restauração em resina composta. Classe I.", valor: 350 },
  { id: "h4", pacienteId: "pac2", data: new Date("2025-04-02"), tipo: "consulta", dentista: "Dr. Carlos Mendes", procedimento: "Avaliação geral", observacoes: "Paciente com múltiplas cáries. Planejado tratamento em 3 sessões." },
  { id: "h5", pacienteId: "pac3", data: new Date("2025-04-07"), tipo: "urgencia", dentista: "Dr. Roberto Lima", procedimento: "Trauma dental — dente 11", observacoes: "Fratura coronária sem exposição pulpar. Restauração provisória.", valor: 200 },
  { id: "h6", pacienteId: "pac5", data: new Date("2025-03-28"), tipo: "retorno", dentista: "Dr. Carlos Mendes", procedimento: "Revisão prótese 16 e 26", observacoes: "Próteses em bom estado. Proservação em 6 meses." },
  { id: "h7", pacienteId: "pac5", data: new Date("2025-01-15"), tipo: "procedimento", dentista: "Dr. Carlos Mendes", procedimento: "Implante dente 46 — segunda fase", observacoes: "Instalação do cicatrizador. Retorno em 15 dias.", valor: 1500 },
];

export const convenios = [
  "Particular",
  "Amil Dental",
  "Bradesco Dental",
  "SulAmérica",
  "Porto Seguro Odonto",
  "OdontoPrev",
  "MetLife Dental",
  "Unimed Odonto",
];
