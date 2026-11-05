// Formatos brasileiros usados nos formulários (moeda, CPF, telefone, datas).
// Funções puras, sem dependências: podem ser usadas em qualquer tela.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 1234.5 → "R$ 1.234,50". Valores inválidos viram "R$ 0,00". */
export function formatBRL(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  return brl.format(Number.isFinite(n as number) ? (n as number) : 0);
}

/**
 * Lê um valor digitado em reais: "1.234,56", "1234,56", "1234.56", "R$ 50".
 * Devolve null se não houver número válido.
 */
export function parseValorBRL(text: string | null | undefined): number | null {
  if (text == null) return null;
  let s = String(text).replace(/[R$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // "1.234" = mil e duzentos
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Mantém só dígitos, vírgula e ponto enquanto a pessoa digita um valor em reais. */
export function maskValorDigitado(text: string): string {
  return text.replace(/[^\d.,]/g, "").slice(0, 15);
}

const digits = (s: string) => s.replace(/\D/g, "");

/** "12345678901" → "123.456.789-01" (aplica enquanto digita). */
export function maskCPF(text: string): string {
  const d = digits(text).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

/** Confere os dígitos verificadores do CPF. Aceita com ou sem pontuação. */
export function cpfValido(text: string): boolean {
  const d = digits(text);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** "11987654321" → "(11) 98765-4321"; fixo "1133334444" → "(11) 3333-4444". */
export function maskTelefone(text: string): string {
  let d = digits(text);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2); // colado com +55
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Telefone brasileiro com DDD: 10 (fixo) ou 11 (celular) dígitos. */
export function telefoneValido(text: string): boolean {
  let d = digits(text);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.length === 10 || d.length === 11;
}

/** "2026-11-05" → "05/11/2026". Se já vier dd/mm/aaaa, devolve igual. */
export function isoParaBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** "05/11/2026" → "2026-11-05". Devolve "" se não for uma data válida. */
export function brParaIso(br: string | null | undefined): string {
  if (!br) return "";
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(br.trim());
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(br) ? br.slice(0, 10) : "";
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[1]) ? "" : iso;
}
