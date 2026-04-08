import { createFileRoute, Link } from "@tanstack/react-router";
import { getAlergias, getCondicoesCriticas } from "@/data/registroCentral";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, CheckCircle2, Clock, Pause, PlayCircle, CalendarDays,
  ChevronRight, AlertCircle, CircleDot, FileText, Plus, ExternalLink, AlertTriangle, HeartPulse,
} from "lucide-react";
import { useState } from "react";
import {
  mockTreatments, mockOdontogram, toothStatusConfig,
  upperRight, upperLeft, lowerRight, lowerLeft,
  type Treatment, type TreatmentStep, type ToothData, type ToothStatus,
} from "@/data/tratamentoMockData";

export const Route = createFileRoute("/tratamentos")({
  component: TratamentosPage,
});

const treatmentStatusCfg: Record<Treatment["status"], { label: string; color: string; icon: React.ElementType }> = {
  planejado: { label: "Planejado", color: "bg-chart-1/15 text-chart-1", icon: FileText },
  em_andamento: { label: "Em Andamento", color: "bg-primary/15 text-primary", icon: PlayCircle },
  pausado: { label: "Pausado", color: "bg-warning/15 text-warning", icon: Pause },
  finalizado: { label: "Finalizado", color: "bg-muted text-muted-foreground", icon: CheckCircle2 },
};

const stepStatusCfg: Record<TreatmentStep["status"], { label: string; color: string }> = {
  pendente: { label: "Pendente", color: "bg-muted text-muted-foreground" },
  agendado: { label: "Agendado", color: "bg-chart-1/15 text-chart-1" },
  realizado: { label: "Realizado", color: "bg-success/15 text-success" },
  cancelado: { label: "Cancelado", color: "bg-destructive/15 text-destructive" },
};

function TratamentosPage() {
  const [selected, setSelected] = useState<Treatment | null>(mockTreatments[0]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTooth, setSelectedTooth] = useState<ToothData | null>(null);

  const filtered = mockTreatments.filter(
    (t) => !searchTerm || t.patientName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const completedSteps = selected ? selected.steps.filter((s) => s.status === "realizado").length : 0;
  const totalSteps = selected ? selected.steps.length : 0;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Gestão de Tratamentos" />
      <main className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Treatment list */}
          <div className="lg:col-span-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar tratamento..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" /> Novo Tratamento
            </button>
            <div className="space-y-1.5">
              {filtered.map((t) => {
                const cfg = treatmentStatusCfg[t.status];
                const done = t.steps.filter((s) => s.status === "realizado").length;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setSelected(t); setSelectedTooth(null); }}
                    className={`w-full text-left px-3 py-3 rounded-xl border transition-all ${
                      selected?.id === t.id ? "bg-primary/5 border-primary/30" : "border-transparent hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`h-7 w-7 rounded-full ${t.avatarColor} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
                        {t.patientInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{t.patientName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{t.professional}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-[10px] text-muted-foreground">{done}/{t.steps.length} etapas</span>
                    </div>
                    <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(done / t.steps.length) * 100}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail area */}
          <div className="lg:col-span-9 space-y-4">
            {selected ? (
              <>
                {/* Header */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-11 w-11 rounded-full ${selected.avatarColor} flex items-center justify-center text-sm font-bold text-white`}>
                        {selected.patientInitials}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-foreground">{selected.patientName}</h3>
                        <p className="text-xs text-muted-foreground">{selected.professional} · {selected.startDate} → {selected.estimatedEnd}</p>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${treatmentStatusCfg[selected.status].color}`}>
                      {treatmentStatusCfg[selected.status].label}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <StatBox label="Progresso" value={`${progress.toFixed(0)}%`} />
                    <StatBox label="Etapas" value={`${completedSteps}/${totalSteps}`} />
                    <StatBox label="Valor Total" value={`R$ ${(selected.totalValue / 1000).toFixed(1)}k`} />
                    <StatBox label="Pago" value={`R$ ${(selected.paidValue / 1000).toFixed(1)}k`} />
                  </div>
                  <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {/* Steps timeline */}
                  <div className="bg-card rounded-xl border border-border p-5">
                    <h4 className="text-sm font-semibold text-card-foreground mb-4">Etapas do Tratamento</h4>
                    <div className="space-y-0">
                      {selected.steps.map((step, i) => {
                        const sCfg = stepStatusCfg[step.status];
                        return (
                          <div key={step.id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                step.status === "realizado" ? "bg-success text-white" :
                                step.status === "agendado" ? "bg-chart-1/20 text-chart-1" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                {step.status === "realizado" ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.order}
                              </div>
                              {i < selected.steps.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
                            </div>
                            <div className={`flex-1 ${i < selected.steps.length - 1 ? "pb-4" : ""}`}>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs font-medium text-foreground">{step.procedure}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${sCfg.color}`}>{sCfg.label}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                {step.tooth && <span>Dente: {step.tooth}</span>}
                                {step.completedDate && <span className="flex items-center gap-0.5"><CheckCircle2 className="h-2.5 w-2.5 text-success" /> {step.completedDate}</span>}
                                {step.scheduledDate && step.status === "agendado" && (
                                  <span className="flex items-center gap-0.5"><CalendarDays className="h-2.5 w-2.5 text-chart-1" /> {step.scheduledDate}</span>
                                )}
                              </div>
                              {step.notes && <p className="text-[10px] text-muted-foreground/70 mt-1 italic">{step.notes}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Odontogram */}
                  <div className="bg-card rounded-xl border border-border p-5">
                    <h4 className="text-sm font-semibold text-card-foreground mb-4">Odontograma</h4>
                    <Odontogram
                      teeth={mockOdontogram}
                      selectedTooth={selectedTooth}
                      onSelectTooth={setSelectedTooth}
                    />
                    {selectedTooth && (
                      <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-foreground">Dente {selectedTooth.number}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${toothStatusConfig[selectedTooth.status].color}`}>
                            {toothStatusConfig[selectedTooth.status].label}
                          </span>
                        </div>
                        {selectedTooth.notes && <p className="text-[10px] text-muted-foreground">{selectedTooth.notes}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um tratamento</h3>
                <p className="text-xs text-muted-foreground">Clique em um tratamento ao lado para ver detalhes.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function Odontogram({
  teeth, selectedTooth, onSelectTooth,
}: {
  teeth: ToothData[];
  selectedTooth: ToothData | null;
  onSelectTooth: (t: ToothData) => void;
}) {
  const getToothData = (num: number): ToothData =>
    teeth.find((t) => t.number === num) || { number: num, status: "saudavel" as ToothStatus };

  const renderRow = (numbers: number[], label: string) => (
    <div className="flex items-center gap-0.5">
      {numbers.map((num) => {
        const td = getToothData(num);
        const cfg = toothStatusConfig[td.status];
        const isSelected = selectedTooth?.number === num;
        return (
          <button
            key={num}
            onClick={() => onSelectTooth(td)}
            className={`flex flex-col items-center gap-0.5 p-1 rounded-md transition-all hover:bg-muted ${
              isSelected ? "ring-1 ring-primary bg-primary/5" : ""
            }`}
            title={`${num} — ${cfg.label}`}
          >
            <div className={`h-5 w-5 rounded-sm border flex items-center justify-center text-[8px] font-bold ${
              td.status === "ausente" ? "border-dashed border-muted-foreground/30 bg-transparent text-muted-foreground/30" :
              td.status === "saudavel" ? "border-success/40 bg-success/10 text-success" :
              `border-current ${cfg.color} bg-current/10`
            }`}>
              {td.status === "ausente" ? "✕" :
               td.status === "implante" ? "I" :
               td.status === "endodontia" ? "E" :
               td.status === "protese" ? "P" :
               td.status === "fratura" ? "F" :
               td.status === "carie" ? "C" :
               td.status === "restaurado" ? "R" : ""}
            </div>
            <span className="text-[8px] text-muted-foreground leading-none">{num}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(toothStatusConfig).map(([key, cfg]) => (
          <span key={key} className={`flex items-center gap-1 text-[9px] ${cfg.color}`}>
            <CircleDot className="h-2.5 w-2.5" /> {cfg.label}
          </span>
        ))}
      </div>

      {/* Upper jaw */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[9px] text-muted-foreground font-medium mb-1">SUPERIOR</span>
        <div className="flex items-center gap-2">
          {renderRow(upperRight, "1Q")}
          <div className="w-px h-8 bg-border" />
          {renderRow(upperLeft, "2Q")}
        </div>
      </div>

      <div className="h-px bg-border w-full" />

      {/* Lower jaw */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          {renderRow(lowerRight, "4Q")}
          <div className="w-px h-8 bg-border" />
          {renderRow(lowerLeft, "3Q")}
        </div>
        <span className="text-[9px] text-muted-foreground font-medium mt-1">INFERIOR</span>
      </div>
    </div>
  );
}
