import { useState } from "react";
import { Star, Send } from "lucide-react";

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
    return "text-muted-foreground/30";
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-[420px] max-w-[95vw] animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3 text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <Star className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            Pesquisa de Satisfação
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Enviar pesquisa NPS para{" "}
            <span className="font-medium text-foreground">{leadName}</span> via
            WhatsApp
          </p>
        </div>

        {/* Stars */}
        <div className="px-6 py-4 flex flex-col items-center gap-2">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                onMouseEnter={() => setHoveredStar(i)}
                onMouseLeave={() => setHoveredStar(0)}
                onClick={() => setRating(i)}
                className="transition-transform hover:scale-125 active:scale-95 p-1"
              >
                <Star
                  className={`h-9 w-9 transition-colors duration-150 ${starColor(i)}`}
                />
              </button>
            ))}
          </div>
          {activeRating > 0 && (
            <span className="text-xs font-medium text-muted-foreground animate-fade-in">
              {RATING_LABELS[activeRating - 1]}
            </span>
          )}
        </div>

        {/* Comment */}
        <div className="px-6 pb-4">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 300))}
            className="w-full h-16 px-3 py-2.5 rounded-xl bg-muted border-0 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Mensagem personalizada (opcional)..."
          />
          <p className="text-[10px] text-muted-foreground text-right mt-1">
            {comment.length}/300
          </p>
        </div>

        {/* Preview */}
        {rating > 0 && (
          <div className="px-6 pb-4 animate-fade-in">
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide font-medium">
              Prévia da mensagem
            </p>
            <div className="bg-muted/50 border border-border/50 rounded-xl px-3 py-2 text-xs text-muted-foreground leading-relaxed">
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
        <div className="px-6 py-3 border-t border-border/50 flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Pular
          </button>
          <button
            onClick={handleSend}
            disabled={rating === 0}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            Enviar Pesquisa
          </button>
        </div>
      </div>
    </div>
  );
}
