import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Ensina ao cn() os tokens próprios de src/styles.css. Sem isso, `cn("text-caption", "text-primary")`
// trataria text-caption como cor e descartaria um dos dois.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "caption", "footnote", "body", "callout", "title-1", "title-2", "title-3",
        "display-26", "display-32", "display-34", "display-40", "display-48", "display-56", "hero",
      ],
      spacing: ["touch"],
      shadow: ["raised", "overlay", "stage"],
      ease: ["out-soft"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Data local (YYYY-MM-DD). toISOString() usa UTC e, no Brasil, vira o dia seguinte a partir das 21h. */
export function localDateISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
