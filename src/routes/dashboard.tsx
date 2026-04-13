import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { ActiveAttendanceCard } from "@/components/ActiveAttendanceCard";
import { GhostModePanel } from "@/components/GhostModePanel";
import {
  getAgendaKpis,
  getOrcamentoKpis,
  getCrmKpis,
  getEstoqueKpis,
  getPacienteKpis,
} from "@/data/dashboardKpis";
import { OrcamentoConversaoChart } from "@/components/charts/OrcamentoConversaoChart";
import { OrigemLeadsChart } from "@/components/charts/OrigemLeadsChart";
import { AgendaStatusChart } from "@/components/charts/AgendaStatusChart";
import { FaturamentoMensalChart } from "@/components/charts/FaturamentoMensalChart";
import {
  CalendarCheck, Users, FileText, DollarSign, Package,
  AlertTriangle, TrendingUp, Activity,
  UserCheck, UserX, Clock, CheckCircle, XCircle, BarChart3,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: DashboardPage,
});

const mockAttendances = [
  { patientName: "Maria Silva", patientInitials: "MS", attendantName: "Ana", attendantInitials: "AR", lastMessage: "Gostaria de saber o valor do implante...", startedAt: new Date(Date.now() - 3 * 60 * 1000) },
  { patientName: "João Santos", patientInitials: "JS", attendantName: "Carla", attendantInitials: "CM", lastMessage: "Posso parcelar em quantas vezes?", startedAt: new Date(Date.now() - 7 * 60 * 1000) },
  { patientName: "Pedro Costa", patientInitials: "PC", attendantName: "Ana", attendantInitials: "AR", lastMessage: "Qual horário disponível para amanhã?", startedAt: new Date(Date.now() - 1 * 60 * 1000) },
  { patientName: "Lucia Ferreira", patientInitials: "LF", attendantName: "Beatriz", attendantInitials: "BL", lastMessage: "Obrigada, vou confirmar com meu marido", startedAt: new Date(Date.now() - 12 * 60 * 1000) },
];

function DashboardPage() {
  const agenda = getAgendaKpis();
  const orcamento = getOrcamentoKpis();
  const crm = getCrmKpis();
  const estoque = getEstoqueKpis();
  const pacientes = getPacienteKpis();

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 p-8 space-y-8 overflow-auto">

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
            <KpiCard title="Receita Total" value={`R$ ${crm.receitaTotal.toLocaleString("pt-BR")}`} icon={DollarSign} />
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mockAttendances.map((a) => (
              <ActiveAttendanceCard key={a.patientName} {...a} />
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
