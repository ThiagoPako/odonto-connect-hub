import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight, Minus, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface KpiCardProps {
  title: string;
  value: string;
  change?: string;
  /**
   * positive = ganho · negative = perda/erro real · warning = pede atenção
   * (ex.: faltas, leads sem resposta) · neutral = informação.
   */
  changeType?: "positive" | "negative" | "warning" | "neutral";
  icon: LucideIcon;
  /** Primeira carga: mostra esqueleto no lugar do número (não exibe "0" falso). */
  loading?: boolean;
}

/**
 * Indicador único. Superfície chapada, ícone neutro (a cor fica para estado),
 * rótulo em caixa normal que quebra linha no celular, número tabular.
 * Ver DESIGN.md › Componentes › KpiCard e › Princípios.
 */
export function KpiCard({ title, value, change, changeType = "neutral", icon: Icon, loading = false }: KpiCardProps) {
  const changeColor = {
    positive: "text-success",
    negative: "text-destructive",
    warning: "text-warning-text",
    neutral: "text-muted-foreground",
  }[changeType];

  const ChangeIcon = {
    positive: ArrowUpRight,
    negative: ArrowDownRight,
    warning: AlertTriangle,
    neutral: Minus,
  }[changeType];

  return (
    <div className="bg-card rounded-lg border border-border p-4" aria-busy={loading || undefined}>
      <div className="flex items-start gap-2">
        <p className="flex-1 min-w-0 text-[0.8125rem] font-medium leading-snug text-muted-foreground break-words">
          {title}
        </p>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-8 w-20" />
          <span className="sr-only">Carregando</span>
        </>
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-card-foreground font-heading tabular-nums break-words">
            {value}
          </p>
          {change && (
            <div className={`flex items-start gap-1 mt-1.5 ${changeColor}`}>
              <ChangeIcon className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
              <span className="text-xs font-medium leading-snug">{change}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
