import { useState } from "react";
import { Star, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface SatisfactionSurveyDialogProps {
  leadName: string;
  open: boolean;
  onClose: () => void;
  onSend: (rating: number, comment: string) => void;
  onSkip: () => void;
}

const RATING_LABELS = ["Péssimo", "Ruim", "Regular", "Bom", "Excelente"];

export function SatisfactionSurveyDialog({
  leadName,
  open,
  onClose,
  onSend,
  onSkip,
}: SatisfactionSurveyDialogProps) {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [comment, setComment] = useState("");

  if (!open) return null;

  const activeRating = hoveredStar || rating;

  const handleSend = () => {
    if (rating === 0) return;
    onSend(rating, comment.trim());
    setRating(0);
    setComment("");
  };

  const handleSkip = () => {
    onSkip();
    setRating(0);
    setComment("");
  };

  const starColor = (i: number) => {
    if (i <= activeRating) {
      if (activeRating <= 2) return "text-destructive fill-destructive";
      if (activeRating === 3) return "text-warning fill-warning";
      return "text-success fill-success";
    }
    return "text-muted-foreground";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-card w-full max-w-[calc(100vw-1rem)] sm:max-w-[420px] max-h-[90dvh] overflow-y-auto p-0 gap-0 rounded-2xl sm:rounded-2xl block [&>button:last-child]:hidden">
        <div className="px-6 pt-6 pb-3 text-center">
          <div className="mx-auto h-12 w-12 rounded-lg bg-muted flex items-center justify-center mb-3">
            <Star className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <DialogTitle className="text-lg font-semibold text-foreground">
            Pesquisa de satisfação
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            Enviar pesquisa NPS para{" "}
            <span className="font-medium text-foreground">{leadName}</span> via
            WhatsApp
          </DialogDescription>
        </div>

        {/* Stars */}
        <div className="px-6 py-4 flex flex-col items-center gap-2">
          <div role="group" aria-label="Nota de 1 a 5" className="flex gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                aria-pressed={rating === i}
                aria-label={`Nota ${i} de 5: ${RATING_LABELS[i - 1]}`}
                onMouseEnter={() => setHoveredStar(i)}
                onMouseLeave={() => setHoveredStar(0)}
                onClick={() => setRating(i)}
                className="size-11 inline-flex items-center justify-center rounded-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Star
                  className={`size-8 transition-colors duration-150 ${starColor(i)}`}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
          {activeRating > 0 ? (
            <span className="text-sm font-medium text-foreground animate-fade-in" aria-hidden="true">
              {RATING_LABELS[activeRating - 1]}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground" aria-hidden="true">Escolha uma nota</span>
          )}
          <span className="sr-only" aria-live="polite">
            {rating > 0 ? `Nota escolhida: ${rating} de 5, ${RATING_LABELS[rating - 1]}` : ""}
          </span>
        </div>

        {/* Comment */}
        <div className="px-6 pb-4">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 300))}
            aria-label="Mensagem personalizada (opcional)"
            className="w-full h-16 px-3 py-2.5 rounded-lg bg-muted border-0 text-base sm:text-sm text-foreground placeholder:text-muted-foreground resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Mensagem personalizada (opcional)..."
          />
          <p className="text-xs text-muted-foreground text-right mt-1 tabular-nums">
            {comment.length}/300
          </p>
        </div>

        {/* Preview */}
        {rating > 0 && (
          <div className="px-6 pb-4 animate-fade-in">
            <p className="text-xs text-muted-foreground mb-1 font-medium">
              Prévia da mensagem
            </p>
            <div className="bg-muted/50 border border-border/50 rounded-lg px-3 py-2 text-xs text-muted-foreground leading-relaxed">
              Olá {leadName}! Como foi seu atendimento? Avalie de 1 a 5
              estrelas: {"⭐".repeat(rating)} ({RATING_LABELS[activeRating - 1]}
              )
              {comment && (
                <>
                  <br />
                  {comment}
                </>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 sm:px-6 py-3 border-t border-border flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleSkip}
            className="h-11 md:h-9 w-full sm:w-auto"
          >
            Não enviar
          </Button>
          <Button
            type="button"
            onClick={handleSend}
            disabled={rating === 0}
            className="h-11 md:h-9 w-full sm:w-auto"
          >
            <Send className="size-4" aria-hidden="true" />
            Enviar pesquisa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
