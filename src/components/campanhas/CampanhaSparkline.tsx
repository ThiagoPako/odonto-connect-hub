import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { computeDailySeries, type Campaign } from "@/data/campanhasStore";

interface Props {
  campaign: Campaign;
  days?: number;
  height?: number;
  showAxis?: boolean;
}

export function CampanhaSparkline({ campaign, days = 7, height = 60, showAxis = false }: Props) {
  const data = computeDailySeries(campaign, days);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${campaign.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        {showAxis && (
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
        )}
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 11,
            padding: "6px 8px",
          }}
          labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
          formatter={(value: number, name: string) => {
            const map: Record<string, string> = {
              total: "Cliques",
              leads: "Leads",
              anonimos: "Anônimos",
              conversoes: "Conversões",
            };
            return [value, map[name] ?? name];
          }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill={`url(#spark-${campaign.id})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
