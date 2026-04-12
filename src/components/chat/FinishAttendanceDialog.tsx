import { useState } from "react";
import {
  CheckCircle2, RotateCcw, MessageSquareOff, MessageSquare,
  Clock, FileText, Target,
} from "lucide-react";
import type { Lead } from "@/data/chatMockData";
import { consciousnessLevels, type ConsciousnessLevel } from "@/data/crmMockData";

export type FinishOutcome = "atendido" | "followup" | "orcamento" | "return_queue";

interface FinishAttendanceDialogProps {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  onFinish: (lead: Lead, outcome: FinishOutcome, options?: {
    farewellMessage?: string;
    consciousnessLevel?: ConsciousnessLevel;
  }) => void;
  onReturnToQueue: (lead: Lead) => void;
}

const FAREWELL_TEMPLATES = [
  "Obrigado pelo contato! Caso precise de algo mais, estamos à disposição. 😊",
  "Foi um prazer atendê-lo(a)! Desejamos saúde e um ótimo dia! 🦷✨",
  "Atendimento finalizado. Qualquer dúvida, entre em contato novamente. Até breve!",
];

export function FinishAttendanceDialog({ lead, open, onClose, onFinish, onReturnToQueue }: FinishAttendanceDialogProps) {
  const [mode, setMode] = useState<"choose" | "farewell" | "consciousness">("choose");
  const [farewellMsg, setFarewellMsg] = useState(FAREWELL_TEMPLATES[0]);
  const [selectedOutcome, setSelectedOutcome] = useState<FinishOutcome>("atendido");
  const [selectedLevel, setSelectedLevel] = useState<ConsciousnessLevel>("inconsciente");

  if (!open) return null;

  const handleSelectOutcome = (outcome: FinishOutcome) => {
    setSelectedOutcome(outcome);
    if (outcome === "return_queue") {
      onReturnToQueue(lead);
      resetState();
      return;
    }
    if (outcome === "atendido") {
      setMode("farewell");
    } else {
      // followup or orcamento — ask consciousness level first
      setMode("consciousness");
    }
  };

  const handleFinishWithFarewell = () => {
    onFinish(lead, "atendido", { farewellMessage: farewellMsg.trim() || undefined });
    resetState();
  };

  const handleFinishWithoutFarewell = () => {
    onFinish(lead, "atendido");
    resetState();
  };

  const handleConfirmWithLevel = () => {
    onFinish(lead, selectedOutcome, { consciousnessLevel: selectedLevel });
    resetState();
  };

  const resetState = () => {
    setMode("choose");
    setFarewellMsg(FAREWELL_TEMPLATES[0]);
    setSelectedOutcome("atendido");
    setSelectedLevel("inconsciente");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-[460px] max-w-[95vw] animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}>

        {mode === "choose" && (
          <>
            <div className="px-6 pt-6 pb-4">
              <h3 className="text-base font-semibold text-foreground">Finalizar Atendimento</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Qual o resultado do atendimento de <span className="font-medium text-foreground">{lead.name}</span>?
              </p>
            </div>

            <div className="px-4 pb-4 space-y-2">
              <OutcomeButton
                icon={CheckCircle2}
                iconBg="bg-success/10"
                iconColor="text-success"
                title="Cliente Atendido"
                description="Dúvidas resolvidas — remove do funil de vendas"
                onClick={() => handleSelectOutcome("atendido")}
              />
              <OutcomeButton
                icon={Clock}
                iconBg="bg-warning/10"
                iconColor="text-warning"
                title="Mover para Follow-up"
                description="Cliente não respondeu ou precisa de acompanhamento"
                onClick={() => handleSelectOutcome("followup")}
              />
              <OutcomeButton
                icon={FileText}
                iconBg="bg-chart-3/10"
                iconColor="text-chart-3"
                title="Encaminhar para Orçamento"
                description="Cliente interessado — criar orçamento no módulo"
                onClick={() => handleSelectOutcome("orcamento")}
              />
              <OutcomeButton
                icon={RotateCcw}
                iconBg="bg-muted"
                iconColor="text-muted-foreground"
                title="Retornar à Fila"
                description="Devolve para a fila de espera"
                onClick={() => handleSelectOutcome("return_queue")}
              />
            </div>

            <div className="px-6 py-3 border-t border-border/50 flex justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Cancelar
              </button>
            </div>
          </>
        )}

        {mode === "farewell" && (
          <>
            <div className="px-6 pt-6 pb-3">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                Mensagem de Despedida
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Personalize ou use um modelo pronto</p>
            </div>

            <div className="px-4 pb-3 space-y-2">
              {FAREWELL_TEMPLATES.map((tpl, i) => (
                <button key={i} onClick={() => setFarewellMsg(tpl)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-all ${
                    farewellMsg === tpl
                      ? "border-primary/50 bg-primary/5 text-foreground"
                      : "border-border/30 text-muted-foreground hover:border-border hover:bg-muted/30"
                  }`}>{tpl}</button>
              ))}
            </div>

            <div className="px-4 pb-4">
              <textarea value={farewellMsg} onChange={(e) => setFarewellMsg(e.target.value.slice(0, 500))}
                className="w-full h-20 px-3 py-2.5 rounded-xl bg-muted border-0 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Escreva sua mensagem de despedida..." />
              <p className="text-[10px] text-muted-foreground text-right mt-1">{farewellMsg.length}/500</p>
            </div>

            <div className="px-6 py-3 border-t border-border/50 flex items-center justify-between">
              <button onClick={() => setMode("choose")} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Voltar
              </button>
              <div className="flex items-center gap-2">
                <button onClick={handleFinishWithoutFarewell}
                  className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  Sem despedida
                </button>
                <button onClick={handleFinishWithFarewell}
                  className="px-5 py-2 rounded-lg bg-success text-white text-sm font-medium hover:bg-success/90 transition-colors">
                  Enviar e Finalizar
                </button>
              </div>
            </div>
          </>
        )}

        {mode === "consciousness" && (
          <>
            <div className="px-6 pt-6 pb-3">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Nível de Consciência do Lead
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Em que etapa de decisão o cliente está?
              </p>
            </div>

            <div className="px-4 pb-4 space-y-1.5">
              {consciousnessLevels.map((level) => (
                <button key={level.id} onClick={() => setSelectedLevel(level.id)}
                  className={`w-full text-left px-3 py-3 rounded-xl border transition-all flex items-center gap-3 ${
                    selectedLevel === level.id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border/30 hover:border-border hover:bg-muted/30"
                  }`}>
                  <span className="text-lg">{level.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{level.label}</p>
                    <p className="text-[11px] text-muted-foreground">{level.description}</p>
                  </div>
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: level.color }} />
                </button>
              ))}
            </div>

            <div className="px-6 py-3 border-t border-border/50 flex items-center justify-between">
              <button onClick={() => setMode("choose")} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Voltar
              </button>
              <button onClick={handleConfirmWithLevel}
                className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                {selectedOutcome === "followup" ? "Mover para Follow-up" : "Encaminhar para Orçamento"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OutcomeButton({ icon: Icon, iconBg, iconColor, title, description, onClick }: {
  icon: typeof CheckCircle2; iconBg: string; iconColor: string; title: string; description: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border/50 hover:bg-muted/50 hover:border-border transition-all text-left group">
      <div className={`h-10 w-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
