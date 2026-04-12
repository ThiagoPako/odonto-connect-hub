import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, Send, CheckCircle2, XCircle, Clock, BarChart3,
  ArrowUpRight, ArrowDownRight, Loader2, RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { automationsApi } from "@/lib/vpsApi";

interface AutomationStats {
  overall: {
    totalJobs: number;
    totalSent: number;
    totalFailed: number;
    totalPending: number;
    totalCancelled: number;
    deliveryRate: string;
  };
  perFlow: { flow_id: string; flow_name: string; total: number; sent: number; failed: number; pending: number }[];
  timeline: { date: string; sent: number; failed: number; pending: number; total: number }[];
  flowStats: { id: string; name: string; active: boolean; sent: number; responded: number; converted: number }[];
  period: number;
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const PIE_COLORS = [
  "hsl(var(--chart-2))",
  "hsl(var(--destructive))",
  "hsl(var(--chart-4))",
  "hsl(var(--muted-foreground))",
];

export function AutomationReportPanel() {
  const [stats, setStats] = useState<AutomationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);

  const loadStats = (days: number) => {
    setLoading(true);
    automationsApi.getStats(days)
      .then((res) => { if (res.data) setStats(res.data as unknown as AutomationStats); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStats(period); }, [period]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        <p>Sem dados de relatório disponíveis</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => loadStats(period)}>
          <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Tentar novamente
        </Button>
      </div>
    );
  }

  const { overall, timeline, flowStats } = stats;

  // Compute aggregated rates from flow stats
  const totalFlowSent = flowStats.reduce((a, f) => a + f.sent, 0);
  const totalResponded = flowStats.reduce((a, f) => a + f.responded, 0);
  const totalConverted = flowStats.reduce((a, f) => a + f.converted, 0);
  const responseRate = totalFlowSent > 0 ? ((totalResponded / totalFlowSent) * 100).toFixed(1) : "0";
  const conversionRate = totalFlowSent > 0 ? ((totalConverted / totalFlowSent) * 100).toFixed(1) : "0";

  // Pie data for job status distribution
  const pieData = [
    { name: "Enviados", value: overall.totalSent },
    { name: "Falhou", value: overall.totalFailed },
    { name: "Pendentes", value: overall.totalPending },
    { name: "Cancelados", value: overall.totalCancelled },
  ].filter(d => d.value > 0);

  // Format timeline dates
  const formattedTimeline = timeline.map(t => ({
    ...t,
    date: new Date(t.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    sent: Number(t.sent),
    failed: Number(t.failed),
    pending: Number(t.pending),
  }));

  // Per-flow conversion chart
  const flowConversionData = flowStats
    .filter(f => f.sent > 0)
    .map(f => ({
      name: f.name.length > 20 ? f.name.slice(0, 20) + "…" : f.name,
      entrega: f.sent > 0 ? 100 : 0,
      resposta: f.sent > 0 ? ((f.responded / f.sent) * 100) : 0,
      conversao: f.sent > 0 ? ((f.converted / f.sent) * 100) : 0,
    }));

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Relatório de Desempenho</h3>
        </div>
        <div className="flex items-center gap-2">
          {[7, 15, 30, 90].map(d => (
            <Button
              key={d}
              variant={period === d ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setPeriod(d)}
            >
              {d}d
            </Button>
          ))}
          <Button variant="ghost" size="sm" className="h-7" onClick={() => loadStats(period)}>
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <ReportKpi
          icon={Send}
          label="Total Enviados"
          value={overall.totalSent.toLocaleString("pt-BR")}
          color="text-primary"
          bg="bg-primary/10"
        />
        <ReportKpi
          icon={CheckCircle2}
          label="Taxa de Entrega"
          value={`${overall.deliveryRate}%`}
          color="text-chart-2"
          bg="bg-chart-2/10"
          trend={Number(overall.deliveryRate) > 90 ? "up" : "down"}
        />
        <ReportKpi
          icon={TrendingUp}
          label="Taxa de Resposta"
          value={`${responseRate}%`}
          color="text-chart-4"
          bg="bg-chart-4/10"
          trend={Number(responseRate) > 30 ? "up" : "down"}
        />
        <ReportKpi
          icon={TrendingUp}
          label="Taxa de Conversão"
          value={`${conversionRate}%`}
          color="text-chart-3"
          bg="bg-chart-3/10"
          trend={Number(conversionRate) > 15 ? "up" : "down"}
        />
        <ReportKpi
          icon={XCircle}
          label="Falhas"
          value={overall.totalFailed.toLocaleString("pt-BR")}
          color="text-destructive"
          bg="bg-destructive/10"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Timeline chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Envios ao Longo do Tempo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {formattedTimeline.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={formattedTimeline} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="sent" name="Enviados" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="failed" name="Falhas" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">Sem dados no período</p>
            )}
          </CardContent>
        </Card>

        {/* Status distribution pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-chart-4" />
              Distribuição de Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">Sem dados no período</p>
            )}
          </CardContent>
        </Card>
      </div>



      {/* Flow detail table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detalhamento por Fluxo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Fluxo</th>
                  <th className="text-center py-2 px-2 font-medium">Status</th>
                  <th className="text-right py-2 px-2 font-medium">Enviados</th>
                  <th className="text-right py-2 px-2 font-medium">Respostas</th>
                  <th className="text-right py-2 px-2 font-medium">Conversões</th>
                  <th className="text-right py-2 px-2 font-medium">% Resp.</th>
                  <th className="text-right py-2 pl-2 font-medium">% Conv.</th>
                </tr>
              </thead>
              <tbody>
                {flowStats.map(f => {
                  const respRate = f.sent > 0 ? ((f.responded / f.sent) * 100).toFixed(1) : "—";
                  const convRate = f.sent > 0 ? ((f.converted / f.sent) * 100).toFixed(1) : "—";
                  return (
                    <tr key={f.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2 pr-4 font-medium text-foreground max-w-[200px] truncate">{f.name}</td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant="outline" className={`text-[10px] ${f.active ? "bg-chart-2/15 text-chart-2" : "bg-muted text-muted-foreground"}`}>
                          {f.active ? "Ativo" : "Pausado"}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{f.sent.toLocaleString("pt-BR")}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{f.responded.toLocaleString("pt-BR")}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{f.converted.toLocaleString("pt-BR")}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium text-chart-4">{respRate}{respRate !== "—" && "%"}</td>
                      <td className="py-2 pl-2 text-right tabular-nums font-medium text-chart-3">{convRate}{convRate !== "—" && "%"}</td>
                    </tr>
                  );
                })}
                {flowStats.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Nenhum fluxo com dados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReportKpi({ icon: Icon, label, value, color, bg, trend }: {
  icon: typeof Send; label: string; value: string; color: string; bg: string; trend?: "up" | "down";
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-lg font-bold">{value}</p>
            {trend === "up" && <ArrowUpRight className="h-3.5 w-3.5 text-chart-2" />}
            {trend === "down" && <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />}
          </div>
          <p className="text-[10px] text-muted-foreground truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
