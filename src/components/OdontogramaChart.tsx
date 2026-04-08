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
        className="flex flex-col items-center gap-1 cursor-pointer group"
        onMouseEnter={() => setHoveredDente(numero)}
        onMouseLeave={() => setHoveredDente(null)}
        onClick={() => handleClick(numero)}
      >
        <span className="text-[9px] text-muted-foreground font-medium">
          {numero}
        </span>
        <div
          className={`relative w-8 h-10 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
            isSelected
              ? "ring-2 ring-primary ring-offset-1 scale-110"
              : isHovered
                ? "scale-105 shadow-md"
                : ""
          }`}
          style={{
            borderColor: config.color,
            backgroundColor: `${config.color}22`,
          }}
        >
          {/* Tooth shape */}
          <svg viewBox="0 0 24 32" className="w-5 h-7" fill="none">
            {status === "ausente" ? (
              <>
                <line x1="4" y1="4" x2="20" y2="28" stroke={config.color} strokeWidth="2" strokeLinecap="round" />
                <line x1="20" y1="4" x2="4" y2="28" stroke={config.color} strokeWidth="2" strokeLinecap="round" />
              </>
            ) : (
              <>
                <path
                  d="M6 4C6 4 4 8 4 14C4 20 6 26 8 28C10 30 14 30 16 28C18 26 20 20 20 14C20 8 18 4 18 4C16 2 8 2 6 4Z"
                  fill={`${config.color}44`}
                  stroke={config.color}
                  strokeWidth="1.5"
                />
                {status === "restaurado" && (
                  <rect x="8" y="10" width="8" height="8" rx="1" fill={config.color} opacity="0.6" />
                )}
                {status === "carie" && (
                  <circle cx="12" cy="14" r="4" fill={config.color} opacity="0.7" />
                )}
                {status === "implante" && (
                  <>
                    <line x1="12" y1="6" x2="12" y2="26" stroke={config.color} strokeWidth="2" />
                    <line x1="8" y1="10" x2="16" y2="10" stroke={config.color} strokeWidth="1.5" />
                    <line x1="9" y1="14" x2="15" y2="14" stroke={config.color} strokeWidth="1.5" />
                    <line x1="10" y1="18" x2="14" y2="18" stroke={config.color} strokeWidth="1.5" />
                  </>
                )}
                {status === "canal" && (
                  <path d="M12 6 L12 26" stroke={config.color} strokeWidth="2" strokeDasharray="3 2" />
                )}
                {status === "protese" && (
                  <rect x="6" y="8" width="12" height="16" rx="3" fill="none" stroke={config.color} strokeWidth="1.5" strokeDasharray="3 2" />
                )}
                {status === "fratura" && (
                  <path d="M6 8 L12 16 L6 24 M18 8 L12 16 L18 24" stroke={config.color} strokeWidth="1.5" fill="none" />
                )}
                {status === "selante" && (
                  <rect x="8" y="8" width="8" height="6" rx="2" fill={config.color} opacity="0.5" />
                )}
              </>
            )}
          </svg>
        </div>
      </div>
    );
  };

  const selectedInfo = selectedDente ? denteMap.get(selectedDente) : null;
  const selectedConfig = selectedInfo ? statusDenteConfig[selectedInfo.status] : null;

  return (
    <div className="space-y-6">
      {/* Legenda */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(statusDenteConfig).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: cfg.color }}
            />
            <span className="text-[10px] text-muted-foreground font-medium">
              {cfg.label}
            </span>
          </div>
        ))}
      </div>

      {/* Arcada Superior */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3 text-center">
          Arcada Superior
        </p>
        <div className="flex justify-center gap-1">
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
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3 text-center">
          Arcada Inferior
        </p>
        <div className="flex justify-center gap-1">
          {arcadaInferior.map(renderDente)}
        </div>
      </div>

      {/* Dente Selecionado Info */}
      {selectedDente && selectedInfo && selectedConfig && (
        <div className="bg-muted/30 rounded-xl p-4 flex items-center gap-4 animate-fade-in">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ backgroundColor: `${selectedConfig.color}22`, color: selectedConfig.color }}
          >
            {selectedDente}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Dente {selectedDente} — {nomesDentes[selectedDente]}
            </p>
            <p className="text-xs text-muted-foreground">
              Status:{" "}
              <span style={{ color: selectedConfig.color }} className="font-semibold">
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
                ringColor: cfg.color,
              }}
            >
              <div
                className="w-2.5 h-2.5 rounded-sm"
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
