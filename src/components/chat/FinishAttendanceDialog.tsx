import { useState } from "react";
import { CheckCircle2, RotateCcw, MessageSquareOff, MessageSquare } from "lucide-react";
import type { Lead } from "@/data/chatMockData";

interface FinishAttendanceDialogProps {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  onFinish: (lead: Lead, farewellMessage?: string) => void;
  onReturnToQueue: (lead: Lead) => void;
}

const FAREWELL_TEMPLATES = [
  "Obrigado pelo contato! Caso precise de algo mais, estamos à disposição. 😊",
  "Foi um prazer atendê-lo(a)! Desejamos saúde e um ótimo dia! 🦷✨",
  "Atendimento finalizado. Qualquer dúvida, entre em contato novamente. Até breve!",
];

export function FinishAttendanceDialog({ lead, open, onClose, onFinish, onReturnToQueue }: FinishAttendanceDialogProps) {
  const [mode, setMode] = useState<"choose" | "farewell">("choose");
  const [farewellMsg, setFarewellMsg] = useState(FAREWELL_TEMPLATES[0]);

  if (!open) return null;

  const handleFinishWithMessage = () => {
    onFinish(lead, farewellMsg.trim() || undefined);
    setMode("choose");
    setFarewellMsg(FAREWELL_TEMPLATES[0]);
  };

  const handleFinishWithout = () => {
    onFinish(lead);
    setMode("choose");
  };

  const handleReturn = () => {
    onReturnToQueue(lead);
    setMode("choose");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-[420px] max-w-[95vw] animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "choose" ? (
          <>
            <div className="px-6 pt-6 pb-4">
              <h3 className="text-base font-semibold text-foreground">Finalizar Atendimento</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Escolha como deseja encerrar o atendimento de <span className="font-medium text-foreground">{lead.name}</span>
              </p>
            </div>

            <div className="px-4 pb-4 space-y-2">
              <button
                onClick={() => setMode("farewell")}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border/50 hover:bg-primary/5 hover:border-primary/30 transition-all text-left group"
              >
                <div className="h-10 w-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0 group-hover:bg-success/20 transition-colors">
                  <MessageSquare className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Finalizar com despedida</p>
                  <p className="text-[11px] text-muted-foreground">Envia mensagem de despedida antes de encerrar</p>
                </div>
              </button>

              <button
                onClick={handleFinishWithout}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border/50 hover:bg-muted/50 hover:border-border transition-all text-left group"
              >
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center shrink-0 group-hover:bg-muted/80 transition-colors">
                  <MessageSquareOff className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Finalizar sem despedida</p>
                  <p className="text-[11px] text-muted-foreground">Encerra o atendimento silenciosamente</p>
                </div>
              </button>

              <button
                onClick={handleReturn}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border/50 hover:bg-warning/5 hover:border-warning/30 transition-all text-left group"
              >
                <div className="h-10 w-10 rounded-xl bg-warning/10 flex items-center justify-center shrink-0 group-hover:bg-warning/20 transition-colors">
                  <RotateCcw className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Retornar à fila</p>
                  <p className="text-[11px] text-muted-foreground">Devolve o paciente para a fila de espera</p>
                </div>
              </button>
            </div>

            <div className="px-6 py-3 border-t border-border/50 flex justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Cancelar
              </button>
            </div>
          </>
        ) : (
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
                <button
                  key={i}
                  onClick={() => setFarewellMsg(tpl)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-all ${
                    farewellMsg === tpl
                      ? "border-primary/50 bg-primary/5 text-foreground"
                      : "border-border/30 text-muted-foreground hover:border-border hover:bg-muted/30"
                  }`}
                >
                  {tpl}
                </button>
              ))}
            </div>

            <div className="px-4 pb-4">
              <textarea
                value={farewellMsg}
                onChange={(e) => setFarewellMsg(e.target.value.slice(0, 500))}
                className="w-full h-20 px-3 py-2.5 rounded-xl bg-muted border-0 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Escreva sua mensagem de despedida..."
              />
              <p className="text-[10px] text-muted-foreground text-right mt-1">{farewellMsg.length}/500</p>
            </div>

            <div className="px-6 py-3 border-t border-border/50 flex items-center justify-between">
              <button onClick={() => setMode("choose")} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Voltar
              </button>
              <button
                onClick={handleFinishWithMessage}
                className="px-5 py-2 rounded-lg bg-success text-white text-sm font-medium hover:bg-success/90 transition-colors"
              >
                Enviar e Finalizar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
