/** Máscara de telefone brasileiro enquanto digita: (11) 99999-0000 / (11) 3333-0000. */
export function mascaraTelefoneBR(valor: string): string {
  const d = valor.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Vazio é aceito (campo opcional); preenchido precisa de DDD + 8 ou 9 dígitos. */
export function erroTelefoneBR(valor: string): string | null {
  const d = valor.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (!d) return null;
  return d.length === 10 || d.length === 11 ? null : "Telefone incompleto: use DDD + número, ex.: (11) 99999-0000.";
}
