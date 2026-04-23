import { useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid,
  Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { computeDailySeries, type Campaign } from "@/data/campanhasStore";

interface Props {
  campaign: Campaign;
}

const RANGES = [
  { label: "7 dias", days: 7 },
  { label: "14 dias", days: 14 },
  { label: "30 dias", days: 30 },
];

export function CampanhaTimelineChart({ campaign }: Props) {
  const [days, setDays] = useState(7);
  const [mode, setMode] = useState<"area" | "bar">("area");
  const data = computeDailySeries(campaign, days);

  const totalPeriodo = data.reduce((s, d) => s + d.total, 0);
  const leadsPeriodo = data.reduce((s, d) => s + d.leads, 0);
  const convPeriodo = data.reduce((s, d) => s + d.conversoes, 0);

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-medium text-sm">Histórico temporal</h4>
          <p className="text-xs text-muted-foreground">
            {totalPeriodo} cliques · {leadsPeriodo} leads · {convPeriodo} conversões nos últimos {days} dias
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.days}
              size="sm"
              variant={days === r.days ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </Button>
          ))}
          <div className="w-px bg-border mx-1" />
          <Button
            size="sm"
            variant={mode === "area" ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            onClick={() => setMode("area")}
          >
            Área
          </Button>
          <Button
            size="sm"
            variant={mode === "bar" ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            onClick={() => setMode("bar")}
          >
            Barras
          </Button>
        </div>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          {mode === "area" ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-leads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-anon" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone" dataKey="anonimos" name="Cliques anônimos"
                stackId="1" stroke="hsl(var(--muted-foreground))" fill="url(#grad-anon)" strokeWidth={1.5}
              />
              <Area
                type="monotone" dataKey="leads" name="Leads identificados"
                stackId="1" stroke="hsl(var(--primary))" fill="url(#grad-leads)" strokeWidth={2}
              />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="anonimos" name="Anônimos" stackId="a" fill="hsl(var(--muted-foreground) / 0.5)" />
              <Bar dataKey="leads" name="Leads" stackId="a" fill="hsl(var(--primary))" />
              <Bar dataKey="conversoes" name="Conversões" fill="hsl(var(--success))" />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
