import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/* ---------- helpers de cor (compartilháveis) ---------- */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{6}|[a-f\d]{3})$/i.exec((hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function withAlpha(hex: string, a: number): string | null {
  const c = hexToRgb(hex);
  if (!c) return null;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}
function relLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const srgb = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}
export function inkFromHex(hex: string, isDark: boolean): string {
  const c = hexToRgb(hex);
  if (!c) return "hsl(var(--foreground))";
  const lum = relLuminance(c);
  if (isDark) {
    if (lum < 0.3) {
      const f = 0.55;
      return `rgb(${Math.round(c.r + (255 - c.r) * f)}, ${Math.round(c.g + (255 - c.g) * f)}, ${Math.round(c.b + (255 - c.b) * f)})`;
    }
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  } else {
    if (lum > 0.6) {
      const f = 0.55;
      return `rgb(${Math.round(c.r * (1 - f))}, ${Math.round(c.g * (1 - f))}, ${Math.round(c.b * (1 - f))})`;
    }
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }
}
export function useIsDark(): boolean {
  const [dark, setDark] = useState<boolean>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/* ---------- Componente ---------- */
export interface CategoriaBadgeProps {
  /** Nome da categoria (ou procedimento como fallback de texto) */
  categoria?: string | null;
  /** Procedimento — usado como texto se categoria estiver vazia */
  procedimento?: string | null;
  /** Cor hex da categoria (#RRGGBB ou #RGB) */
  cor?: string | null;
  /** Tamanho visual do badge */
  size?: "xs" | "sm" | "md";
  /** Variante visual: 'soft' (fundo translúcido) ou 'dot' (apenas bolinha + texto) */
  variant?: "soft" | "dot" | "outline";
  /** Texto exibido quando não há categoria nem procedimento */
  emptyLabel?: string;
  className?: string;
  title?: string;
}

const SIZE_MAP = {
  xs: { dot: "h-1.5 w-1.5", text: "text-[10px]", pad: "px-1.5 py-0.5", gap: "gap-1" },
  sm: { dot: "h-2 w-2",     text: "text-xs",     pad: "px-2 py-0.5",   gap: "gap-1.5" },
  md: { dot: "h-2.5 w-2.5", text: "text-sm",     pad: "px-2.5 py-1",   gap: "gap-2" },
} as const;

/**
 * Badge consistente para categoria/procedimento, com fallback neutro/listrado
 * quando a cor estiver ausente ou inválida. Reaplica a mesma lógica visual
 * usada na AgendaGrid em qualquer lugar do app.
 */
export function CategoriaBadge({
  categoria,
  procedimento,
  cor,
  size = "sm",
  variant = "soft",
  emptyLabel = "Sem categoria",
  className,
  title,
}: CategoriaBadgeProps) {
  const isDark = useIsDark();
  const rawHex = (cor || "").trim();
  const validHex = rawHex && hexToRgb(rawHex) ? rawHex : "";
  const ink = validHex ? inkFromHex(validHex, isDark) : undefined;
  const bg = validHex ? withAlpha(validHex, isDark ? 0.18 : 0.10) || undefined : undefined;

  const label = categoria || procedimento || emptyLabel;
  const isEmpty = !categoria && !procedimento;
  const s = SIZE_MAP[size];

  // Apenas dot + texto inline (sem container/fundo)
  if (variant === "dot") {
    return (
      <span
        className={cn("inline-flex items-center min-w-0", s.gap, s.text, className)}
        title={title || label}
      >
        {validHex ? (
          <span
            className={cn("rounded-full shrink-0", s.dot)}
            style={{ background: ink }}
            aria-hidden
          />
        ) : (
          <span
            className={cn(
              "rounded-full shrink-0 ring-1 ring-muted-foreground/40",
              s.dot,
              !isEmpty && "bg-[repeating-linear-gradient(135deg,hsl(var(--muted-foreground)/0.35)_0_2px,transparent_2px_4px)]"
            )}
            aria-hidden
          />
        )}
        <span
          className={cn(
            "truncate font-medium",
            !validHex && (isEmpty ? "text-muted-foreground italic" : "text-foreground/80")
          )}
          style={ink ? { color: ink } : undefined}
        >
          {label}
        </span>
      </span>
    );
  }

  // outline / soft → container com fundo ou borda
  const isOutline = variant === "outline";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border max-w-full",
        s.pad,
        s.gap,
        s.text,
        validHex
          ? isOutline
            ? "bg-transparent"
            : ""
          : cn(
              "border-dashed",
              isEmpty ? "bg-muted/40 text-muted-foreground" : "bg-muted/40 text-foreground/80"
            ),
        className
      )}
      style={{
        background: validHex && !isOutline ? bg : undefined,
        borderColor: ink || undefined,
        color: ink || undefined,
      }}
      title={title || label}
    >
      {validHex ? (
        <span className={cn("rounded-full shrink-0", s.dot)} style={{ background: ink }} aria-hidden />
      ) : (
        <span
          className={cn(
            "rounded-full shrink-0 ring-1 ring-muted-foreground/40",
            s.dot,
            !isEmpty && "bg-[repeating-linear-gradient(135deg,hsl(var(--muted-foreground)/0.35)_0_2px,transparent_2px_4px)]"
          )}
          aria-hidden
        />
      )}
      <span
        className={cn(
          "truncate font-medium",
          isEmpty && !validHex && "italic"
        )}
      >
        {label}
      </span>
    </span>
  );
}
