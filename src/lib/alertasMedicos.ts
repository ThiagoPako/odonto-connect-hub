/**
 * Alertas médicos da consulta, derivados da anamnese real
 * (GET /api/pacientes/:id/anamnese — tabela `anamneses`).
 */

export interface AnamneseVPS {
  id?: string;
  paciente_id?: string;
  alergias?: string[] | null;
  medicamentos?: string[] | null;
  doencas_preexistentes?: string[] | null;
  cirurgias_anteriores?: string[] | null;
  fumante?: boolean | null;
  etilista?: boolean | null;
  gestante?: boolean | null;
  diabetes?: boolean | null;
  cardiopatia?: boolean | null;
  hepatite?: boolean | null;
  hiv?: boolean | null;
  hemofilia?: boolean | null;
  epilepsia?: boolean | null;
  pressao_arterial?: string | null;
  observacoes?: string | null;
  updated_at?: string | null;
}

export interface AlertasMedicos {
  alergias: string[];
  condicoes: string[];
  medicamentos: string[];
  /** Informações de contexto (não disparam o alerta vermelho): pressão, fumo, álcool */
  outros: string[];
  /** true quando há alergia ou condição que exige atenção do dentista */
  temAlerta: boolean;
}

// Respostas de "não tem" que não devem virar alerta vermelho.
const NEGATIVAS = new Set([
  "", "-", "--", "nao", "não", "nenhum", "nenhuma", "nada", "nega", "negativo", "negativa",
  "sem alergia", "sem alergias", "nao possui", "não possui", "nao tem", "não tem", "n/a", "na",
]);

function limparLista(lista: string[] | null | undefined): string[] {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const item of lista) {
    if (typeof item !== "string") continue;
    const texto = item.trim();
    const chave = texto.toLowerCase();
    if (NEGATIVAS.has(chave) || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(texto);
  }
  return saida;
}

const FLAGS_CONDICAO: Array<[keyof AnamneseVPS, string]> = [
  ["cardiopatia", "Cardiopatia"],
  ["diabetes", "Diabetes"],
  ["hemofilia", "Hemofilia"],
  ["hepatite", "Hepatite"],
  ["hiv", "HIV"],
  ["epilepsia", "Epilepsia"],
  ["gestante", "Gestante"],
];

export function extrairAlertasMedicos(anamnese: AnamneseVPS | null | undefined): AlertasMedicos {
  if (!anamnese) return { alergias: [], condicoes: [], medicamentos: [], outros: [], temAlerta: false };

  const alergias = limparLista(anamnese.alergias);
  const condicoesFlags = FLAGS_CONDICAO.filter(([campo]) => anamnese[campo] === true).map(([, rotulo]) => rotulo);
  const doencas = limparLista(anamnese.doencas_preexistentes);
  const condicoes = limparLista([...condicoesFlags, ...doencas]);
  const medicamentos = limparLista(anamnese.medicamentos);

  const pressao = anamnese.pressao_arterial?.trim();
  const outros = [
    ...(pressao && !NEGATIVAS.has(pressao.toLowerCase()) ? [`Pressão arterial: ${pressao}`] : []),
    ...(anamnese.fumante === true ? ["Fumante"] : []),
    ...(anamnese.etilista === true ? ["Etilista"] : []),
  ];

  return { alergias, condicoes, medicamentos, outros, temAlerta: alergias.length > 0 || condicoes.length > 0 };
}
