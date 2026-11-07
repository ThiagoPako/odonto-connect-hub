/**
 * Iniciais para avatar: 1ª letra do primeiro e do último nome.
 * Ignora palavras que não começam com letra — "(Alfa)", "-", "2º" — para o avatar
 * não mostrar "M(" em "Maria Silva (Alfa)".
 */
export function iniciaisNome(nome: string | null | undefined): string {
  return (nome ?? "")
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .filter((_, i, arr) => i === 0 || i === arr.length - 1)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}
