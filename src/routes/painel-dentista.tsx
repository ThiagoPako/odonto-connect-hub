import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  painelDentistaApi,
  type DentistaPainel,
  type PainelAtendimento,
  type PainelAgenda,
  type PainelOrcamento,
  type PainelProntuario,
  type PainelComissao,
  type PainelTratamento,
} from "@/lib/vpsApi";
import { TratamentoFromAgendaDialog } from "@/components/dentista/TratamentoFromAgendaDialog";
import { useTratamentoRealtime } from "@/hooks/useTratamentoRealtime";
import { toast } from "sonner";
import {
  CalendarDays,
  Clock,
  FileHeart,
  Receipt,
  Stethoscope,
  AlertCircle,
  CheckCircle2,
  Play,
  User,
  ChevronRight,
  ArrowLeft,
  ExternalLink,
  Percent,
  DollarSign,
  TrendingUp,
  Loader2,
  RefreshCw,
  Plus,
  Pencil,
} from "lucide-react";

export const Route = createFileRoute("/painel-dentista")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || "",
  }),
  ssr: false,
  component: PainelDentistaPage,
});

type Tab = "atendimentos" | "agenda" | "orcamentos" | "prontuario" | "comissoes";

function PainelDentistaPage() {
  const { id } = Route.useSearch();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("atendimentos");
  const [data, setData] = useState<DentistaPainel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: payload, error: err } = await painelDentistaApi.get(id || undefined);
    if (err) setError(err);
    else setData(payload);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Realtime: recarrega painel quando tratamentos mudam (deste dentista)
  useTratamentoRealtime((evt) => {
    load();
    if (evt.action === "created") toast.info("Novo tratamento criado");
    else if (evt.action === "updated") toast.info("Tratamento atualizado");
    else if (evt.action === "deleted") toast.info("Tratamento removido");
  }, data?.dentista?.id || id || undefined);

  if (loading && !data) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Painel — Dentista" />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando painel…
          </div>
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Painel — Dentista" />
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-sm text-foreground font-semibold">Não foi possível carregar o painel</p>
            <p className="text-xs text-muted-foreground mt-1">{error || "Dentista não encontrado."}</p>
            <button
              onClick={load}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </button>
          </div>
        </main>
      </div>
    );
  }

  const { dentista, atendimentos, agenda, orcamentos, prontuarios, comissoes, tratamentos } = data;

  const tabs: { key: Tab; label: string; icon: typeof Stethoscope; count: number }[] = [
    { key: "atendimentos", label: "Atendimentos", icon: Stethoscope, count: atendimentos.length },
    { key: "agenda", label: "Agenda", icon: CalendarDays, count: agenda.length },
    { key: "comissoes", label: "Comissões", icon: Percent, count: comissoes.length },
    { key: "orcamentos", label: "Orçamentos", icon: Receipt, count: orcamentos.length },
    { key: "prontuario", label: "Prontuários", icon: FileHeart, count: prontuarios.length },
  ];

  const isPaga = (s: string) => s === "paga" || s === "pago";
  const totalComissoes = comissoes.reduce((s, c) => s + c.valorComissao, 0);
  const comissoesPagas = comissoes.filter((c) => isPaga(c.status)).reduce((s, c) => s + c.valorComissao, 0);
  const comissoesPendentes = comissoes.filter((c) => c.status === "pendente").reduce((s, c) => s + c.valorComissao, 0);

  const isAprovado = (s: string) => s === "aprovado" || s === "em_tratamento" || s === "finalizado";

  const iniciaisDentista = dentista.nome
    .split(" ")
    .filter((_, i, arr) => i === 0 || i === arr.length - 1)
    .map((n) => n[0])
    .join("");

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title={`Painel — ${dentista.nome}`} />
      <main className="flex-1 p-8 space-y-6 overflow-auto">
        {user?.role === "admin" && (
          <div className="flex items-center gap-4 animate-fade-in">
            <Link
              to="/dentistas"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Link>
            <button
              onClick={load}
              className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>
        )}

        {/* Dentist Profile Card */}
        <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card flex items-center gap-6 animate-fade-in">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center text-xl font-bold text-primary font-heading">
            {iniciaisDentista}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-foreground font-heading">{dentista.nome}</h2>
            <div className="flex items-center gap-4 mt-1 flex-wrap">
              {dentista.cro && <span className="text-xs text-muted-foreground">{dentista.cro}</span>}
              {dentista.especialidade && <span className="text-xs text-muted-foreground">{dentista.especialidade}</span>}
              <span className="text-xs text-muted-foreground">Comissão: {dentista.comissao}%</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  dentista.status === "ativo"
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {dentista.status === "ativo" ? "Ativo" : "Inativo"}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground font-heading">{atendimentos.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Atendimentos</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground font-heading">
                {orcamentos.filter((o) => isAprovado(o.status)).length}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Aprovados</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-primary font-heading">
                R$ {orcamentos
                  .filter((o) => isAprovado(o.status))
                  .reduce((sum, o) => sum + o.total, 0)
                  .toLocaleString("pt-BR")}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Faturamento</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-success font-heading">
                R$ {totalComissoes.toLocaleString("pt-BR")}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Comissões</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border/60 pb-0 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-[1px] whitespace-nowrap ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              <span
                className={`h-5 min-w-[22px] px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                  activeTab === tab.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="animate-fade-in">
          {activeTab === "atendimentos" && <AtendimentosTab atendimentos={atendimentos} />}
          {activeTab === "agenda" && (
            <AgendaTab
              agenda={agenda}
              tratamentos={tratamentos}
              dentistaId={dentista.id}
              onChanged={load}
            />
          )}
          {activeTab === "comissoes" && (
            <ComissoesTab
              comissoes={comissoes}
              totalComissoes={totalComissoes}
              comissoesPagas={comissoesPagas}
              comissoesPendentes={comissoesPendentes}
            />
          )}
          {activeTab === "orcamentos" && <OrcamentosTab orcamentos={orcamentos} />}
          {activeTab === "prontuario" && <ProntuarioTab prontuarios={prontuarios} />}
        </div>
      </main>
    </div>
  );
}

// ─── Comissões Tab ──────────────────────────────────────────

function ComissoesTab({
  comissoes,
  totalComissoes,
  comissoesPagas,
  comissoesPendentes,
}: {
  comissoes: PainelComissao[];
  totalComissoes: number;
  comissoesPagas: number;
  comissoesPendentes: number;
}) {
  const statusConfig: Record<string, { label: string; color: string }> = {
    pendente: { label: "Pendente", color: "bg-warning/10 text-warning" },
    aprovada: { label: "Aprovada", color: "bg-info/10 text-info" },
    aprovado: { label: "Aprovada", color: "bg-info/10 text-info" },
    paga: { label: "Paga", color: "bg-success/10 text-success" },
    pago: { label: "Paga", color: "bg-success/10 text-success" },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total</p>
          </div>
          <p className="text-2xl font-bold text-foreground font-heading">R$ {totalComissoes.toLocaleString("pt-BR")}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-success/10 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-success" />
            </div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pagas</p>
          </div>
          <p className="text-2xl font-bold text-success font-heading">R$ {comissoesPagas.toLocaleString("pt-BR")}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Clock className="h-5 w-5 text-warning" />
            </div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pendentes</p>
          </div>
          <p className="text-2xl font-bold text-warning font-heading">R$ {comissoesPendentes.toLocaleString("pt-BR")}</p>
        </div>
      </div>

      <div className="space-y-3">
        {comissoes.map((c) => {
          const st = statusConfig[c.status] || { label: c.status, color: "bg-muted text-muted-foreground" };
          return (
            <div
              key={c.id}
              className="bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-card-hover transition-all flex items-center gap-4"
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Percent className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{c.pacienteNome}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{c.procedimento}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {new Date(c.data).toLocaleDateString("pt-BR")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  R$ {c.valorProcedimento.toLocaleString("pt-BR")} × {c.percentual}%
                </p>
              </div>
              <div className="text-right min-w-[100px]">
                <p className="text-sm font-bold text-foreground font-heading">
                  R$ {c.valorComissao.toLocaleString("pt-BR")}
                </p>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${st.color}`}>
                {st.label}
              </span>
            </div>
          );
        })}
        {comissoes.length === 0 && (
          <div className="text-center py-16">
            <Percent className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">Nenhuma comissão registrada.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Atendimentos Tab ───────────────────────────────────────

function AtendimentosTab({ atendimentos }: { atendimentos: PainelAtendimento[] }) {
  const statusConfig: Record<string, { label: string; icon: typeof Clock; color: string }> = {
    agendado: { label: "Agendado", icon: Clock, color: "bg-info/10 text-info" },
    em_atendimento: { label: "Em Atendimento", icon: Play, color: "bg-warning/10 text-warning" },
    concluido: { label: "Concluído", icon: CheckCircle2, color: "bg-success/10 text-success" },
    cancelado: { label: "Cancelado", icon: AlertCircle, color: "bg-destructive/10 text-destructive" },
  };

  const tipoConfig: Record<string, string> = {
    consulta: "bg-info/10 text-info",
    retorno: "bg-muted text-muted-foreground",
    procedimento: "bg-primary/10 text-primary",
    urgencia: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="space-y-3">
      {atendimentos.map((a) => {
        const st = statusConfig[a.status] || statusConfig.agendado;
        const StIcon = st.icon;
        return (
          <div
            key={a.id}
            className="bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-card-hover transition-all flex items-center gap-4"
          >
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {a.pacienteIniciais}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{a.pacienteNome}</p>
                {a.pacienteId && (
                  <Link
                    to="/pacientes"
                    search={{ pacienteId: a.pacienteId }}
                    className="p-0.5 rounded hover:bg-primary/10"
                    title="Ver ficha"
                  >
                    <ExternalLink className="h-3 w-3 text-primary" />
                  </Link>
                )}
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                    tipoConfig[a.tipo] || "bg-muted text-muted-foreground"
                  }`}
                >
                  {a.tipo}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{a.procedimento}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-foreground font-heading">{a.horario}</p>
              {a.valor != null && (
                <p className="text-xs text-muted-foreground mt-0.5">R$ {a.valor.toLocaleString("pt-BR")}</p>
              )}
            </div>
            <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold ${st.color}`}>
              <StIcon className="h-3.5 w-3.5" />
              {st.label}
            </span>
          </div>
        );
      })}
      {atendimentos.length === 0 && (
        <div className="text-center py-16">
          <Stethoscope className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">Nenhum atendimento hoje.</p>
        </div>
      )}
    </div>
  );
}

// ─── Agenda Tab ─────────────────────────────────────────────

function AgendaTab({
  agenda,
  tratamentos,
  dentistaId,
  onChanged,
}: {
  agenda: PainelAgenda[];
  tratamentos: PainelTratamento[];
  dentistaId: string;
  onChanged: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const sameDay = (d: string) => String(d).slice(0, 10) === today;
  const agendaHoje = agenda.filter((a) => sameDay(a.data));
  const agendaFutura = agenda.filter((a) => !sameDay(a.data));

  // Estado do diálogo
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPaciente, setDialogPaciente] = useState<{ id: string; nome: string } | null>(null);
  const [dialogTratamento, setDialogTratamento] = useState<PainelTratamento | null>(null);

  const abrirNovo = (pacienteId: string, pacienteNome: string) => {
    setDialogPaciente({ id: pacienteId, nome: pacienteNome });
    setDialogTratamento(null);
    setDialogOpen(true);
  };

  const abrirEditar = (t: PainelTratamento) => {
    setDialogPaciente({ id: t.pacienteId || "", nome: t.pacienteNome });
    setDialogTratamento(t);
    setDialogOpen(true);
  };

  // Mapeia tratamento ativo por paciente (mais recente não finalizado)
  const tratamentoAtivoPorPaciente = new Map<string, PainelTratamento>();
  tratamentos.forEach((t) => {
    if (!t.pacienteId) return;
    if (t.status === "finalizado") return;
    const existing = tratamentoAtivoPorPaciente.get(t.pacienteId);
    if (!existing || new Date(t.criadoEm) > new Date(existing.criadoEm)) {
      tratamentoAtivoPorPaciente.set(t.pacienteId, t);
    }
  });

  const statusColor: Record<string, string> = {
    agendado: "border-l-info",
    confirmado: "border-l-success",
    cancelado: "border-l-destructive",
  };

  const statusTratLabel: Record<string, { label: string; color: string }> = {
    planejado: { label: "Planejado", color: "bg-info/10 text-info border-info/30" },
    em_andamento: { label: "Em andamento", color: "bg-success/10 text-success border-success/30" },
    pausado: { label: "Pausado", color: "bg-warning/10 text-warning border-warning/30" },
    finalizado: { label: "Finalizado", color: "bg-muted text-muted-foreground border-border" },
  };

  const renderAgendaItem = (item: PainelAgenda) => {
    const tratAtivo = item.pacienteId ? tratamentoAtivoPorPaciente.get(item.pacienteId) : null;
    const tratStyle = tratAtivo ? statusTratLabel[tratAtivo.status] || { label: tratAtivo.status, color: "bg-muted text-muted-foreground border-border" } : null;

    return (
      <div
        key={item.id}
        className={`bg-card rounded-xl border border-border/60 p-4 shadow-card border-l-4 ${
          statusColor[item.status] || "border-l-muted"
        } flex items-center gap-4 flex-wrap`}
      >
        <div className="text-center min-w-[60px]">
          <p className="text-lg font-bold text-foreground font-heading">{item.horario}</p>
          <p className="text-[10px] text-muted-foreground">{item.duracao}min</p>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-foreground">{item.pacienteNome}</p>
            {item.pacienteId && (
              <Link
                to="/pacientes"
                search={{ pacienteId: item.pacienteId }}
                className="p-0.5 rounded hover:bg-primary/10"
                title="Ver ficha"
              >
                <ExternalLink className="h-3 w-3 text-primary" />
              </Link>
            )}
            {tratAtivo && tratStyle && (
              <button
                type="button"
                onClick={() => abrirEditar(tratAtivo)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border hover:opacity-80 transition-opacity ${tratStyle.color}`}
                title="Editar tratamento ativo"
              >
                <Stethoscope className="h-3 w-3" />
                {tratStyle.label}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground capitalize mt-0.5">{item.tipo}</p>
        </div>

        <div className="flex items-center gap-2">
          {item.pacienteId && (
            tratAtivo ? (
              <button
                type="button"
                onClick={() => abrirEditar(tratAtivo)}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
                title="Editar tratamento"
              >
                <Pencil className="h-3 w-3" />
                Tratamento
              </button>
            ) : (
              <button
                type="button"
                onClick={() => abrirNovo(item.pacienteId!, item.pacienteNome)}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
                title="Criar tratamento"
              >
                <Plus className="h-3 w-3" />
                Tratamento
              </button>
            )
          )}
          <span
            className={`text-[10px] font-bold uppercase tracking-wider ${
              item.status === "confirmado"
                ? "text-success"
                : item.status === "cancelado"
                ? "text-destructive"
                : "text-info"
            }`}
          >
            {item.status}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          Hoje
        </h3>
        <div className="space-y-2">
          {agendaHoje.map(renderAgendaItem)}
          {agendaHoje.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum agendamento para hoje.</p>
          )}
        </div>
      </div>
      {agendaFutura.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            Próximos Dias
          </h3>
          <div className="space-y-2">
            {agendaFutura.map((item) => (
              <div key={item.id}>
                <p className="text-[10px] text-muted-foreground mb-1 font-medium">
                  {new Date(item.data).toLocaleDateString("pt-BR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </p>
                {renderAgendaItem(item)}
              </div>
            ))}
          </div>
        </div>
      )}

      {dialogPaciente && (
        <TratamentoFromAgendaDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          pacienteId={dialogPaciente.id}
          pacienteNome={dialogPaciente.nome}
          dentistaId={dentistaId}
          tratamento={dialogTratamento}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

// ─── Orçamentos Tab ─────────────────────────────────────────

function OrcamentosTab({ orcamentos }: { orcamentos: PainelOrcamento[] }) {
  const statusConfig: Record<string, { label: string; color: string }> = {
    pendente: { label: "Pendente", color: "bg-warning/10 text-warning" },
    aprovado: { label: "Aprovado", color: "bg-success/10 text-success" },
    recusado: { label: "Recusado", color: "bg-destructive/10 text-destructive" },
    reprovado: { label: "Reprovado", color: "bg-destructive/10 text-destructive" },
    em_andamento: { label: "Em Andamento", color: "bg-info/10 text-info" },
    em_tratamento: { label: "Em Tratamento", color: "bg-info/10 text-info" },
    finalizado: { label: "Finalizado", color: "bg-success/10 text-success" },
  };

  return (
    <div className="space-y-4">
      {orcamentos.map((orc) => {
        const st = statusConfig[orc.status] || { label: orc.status, color: "bg-muted text-muted-foreground" };
        return (
          <div
            key={orc.id}
            className="bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-card-hover transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-foreground">{orc.pacienteNome}</p>
                    {orc.pacienteId && (
                      <Link
                        to="/pacientes"
                        search={{ pacienteId: orc.pacienteId }}
                        className="p-0.5 rounded hover:bg-primary/10"
                        title="Ver ficha"
                      >
                        <ExternalLink className="h-3 w-3 text-primary" />
                      </Link>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(orc.criadoEm).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${st.color}`}>
                  {st.label}
                </span>
                <p className="text-lg font-bold text-foreground font-heading">
                  R$ {orc.total.toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
            {orc.itens.length > 0 && (
              <div className="bg-muted/30 rounded-xl p-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left py-1 font-medium">Procedimento</th>
                      <th className="text-center py-1 font-medium">Qtd</th>
                      <th className="text-right py-1 font-medium">Valor</th>
                      <th className="text-right py-1 font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orc.itens.map((item, i) => (
                      <tr key={i} className="text-foreground">
                        <td className="py-1.5">{item.procedimento}</td>
                        <td className="text-center py-1.5">{item.quantidade}</td>
                        <td className="text-right py-1.5">R$ {item.valor.toLocaleString("pt-BR")}</td>
                        <td className="text-right py-1.5 font-semibold">
                          R$ {(item.valor * item.quantidade).toLocaleString("pt-BR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {orcamentos.length === 0 && (
        <div className="text-center py-16">
          <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">Nenhum orçamento registrado.</p>
        </div>
      )}
    </div>
  );
}

// ─── Prontuários Tab ────────────────────────────────────────

function ProntuarioTab({ prontuarios }: { prontuarios: PainelProntuario[] }) {
  return (
    <div className="space-y-4">
      {prontuarios.map((p) => (
        <div
          key={p.id}
          className="bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-card-hover transition-all"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {p.pacienteIniciais}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-foreground">{p.pacienteNome}</p>
                {p.pacienteId && (
                  <Link
                    to="/pacientes"
                    search={{ pacienteId: p.pacienteId }}
                    className="p-0.5 rounded hover:bg-primary/10"
                    title="Ver ficha"
                  >
                    <ExternalLink className="h-3 w-3 text-primary" />
                  </Link>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Última consulta: {new Date(p.ultimaConsulta).toLocaleDateString("pt-BR")}
              </p>
            </div>
            {p.alergias && p.alergias.length > 0 && (
              <div className="flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-[10px] font-bold text-destructive">
                  Alergias: {p.alergias.join(", ")}
                </span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-muted/30 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Diagnóstico
              </p>
              <p className="text-xs text-foreground">{p.diagnostico}</p>
            </div>
            <div className="bg-muted/30 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Tratamento
              </p>
              <p className="text-xs text-foreground">{p.tratamento}</p>
            </div>
            <div className="bg-muted/30 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Observações
              </p>
              <p className="text-xs text-foreground">{p.observacoes}</p>
            </div>
          </div>
        </div>
      ))}
      {prontuarios.length === 0 && (
        <div className="text-center py-16">
          <FileHeart className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">Nenhum prontuário registrado.</p>
        </div>
      )}
    </div>
  );
}
