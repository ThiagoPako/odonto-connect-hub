import { useState } from "react";
import {
  CheckCircle2, RotateCcw,
  Clock, FileText, Target, Check, ChevronRight, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-card w-full max-w-[calc(100vw-1rem)] sm:max-w-[460px] max-h-[90dvh] p-0 gap-0 rounded-2xl sm:rounded-2xl overflow-hidden flex flex-col [&>button:last-child]:hidden">

        {mode === "choose" && (
          <>
            <div className="min-h-0 overflow-y-auto">
              <div className="px-6 pt-6 pb-4">
                <DialogTitle className="text-lg font-semibold text-foreground">Finalizar atendimento</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-1">
                  Qual o resultado do atendimento de <span className="font-medium text-foreground">{lead.name}</span>?
                </DialogDescription>
              </div>

              <div className="px-4 pb-4 space-y-2">
                <OutcomeButton
                  icon={CheckCircle2}
                  iconBg="bg-success/10"
                  iconColor="text-success"
                  title="Paciente atendido"
                  description="Dúvidas resolvidas — remove do funil de vendas"
                  hasNextStep
                  onClick={() => handleSelectOutcome("atendido")}
                />
                <OutcomeButton
                  icon={Clock}
                  iconBg="bg-warning/10"
                  iconColor="text-warning-text"
                  title="Mover para follow-up"
                  description="Paciente não respondeu ou precisa de acompanhamento"
                  hasNextStep
                  onClick={() => handleSelectOutcome("followup")}
                />
                <OutcomeButton
                  icon={FileText}
                  iconBg="bg-chart-3/10"
                  iconColor="text-chart-3"
                  title="Encaminhar para orçamento"
                  description="Paciente interessado — criar orçamento no módulo"
                  hasNextStep
                  onClick={() => handleSelectOutcome("orcamento")}
                />
                <hr className="border-border my-2" />
                <OutcomeButton
                  icon={RotateCcw}
                  iconBg="bg-muted"
                  iconColor="text-muted-foreground"
                  title="Devolver à fila"
                  description="Sai dos seus atendimentos e volta para a fila de espera"
                  onClick={() => handleSelectOutcome("return_queue")}
                />
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 border-t border-border flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={onClose} className="h-11 md:h-9 w-full sm:w-auto">
                Cancelar
              </Button>
            </div>
          </>
        )}

        {mode === "farewell" && (
          <>
            <div className="min-h-0 overflow-y-auto">
              <div className="px-6 pt-6 pb-3">
                <DialogTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
                  Mensagem de despedida
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-1">Personalize ou use um modelo pronto</DialogDescription>
              </div>

              <div className="px-4 pb-3 space-y-2">
                {FAREWELL_TEMPLATES.map((tpl, i) => (
                  <button key={i} type="button" onClick={() => setFarewellMsg(tpl)}
                    aria-pressed={farewellMsg === tpl}
                    className={`w-full min-h-11 text-left px-3 py-2.5 rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      farewellMsg === tpl
                        ? "border-primary/50 bg-primary/5 text-foreground font-medium"
                        : "border-border text-foreground hover:bg-muted"
                    }`}>{tpl}</button>
                ))}
              </div>

              <div className="px-4 pb-4">
                <label htmlFor="farewell-msg" className="block text-sm font-medium text-foreground mb-1.5">
                  Mensagem que o paciente vai receber
                </label>
                <textarea id="farewell-msg" aria-describedby="farewell-count"
                  value={farewellMsg} onChange={(e) => setFarewellMsg(e.target.value.slice(0, 500))}
                  className="w-full min-h-24 px-3 py-2.5 rounded-lg bg-muted border-0 text-base sm:text-sm text-foreground placeholder:text-muted-foreground resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Escreva sua mensagem de despedida..." />
                <p id="farewell-count" className="text-xs text-muted-foreground text-right mt-1 tabular-nums">{farewellMsg.length}/500</p>
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 border-t border-border flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setMode("choose")} className="h-11 md:h-9 w-full sm:w-auto">
                Voltar
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                <Button type="button" variant="ghost" onClick={handleFinishWithoutFarewell} className="h-11 md:h-9 w-full sm:w-auto">
                  Finalizar sem mensagem
                </Button>
                <Button type="button" onClick={handleFinishWithFarewell} className="h-11 md:h-9 w-full sm:w-auto">
                  <Send className="size-4" aria-hidden="true" />
                  Enviar e finalizar
                </Button>
              </div>
            </div>
          </>
        )}

        {mode === "consciousness" && (
          <>
            <div className="min-h-0 overflow-y-auto">
              <div className="px-6 pt-6 pb-3">
                <DialogTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Target className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  Etapa do paciente
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-1">
                  Em que etapa de decisão o paciente está?
                </DialogDescription>
              </div>

              <div role="group" aria-label="Etapa do paciente" className="px-4 pb-4 space-y-2">
                {consciousnessLevels.map((level) => {
                  const selected = selectedLevel === level.id;
                  return (
                    <button key={level.id} type="button" onClick={() => setSelectedLevel(level.id)}
                      aria-pressed={selected}
                      className={`w-full min-h-14 text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted"
                      }`}>
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: level.color }} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm text-foreground ${selected ? "font-semibold" : "font-medium"}`}>{level.label}</p>
                        <p className="text-xs text-muted-foreground">{level.description}</p>
                      </div>
                      {selected && <Check className="size-4 text-primary shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 border-t border-border flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setMode("choose")} className="h-11 md:h-9 w-full sm:w-auto">
                Voltar
              </Button>
              <Button type="button" onClick={handleConfirmWithLevel} className="h-11 md:h-9 w-full sm:w-auto">
                {selectedOutcome === "followup" ? "Mover para follow-up" : "Encaminhar para orçamento"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeButton({ icon: Icon, iconBg, iconColor, title, description, onClick, hasNextStep = false }: {
  icon: typeof CheckCircle2; iconBg: string; iconColor: string; title: string; description: string; onClick: () => void; hasNextStep?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className="w-full min-h-14 flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-muted active:translate-y-px transition-[color,background-color,border-color,transform] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      <div className={`h-10 w-10 rounded-md ${iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`h-5 w-5 ${iconColor}`} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {hasNextStep && <ChevronRight className="size-4 text-muted-foreground ml-auto shrink-0" aria-hidden="true" />}
    </button>
  );
}
