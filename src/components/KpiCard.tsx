import type { LucideIcon } from "lucide-react";

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

  return (
    <div className="bg-card rounded-xl border border-border p-5 flex items-start gap-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold text-card-foreground mt-0.5">{value}</p>
        {change && (
          <p className={`text-xs mt-1 ${changeColor}`}>{change}</p>
        )}
      </div>
    </div>
  );
}
