/**
 * REGISTRO CENTRAL DE DADOS
 * 
 * Este módulo é a fonte única de verdade (single source of truth) para
 * dados compartilhados entre todos os módulos do sistema.
 * 
 * REGRA: Todos os módulos DEVEM referenciar pacientes, dentistas e
 * profissionais pelo ID deste registro. Nenhum módulo deve duplicar
 * dados que existem aqui.
 */

import { mockPacientes, mockAnamneses, mockOdontogramas, mockHistoricos, type Paciente, type Anamnese } from "./pacientesMockData";
import { mockDentistas, type Dentista } from "./dentistasMockData";
import { mockProfessionals, type Professional } from "./agendaMockData";

// ==================== PACIENTES ====================

/** Busca paciente por ID */
export function getPacienteById(id: string): Paciente | undefined {
  return mockPacientes.find((p) => p.id === id);
}

/** Busca paciente por nome (parcial, case-insensitive) */
export function getPacienteByNome(nome: string): Paciente | undefined {
  const lower = nome.toLowerCase();
  return mockPacientes.find((p) => p.nome.toLowerCase().includes(lower));
}

/** Retorna iniciais do paciente */
export function getPacienteIniciais(paciente: Paciente): string {
  return paciente.nome
    .split(" ")
    .filter((_, i, arr) => i === 0 || i === arr.length - 1)
    .map((n) => n[0])
    .join("");
}

/** Retorna idade do paciente */
export function getPacienteIdade(paciente: Paciente): number {
  const hoje = new Date();
  const nasc = paciente.dataNascimento;
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

/** Retorna anamnese do paciente */
export function getAnamnese(pacienteId: string): Anamnese | undefined {
  return mockAnamneses[pacienteId];
}

/** Retorna alergias do paciente */
export function getAlergias(pacienteId: string): string[] {
  return mockAnamneses[pacienteId]?.alergias ?? [];
}

/** Retorna condições médicas críticas do paciente */
export function getCondicoesCriticas(pacienteId: string): string[] {
  const a = mockAnamneses[pacienteId];
  if (!a) return [];
  const conds: string[] = [];
  if (a.cardiopatia) conds.push("Cardiopatia");
  if (a.diabetes) conds.push("Diabetes");
  if (a.hemofilia) conds.push("Hemofilia");
  if (a.epilepsia) conds.push("Epilepsia");
  if (a.hepatite) conds.push("Hepatite");
  if (a.hiv) conds.push("HIV");
  return conds;
}

/** Retorna se paciente tem alertas médicos */
export function temAlertasMedicos(pacienteId: string): boolean {
  return getAlergias(pacienteId).length > 0 || getCondicoesCriticas(pacienteId).length > 0;
}

/** Retorna odontograma do paciente */
export function getOdontograma(pacienteId: string) {
  return mockOdontogramas[pacienteId];
}

/** Retorna histórico do paciente (ordenado por data desc) */
export function getHistorico(pacienteId: string) {
  return mockHistoricos
    .filter((h) => h.pacienteId === pacienteId)
    .sort((a, b) => b.data.getTime() - a.data.getTime());
}

// ==================== DENTISTAS ====================

/** Busca dentista por ID */
export function getDentistaById(id: string): Dentista | undefined {
  return mockDentistas.find((d) => d.id === id);
}

/** Busca dentista por nome */
export function getDentistaByNome(nome: string): Dentista | undefined {
  const lower = nome.toLowerCase();
  return mockDentistas.find((d) => d.nome.toLowerCase().includes(lower));
}

// ==================== PROFISSIONAIS (AGENDA) ====================

/** Busca profissional da agenda por ID */
export function getProfissionalById(id: string): Professional | undefined {
  return mockProfessionals.find((p) => p.id === id);
}

// ==================== MAPEAMENTO NOME → ID ====================

/**
 * Mapa de nomes de pacientes para IDs do registro central.
 * Usado para vincular dados de módulos que ainda usam nomes em vez de IDs.
 */
export const pacienteNomeParaId: Record<string, string> = {
  "Maria Silva": "pac1",
  "João Santos": "pac2",
  "Pedro Costa": "pac3",
  "Ana Paula Ferreira": "pac4",
  "Ana Paula": "pac4",
  "Carlos Oliveira": "pac5",
};

/** Resolve pacienteId a partir de um nome ou ID existente */
export function resolverPacienteId(nomeOuId: string): string | undefined {
  // Já é um ID?
  if (nomeOuId.startsWith("pac")) return nomeOuId;
  return pacienteNomeParaId[nomeOuId];
}

// ==================== RE-EXPORTS ====================

export { mockPacientes, mockAnamneses, mockOdontogramas, mockHistoricos };
export { mockDentistas };
export { mockProfessionals };
export type { Paciente, Anamnese, Dentista, Professional };
