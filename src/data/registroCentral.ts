/**
 * REGISTRO CENTRAL DE DADOS
 * 
 * Este módulo é a fonte única de verdade (single source of truth) para
 * dados compartilhados entre todos os módulos do sistema.
 */

import { type Paciente, type Anamnese } from "./pacientesMockData";
import { type Dentista } from "./dentistasMockData";
import { type Professional } from "./agendaMockData";

// ==================== PACIENTES ====================

/** Busca paciente por ID */
export function getPacienteById(id: string): Paciente | undefined {
  return undefined;
}

/** Busca paciente por nome (parcial, case-insensitive) */
export function getPacienteByNome(nome: string): Paciente | undefined {
  return undefined;
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
  return undefined;
}

/** Retorna alergias do paciente */
export function getAlergias(pacienteId: string): string[] {
  return [];
}

/** Retorna condições médicas críticas do paciente */
export function getCondicoesCriticas(pacienteId: string): string[] {
  return [];
}

/** Retorna se paciente tem alertas médicos */
export function temAlertasMedicos(pacienteId: string): boolean {
  return false;
}

/** Retorna odontograma do paciente */
export function getOdontograma(pacienteId: string) {
  return undefined;
}

/** Retorna histórico do paciente (ordenado por data desc) */
export function getHistorico(pacienteId: string) {
  return [];
}

// ==================== DENTISTAS ====================

/** Busca dentista por ID */
export function getDentistaById(id: string): Dentista | undefined {
  return undefined;
}

/** Busca dentista por nome */
export function getDentistaByNome(nome: string): Dentista | undefined {
  return undefined;
}

// ==================== PROFISSIONAIS (AGENDA) ====================

/** Busca profissional da agenda por ID */
export function getProfissionalById(id: string): Professional | undefined {
  return undefined;
}

// ==================== MAPEAMENTO NOME → ID ====================

export const pacienteNomeParaId: Record<string, string> = {};

/** Resolve pacienteId a partir de um nome ou ID existente */
export function resolverPacienteId(nomeOuId: string): string | undefined {
  if (nomeOuId.startsWith("pac")) return nomeOuId;
  return undefined;
}

// ==================== RE-EXPORTS ====================

export const mockPacientes: Paciente[] = [];
export const mockAnamneses: Record<string, Anamnese> = {};
export const mockOdontogramas: Record<string, any> = {};
export const mockHistoricos: any[] = [];
export const mockDentistas: Dentista[] = [];
export const mockProfessionals: Professional[] = [];

export type { Paciente, Anamnese, Dentista, Professional };
