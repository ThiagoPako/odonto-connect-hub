import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { ActiveAttendanceCard } from "@/components/ActiveAttendanceCard";
import { dashboardApi, sessionsApi } from "@/lib/vpsApi";
import { OrcamentoConversaoChart } from "@/components/charts/OrcamentoConversaoChart";
import { OrigemLeadsChart } from "@/components/charts/OrigemLeadsChart";
import { AgendaStatusChart } from "@/components/charts/AgendaStatusChart";
import { FaturamentoMensalChart } from "@/components/charts/FaturamentoMensalChart";
import {
  CalendarCheck, Users, FileText, DollarSign, Package,
  AlertTriangle, TrendingUp, Activity,
  UserCheck, UserX, Clock, CheckCircle, XCircle, BarChart3,
  ArrowRight, Loader2, AlertCircle, MessageSquare,
  type LucideIcon,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Dashboard · Odonto Connect" }] }),
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

const EMPTY_KPIS: any = {
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

const fmt = (n: number) => Number(n || 0).toLocaleString("pt-BR");

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function SectionHeader({ icon: Icon, title, to, linkLabel }: { icon: LucideIcon; title: string; to: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3 md:mb-4">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-[0.9375rem] font-semibold text-foreground truncate">{title}</h2>
      </div>
      <Link to={to} className="group inline-flex items-center gap-1 shrink-0 min-h-11 -my-3 md:min-h-0 md:my-0 text-[0.8125rem] font-medium text-primary hover:underline underline-offset-4">
        {linkLabel} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const primeiroNome = user?.name?.trim().split(/\s+/)[0] ?? "";
  const [kpis, setKpis] = useState<any>(EMPTY_KPIS);

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Erro da lista de atendimentos ativos: antes era ignorado e a tela dizia "nenhuma conversa"
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  // Só depois da primeira resposta os números são reais; antes, esqueleto (nada de "0" falso)
  const [hasLoaded, setHasLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Wait for auth to resolve before querying — avoids "Sem tenant" race
    if (authLoading) return;
    if (!user?.tenant_id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const [{ data, error: kpiErr }, { data: sess, error: sessErr }] = await Promise.all([
        dashboardApi.getKpis(),
        sessionsApi.list({ active: true }),
      ]);
      if (cancelled) return;
      if (kpiErr) setError(kpiErr);
      if (data) {
        const d = data as any;
        setKpis({
          ...EMPTY_KPIS,
          ...d,
          agenda: { ...EMPTY_KPIS.agenda, ...(d.agenda || {}) },
          orcamentos: { ...EMPTY_KPIS.orcamentos, ...(d.orcamentos || {}) },
          crm: { ...EMPTY_KPIS.crm, ...(d.crm || {}) },
          pacientes: { ...EMPTY_KPIS.pacientes, ...(d.pacientes || {}), totalCadastrados: d.pacientes?.totalCadastrados ?? d.totalPacientes ?? 0 },
          estoque: { ...EMPTY_KPIS.estoque, ...(d.estoque || {}) },
        });
      }
      setSessionsError(sessErr ?? null);
      if (Array.isArray(sess)) setSessions(sess);
      setHasLoaded(true);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [authLoading, user?.tenant_id, reloadKey]);

  const { agenda, orcamentos: orcamento, crm, estoque, pacientes } = kpis;
  const firstLoad = loading && !hasLoaded;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 px-4 py-6 md:p-8 space-y-8 md:space-y-10 overflow-auto max-w-[1600px] w-full mx-auto">

        <div className="space-y-1">
          <p className="text-2xl md:text-[1.75rem] font-semibold tracking-tight text-foreground font-heading">
            {saudacao()}{primeiroNome ? `, ${primeiroNome}` : ""}
          </p>
          <p className="text-sm md:text-[0.9375rem] text-muted-foreground">
            {firstLoad
              ? "Carregando o resumo do dia…"
              : agenda.total === 0
                ? "Nenhuma consulta marcada para hoje."
                : `Hoje: ${agenda.total} ${agenda.total === 1 ? "consulta" : "consultas"} · ${agenda.aguardando} aguardando · ${agenda.emAtendimento} em atendimento.`}
          </p>
        </div>

        {loading && hasLoaded && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Atualizando indicadores…
          </div>
        )}

        {error && (
          <div role="alert" className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm">
            <span className="flex flex-1 items-start gap-2 text-foreground">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
              <span>Não foi possível carregar os indicadores. {error}</span>
            </span>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-card text-foreground text-sm font-medium border border-input hover:bg-muted active:translate-y-px transition-[background-color,transform] disabled:opacity-50 shrink-0"
            >
              {loading ? "Tentando…" : "Tentar de novo"}
            </button>
          </div>
        )}

        {/* Estado vazio: o checklist de primeiros passos (#61) entra aqui. O aviso "sua clínica ainda
            não tem dados" saiu para não repetir o checklist. */}

        {/* === AGENDA DO DIA === */}
        <section>
          <SectionHeader icon={CalendarCheck} title="Agenda de hoje" to="/agenda" linkLabel="Ver agenda" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
            <KpiCard loading={firstLoad} title="Total Consultas" value={fmt(agenda.total)} icon={CalendarCheck} />
            <KpiCard loading={firstLoad} title="Finalizados" value={fmt(agenda.finalizados)} change={`${agenda.taxaPresenca}% presença`} changeType="positive" icon={CheckCircle} />
            <KpiCard loading={firstLoad} title="Em Atendimento" value={fmt(agenda.emAtendimento)} icon={Activity} />
            <KpiCard loading={firstLoad} title="Aguardando" value={fmt(agenda.aguardando)} icon={Clock} />
            <KpiCard loading={firstLoad} title="Faltas" value={fmt(agenda.faltas)} change={agenda.faltas > 0 ? "Atenção" : ""} changeType={agenda.faltas > 0 ? "warning" : "neutral"} icon={XCircle} />
            <KpiCard loading={firstLoad} title="Encaixes" value={fmt(agenda.encaixes)} icon={TrendingUp} />
          </div>
        </section>

        {/* === FINANCEIRO / ORÇAMENTOS === */}
        <section>
          <SectionHeader icon={FileText} title="Orçamentos" to="/orcamentos" linkLabel="Ver orçamentos" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
            <KpiCard loading={firstLoad} title="Total Orçamentos" value={fmt(orcamento.total)} icon={FileText} />
            <KpiCard loading={firstLoad} title="Valor Aprovado" value={`R$ ${orcamento.valorAprovado.toLocaleString("pt-BR")}`} change={`${orcamento.taxaConversao}% conversão`} changeType="positive" icon={DollarSign} />
            <KpiCard loading={firstLoad} title="Pendentes" value={fmt(orcamento.pendentes)} change="Aguardando resposta" changeType="neutral" icon={Clock} />
            <KpiCard loading={firstLoad} title="Reprovados" value={fmt(orcamento.reprovados)} icon={XCircle} />
            <KpiCard loading={firstLoad} title="Ticket Médio" value={`R$ ${orcamento.ticketMedio.toLocaleString("pt-BR")}`} icon={BarChart3} />
          </div>
        </section>

        {/* === CRM / PACIENTES === */}
        <section>
          <SectionHeader icon={Users} title="Pacientes e CRM" to="/crm" linkLabel="Ver CRM" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
            <KpiCard loading={firstLoad} title="Pacientes Cadastrados" value={fmt(pacientes.totalCadastrados)} icon={Users} />
            <KpiCard loading={firstLoad} title="Pacientes Ativos" value={fmt(crm.ativos)} icon={UserCheck} />
            <KpiCard loading={firstLoad} title="Leads no Funil" value={fmt(crm.totalLeadsKanban)} change={`${crm.semResposta} sem resposta`} changeType={crm.semResposta > 0 ? "warning" : "neutral"} icon={TrendingUp} />
            <KpiCard loading={firstLoad} title="Inativos" value={fmt(crm.inativos)} change={crm.inativos > 0 ? "Reativar" : ""} changeType="warning" icon={UserX} />
            <KpiCard loading={firstLoad} title="Receita Mensal" value={`R$ ${Number(kpis.receitaMensal ?? 0).toLocaleString("pt-BR")}`} icon={DollarSign} />
          </div>
        </section>

        {/* === GRÁFICOS ANALÍTICOS === */}
        <section className="space-y-5">
          <FaturamentoMensalChart />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <OrcamentoConversaoChart kpis={orcamento} />
            <OrigemLeadsChart data={kpis.conversionByOrigin} />
            <AgendaStatusChart kpis={agenda} />
          </div>
        </section>

        <section>
          <SectionHeader icon={Package} title="Estoque" to="/estoque" linkLabel="Ver estoque" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            <KpiCard loading={firstLoad} title="Total Itens" value={fmt(estoque.totalItens)} icon={Package} />
            <KpiCard loading={firstLoad}
              title="Abaixo do Mínimo"
              value={fmt(estoque.abaixoMinimo)}
              change={estoque.itensAbaixoMinimo.slice(0, 2).join(", ")}
              changeType={estoque.abaixoMinimo > 0 ? "warning" : "neutral"}
              icon={AlertTriangle}
            />
            <KpiCard loading={firstLoad}
              title="Sem Estoque"
              value={fmt(estoque.semEstoque)}
              change={estoque.itensSemEstoque.join(", ")}
              changeType={estoque.semEstoque > 0 ? "negative" : "neutral"}
              icon={XCircle}
            />
            <KpiCard loading={firstLoad} title="Valor em Estoque" value={`R$ ${estoque.valorTotalEstoque.toLocaleString("pt-BR")}`} icon={DollarSign} />
          </div>
        </section>

        {/* === ATENDIMENTOS ATIVOS (CHAT) === */}
        <section>
          <SectionHeader icon={MessageSquare} title="Atendimentos ativos" to="/chat" linkLabel="Abrir chat" />
          {sessionsError ? (
            <div role="alert" className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm">
              <span className="flex flex-1 items-start gap-2 text-foreground">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
                <span>Não foi possível carregar os atendimentos ativos. {sessionsError}</span>
              </span>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={loading}
                className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-card text-foreground text-sm font-medium border border-input hover:bg-muted active:translate-y-px transition-[background-color,transform] disabled:opacity-50 shrink-0"
              >
                {loading ? "Tentando…" : "Tentar de novo"}
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-lg bg-muted px-5 py-6 text-sm text-muted-foreground">
              Nenhuma conversa em andamento agora.
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
