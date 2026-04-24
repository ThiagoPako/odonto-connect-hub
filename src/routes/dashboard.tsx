import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { ActiveAttendanceCard } from "@/components/ActiveAttendanceCard";
import { GhostModePanel } from "@/components/GhostModePanel";
import { dashboardApi, type DashboardKpis, vpsApiFetch } from "@/lib/vpsApi";
import { OrcamentoConversaoChart } from "@/components/charts/OrcamentoConversaoChart";
import { OrigemLeadsChart } from "@/components/charts/OrigemLeadsChart";
import { AgendaStatusChart } from "@/components/charts/AgendaStatusChart";
import { FaturamentoMensalChart } from "@/components/charts/FaturamentoMensalChart";
import {
  CalendarCheck, Users, FileText, DollarSign, Package,
  AlertTriangle, TrendingUp, Activity,
  UserCheck, UserX, Clock, CheckCircle, XCircle, BarChart3,
  ExternalLink, Loader2, AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: DashboardPage,
});

interface ActiveSession {
  id: string;
  lead_id: string;
  lead_nome: string;
  attendant_name: string;
  last_message: string | null;
  started_at: string;
}

const EMPTY_KPIS: DashboardKpis = {
  totalPacientes: 0,
  agendaHoje: 0,
  receitaMensal: 0,
  despesaMensal: 0,
  agenda: { total: 0, finalizados: 0, emAtendimento: 0, aguardando: 0, faltas: 0, encaixes: 0, taxaPresenca: 0 },
  orcamentos: { total: 0, pendentes: 0, aprovados: 0, reprovados: 0, valorAprovado: 0, taxaConversao: 0, ticketMedio: 0 },
  crm: { totalLeadsKanban: 0, semResposta: 0, ativos: 0, inativos: 0, receitaTotal: 0 },
  pacientes: { totalCadastrados: 0 },
  estoque: { totalItens: 0, abaixoMinimo: 0, itensAbaixoMinimo: [], semEstoque: 0, itensSemEstoque: [], valorTotalEstoque: 0 },
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKpis>(EMPTY_KPIS);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const [{ data, error: kpiErr }, { data: sess }] = await Promise.all([
        dashboardApi.kpis(),
        vpsApiFetch<ActiveSession[]>("/sessions/active", { background: true }),
      ]);
      if (cancelled) return;
      if (kpiErr) setError(kpiErr);
      if (data) setKpis(data);
      if (Array.isArray(sess)) setSessions(sess);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 60_000); // refresh a cada 60s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const { agenda, orcamentos: orcamento, crm, estoque, pacientes } = kpis;
  const isEmpty = !loading && !error && pacientes.totalCadastrados === 0 && agenda.total === 0;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 p-8 space-y-8 overflow-auto">

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Atualizando KPIs...
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Erro ao carregar dashboard: {error}</span>
          </div>
        )}

        {isEmpty && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning-foreground flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Banco de dados vazio</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cadastre pacientes, agendamentos e orçamentos para ver os indicadores reais aqui.
                Comece em <Link to="/pacientes" search={{ pacienteId: undefined }} className="text-primary hover:underline">Pacientes</Link> ou <Link to="/agenda" className="text-primary hover:underline">Agenda</Link>.
              </p>
            </div>
          </div>
        )}

        {/* === AGENDA DO DIA === */}
        <section className="animate-slide-up" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Agenda do Dia</h2>
            </div>
            <Link to="/agenda" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver agenda <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard title="Total Consultas" value={String(agenda.total)} icon={CalendarCheck} />
            <KpiCard title="Finalizados" value={String(agenda.finalizados)} change={`${agenda.taxaPresenca}% presença`} changeType="positive" icon={CheckCircle} />
            <KpiCard title="Em Atendimento" value={String(agenda.emAtendimento)} icon={Activity} />
            <KpiCard title="Aguardando" value={String(agenda.aguardando)} icon={Clock} />
            <KpiCard title="Faltas" value={String(agenda.faltas)} change={agenda.faltas > 0 ? "Atenção" : ""} changeType={agenda.faltas > 0 ? "negative" : "neutral"} icon={XCircle} />
            <KpiCard title="Encaixes" value={String(agenda.encaixes)} icon={TrendingUp} />
          </div>
        </section>

        {/* === FINANCEIRO / ORÇAMENTOS === */}
        <section className="animate-slide-up" style={{ animationDelay: '80ms', animationFillMode: 'both' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Orçamentos</h2>
            </div>
            <Link to="/orcamentos" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver orçamentos <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard title="Total Orçamentos" value={String(orcamento.total)} icon={FileText} />
            <KpiCard title="Valor Aprovado" value={`R$ ${orcamento.valorAprovado.toLocaleString("pt-BR")}`} change={`${orcamento.taxaConversao}% conversão`} changeType="positive" icon={DollarSign} />
            <KpiCard title="Pendentes" value={String(orcamento.pendentes)} change="Aguardando resposta" changeType="neutral" icon={Clock} />
            <KpiCard title="Reprovados" value={String(orcamento.reprovados)} changeType="negative" icon={XCircle} />
            <KpiCard title="Ticket Médio" value={`R$ ${orcamento.ticketMedio.toLocaleString("pt-BR")}`} icon={BarChart3} />
          </div>
        </section>

        {/* === CRM / PACIENTES === */}
        <section className="animate-slide-up" style={{ animationDelay: '160ms', animationFillMode: 'both' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">CRM & Pacientes</h2>
            </div>
            <Link to="/crm" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver CRM <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard title="Pacientes Cadastrados" value={String(pacientes.totalCadastrados)} icon={Users} />
            <KpiCard title="Pacientes Ativos" value={String(crm.ativos)} changeType="positive" icon={UserCheck} />
            <KpiCard title="Leads no Funil" value={String(crm.totalLeadsKanban)} change={`${crm.semResposta} sem resposta`} changeType={crm.semResposta > 0 ? "negative" : "neutral"} icon={TrendingUp} />
            <KpiCard title="Inativos" value={String(crm.inativos)} change="Reativar" changeType="negative" icon={UserX} />
            <KpiCard title="Receita Mensal" value={`R$ ${crm.receitaTotal.toLocaleString("pt-BR")}`} icon={DollarSign} />
          </div>
        </section>

        {/* === GRÁFICOS ANALÍTICOS === */}
        <section className="animate-slide-up space-y-5" style={{ animationDelay: '240ms', animationFillMode: 'both' }}>
          <FaturamentoMensalChart />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <OrcamentoConversaoChart />
            <OrigemLeadsChart />
            <AgendaStatusChart />
          </div>
        </section>

        <section className="animate-slide-up" style={{ animationDelay: '320ms', animationFillMode: 'both' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Estoque</h2>
            </div>
            <Link to="/estoque" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver estoque <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <KpiCard title="Total Itens" value={String(estoque.totalItens)} icon={Package} />
            <KpiCard
              title="Abaixo do Mínimo"
              value={String(estoque.abaixoMinimo)}
              change={estoque.itensAbaixoMinimo.slice(0, 2).join(", ")}
              changeType="negative"
              icon={AlertTriangle}
            />
            <KpiCard
              title="Sem Estoque"
              value={String(estoque.semEstoque)}
              change={estoque.itensSemEstoque.join(", ")}
              changeType="negative"
              icon={XCircle}
            />
            <KpiCard title="Valor em Estoque" value={`R$ ${estoque.valorTotalEstoque.toLocaleString("pt-BR")}`} icon={DollarSign} />
          </div>
        </section>

        {/* === ATENDIMENTOS ATIVOS (CHAT) === */}
        <section className="animate-slide-up">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-foreground">Atendimentos Ativos</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Conversas em andamento agora</p>
            </div>
            <GhostModePanel />
          </div>
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              Nenhum atendimento ativo no momento. <Link to="/chat" className="text-primary hover:underline">Abrir chat</Link>.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sessions.map((s) => (
                <ActiveAttendanceCard
                  key={s.id}
                  patientName={s.lead_nome}
                  patientInitials={getInitials(s.lead_nome)}
                  attendantName={s.attendant_name || "—"}
                  attendantInitials={getInitials(s.attendant_name || "—")}
                  lastMessage={s.last_message || "(sem mensagens)"}
                  startedAt={new Date(s.started_at)}
                />
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
