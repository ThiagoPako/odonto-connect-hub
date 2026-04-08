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

// Tooth type by FDI number
function getToothType(n: number): "molar" | "premolar" | "canine" | "incisor" {
  const unit = n % 10;
  if (unit >= 6) return "molar";
  if (unit >= 4) return "premolar";
  if (unit === 3) return "canine";
  return "incisor";
}

function isUpper(n: number): boolean {
  return n >= 11 && n <= 28;
}

// Realistic SVG tooth paths by type
function ToothSVG({ numero, status, color, fillColor }: { numero: number; status: StatusDente; color: string; fillColor: string }) {
  const type = getToothType(numero);
  const upper = isUpper(numero);

  if (status === "ausente") {
    return (
      <svg viewBox="0 0 32 44" className="w-7 h-10">
        <line x1="6" y1="6" x2="26" y2="38" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="26" y1="6" x2="6" y2="38" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </svg>
    );
  }

  const crownPath = getCrownPath(type, upper);
  const rootPath = getRootPath(type, upper);

  return (
    <svg viewBox="0 0 32 44" className="w-7 h-10">
      {/* Root(s) */}
      <path d={rootPath} fill={fillColor} stroke={color} strokeWidth="1" opacity="0.7" />
      {/* Crown */}
      <path d={crownPath} fill={fillColor} stroke={color} strokeWidth="1.2" />
      {/* Crown surface detail */}
      {renderCrownDetail(type, upper, color)}
      {/* Status overlay */}
      {renderStatusOverlay(status, color, type, upper)}
    </svg>
  );
}

function getCrownPath(type: string, upper: boolean): string {
  if (upper) {
    switch (type) {
      case "molar":
        return "M6 14 C6 10, 8 7, 10 6 C12 5, 14 4.5, 16 4.5 C18 4.5, 20 5, 22 6 C24 7, 26 10, 26 14 C26 18, 25 20, 24 21 C22 22, 20 22.5, 16 22.5 C12 22.5, 10 22, 8 21 C7 20, 6 18, 6 14Z";
      case "premolar":
        return "M9 14 C9 10, 10 7, 12 6 C13.5 5, 15 4.5, 16 4.5 C17 4.5, 18.5 5, 20 6 C22 7, 23 10, 23 14 C23 18, 22 20, 21 21 C19.5 22, 17 22.5, 16 22.5 C15 22.5, 12.5 22, 11 21 C10 20, 9 18, 9 14Z";
      case "canine":
        return "M10 16 C10 12, 11 8, 13 6 C14 5, 15 4.5, 16 4 C17 4.5, 18 5, 19 6 C21 8, 22 12, 22 16 C22 19, 21 21, 20 22 C18.5 23, 17 23, 16 23 C15 23, 13.5 23, 12 22 C11 21, 10 19, 10 16Z";
      default: // incisor
        return "M10 16 C10 11, 11 8, 13 6.5 C14 5.5, 15 5, 16 5 C17 5, 18 5.5, 19 6.5 C21 8, 22 11, 22 16 C22 19, 21 21, 20 22 C18.5 23, 17 23, 16 23 C15 23, 13.5 23, 12 22 C11 21, 10 19, 10 16Z";
    }
  } else {
    switch (type) {
      case "molar":
        return "M6 22 C6 18, 7 16, 8 15 C10 14, 12 13.5, 16 13.5 C20 13.5, 22 14, 24 15 C25 16, 26 18, 26 22 C26 26, 25 29, 24 30 C22 31, 20 31.5, 16 31.5 C12 31.5, 10 31, 8 30 C7 29, 6 26, 6 22Z";
      case "premolar":
        return "M9 22 C9 18, 10 16, 11 15 C12.5 14, 14.5 13.5, 16 13.5 C17.5 13.5, 19.5 14, 21 15 C22 16, 23 18, 23 22 C23 26, 22 29, 21 30 C19.5 31, 17 31.5, 16 31.5 C15 31.5, 12.5 31, 11 30 C10 29, 9 26, 9 22Z";
      case "canine":
        return "M10 20 C10 17, 11 15, 12 14 C13.5 13, 15 13, 16 13 C17 13, 18.5 13, 20 14 C21 15, 22 17, 22 20 C22 24, 21 28, 19 30 C18 31, 17 31.5, 16 32 C15 31.5, 14 31, 13 30 C11 28, 10 24, 10 20Z";
      default:
        return "M11 20 C11 17, 12 15, 13 14 C14 13, 15 13, 16 13 C17 13, 18 13, 19 14 C20 15, 21 17, 21 20 C21 24, 20 28, 19 30 C18 31, 17 31.5, 16 32 C15 31.5, 14 31, 13 30 C12 28, 11 24, 11 20Z";
    }
  }
}

function getRootPath(type: string, upper: boolean): string {
  if (upper) {
    switch (type) {
      case "molar":
        return "M10 21 L7 38 L9 38 L12 25 M16 22 L16 40 M20 21 L25 38 L23 38 L20 25";
      case "premolar":
        return "M13 21 L11 36 L13 36 L14 24 M19 21 L21 36 L19 36 L18 24";
      case "canine":
        return "M15 22 L14 40 L16 41 L18 40 L17 22";
      default:
        return "M15 22 L14.5 38 L16 39 L17.5 38 L17 22";
    }
  } else {
    switch (type) {
      case "molar":
        return "M10 15 L7 4 L9 4 L12 12 M16 14 L16 2 M20 15 L25 4 L23 4 L20 12";
      case "premolar":
        return "M13 15 L11 4 L13 4 L14 12 M19 15 L21 4 L19 4 L18 12";
      case "canine":
        return "M15 14 L14 2 L16 1 L18 2 L17 14";
      default:
        return "M15 14 L14.5 4 L16 3 L17.5 4 L17 14";
    }
  }
}

function renderCrownDetail(type: string, upper: boolean, color: string) {
  const cy = upper ? 14 : 22;
  switch (type) {
    case "molar":
      return (
        <g opacity="0.4">
          <line x1="11" y1={cy - 3} x2="21" y2={cy - 3} stroke={color} strokeWidth="0.6" />
          <line x1="16" y1={cy - 6} x2="16" y2={cy + 3} stroke={color} strokeWidth="0.6" />
          <circle cx="12" cy={cy - 1} r="2" fill="none" stroke={color} strokeWidth="0.5" />
          <circle cx="20" cy={cy - 1} r="2" fill="none" stroke={color} strokeWidth="0.5" />
          <circle cx="16" cy={cy + 2} r="1.5" fill="none" stroke={color} strokeWidth="0.5" />
        </g>
      );
    case "premolar":
      return (
        <g opacity="0.4">
          <line x1="16" y1={cy - 5} x2="16" y2={cy + 2} stroke={color} strokeWidth="0.6" />
          <circle cx="13.5" cy={cy - 1} r="1.8" fill="none" stroke={color} strokeWidth="0.5" />
          <circle cx="18.5" cy={cy - 1} r="1.8" fill="none" stroke={color} strokeWidth="0.5" />
        </g>
      );
    case "canine":
      return (
        <g opacity="0.35">
          <path d={`M13 ${cy + 1} L16 ${cy - 4} L19 ${cy + 1}`} fill="none" stroke={color} strokeWidth="0.6" />
        </g>
      );
    default:
      return (
        <g opacity="0.3">
          <line x1="13" y1={cy - 2} x2="19" y2={cy - 2} stroke={color} strokeWidth="0.5" />
        </g>
      );
  }
}

function renderStatusOverlay(status: StatusDente, color: string, type: string, upper: boolean) {
  const cy = upper ? 14 : 22;
  switch (status) {
    case "restaurado":
      return <rect x="12" y={cy - 3} width="8" height="6" rx="1" fill={color} opacity="0.5" />;
    case "carie":
      return (
        <g>
          <circle cx="16" cy={cy} r="3.5" fill={color} opacity="0.5" />
          <circle cx="16" cy={cy} r="2" fill={color} opacity="0.3" />
        </g>
      );
    case "implante":
      return (
        <g>
          <line x1="16" y1={upper ? 6 : 30} x2="16" y2={upper ? 38 : 4} stroke={color} strokeWidth="2.5" opacity="0.6" />
          <line x1="12" y1={upper ? 28 : 14} x2="20" y2={upper ? 28 : 14} stroke={color} strokeWidth="1.2" />
          <line x1="13" y1={upper ? 32 : 10} x2="19" y2={upper ? 32 : 10} stroke={color} strokeWidth="1.2" />
          <line x1="14" y1={upper ? 36 : 6} x2="18" y2={upper ? 36 : 6} stroke={color} strokeWidth="1.2" />
        </g>
      );
    case "canal":
      return (
        <path
          d={`M16 ${upper ? 8 : 28} L16 ${upper ? 36 : 6}`}
          stroke={color}
          strokeWidth="2"
          strokeDasharray="2.5 1.5"
          opacity="0.6"
        />
      );
    case "protese":
      return (
        <rect
          x={type === "molar" ? 8 : 10}
          y={upper ? 6 : 15}
          width={type === "molar" ? 16 : 12}
          height={type === "molar" ? 16 : 14}
          rx="3"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray="2 2"
          opacity="0.7"
        />
      );
    case "fratura":
      return (
        <g opacity="0.7">
          <path d={`M10 ${cy - 5} L14 ${cy - 1} L11 ${cy + 1} L16 ${cy + 5}`} stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d={`M22 ${cy - 5} L18 ${cy - 1} L21 ${cy + 1} L16 ${cy + 5}`} stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </g>
      );
    case "selante":
      return <ellipse cx="16" cy={cy - 1} rx="3.5" ry="2.5" fill={color} opacity="0.45" />;
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

  const renderDente = (numero: number) => {
    const dente = denteMap.get(numero);
    const status = dente?.status ?? "saudavel";
    const config = statusDenteConfig[status];
    const isHovered = hoveredDente === numero;
    const isSelected = selectedDente === numero;

    return (
      <div
        key={numero}
        className="flex flex-col items-center gap-0.5 cursor-pointer group"
        onMouseEnter={() => setHoveredDente(numero)}
        onMouseLeave={() => setHoveredDente(null)}
        onClick={() => handleClick(numero)}
      >
        <span className={`text-[8px] font-bold transition-colors ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
          {numero}
        </span>
        <div
          className={`relative transition-all duration-200 ${
            isSelected
              ? "scale-[1.2] drop-shadow-lg"
              : isHovered
                ? "scale-110 drop-shadow-md"
                : ""
          }`}
        >
          <ToothSVG
            numero={numero}
            status={status}
            color={config.color}
            fillColor={status === "saudavel" ? "hsl(152,60%,42%,0.12)" : `${config.color}25`}
          />
        </div>
        {isHovered && (
          <span className="text-[7px] text-muted-foreground font-medium whitespace-nowrap">
            {config.label}
          </span>
        )}
      </div>
    );
  };

  const selectedInfo = selectedDente ? denteMap.get(selectedDente) : null;
  const selectedConfig = selectedInfo ? statusDenteConfig[selectedInfo.status] : null;

  return (
    <div className="space-y-5">
      {/* Legenda */}
      <div className="flex flex-wrap justify-center gap-3">
        {Object.entries(statusDenteConfig).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full border"
              style={{ backgroundColor: `${cfg.color}33`, borderColor: cfg.color }}
            />
            <span className="text-[10px] text-muted-foreground font-medium">
              {cfg.label}
            </span>
          </div>
        ))}
      </div>

      {/* Arcada Superior */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 text-center">
          Arcada Superior
        </p>
        <div className="flex justify-center gap-0.5 sm:gap-1">
          {arcadaSuperior.map(renderDente)}
        </div>
      </div>

      {/* Divisória */}
      <div className="flex items-center gap-3 px-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-medium">
          Direito ← → Esquerdo
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Arcada Inferior */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 text-center">
          Arcada Inferior
        </p>
        <div className="flex justify-center gap-0.5 sm:gap-1">
          {arcadaInferior.map(renderDente)}
        </div>
      </div>

      {/* Dente Selecionado Info */}
      {selectedDente && selectedInfo && selectedConfig && (
        <div className="bg-card rounded-xl border border-border/60 p-4 flex items-center gap-4 animate-fade-in shadow-sm">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${selectedConfig.color}18` }}
          >
            <ToothSVG
              numero={selectedDente}
              status={selectedInfo.status}
              color={selectedConfig.color}
              fillColor={`${selectedConfig.color}30`}
            />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground font-heading">
              Dente {selectedDente} — {nomesDentes[selectedDente]}
            </p>
            <p className="text-xs text-muted-foreground">
              Status:{" "}
              <span style={{ color: selectedConfig.color }} className="font-bold">
                {selectedConfig.label}
              </span>
            </p>
            {selectedInfo.observacao && (
              <p className="text-xs text-muted-foreground mt-1">
                {selectedInfo.observacao}
              </p>
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
      {/* Status selector */}
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
                selectedStatus === key
                  ? "ring-2 ring-offset-1 shadow-sm"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                borderColor: cfg.color,
                backgroundColor: selectedStatus === key ? `${cfg.color}22` : "transparent",
                color: cfg.color,
              }}
            >
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: cfg.color }}
              />
              {cfg.label}
            </button>
          ))}
        </div>
      </div>

      <OdontogramaChart
        dentes={dentes}
        onDenteClick={handleDenteClick}
        editable
      />
    </div>
  );
}
