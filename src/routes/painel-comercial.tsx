import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  Headset, MessageSquare, CalendarCheck, TrendingUp, Clock, AlertCircle,
  Users, BarChart3, Loader2,
} from "lucide-react";
import { comercialApi, type ComercialPainel } from "@/lib/vpsApi";

export const Route = createFileRoute("/painel-comercial")({
  ssr: false,
  component: PainelComercialPage,
});

const followUpTypeConfig: Record<string, { label: string; class: string }> = {
  retorno: { label: "Retorno", class: "bg-primary/15 text-primary" },
  confirmacao: { label: "Confirmação", class: "bg-chart-2/15 text-chart-2" },
  reativacao: { label: "Reativação", class: "bg-chart-4/15 text-chart-4" },
};

const chartColors = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const EMPTY: ComercialPainel = {
  attendantId: "",
  kpis: { atendimentosHoje: 0, agendamentosHoje: 0, taxaConversao: 0, leadsPendentes: 0 },
  followUps: [],
  conversionByOrigin: [],
};

function formatScheduled(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const hh = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (sameDay(d, today)) return `Hoje, ${hh}`;
    if (sameDay(d, tomorrow)) return `Amanhã, ${hh}`;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + `, ${hh}`;
  } catch { return iso; }
}

function PainelComercialPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ComercialPainel>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data: res, error: err } = await comercialApi.painel();
      if (cancelled) return;
      if (err) setError(err);
      else if (res) setData(res);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const { kpis, followUps, conversionByOrigin } = data;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Painel Comercial" />
      <main className="flex-1 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-chart-4/15 flex items-center justify-center">
            <Headset className="h-5 w-5 text-chart-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              Olá, {user?.name?.split(" ")[0] ?? "Comercial"} 👋
            </h2>
            <p className="text-sm text-muted-foreground">
              Visão geral do seu dia — leads e follow-ups
            </p>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Erro ao carregar painel: {error}</span>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiMini icon={MessageSquare} label="Atendimentos hoje" value={kpis.atendimentosHoje} color="text-primary" bg="bg-primary/10" />
          <KpiMini icon={CalendarCheck} label="Agendamentos hoje" value={kpis.agendamentosHoje} color="text-chart-2" bg="bg-chart-2/10" />
          <KpiMini icon={TrendingUp} label="Taxa de conversão" value={`${kpis.taxaConversao}%`} color="text-chart-4" bg="bg-chart-4/10" />
          <KpiMini icon={AlertCircle} label="Leads pendentes" value={kpis.leadsPendentes} color="text-destructive" bg="bg-destructive/10" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Follow-ups */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-chart-4" />
                Follow-ups do dia
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {followUps.length === 0 && !loading ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Sem follow-ups pendentes 🎉
                </p>
              ) : followUps.map((fu) => (
                <Link key={fu.id} to="/crm" className="block p-3 rounded-xl border bg-card hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{fu.leadName}</span>
                    <Badge variant="outline" className={`text-[10px] ${followUpTypeConfig[fu.type]?.class ?? ""}`}>
                      {followUpTypeConfig[fu.type]?.label ?? fu.type}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1 line-clamp-1">{fu.note}</p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatScheduled(fu.scheduledAt)}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Conversion chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-chart-4" />
                Conversão por Origem
              </CardTitle>
            </CardHeader>
            <CardContent>
              {conversionByOrigin.length === 0 && !loading ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  Nenhum lead atribuído ainda.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={conversionByOrigin} layout="vertical" margin={{ left: 10, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis type="category" dataKey="origin" width={80} fontSize={12} tick={{ fill: "hsl(var(--foreground))" }} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number, _n, p: any) => [
                        `${value.toFixed(1)}% (${p.payload.convertidos}/${p.payload.leads})`,
                        "Conversão",
                      ]}
                    />
                    <Bar dataKey="rate" radius={[0, 6, 6, 0]} barSize={18}>
                      {conversionByOrigin.map((_, i) => (
                        <Cell key={i} fill={chartColors[i % chartColors.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Quick links */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Acesso rápido
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link to="/chat">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <MessageSquare className="h-4 w-4" /> Abrir Chat de Atendimento
                </Button>
              </Link>
              <Link to="/crm">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Users className="h-4 w-4" /> CRM &amp; Funil de Vendas
                </Button>
              </Link>
              <Link to="/agenda">
                <Button variant="outline" className="w-full justify-start gap-2">
                  <CalendarCheck className="h-4 w-4" /> Ver Agenda
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function KpiMini({ icon: Icon, label, value, color, bg }: {
  icon: typeof MessageSquare; label: string; value: string | number; color: string; bg: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
