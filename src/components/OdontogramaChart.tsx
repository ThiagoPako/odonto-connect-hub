import { useState } from "react";
import {
  type DenteInfo,
  type StatusDente,
  statusDenteConfig,
  nomesDentes,
} from "@/data/pacientesMockData";

interface OdontogramaChartProps {
  dentes: DenteInfo[];
  onDenteClick?: (numero: number) => void;
  editable?: boolean;
}

const arcadaSuperior = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const arcadaInferior = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

function getToothType(n: number): "molar3" | "molar2" | "premolar" | "canine" | "lateral" | "central" {
  const unit = n % 10;
  if (unit === 8 || unit === 7) return "molar3"; // 3rd & 2nd molar (bigger)
  if (unit === 6) return "molar2"; // 1st molar
  if (unit === 5 || unit === 4) return "premolar";
  if (unit === 3) return "canine";
  if (unit === 2) return "lateral";
  return "central"; // 1 = central incisor
}

function isUpper(n: number): boolean {
  return n >= 11 && n <= 28;
}

/* ─── Lateral (side) view of each tooth ─── */
function LateralToothSVG({ numero, status, color, fillColor }: {
  numero: number; status: StatusDente; color: string; fillColor: string;
}) {
  const type = getToothType(numero);
  const upper = isUpper(numero);

  if (status === "ausente") {
    return (
      <svg viewBox="0 0 28 52" className="w-full h-full">
        <line x1="5" y1="5" x2="23" y2="47" stroke={color} strokeWidth="1.5" opacity="0.4" />
        <line x1="23" y1="5" x2="5" y2="47" stroke={color} strokeWidth="1.5" opacity="0.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 28 52" className="w-full h-full">
      {upper ? (
        <UpperLateral type={type} fillColor={fillColor} color={color} />
      ) : (
        <LowerLateral type={type} fillColor={fillColor} color={color} />
      )}
      {renderLateralStatusOverlay(status, color, upper)}
    </svg>
  );
}

function UpperLateral({ type, fillColor, color }: { type: string; fillColor: string; color: string }) {
  // Upper teeth: roots on top, crown on bottom
  switch (type) {
    case "molar3":
      return (
        <g>
          {/* 3 roots */}
          <path d="M7 24 C7 18, 5 8, 4 3 C4 2, 5 2, 6 3 C7 6, 8 14, 10 22" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M12 22 C12 16, 13 8, 14 3 C14 2, 15 2, 15 3 C16 8, 16 16, 16 22" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M18 22 C19 14, 21 8, 22 3 C22 2, 23 2, 24 3 C23 8, 21 18, 21 24" fill={fillColor} stroke={color} strokeWidth="0.8" />
          {/* Crown */}
          <path d="M5 24 C5 22, 6 21, 7 20 C9 19, 12 18.5, 14 18.5 C16 18.5, 19 19, 21 20 C22 21, 23 22, 23 24 C23 28, 22 32, 21 34 C19 36, 17 37, 14 37 C11 37, 9 36, 7 34 C6 32, 5 28, 5 24Z" fill={fillColor} stroke={color} strokeWidth="1" />
          {/* Crown bumps */}
          <path d="M7 24 C8 22, 10 21, 11 22 C12 23, 12 22, 14 21 C15 22, 16 22, 17 21 C18 22, 20 22, 21 24" fill="none" stroke={color} strokeWidth="0.6" opacity="0.5" />
        </g>
      );
    case "molar2":
      return (
        <g>
          <path d="M8 23 C8 17, 6 9, 5 4 C5 3, 6 3, 7 4 C8 8, 9 15, 11 21" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M13 21 C13 15, 14 9, 14 4 C14 3, 15 3, 15 4 C16 9, 16 15, 16 21" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M17 21 C18 13, 20 7, 21 4 C21 3, 22 3, 22 4 C22 8, 21 16, 20 23" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M6 23 C6 21, 7 20, 8 19 C10 18, 12 17.5, 14 17.5 C16 17.5, 18 18, 20 19 C21 20, 22 21, 22 23 C22 27, 21 31, 20 33 C18 35, 16 36, 14 36 C12 36, 10 35, 8 33 C7 31, 6 27, 6 23Z" fill={fillColor} stroke={color} strokeWidth="1" />
          <path d="M8 23 C9 21, 11 20, 12 21 C13 22, 15 20, 16 21 C17 22, 19 21, 20 23" fill="none" stroke={color} strokeWidth="0.6" opacity="0.5" />
        </g>
      );
    case "premolar":
      return (
        <g>
          <path d="M11 22 C11 16, 10 9, 9 4 C9 3, 10 3, 11 4 C12 8, 12 15, 13 20" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M15 20 C16 15, 17 9, 18 4 C18 3, 19 3, 19 4 C18 9, 17 16, 17 22" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M9 22 C9 20, 10 19, 11 18 C12 17, 13 17, 14 17 C15 17, 16 17, 17 18 C18 19, 19 20, 19 22 C19 26, 18 30, 17 32 C16 33, 15 34, 14 34 C13 34, 12 33, 11 32 C10 30, 9 26, 9 22Z" fill={fillColor} stroke={color} strokeWidth="1" />
          <path d="M11 22 C12 20, 13 21, 14 20 C15 21, 16 20, 17 22" fill="none" stroke={color} strokeWidth="0.6" opacity="0.5" />
        </g>
      );
    case "canine":
      return (
        <g>
          <path d="M12 22 C12 15, 11 8, 11 4 C11 2, 14 1, 14 3 C15 2, 17 2, 17 4 C17 8, 16 15, 16 22" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M10 24 C10 21, 11 19, 12 18 C13 17, 14 16, 14 16 C14 16, 15 17, 16 18 C17 19, 18 21, 18 24 C18 28, 17 32, 16 34 C15 35, 14 36, 14 36 C14 36, 13 35, 12 34 C11 32, 10 28, 10 24Z" fill={fillColor} stroke={color} strokeWidth="1" />
        </g>
      );
    case "lateral":
      return (
        <g>
          <path d="M12 20 C12 14, 12 8, 12 4 C12 2, 14 2, 14 3 C16 2, 16 2, 16 4 C16 8, 16 14, 16 20" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M10 22 C10 19, 11 18, 12 17 C13 16, 14 16, 14 16 C14 16, 15 16, 16 17 C17 18, 18 19, 18 22 C18 26, 17 30, 16 32 C15 33, 14 34, 14 34 C14 34, 13 33, 12 32 C11 30, 10 26, 10 22Z" fill={fillColor} stroke={color} strokeWidth="1" />
        </g>
      );
    default: // central
      return (
        <g>
          <path d="M12 18 C12 12, 13 6, 13 4 C13 2, 14 2, 14 3 C15 2, 15 2, 15 4 C15 6, 16 12, 16 18" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M10 20 C10 18, 11 16, 12 15 C13 14.5, 14 14, 14 14 C14 14, 15 14.5, 16 15 C17 16, 18 18, 18 20 C18 25, 17 30, 16 33 C15 34, 14 35, 14 35 C14 35, 13 34, 12 33 C11 30, 10 25, 10 20Z" fill={fillColor} stroke={color} strokeWidth="1" />
        </g>
      );
  }
}

function LowerLateral({ type, fillColor, color }: { type: string; fillColor: string; color: string }) {
  // Lower teeth: crown on top, roots on bottom
  switch (type) {
    case "molar3":
      return (
        <g>
          {/* Crown */}
          <path d="M5 15 C5 19, 6 21, 7 22 C9 24, 11 25, 14 25 C17 25, 19 24, 21 22 C22 21, 23 19, 23 15 C23 12, 22 9, 21 8 C19 7, 16 6, 14 6 C12 6, 9 7, 7 8 C6 9, 5 12, 5 15Z" fill={fillColor} stroke={color} strokeWidth="1" />
          <path d="M7 15 C8 17, 10 18, 11 17 C12 16, 14 18, 17 17 C18 16, 20 17, 21 15" fill="none" stroke={color} strokeWidth="0.6" opacity="0.5" />
          {/* 2 roots */}
          <path d="M9 24 C9 30, 7 38, 6 46 C6 48, 7 48, 8 47 C9 42, 10 34, 12 26" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M16 26 C18 34, 19 42, 20 47 C20 48, 21 48, 22 46 C21 38, 19 30, 19 24" fill={fillColor} stroke={color} strokeWidth="0.8" />
        </g>
      );
    case "molar2":
      return (
        <g>
          <path d="M6 15 C6 19, 7 21, 8 22 C10 24, 12 25, 14 25 C16 25, 18 24, 20 22 C21 21, 22 19, 22 15 C22 12, 21 9, 20 8 C18 7, 16 6, 14 6 C12 6, 10 7, 8 8 C7 9, 6 12, 6 15Z" fill={fillColor} stroke={color} strokeWidth="1" />
          <path d="M8 15 C9 17, 11 18, 12 17 C14 16, 16 17, 17 17 C19 18, 20 17, 20 15" fill="none" stroke={color} strokeWidth="0.6" opacity="0.5" />
          <path d="M10 24 C10 30, 8 38, 7 46 C7 48, 8 48, 9 47 C10 42, 11 34, 12 26" fill={fillColor} stroke={color} strokeWidth="0.8" />
          <path d="M16 26 C17 34, 18 42, 19 47 C19 48, 20 48, 21 46 C20 38, 18 30, 18 24" fill={fillColor} stroke={color} strokeWidth="0.8" />
        </g>
      );
    case "premolar":
      return (
        <g>
          <path d="M9 14 C9 18, 10 20, 11 21 C12 22, 13 23, 14 23 C15 23, 16 22, 17 21 C18 20, 19 18, 19 14 C19 11, 18 9, 17 8 C16 7, 15 7, 14 7 C13 7, 12 7, 11 8 C10 9, 9 11, 9 14Z" fill={fillColor} stroke={color} strokeWidth="1" />
          <path d="M11 14 C12 16, 13 15, 14 16 C15 15, 16 16, 17 14" fill="none" stroke={color} strokeWidth="0.6" opacity="0.5" />
          <path d="M13 22 C13 28, 12 36, 11 44 C11 46, 12 46, 13 45 C14 40, 15 28, 15 22" fill={fillColor} stroke={color} strokeWidth="0.8" />
        </g>
      );
    case "canine":
      return (
        <g>
          <path d="M10 14 C10 18, 11 21, 12 22 C13 23, 14 24, 14 24 C14 24, 15 23, 16 22 C17 21, 18 18, 18 14 C18 11, 17 9, 16 8 C15 7, 14 7, 14 7 C14 7, 13 7, 12 8 C11 9, 10 11, 10 14Z" fill={fillColor} stroke={color} strokeWidth="1" />
          <path d="M12 22 C12 28, 12 36, 12 44 C12 46, 14 47, 14 46 C16 47, 16 46, 16 44 C16 36, 16 28, 16 22" fill={fillColor} stroke={color} strokeWidth="0.8" />
        </g>
      );
    case "lateral":
      return (
        <g>
          <path d="M10 14 C10 18, 11 20, 12 21 C13 22, 14 22, 14 22 C14 22, 15 22, 16 21 C17 20, 18 18, 18 14 C18 11, 17 9, 16 8 C15 7, 14 7, 14 7 C14 7, 13 7, 12 8 C11 9, 10 11, 10 14Z" fill={fillColor} stroke={color} strokeWidth="1" />
          <path d="M12 21 C12 28, 12 36, 12 44 C12 46, 14 47, 14 46 C16 47, 16 46, 16 44 C16 36, 16 28, 16 21" fill={fillColor} stroke={color} strokeWidth="0.8" />
        </g>
      );
    default: // central
      return (
        <g>
          <path d="M10 13 C10 17, 11 19, 12 20 C13 21, 14 22, 14 22 C14 22, 15 21, 16 20 C17 19, 18 17, 18 13 C18 10, 17 8, 16 7 C15 6, 14 6, 14 6 C14 6, 13 6, 12 7 C11 8, 10 10, 10 13Z" fill={fillColor} stroke={color} strokeWidth="1" />
          <path d="M12 21 C12 28, 13 36, 13 44 C13 46, 14 47, 14 46 C15 47, 15 46, 15 44 C15 36, 16 28, 16 21" fill={fillColor} stroke={color} strokeWidth="0.8" />
        </g>
      );
  }
}

/* ─── Occlusal (top-down) view ─── */
function OcclusalToothSVG({ numero, status, color, fillColor }: {
  numero: number; status: StatusDente; color: string; fillColor: string;
}) {
  const type = getToothType(numero);

  if (status === "ausente") {
    return (
      <svg viewBox="0 0 24 24" className="w-full h-full">
        <line x1="4" y1="4" x2="20" y2="20" stroke={color} strokeWidth="1.2" opacity="0.4" />
        <line x1="20" y1="4" x2="4" y2="20" stroke={color} strokeWidth="1.2" opacity="0.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      {renderOcclusalShape(type, fillColor, color)}
      {renderOcclusalStatusOverlay(status, color, type)}
    </svg>
  );
}

function renderOcclusalShape(type: string, fillColor: string, color: string) {
  switch (type) {
    case "molar3":
    case "molar2":
      return (
        <g>
          <rect x="2" y="3" width="20" height="18" rx="4" fill={fillColor} stroke={color} strokeWidth="0.9" />
          {/* Cross grooves */}
          <line x1="8" y1="5" x2="8" y2="19" stroke={color} strokeWidth="0.5" opacity="0.35" />
          <line x1="16" y1="5" x2="16" y2="19" stroke={color} strokeWidth="0.5" opacity="0.35" />
          <line x1="4" y1="9" x2="20" y2="9" stroke={color} strokeWidth="0.5" opacity="0.35" />
          <line x1="4" y1="15" x2="20" y2="15" stroke={color} strokeWidth="0.5" opacity="0.35" />
          {/* Central pit */}
          <rect x="8" y="9" width="8" height="6" rx="1.5" fill="none" stroke={color} strokeWidth="0.6" opacity="0.4" />
        </g>
      );
    case "premolar":
      return (
        <g>
          <ellipse cx="12" cy="12" rx="8" ry="9" fill={fillColor} stroke={color} strokeWidth="0.9" />
          <line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth="0.5" opacity="0.35" />
          <ellipse cx="9" cy="12" rx="2.5" ry="3" fill="none" stroke={color} strokeWidth="0.5" opacity="0.4" />
          <ellipse cx="15" cy="12" rx="2.5" ry="3" fill="none" stroke={color} strokeWidth="0.5" opacity="0.4" />
        </g>
      );
    case "canine":
      return (
        <g>
          <ellipse cx="12" cy="12" rx="7" ry="9" fill={fillColor} stroke={color} strokeWidth="0.9" />
          {/* Pointed ridge */}
          <path d="M8 16 L12 6 L16 16" fill="none" stroke={color} strokeWidth="0.5" opacity="0.4" />
        </g>
      );
    case "lateral":
      return (
        <g>
          <ellipse cx="12" cy="12" rx="6.5" ry="8" fill={fillColor} stroke={color} strokeWidth="0.9" />
          <line x1="8" y1="10" x2="16" y2="10" stroke={color} strokeWidth="0.4" opacity="0.3" />
        </g>
      );
    default: // central
      return (
        <g>
          <rect x="4" y="3" width="16" height="18" rx="5" fill={fillColor} stroke={color} strokeWidth="0.9" />
          <line x1="7" y1="10" x2="17" y2="10" stroke={color} strokeWidth="0.4" opacity="0.3" />
        </g>
      );
  }
}

function renderOcclusalStatusOverlay(status: StatusDente, color: string, type: string) {
  switch (status) {
    case "restaurado":
      return <rect x="8" y="8" width="8" height="8" rx="1.5" fill={color} opacity="0.45" />;
    case "carie":
      return <circle cx="12" cy="12" r="4" fill={color} opacity="0.5" />;
    case "implante":
      return (
        <g>
          <circle cx="12" cy="12" r="5" fill="none" stroke={color} strokeWidth="1.5" opacity="0.6" />
          <circle cx="12" cy="12" r="2" fill={color} opacity="0.4" />
        </g>
      );
    case "canal":
      return (
        <g>
          <line x1="9" y1="9" x2="15" y2="15" stroke={color} strokeWidth="1.5" opacity="0.5" />
          <line x1="15" y1="9" x2="9" y2="15" stroke={color} strokeWidth="1.5" opacity="0.5" />
        </g>
      );
    case "protese":
      return <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="2 2" opacity="0.6" />;
    case "fratura":
      return <path d="M8 6 L12 10 L10 12 L14 18" stroke={color} strokeWidth="1.5" fill="none" opacity="0.6" />;
    case "selante":
      return <ellipse cx="12" cy="12" rx="4" ry="3" fill={color} opacity="0.4" />;
    default:
      return null;
  }
}

function renderLateralStatusOverlay(status: StatusDente, color: string, upper: boolean) {
  const cy = upper ? 26 : 16;
  switch (status) {
    case "restaurado":
      return <rect x="10" y={cy - 4} width="8" height="8" rx="1.5" fill={color} opacity="0.45" />;
    case "carie":
      return <circle cx="14" cy={cy} r="4" fill={color} opacity="0.45" />;
    case "implante":
      return (
        <g>
          <line x1="14" y1={upper ? 8 : 30} x2="14" y2={upper ? 36 : 8} stroke={color} strokeWidth="2" opacity="0.5" />
          <line x1="10" y1={upper ? 30 : 14} x2="18" y2={upper ? 30 : 14} stroke={color} strokeWidth="1" />
          <line x1="11" y1={upper ? 34 : 10} x2="17" y2={upper ? 34 : 10} stroke={color} strokeWidth="1" />
        </g>
      );
    case "canal":
      return <path d={`M14 ${upper ? 10 : 38} L14 ${upper ? 38 : 10}`} stroke={color} strokeWidth="1.5" strokeDasharray="2 2" opacity="0.5" />;
    case "protese":
      return <rect x="8" y={upper ? 16 : 6} width="12" height="16" rx="3" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="2 2" opacity="0.6" />;
    case "fratura":
      return <path d={`M9 ${cy - 6} L13 ${cy - 2} L10 ${cy} L15 ${cy + 6}`} stroke={color} strokeWidth="1.5" fill="none" opacity="0.6" />;
    case "selante":
      return <ellipse cx="14" cy={cy} rx="4" ry="3" fill={color} opacity="0.4" />;
    default:
      return null;
  }
}

export function OdontogramaChart({ dentes, onDenteClick, editable = false }: OdontogramaChartProps) {
  const [hoveredDente, setHoveredDente] = useState<number | null>(null);
  const [selectedDente, setSelectedDente] = useState<number | null>(null);

  const denteMap = new Map(dentes.map((d) => [d.numero, d]));

  const handleClick = (numero: number) => {
    if (editable && onDenteClick) {
      onDenteClick(numero);
    }
    setSelectedDente(selectedDente === numero ? null : numero);
  };

  const getToothProps = (numero: number) => {
    const dente = denteMap.get(numero);
    const status = dente?.status ?? "saudavel";
    const config = statusDenteConfig[status];
    return { status, config, fillColor: status === "saudavel" ? "hsl(45, 30%, 92%)" : `${config.color}20` };
  };

  const renderToothColumn = (numero: number) => {
    const { status, config, fillColor } = getToothProps(numero);
    const isHovered = hoveredDente === numero;
    const isSelected = selectedDente === numero;
    const upper = isUpper(numero);

    return (
      <div
        key={numero}
        className={`flex flex-col items-center cursor-pointer transition-all duration-150 ${
          isSelected ? "scale-110 z-10" : isHovered ? "scale-105" : ""
        }`}
        style={{ width: "clamp(22px, 4vw, 34px)" }}
        onMouseEnter={() => setHoveredDente(numero)}
        onMouseLeave={() => setHoveredDente(null)}
        onClick={() => handleClick(numero)}
      >
        {upper ? (
          <>
            {/* Lateral view (roots up) */}
            <div className="w-full" style={{ height: "clamp(28px, 5vw, 42px)" }}>
              <LateralToothSVG numero={numero} status={status} color={config.color} fillColor={fillColor} />
            </div>
            {/* Occlusal view */}
            <div className="w-full" style={{ height: "clamp(16px, 3vw, 24px)" }}>
              <OcclusalToothSVG numero={numero} status={status} color={config.color} fillColor={fillColor} />
            </div>
          </>
        ) : (
          <>
            {/* Occlusal view */}
            <div className="w-full" style={{ height: "clamp(16px, 3vw, 24px)" }}>
              <OcclusalToothSVG numero={numero} status={status} color={config.color} fillColor={fillColor} />
            </div>
            {/* Lateral view (roots down) */}
            <div className="w-full" style={{ height: "clamp(28px, 5vw, 42px)" }}>
              <LateralToothSVG numero={numero} status={status} color={config.color} fillColor={fillColor} />
            </div>
          </>
        )}
        {isHovered && (
          <span className="text-[7px] text-muted-foreground font-medium whitespace-nowrap absolute -bottom-3">
            {config.label}
          </span>
        )}
      </div>
    );
  };

  const selectedInfo = selectedDente ? denteMap.get(selectedDente) : null;
  const selectedConfig = selectedInfo ? statusDenteConfig[selectedInfo.status] : null;

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3">
        {Object.entries(statusDenteConfig).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: `${cfg.color}33`, borderColor: cfg.color }} />
            <span className="text-[10px] text-muted-foreground font-medium">{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* Upper Arch */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 text-center">
          Arcada Superior
        </p>
        <div className="flex justify-center items-end gap-px">
          {arcadaSuperior.map(renderToothColumn)}
        </div>
        {/* Numbers */}
        <div className="flex justify-center gap-px mt-0.5">
          {arcadaSuperior.map((n) => (
            <div key={n} className="text-center border border-border/50 bg-muted/30" style={{ width: "clamp(22px, 4vw, 34px)" }}>
              <span className={`text-[8px] font-bold ${selectedDente === n ? "text-primary" : "text-muted-foreground"}`}>{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Lower numbers + arch */}
      <div>
        <div className="flex justify-center gap-px mb-0.5">
          {arcadaInferior.map((n) => (
            <div key={n} className="text-center border border-border/50 bg-muted/30" style={{ width: "clamp(22px, 4vw, 34px)" }}>
              <span className={`text-[8px] font-bold ${selectedDente === n ? "text-primary" : "text-muted-foreground"}`}>{n}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-center items-start gap-px">
          {arcadaInferior.map(renderToothColumn)}
        </div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-1 text-center">
          Arcada Inferior
        </p>
      </div>

      {/* Selected tooth info */}
      {selectedDente && selectedInfo && selectedConfig && (
        <div className="bg-card rounded-xl border border-border/60 p-4 flex items-center gap-4 animate-fade-in shadow-sm">
          <div className="w-12 h-16 flex items-center justify-center" style={{ backgroundColor: `${selectedConfig.color}10` }}>
            <LateralToothSVG numero={selectedDente} status={selectedInfo.status} color={selectedConfig.color} fillColor={`${selectedConfig.color}25`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Dente {selectedDente} — {nomesDentes[selectedDente]}
            </p>
            <p className="text-xs text-muted-foreground">
              Status: <span style={{ color: selectedConfig.color }} className="font-bold">{selectedConfig.label}</span>
            </p>
            {selectedInfo.observacao && (
              <p className="text-xs text-muted-foreground mt-1">{selectedInfo.observacao}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface OdontogramaEditorProps {
  dentes: DenteInfo[];
  onChange: (dentes: DenteInfo[]) => void;
}

export function OdontogramaEditor({ dentes, onChange }: OdontogramaEditorProps) {
  const [selectedStatus, setSelectedStatus] = useState<StatusDente>("carie");

  const handleDenteClick = (numero: number) => {
    const updated = dentes.map((d) =>
      d.numero === numero ? { ...d, status: selectedStatus } : d
    );
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Selecione o status e clique no dente:
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(statusDenteConfig).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setSelectedStatus(key as StatusDente)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border ${
                selectedStatus === key ? "ring-2 ring-offset-1 shadow-sm" : "opacity-60 hover:opacity-100"
              }`}
              style={{
                borderColor: cfg.color,
                backgroundColor: selectedStatus === key ? `${cfg.color}22` : "transparent",
                color: cfg.color,
              }}
            >
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.color }} />
              {cfg.label}
            </button>
          ))}
        </div>
      </div>
      <OdontogramaChart dentes={dentes} onDenteClick={handleDenteClick} editable />
    </div>
  );
}
