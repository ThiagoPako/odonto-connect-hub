/**
 * Telefone brasileiro: a máscara é só para a tela; para o servidor vai `telefoneParaServidor`
 * (só dígitos, com o 55 do Brasil na frente).
 *
 * O 55 do país só é retirado quando o texto tem mais de 11 dígitos (número colado com DDI).
 * Assim um número do RS (DDD 55) digitado com 10/11 dígitos não perde o DDD.
 */
function digitosNacionais(valor: string): string {
  let d = valor.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.slice(0, 11);
}

/** Máscara enquanto digita: (11) 99999-0000 / (11) 3333-0000. No máximo 11 dígitos. */
export function mascaraTelefoneBR(valor: string): string {
  const d = digitosNacionais(valor);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Vazio é aceito (campo opcional); preenchido precisa de DDD + 8 ou 9 dígitos. */
export function erroTelefoneBR(valor: string): string | null {
  const d = digitosNacionais(valor);
  if (!d) return null;
  return d.length === 10 || d.length === 11 ? null : "Telefone incompleto: use DDD + número, ex.: (11) 99999-0000.";
}

/** Valor para gravar: "55" + DDD + número, só dígitos ("" se vazio). */
export function telefoneParaServidor(valor: string): string {
  const d = digitosNacionais(valor);
  return d ? `55${d}` : "";
}
