import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { ActiveAttendanceCard } from "@/components/ActiveAttendanceCard";
import { GhostModePanel } from "@/components/GhostModePanel";
import {
  MessageSquare, Users, Phone, TrendingUp, DollarSign,
  Target, BarChart3, ArrowUpRight, ArrowDownRight, Activity,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

const mockAttendances = [
  { patientName: "Maria Silva", patientInitials: "MS", attendantName: "Ana", attendantInitials: "AR", lastMessage: "Gostaria de saber o valor do implante...", startedAt: new Date(Date.now() - 3 * 60 * 1000) },
  { patientName: "João Santos", patientInitials: "JS", attendantName: "Carla", attendantInitials: "CM", lastMessage: "Posso parcelar em quantas vezes?", startedAt: new Date(Date.now() - 7 * 60 * 1000) },
  { patientName: "Pedro Costa", patientInitials: "PC", attendantName: "Ana", attendantInitials: "AR", lastMessage: "Qual horário disponível para amanhã?", startedAt: new Date(Date.now() - 1 * 60 * 1000) },
  { patientName: "Lucia Ferreira", patientInitials: "LF", attendantName: "Beatriz", attendantInitials: "BL", lastMessage: "Obrigada, vou confirmar com meu marido", startedAt: new Date(Date.now() - 12 * 60 * 1000) },
];

function DashboardPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 p-8 space-y-8 overflow-auto">
        {/* Top KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
          <KpiCard title="Faturamento Mês" value="R$ 187.500" change="+18% vs mês anterior" changeType="positive" icon={DollarSign} />
          <KpiCard title="Investimento Ads" value="R$ 12.400" change="Meta + Google Ads" changeType="neutral" icon={Target} />
          <KpiCard title="ROI" value="15.1x" change="+2.3x vs mês anterior" changeType="positive" icon={BarChart3} />
          <KpiCard title="Custo por Lead" value="R$ 32,50" change="-12% vs mês anterior" changeType="positive" icon={TrendingUp} />
        </div>

        {/* Second row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
          <KpiCard title="Atendimentos Hoje" value="47" change="+12% vs ontem" changeType="positive" icon={MessageSquare} />
          <KpiCard title="Leads na Fila" value="8" change="3 aguardando >5min" changeType="negative" icon={Users} />
          <KpiCard title="Chamadas Realizadas" value="23" change="+5 esta hora" changeType="positive" icon={Phone} />
          <KpiCard title="Conversão do Dia" value="34%" change="Meta: 40%" changeType="neutral" icon={TrendingUp} />
        </div>

        {/* Analytics Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-slide-up">
          {/* Origem dos Leads */}
          <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card hover:shadow-card-hover transition-all">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-card-foreground">Origem dos Leads</h3>
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">Este mês</span>
            </div>
            <div className="space-y-4">
              {[
                { origin: "Google Ads", count: 124, pct: 38, color: "bg-chart-1" },
                { origin: "Meta Ads", count: 98, pct: 30, color: "bg-chart-2" },
                { origin: "Instagram", count: 56, pct: 17, color: "bg-dental-cyan" },
                { origin: "Indicação", count: 32, pct: 10, color: "bg-chart-3" },
                { origin: "Site", count: 16, pct: 5, color: "bg-chart-4" },
              ].map((item) => (
                <div key={item.origin}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-foreground">{item.origin}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{item.count}</span>
                      <span className="text-[10px] text-muted-foreground">({item.pct}%)</span>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full transition-all duration-500`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Conversão por Canal */}
          <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card hover:shadow-card-hover transition-all">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-card-foreground">Conversão por Canal</h3>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-3">
              {[
                { channel: "Google Ads", rate: 42, trend: "up" as const, revenue: "R$ 82.400" },
                { channel: "Indicação", rate: 68, trend: "up" as const, revenue: "R$ 45.600" },
                { channel: "Meta Ads", rate: 28, trend: "down" as const, revenue: "R$ 38.200" },
                { channel: "Instagram", rate: 22, trend: "up" as const, revenue: "R$ 15.800" },
                { channel: "Site", rate: 35, trend: "down" as const, revenue: "R$ 5.500" },
              ].map((item) => (
                <div key={item.channel} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-muted/40 transition-colors">
                  <span className="text-xs font-medium text-foreground flex-1">{item.channel}</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      item.trend === "up" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                    }`}>
                      {item.trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {item.rate}%
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground w-24 text-right font-medium">{item.revenue}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Reativação */}
          <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card hover:shadow-card-hover transition-all relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-warning/8 to-transparent rounded-bl-full pointer-events-none" />
            <div className="flex items-center justify-between mb-5 relative z-10">
              <h3 className="text-sm font-bold text-card-foreground">Reativação</h3>
              <span className="text-[9px] uppercase font-bold tracking-wider text-warning bg-warning/10 px-2.5 py-1 rounded-full">
                Ação necessária
              </span>
            </div>
            <div className="space-y-3 relative z-10">
              {[
                { label: "Pacientes inativos >90d", count: 23, action: "Reativar" },
                { label: "Orçamentos não fechados", count: 15, action: "Follow-up" },
                { label: "Leads sem resposta", count: 8, action: "Campanha" },
                { label: "Retornos pendentes", count: 12, action: "Lembrete" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-muted/30 transition-colors">
                  <div>
                    <p className="text-xs font-medium text-foreground">{item.label}</p>
                    <p className="text-xl font-bold text-foreground mt-0.5">{item.count}</p>
                  </div>
                  <button className="px-3.5 py-1.5 rounded-xl text-[11px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 hover:shadow-sm transition-all">
                    {item.action}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Active Attendances */}
        <div className="animate-slide-up">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-foreground">Atendimentos Ativos</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Conversas em andamento agora</p>
            </div>
            <GhostModePanel />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mockAttendances.map((a) => (
              <ActiveAttendanceCard key={a.patientName} {...a} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
