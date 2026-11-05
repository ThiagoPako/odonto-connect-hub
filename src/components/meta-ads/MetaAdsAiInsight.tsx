import { Bot } from "lucide-react";

export function MetaAdsAiInsight({ insight }: { insight: string }) {
  return (
    <div className="bg-primary/5 rounded-xl border border-primary/20 p-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-xs font-semibold text-primary mb-1">Análise gerada por IA (OpenAI)</p>
          <p className="text-[11px] text-muted-foreground mb-1">Feita a partir dos números das campanhas. Confira os dados antes de decidir.</p>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{insight}</p>
        </div>
      </div>
    </div>
  );
}
