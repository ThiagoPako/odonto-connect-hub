import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
}

/**
 * Indicador único. Superfície chapada (sem degradê nem brilho), rótulo em
 * caixa normal para caber em colunas estreitas no celular, número em
 * algarismos tabulares. Ver DESIGN.md › Componentes › KpiCard.
 */
export function KpiCard({ title, value, change, changeType = "neutral", icon: Icon }: KpiCardProps) {
  const changeColor =
    changeType === "positive"
      ? "text-success"
      : changeType === "negative"
        ? "text-destructive"
        : "text-muted-foreground";

  const ChangeIcon =
    changeType === "positive"
      ? ArrowUpRight
      : changeType === "negative"
        ? ArrowDownRight
        : Minus;

  return (
    <div className="bg-card rounded-lg border border-border p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start gap-2">
        <p className="flex-1 min-w-0 text-[13px] font-medium leading-snug text-muted-foreground break-words">
          {title}
        </p>
        <Icon className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-card-foreground font-heading tabular-nums break-words">
        {value}
      </p>
      {change && (
        <div className={`flex items-start gap-1 mt-1.5 ${changeColor}`}>
          <ChangeIcon className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span className="text-xs font-medium leading-snug">{change}</span>
        </div>
      )}
    </div>
  );
}
