// Mesmo cálculo do servidor (vps-api-server/server.mjs, dividirEmParcelasCentavos / addMesesIso):
// usado só para a prévia; quem grava é o servidor.
export function dividirEmParcelasCentavos(totalCentavos: number, n: number): number[] {
  const base = Math.floor(totalCentavos / n);
  const lista = Array.from({ length: n }, () => base);
  lista[n - 1] = totalCentavos - base * (n - 1);
  return lista;
}

export function addMesesIso(iso: string, meses: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export const reaisParaCentavos = (v: number) => Math.round(v * 100);

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function isoParaBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// Hoje no fuso de Brasília, em aaaa-mm-dd (valor de <input type="date">).
export function hojeIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
