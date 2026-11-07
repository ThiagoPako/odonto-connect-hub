import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Data local (YYYY-MM-DD). toISOString() usa UTC e, no Brasil, vira o dia seguinte a partir das 21h. */
export function localDateISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Minúsculas e sem acento, para busca por nome ("lucia" acha "Lúcia"). */
export function semAcento(s: string | null | undefined): string {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
