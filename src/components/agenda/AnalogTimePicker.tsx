/**
 * AnalogTimePicker — Relógio circular interativo, inspirado no Material Design.
 * Adaptado ao design system teal/cyan da Odonto Connect.
 *
 * Uso:
 *   <AnalogTimePicker value="09:30" onChange={(v) => ...} />
 *
 * Visual: face circular com 12 marcações (horas) ou 60 (minutos), dot grande
 * no número selecionado, ponteiro animado com gradiente primário.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string; // "HH:MM"
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function AnalogTimePicker({ value, onChange, className, placeholder = "00:00", disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"h" | "m">("h");
  const [draftH, setDraftH] = useState<number>(() => parseInt(value?.split(":")[0] || "9", 10));
  const [draftM, setDraftM] = useState<number>(() => parseInt(value?.split(":")[1] || "0", 10));

  useEffect(() => {
    if (!open) return;
    const [h, m] = (value || "09:00").split(":").map((x) => parseInt(x, 10));
    setDraftH(isNaN(h) ? 9 : h);
    setDraftM(isNaN(m) ? 0 : m);
    setMode("h");
  }, [open, value]);

  const display = useMemo(() => {
    const h = String(draftH).padStart(2, "0");
    const m = String(draftM).padStart(2, "0");
    return `${h}:${m}`;
  }, [draftH, draftM]);

  const commit = (h: number, m: number) => {
    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { if (!disabled) setOpen(o); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm",
            "hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30 transition",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
        >
          <Clock className="h-4 w-4 text-primary" />
          <span className={cn("font-mono tabular-nums", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0 overflow-hidden rounded-2xl border-0 shadow-2xl"
        align="start"
      >
        {/* Header gradiente cyan com displays grandes */}
        <div className="relative gradient-primary px-5 pt-5 pb-4">
          <div className="absolute inset-0 opacity-30 mix-blend-overlay bg-[radial-gradient(circle_at_30%_20%,white,transparent_60%)]" />
          <div className="relative flex items-end justify-center gap-1 font-mono text-white">
            <button
              type="button"
              onClick={() => setMode("h")}
              className={cn(
                "px-3 py-1 text-5xl tabular-nums transition rounded-md",
                mode === "h" ? "bg-white/20" : "opacity-60 hover:opacity-90",
              )}
            >
              {String(draftH).padStart(2, "0")}
            </button>
            <span className="text-4xl pb-1 opacity-70">:</span>
            <button
              type="button"
              onClick={() => setMode("m")}
              className={cn(
                "px-3 py-1 text-5xl tabular-nums transition rounded-md",
                mode === "m" ? "bg-white/20" : "opacity-60 hover:opacity-90",
              )}
            >
              {String(draftM).padStart(2, "0")}
            </button>
          </div>
          <div className="relative text-center text-[11px] font-medium uppercase tracking-wider text-white/80 mt-1">
            {mode === "h" ? "Selecione a hora" : "Selecione os minutos"}
          </div>
        </div>

        {/* Face do relógio */}
        <div className="px-5 py-5 bg-card">
          <ClockFace
            mode={mode}
            valueH={draftH}
            valueM={draftM}
            onPick={(num) => {
              if (mode === "h") {
                setDraftH(num);
                setMode("m");
              } else {
                setDraftM(num);
              }
            }}
          />
          {/* Quick presets */}
          {mode === "h" && (
            <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
              {[7, 8, 9, 10, 13, 14, 15, 16].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => { setDraftH(h); setMode("m"); }}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground transition"
                >
                  {h}h
                </button>
              ))}
            </div>
          )}
          {mode === "m" && (
            <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
              {[0, 15, 30, 45].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraftM(m)}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground transition"
                >
                  :{String(m).padStart(2, "0")}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-t border-border/60">
          <div className="text-xs text-muted-foreground font-mono tabular-nums">{display}</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs px-3 py-1.5 rounded-md hover:bg-muted text-muted-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => { commit(draftH, draftM); setOpen(false); }}
              className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm"
            >
              Confirmar
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface FaceProps {
  mode: "h" | "m";
  valueH: number;
  valueM: number;
  onPick: (num: number) => void;
}

function ClockFace({ mode, valueH, valueM, onPick }: FaceProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const SIZE = 220;
  const CENTER = SIZE / 2;
  const RADIUS_OUTER = 92;
  const RADIUS_INNER = 64;

  // Para horas: 1-12 no anel externo, 13-24 (e 0) no interno (estilo Material 24h).
  // Para minutos: 0-55 step 5 no externo (60 = 12h pos), todos minutos clicáveis por arraste.
  const items = useMemo(() => {
    if (mode === "h") {
      const outer = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
      const inner = Array.from({ length: 12 }, (_, i) => (i + 13) % 24); // 13..24 -> 13..23,0
      return { outer, inner };
    }
    return { outer: Array.from({ length: 12 }, (_, i) => i * 5), inner: [] as number[] };
  }, [mode]);

  const currentValue = mode === "h" ? valueH : valueM;

  // Ângulo para um número (0deg = 12h pos, sentido horário)
  const angleFor = (num: number) => {
    if (mode === "h") {
      const h12 = num === 0 ? 12 : num > 12 ? num - 12 : num;
      return ((h12 % 12) * 30) - 90; // 0 = topo
    }
    return ((num % 60) / 5) * 30 - 90;
  };

  const isInner = (num: number) => mode === "h" && (num === 0 || num > 12);

  const posFor = (num: number) => {
    const a = (angleFor(num) * Math.PI) / 180;
    const r = isInner(num) ? RADIUS_INNER : RADIUS_OUTER;
    return { x: CENTER + r * Math.cos(a), y: CENTER + r * Math.sin(a) };
  };

  const handPos = posFor(currentValue);
  const handIsInner = isInner(currentValue);

  // Drag handler — calcula posição do mouse → número mais próximo
  const handlePointer = (e: React.PointerEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - CENTER;
    const y = e.clientY - rect.top - CENTER;
    const dist = Math.sqrt(x * x + y * y);
    let angleDeg = Math.atan2(y, x) * (180 / Math.PI) + 90; // 0 = topo
    if (angleDeg < 0) angleDeg += 360;

    if (mode === "h") {
      const idx = Math.round(angleDeg / 30) % 12; // 0..11
      const innerSel = dist < (RADIUS_OUTER + RADIUS_INNER) / 2;
      const num = innerSel
        ? (idx === 0 ? 0 : idx + 12) // 12h pos no anel interno = 0 (00h)
        : (idx === 0 ? 12 : idx);
      onPick(num);
    } else {
      const minute = Math.round(angleDeg / 6) % 60;
      onPick(minute);
    }
  };

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="cursor-pointer touch-none select-none"
        onPointerDown={(e) => { setDragging(true); handlePointer(e); }}
        onPointerMove={(e) => dragging && handlePointer(e)}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        {/* Background circle */}
        <circle cx={CENTER} cy={CENTER} r={CENTER - 4} fill="hsl(var(--muted) / 0.4)" />
        <circle cx={CENTER} cy={CENTER} r={CENTER - 4} fill="none" stroke="hsl(var(--border))" strokeWidth="1" />

        {/* Hand line */}
        <line
          x1={CENTER}
          y1={CENTER}
          x2={handPos.x}
          y2={handPos.y}
          stroke="url(#handGrad)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Hand dot at end */}
        <circle
          cx={handPos.x}
          cy={handPos.y}
          r={handIsInner ? 14 : 16}
          fill="url(#handGrad)"
          className="drop-shadow-[0_2px_8px_hsl(var(--primary)/0.4)]"
        />
        {/* Center pivot */}
        <circle cx={CENTER} cy={CENTER} r="4" fill="hsl(var(--primary))" />

        <defs>
          <linearGradient id="handGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--primary-glow))" />
          </linearGradient>
        </defs>

        {/* Outer ring numbers */}
        {items.outer.map((n) => {
          const p = posFor(n);
          const selected = n === currentValue;
          return (
            <g key={`o-${n}`} pointerEvents="none">
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                className={cn(
                  "font-medium tabular-nums",
                  selected ? "fill-primary-foreground" : "fill-foreground",
                )}
                style={{ fontSize: mode === "h" ? 14 : 13 }}
              >
                {mode === "m" ? String(n).padStart(2, "0") : n}
              </text>
            </g>
          );
        })}

        {/* Inner ring numbers (24h mode) */}
        {items.inner.map((n) => {
          const p = posFor(n);
          const selected = n === currentValue;
          return (
            <g key={`i-${n}`} pointerEvents="none">
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                className={cn(
                  "font-normal tabular-nums",
                  selected ? "fill-primary-foreground" : "fill-muted-foreground",
                )}
                style={{ fontSize: 11 }}
              >
                {String(n).padStart(2, "0")}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
