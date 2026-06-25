import * as pdfjsLib from "pdfjs-dist";
// @ts-expect-error - worker bundled as URL by Vite
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

async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    out += tc.items.map((it: any) => it.str).join(" ") + "\n";
  }
  return out;
}

function pickField(text: string, label: RegExp): string | undefined {
  const m = text.match(label);
  if (!m) return undefined;
  return m[1].trim().replace(/\s{2,}/g, " ").slice(0, 200) || undefined;
}

function parseText(text: string): ParsedPedido {
  const lower = text.toLowerCase();
  const checks: Record<string, boolean> = {};
  for (const [key, kws] of KEYWORDS) {
    if (kws.some((k) => lower.includes(k))) checks[key] = true;
  }

  // Split teeth by tomografia section
  const tomoIdx = lower.search(/tomografia/);
  const beforeTomo = tomoIdx >= 0 ? text.slice(0, tomoIdx) : text;
  const afterTomo = tomoIdx >= 0 ? text.slice(tomoIdx) : "";

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

  const result: ParsedPedido = {
    paciente: pickField(text, /Paciente[:\s]+([^\n]+?)(?=\s+(?:CPF|Endere|Fone|Dr|Data)|$)/i),
    cpf: pickField(text, /CPF[:\s]+([\d.\-/]+)/i),
    endereco: pickField(text, /Endere[çc]o[:\s]+([^\n]+?)(?=\s+(?:Fone|Tel|CEP|Data|Dr)|$)/i),
    fone: pickField(text, /(?:Fone|Telefone)[:\s]+([\d().\-\s+]+)/i),
    dataNasc: pickField(text, /Data\s+de\s+Nasc[\w.]*[:\s]+([\d/\-]+)/i),
    doutor: pickField(text, /Dr\(a\)[:\s]+([^\n]+?)(?=\s+(?:CRO|$))/i),
    cro: pickField(text, /CRO[:\s]+([\w\-./\s]+?)(?=\s|$)/i),
    obs: pickField(text, /OBS[:\s]+([\s\S]+?)(?=\s+Favor\s+enviar|$)/i),
    analise: pickField(text, /An[áa]lise[:\s]+([^\n]+?)(?=\s|$)/i),
    teeth,
    tomoTeeth,
    checks,
  };

  // Normalize date dd/mm/yyyy → yyyy-mm-dd
  if (result.dataNasc) {
    const d = result.dataNasc.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (d) result.dataNasc = `${d[3]}-${d[2]}-${d[1]}`;
  }

  return result;
}

export async function parsePedidoFile(file: File): Promise<ParsedPedido> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const text = await extractPdfText(file);
    return parseText(text);
  }
  // For non-PDF (images), no OCR available client-side — return empty parse
  return { teeth: [], tomoTeeth: [], checks: {} };
}
