/** Shared Recharts tooltip style that respects light/dark theme tokens */
export const chartTooltipStyle: React.CSSProperties = {
  background: "var(--color-card)",
  color: "var(--color-card-foreground)",
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  fontSize: "12px",
};

/** Muted tick fill using CSS var (works in both themes) */
export const chartTickFill = "var(--color-muted-foreground)";

/** Grid stroke using CSS var */
export const chartGridStroke = "var(--color-border)";
