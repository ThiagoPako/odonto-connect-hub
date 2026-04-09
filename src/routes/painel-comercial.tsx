import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  Headset,
  MessageSquare,
  CalendarCheck,
  TrendingUp,
  Clock,
  AlertCircle,
  Users,
  BarChart3,
} from "lucide-react";

export const Route = createFileRoute("/painel-comercial")({
  ssr: false,
  component: PainelComercialPage,
});

/* ── Mock Data ───────────────────────────────────── */

interface FollowUp {
  id: string;
  leadName: string;
  type: "retorno" | "confirmacao" | "reativacao";
  scheduledAt: string;
  note: string;
}

const mockFollowUps: FollowUp[] = [
  { id: "1", leadName: "João Santos", type: "retorno", scheduledAt: "Hoje, 14:00", note: "Enviar tabela de preços" },
  { id: "2", leadName: "Carlos Ferreira", type: "retorno", scheduledAt: "Hoje, 16:30", note: "Explicar opções de implante" },
  { id: "3", leadName: "Patrícia Lima", type: "confirmacao", scheduledAt: "Amanhã, 09:00", note: "Confirmar interesse nas lentes" },
  { id: "4", leadName: "Roberto Alves", type: "reativacao", scheduledAt: "Amanhã, 11:00", note: "Reativar com promoção de implante" },
];

const kpis = {
  atendimentosHoje: 18,
  agendamentosHoje: 6,
  taxaConversao: 33,
  leadsPendentes: 4,
};

const followUpTypeConfig: Record<string, { label: string; class: string }> = {
  retorno: { label: "Retorno", class: "bg-primary/15 text-primary" },
  confirmacao: { label: "Confirmação", class: "bg-chart-2/15 text-chart-2" },
  reativacao: { label: "Reativação", class: "bg-chart-4/15 text-chart-4" },
};

const conversionByOrigin = [
  { origin: "Instagram", leads: 32, convertidos: 12, rate: 37.5 },
  { origin: "Google Ads", leads: 28, convertidos: 14, rate: 50 },
  { origin: "Indicação", leads: 15, convertidos: 10, rate: 66.7 },
  { origin: "Meta Ads", leads: 20, convertidos: 6, rate: 30 },
  { origin: "Site", leads: 10, convertidos: 3, rate: 30 },
];

const chartColors = [
  "hsl(var(--chart-4))",
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-5))",
];

/* ── Component ───────────────────────────────────── */

function PainelComercialPage() {
  const { user } = useAuth();

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
        </div>

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
              {mockFollowUps.map((fu) => (
                <div key={fu.id} className="p-3 rounded-xl border bg-card hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{fu.leadName}</span>
                    <Badge variant="outline" className={`text-[10px] ${followUpTypeConfig[fu.type]?.class ?? ""}`}>
                      {followUpTypeConfig[fu.type]?.label ?? fu.type}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">{fu.note}</p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {fu.scheduledAt}
                  </div>
                </div>
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
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={conversionByOrigin} layout="vertical" margin={{ left: 10, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="origin" width={80} fontSize={12} tick={{ fill: "hsl(var(--foreground))" }} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`${value.toFixed(1)}%`, "Conversão"]}
                  />
                  <Bar dataKey="rate" radius={[0, 6, 6, 0]} barSize={18}>
                    {conversionByOrigin.map((_, i) => (
                      <Cell key={i} fill={chartColors[i % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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

/* ── Sub-components ──────────────────────────────── */

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
