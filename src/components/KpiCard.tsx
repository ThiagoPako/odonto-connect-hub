import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
}

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
    <div className="@container group bg-card rounded-2xl border border-border/60 p-4 sm:p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
      {/* Subtle gradient accent */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
      {/* Hover glow */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/0 to-primary/0 group-hover:from-primary/[0.03] group-hover:to-transparent transition-all duration-500 pointer-events-none" />

      {/* Card estreito (2 colunas no celular): o ícone sobe para cima do texto em vez de
          ficar por cima do rótulo. A partir de ~13rem volta para a direita. */}
      <div className="flex flex-col-reverse gap-3 @[13rem]:flex-row @[13rem]:items-start @[13rem]:justify-between relative z-10">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium leading-snug break-words">{title}</p>
          <p className="text-2xl font-bold text-card-foreground mt-1.5 tracking-tight font-heading break-words">{value}</p>
          {change && (
            <div className={`flex items-center gap-1 mt-2 ${changeColor}`}>
              <ChangeIcon className="h-3 w-3 shrink-0" />
              <span className="text-[11px] font-medium leading-snug">{change}</span>
            </div>
          )}
        </div>
        <div className="h-10 w-10 @[13rem]:h-11 @[13rem]:w-11 rounded-xl bg-primary/8 flex items-center justify-center shrink-0 group-hover:bg-primary/15 group-hover:shadow-[0_0_12px_-2px_hsl(var(--primary)/0.3)] transition-all duration-300 icon-bounce">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </div>
  );
}
