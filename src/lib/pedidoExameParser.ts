import * as pdfjsLib from "pdfjs-dist";

import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc as string;

export type ParsedPedido = {
  paciente?: string;
  cpf?: string;
  endereco?: string;
  fone?: string;
  dataNasc?: string;
  doutor?: string;
  cro?: string;
  obs?: string;
  analise?: string;
  teeth: number[];
  tomoTeeth: number[];
  checks: Record<string, boolean>;
};

const KEYWORDS: Array<[string, string[]]> = [
  ["peri_total", ["total (checkup)", "checkup periapical", "periapical total"]],
  ["peri_indicados", ["dentes indicados"]],
  ["int_pre_d", ["pré-molares d", "pre-molares d", "premolares d"]],
  ["int_pre_e", ["pré-molares e", "pre-molares e", "premolares e"]],
  ["int_mol_d", ["molares d"]],
  ["int_mol_e", ["molares e"]],
  ["pan_conv", ["panorâmica convencional", "panoramica convencional"]],
  ["pan_tracado", ["traçado para implante", "tracado para implante"]],
  ["pan_laudo", ["com laudo"]],
  ["pan_carpal", ["carpal"]],
  ["tele_lateral", ["lateral"]],
  ["tele_frontal", ["frontal"]],
  ["tele_s_analise", ["s/ análise", "s/ analise", "sem análise"]],
  ["tele_c_analise", ["análise:", "analise:"]],
  ["tomo_implante", ["implante"]],
  ["tomo_fratura", ["fratura radicular"]],
  ["tomo_perf", ["perfuração", "perfuracao", "trepanação", "trepanacao"]],
  ["tomo_retido", ["dente retido"]],
  ["tomo_supra", ["supra numerário", "supra numerario"]],
  ["tomo_patolog", ["área patológica", "area patologica"]],
  ["tomo_enxerto", ["enxerto"]],
  ["tomo_regiao", ["região assinalada", "regiao assinalada"]],
  ["tomo_maxila", ["maxila total"]],
  ["tomo_mandibula", ["mandíbula total", "mandibula total"]],
  ["tomo_seios", ["seios maxilares"]],
  ["tomo_atm", ["atm bilateral"]],
  ["doc_t1", ["tipo i -", "tipo i-"]],
  ["doc_t2", ["tipo ii -", "tipo ii-"]],
  ["doc_t3", ["tipo iii -", "tipo iii-"]],
  ["doc_t4", ["tipo iv -", "tipo iv-"]],
  ["doc_t5", ["tipo v -", "tipo v-"]],
  ["mod_estudo", ["estudo"]],
  ["mod_trabalho", ["trabalho"]],
  ["foto_extra", ["extrabucal"]],
  ["foto_intra", ["intrabucal"]],
  ["an_dent", ["análise dentária", "analise dentaria"]],
  ["an_facial", ["análise facial", "analise facial"]],
  ["an_modelo", ["análise de modelo", "analise de modelo"]],
];

const VALID_TEETH = new Set<number>([
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
  51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75,
  81, 82, 83, 84, 85,
]);

type Line = { y: number; text: string; items: Array<{ x: number; str: string; width: number }> };

async function extractPdfStructured(file: File): Promise<{ lines: Line[]; fullText: string }> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines: Line[] = [];
  const Y_TOL = 3;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const buckets = new Map<number, Array<{ x: number; str: string; width: number }>>();
    for (const it of tc.items as any[]) {
      const str: string = it.str ?? "";
      if (!str.trim()) continue;
      const x = it.transform[4] as number;
      const y = it.transform[5] as number;
      const key = Math.round(y / Y_TOL) * Y_TOL;
      const arr = buckets.get(key) ?? [];
      arr.push({ x, str, width: it.width ?? str.length * 4 });
      buckets.set(key, arr);
    }
    const pageLines = Array.from(buckets.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([y, items]) => {
        items.sort((a, b) => a.x - b.x);
        let text = "";
        for (let i = 0; i < items.length; i++) {
          if (i > 0) {
            const gap = items[i].x - (items[i - 1].x + items[i - 1].width);
            text += gap > 8 ? "  " : "";
          }
          text += items[i].str;
        }
        return { y: y + p * 10000, text: text.replace(/\s+/g, " ").trim(), items };
      })
      .filter((l) => l.text);
    lines.push(...pageLines);
  }
  return { lines, fullText: lines.map((l) => l.text).join("\n") };
}

const LABELS = [
  "paciente", "cpf", "endereço", "endereco", "fone", "telefone",
  "data de nasc", "data nasc", "nasc", "dr(a)", "dra", "dr.", "doutor",
  "cro", "obs", "observações", "observacoes", "análise", "analise",
];

function stripLabels(s: string): string {
  let out = s.trim();
  // Remove a trailing label like "CPF:" that might leak in
  for (const lab of LABELS) {
    const re = new RegExp(`\\s*${lab.replace(/[.()]/g, (m) => "\\" + m)}\\s*:?\\s*$`, "i");
    out = out.replace(re, "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function findValueForLabel(lines: Line[], labelRegex: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.text.match(labelRegex);
    if (!m) continue;
    // Value can be: rest of same line after the label, possibly split by another label
    const afterIdx = (m.index ?? 0) + m[0].length;
    let rest = line.text.slice(afterIdx).trim();
    // cut at next known label
    const cutRe = /\b(PACIENTE|CPF|ENDERE[ÇC]O|FONE|TELEFONE|DATA\s+DE\s+NASC|DR\(A\)|DRA|DOUTOR|CRO|OBS|OBSERVA[ÇC][ÕO]ES|AN[ÁA]LISE)\s*:?/i;
    const cm = rest.match(cutRe);
    if (cm && (cm.index ?? 0) > 0) rest = rest.slice(0, cm.index).trim();
    rest = stripLabels(rest);
    if (rest && rest.length > 0) return rest;
    // Otherwise look at next line
    if (i + 1 < lines.length) {
      const next = stripLabels(lines[i + 1].text);
      if (next && !labelRegex.test(next)) return next;
    }
  }
  return undefined;
}

function parseStructured(lines: Line[], fullText: string): ParsedPedido {
  const lower = fullText.toLowerCase();
  const checks: Record<string, boolean> = {};
  for (const [key, kws] of KEYWORDS) {
    if (kws.some((k) => lower.includes(k))) checks[key] = true;
  }

  const tomoIdx = lower.search(/tomografia/);
  const beforeTomo = tomoIdx >= 0 ? fullText.slice(0, tomoIdx) : fullText;
  const afterTomo = tomoIdx >= 0 ? fullText.slice(tomoIdx) : "";

  const extractTeeth = (src: string): number[] => {
    const found = new Set<number>();
    const re = /\b([1-8][1-8])\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const n = parseInt(m[1], 10);
      if (VALID_TEETH.has(n)) found.add(n);
    }
    return Array.from(found).sort((a, b) => a - b);
  };

  const teeth = extractTeeth(beforeTomo);
  const tomoTeeth = extractTeeth(afterTomo);

  const paciente = findValueForLabel(lines, /PACIENTE\s*:?\s*/i);
  const cpfRaw = findValueForLabel(lines, /CPF\s*:?\s*/i);
  const cpf = cpfRaw?.match(/[\d.\-/]{6,}/)?.[0] ?? cpfRaw;
  const endereco = findValueForLabel(lines, /ENDERE[ÇC]O\s*:?\s*/i);
  const foneRaw = findValueForLabel(lines, /(?:FONE|TELEFONE)\s*:?\s*/i);
  const fone = foneRaw?.match(/[\d()+\-.\s]{6,}/)?.[0]?.trim() ?? foneRaw;
  let dataNasc = findValueForLabel(lines, /DATA\s+(?:DE\s+)?NASC[\w.]*\s*:?\s*/i);
  if (dataNasc) {
    const dm = dataNasc.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/);
    if (dm) dataNasc = `${dm[3]}-${dm[2]}-${dm[1]}`;
  }
  const doutor = findValueForLabel(lines, /(?:DR\(A\)|DRA|DR\.|DOUTOR)\s*:?\s*/i);
  const croRaw = findValueForLabel(lines, /CRO\s*:?\s*/i);
  const cro = croRaw?.replace(/\s{2,}/g, " ").trim();
  const obs = findValueForLabel(lines, /OBS(?:ERVA[ÇC][ÕO]ES)?\s*:?\s*/i);
  const analise = findValueForLabel(lines, /AN[ÁA]LISE\s*:?\s*/i);

  return {
    paciente,
    cpf,
    endereco,
    fone,
    dataNasc,
    doutor,
    cro,
    obs,
    analise,
    teeth,
    tomoTeeth,
    checks,
  };
}

export async function parsePedidoFile(file: File): Promise<ParsedPedido> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { lines, fullText } = await extractPdfStructured(file);
    return parseStructured(lines, fullText);
  }
  return { teeth: [], tomoTeeth: [], checks: {} };
}
