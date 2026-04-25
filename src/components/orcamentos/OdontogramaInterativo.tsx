/**
 * Odontograma Interativo — Fase B
 *
 * Suporta:
 * • Dentição PERMANENTE (32 dentes — FDI 11..48)
 * • Dentição DECÍDUA (20 dentes — FDI 51..85)
 * • Seleção por FACE (V/L/M/D/O ou V/L/M/D para incisivos)
 * • Click-to-select com feedback visual usando tokens semânticos do design system.
 *
 * Cada dente é desenhado com 5 regiões clicáveis representando suas faces.
 * O componente emite o estado completo via onChange (controlled).
 */
import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";

export type Face = "V" | "L" | "M" | "D" | "O";
export type Dentition = "permanente" | "decidua";

export interface FaceSelection {
  /** numeração FDI do dente (11..48 para permanente, 51..85 para decíduo) */
  dente: number;
  /** faces marcadas neste dente */
  faces: Face[];
  /** cor da marcação (vem do procedimento selecionado) */
  cor?: string;
}

interface Props {
  selections: FaceSelection[];
  onChange: (next: FaceSelection[]) => void;
  /** cor atualmente "ativa" — usada quando o usuário marca uma face nova */
  activeColor?: string;
  readOnly?: boolean;
  /** mostrar legenda + botão de troca de dentição */
  showHeader?: boolean;
}

// FDI ordering (left→right como o paciente vê: lado direito do paciente = nossa esquerda)
const PERM_SUP = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const PERM_INF = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const DEC_SUP = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const DEC_INF = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

function isIncisor(num: number): boolean {
  const u = num % 10;
  return u === 1 || u === 2;
}

function ToothFaces({
  numero,
  selectedFaces,
  cor,
  onToggle,
  readOnly,
}: {
  numero: number;
  selectedFaces: Face[];
  cor: string;
  onToggle: (face: Face) => void;
  readOnly?: boolean;
}) {
  const incisor = isIncisor(numero);
  const fillFor = (f: Face) =>
    selectedFaces.includes(f) ? cor : "transparent";
  const strokeFor = (f: Face) =>
    selectedFaces.includes(f) ? cor : "hsl(var(--border))";

  const handle = (f: Face) => {
    if (readOnly) return;
    onToggle(f);
  };

  // SVG 40x52 — top=Vestibular, bottom=Lingual, left=Mesial(esq), right=Distal(esq)
  // Mas a "esquerda visual" depende do lado: trocaremos M/D com base em numero%10>=5? não,
  // simplificação: usamos sempre M=esquerda, D=direita (o usuário vê o dente isoladamente).
  return (
    <svg viewBox="0 0 40 52" className="w-full h-full">
      {/* Vestibular (topo) */}
      <path
        d="M2 2 L38 2 L28 14 L12 14 Z"
        fill={fillFor("V")}
        stroke={strokeFor("V")}
        strokeWidth="1"
        className={cn("transition-colors", !readOnly && "cursor-pointer hover:opacity-70")}
        onClick={() => handle("V")}
      />
      {/* Mesial (esquerda) */}
      <path
        d="M2 2 L12 14 L12 38 L2 50 Z"
        fill={fillFor("M")}
        stroke={strokeFor("M")}
        strokeWidth="1"
        className={cn("transition-colors", !readOnly && "cursor-pointer hover:opacity-70")}
        onClick={() => handle("M")}
      />
      {/* Distal (direita) */}
      <path
        d="M38 2 L28 14 L28 38 L38 50 Z"
        fill={fillFor("D")}
        stroke={strokeFor("D")}
        strokeWidth="1"
        className={cn("transition-colors", !readOnly && "cursor-pointer hover:opacity-70")}
        onClick={() => handle("D")}
      />
      {/* Lingual (base) */}
      <path
        d="M2 50 L12 38 L28 38 L38 50 Z"
        fill={fillFor("L")}
        stroke={strokeFor("L")}
        strokeWidth="1"
        className={cn("transition-colors", !readOnly && "cursor-pointer hover:opacity-70")}
        onClick={() => handle("L")}
      />
      {/* Oclusal/Incisal (centro) */}
      {incisor ? (
        // incisivo/canino: sem face oclusal — apenas linha incisal fina central
        <rect
          x="13"
          y="22"
          width="14"
          height="8"
          fill={fillFor("O")}
          stroke={strokeFor("O")}
          strokeWidth="1"
          className={cn("transition-colors", !readOnly && "cursor-pointer hover:opacity-70")}
          onClick={() => handle("O")}
        />
      ) : (
        <rect
          x="13"
          y="15"
          width="14"
          height="22"
          fill={fillFor("O")}
          stroke={strokeFor("O")}
          strokeWidth="1"
          className={cn("transition-colors", !readOnly && "cursor-pointer hover:opacity-70")}
          onClick={() => handle("O")}
        />
      )}
    </svg>
  );
}

export function OdontogramaInterativo({
  selections,
  onChange,
  activeColor = "hsl(var(--primary))",
  readOnly,
  showHeader = true,
}: Props) {
  const [dentition, setDentition] = useState<Dentition>("permanente");

  const map = useMemo(() => {
    const m = new Map<number, FaceSelection>();
    for (const s of selections) m.set(s.dente, s);
    return m;
  }, [selections]);

  const toggleFace = useCallback(
    (dente: number, face: Face) => {
      const current = map.get(dente);
      let next: FaceSelection[];
      if (!current) {
        next = [...selections, { dente, faces: [face], cor: activeColor }];
      } else {
        const has = current.faces.includes(face);
        const newFaces = has
          ? current.faces.filter((f) => f !== face)
          : [...current.faces, face];
        if (newFaces.length === 0) {
          next = selections.filter((s) => s.dente !== dente);
        } else {
          next = selections.map((s) =>
            s.dente === dente ? { ...s, faces: newFaces, cor: activeColor } : s
          );
        }
      }
      onChange(next);
    },
    [map, selections, onChange, activeColor]
  );

  const supTeeth = dentition === "permanente" ? PERM_SUP : DEC_SUP;
  const infTeeth = dentition === "permanente" ? PERM_INF : DEC_INF;

  const renderArch = (teeth: number[]) => (
    <div className="flex justify-center items-end gap-0.5">
      {teeth.map((n) => {
        const sel = map.get(n);
        return (
          <div key={n} className="flex flex-col items-center" style={{ width: "clamp(22px, 3.2vw, 36px)" }}>
            <ToothFaces
              numero={n}
              selectedFaces={sel?.faces ?? []}
              cor={sel?.cor ?? activeColor}
              onToggle={(f) => toggleFace(n, f)}
              readOnly={readOnly}
            />
          </div>
        );
      })}
    </div>
  );

  const renderNumbers = (teeth: number[]) => (
    <div className="flex justify-center gap-0.5">
      {teeth.map((n) => (
        <div
          key={n}
          className="text-center"
          style={{ width: "clamp(22px, 3.2vw, 36px)" }}
        >
          <span
            className={cn(
              "text-[9px] font-bold",
              map.has(n) ? "text-primary" : "text-muted-foreground"
            )}
          >
            {n}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex items-center justify-between">
          <div className="inline-flex h-7 items-center rounded-lg bg-muted p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setDentition("permanente")}
              className={cn(
                "px-3 py-1 rounded-md font-medium transition-colors",
                dentition === "permanente"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Permanente
            </button>
            <button
              type="button"
              onClick={() => setDentition("decidua")}
              className={cn(
                "px-3 py-1 rounded-md font-medium transition-colors",
                dentition === "decidua"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Decídua
            </button>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm border border-border" /> V (Vestibular)
            </span>
            <span>L (Lingual) · M (Mesial) · D (Distal) · O (Oclusal)</span>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold text-center">
          Arcada Superior
        </p>
        {renderArch(supTeeth)}
        {renderNumbers(supTeeth)}

        <div className="border-t border-dashed border-border my-2" />

        {renderNumbers(infTeeth)}
        {renderArch(infTeeth)}
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold text-center">
          Arcada Inferior
        </p>
      </div>
    </div>
  );
}
