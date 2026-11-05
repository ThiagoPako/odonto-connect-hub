import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search, FileText, Calendar, User, Clock, Stethoscope,
  Pill, ChevronDown, Mic, Bot, Sparkles, X, Activity,
  Download, FileDown, Filter,
} from "lucide-react";
import { aiApi, type ClinicalReportApi } from "@/lib/vpsApi";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { exportarRelatoriosClinicosPdf } from "@/lib/relatoriosClinicosPdfExport";
import { toast } from "sonner";
import { simpleMarkdownToHtml } from "@/lib/safeHtml";
import { useAuth } from "@/hooks/useAuth";
import { AprovarRelatorioIA, AvisoDecisaoClinica, RotuloRelatorioIA, relatorioAprovado } from "@/components/RelatorioIaRevisao";

export const Route = createFileRoute("/relatorios-clinicos")({
  ssr: false,
  component: RelatoriosClinicosPage,
});

type StatusFilter = 'todos' | 'com_prescricao' | 'sem_prescricao';

// Teto do servidor em GET /api/ai/reports.
// TODO(minimização): a lista de pacientes do filtro vem de até 1000 relatórios completos; o
// ideal é um endpoint que devolva só patient_id/patient_name distintos (não existe hoje).
const LIMITE_PACIENTES = 1000;

function RelatoriosClinicosPage() {
  const { user } = useAuth();
  // Exportação em massa é só do admin (o servidor também bloqueia e registra cada exportação)
  const isAdmin = user?.role === "admin";
  const [busca, setBusca] = useState("");
  const [reports, setReports] = useState<ClinicalReportApi[]>([]);
  const [stats, setStats] = useState<{
    total: number; com_prescricao: number; sem_prescricao: number; pacientes_unicos: number; duracao_total_min: number;
    pendentes_revisao?: number; prazo_revisao_dias?: number;
  }>({ total: 0, com_prescricao: 0, sem_prescricao: 0, pacientes_unicos: 0, duracao_total_min: 0 });
  // Começa em true para não piscar "Nenhum relatório" antes da primeira carga
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relatorioAberto, setRelatorioAberto] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [pacienteFilter, setPacienteFilter] = useState<string | null>(null);
  const [buscaPaciente, setBuscaPaciente] = useState("");
  const [pacientesBase, setPacientesBase] = useState<ClinicalReportApi[]>([]);
  const [loadingPacientes, setLoadingPacientes] = useState(true);
  const [erroPacientes, setErroPacientes] = useState<string | null>(null);
  const [tentativaPacientes, setTentativaPacientes] = useState(0);
  const [pacientesTruncados, setPacientesTruncados] = useState(false);

  const buildFilters = useCallback(() => ({
    from: dateFrom ? format(dateFrom, 'yyyy-MM-dd') : undefined,
    to: dateTo ? format(dateTo, 'yyyy-MM-dd') : undefined,
    status: statusFilter,
    patientId: pacienteFilter || undefined,
    q: busca.trim() || undefined,
  }), [dateFrom, dateTo, statusFilter, pacienteFilter, busca]);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await aiApi.listReports(buildFilters());
      if (err) {
        setError(err);
        setReports([]);
        return;
      }
      if (data) {
        setReports(data.reports);
        setStats(data.stats);
      }
    } finally {
      setLoading(false);
    }
  }, [buildFilters]);

  useEffect(() => {
    const t = setTimeout(carregar, 300);
    return () => clearTimeout(t);
  }, [carregar]);

  // Lista de pacientes do filtro lateral: depende só do período, para que
  // escolher um paciente ou um status não esconda os outros pacientes.
  // O servidor devolve no máximo LIMITE_PACIENTES relatórios; acima disso a lista sai incompleta.
  const fromStr = dateFrom ? format(dateFrom, 'yyyy-MM-dd') : undefined;
  const toStr = dateTo ? format(dateTo, 'yyyy-MM-dd') : undefined;
  useEffect(() => {
    let ativo = true;
    setLoadingPacientes(true);
    setErroPacientes(null);
    aiApi.listReports({ from: fromStr, to: toStr, limit: LIMITE_PACIENTES }).then(({ data, error: err }) => {
      if (!ativo) return;
      if (err) {
        setErroPacientes(err);
        setPacientesBase([]);
        setPacientesTruncados(false);
      } else if (data) {
        setPacientesBase(data.reports);
        setPacientesTruncados(data.reports.length >= LIMITE_PACIENTES);
      }
      setLoadingPacientes(false);
    });
    return () => { ativo = false; };
  }, [fromStr, toStr, tentativaPacientes]);

  const recarregarPacientes = () => setTentativaPacientes(n => n + 1);

  const limparFiltros = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
    setStatusFilter('todos');
    setPacienteFilter(null);
    setBusca("");
    setBuscaPaciente("");
  };

  const hasFilters = !!dateFrom || !!dateTo || statusFilter !== 'todos' || !!pacienteFilter || !!busca.trim();

  // Lista de pacientes únicos a partir dos relatórios para filtro lateral
  const pacientesDisponiveis = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; count: number }>();
    pacientesBase.forEach(r => {
      if (!r.patient_id) return;
      const existing = map.get(r.patient_id);
      if (existing) {
        existing.count++;
      } else {
        map.set(r.patient_id, { id: r.patient_id, nome: r.patient_name || 'Sem nome', count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [pacientesBase]);

  const pacientesVisiveis = useMemo(() => {
    const termo = buscaPaciente.trim().toLowerCase();
    if (!termo) return pacientesDisponiveis;
    return pacientesDisponiveis.filter(p => p.nome.toLowerCase().includes(termo));
  }, [pacientesDisponiveis, buscaPaciente]);

  // Só o aprovado é histórico clínico oficial; rascunhos (novos e antigos) e não aprovados ficam à parte
  const oficiais = reports.filter(r => r.status === 'aprovado');
  const pendentes = reports.filter(r => r.status !== 'aprovado' && r.status !== 'nao_aprovado');
  const naoAprovados = reports.filter(r => r.status === 'nao_aprovado');
  const pendentesVencidos = pendentes.filter(r => r.revisar_ate && new Date(r.revisar_ate).getTime() < Date.now()).length;

  const atualizarRelatorio = (id: string, mudanca: Partial<ClinicalReportApi>) =>
    setReports(prev => prev.map(x => (x.id === id ? { ...x, ...mudanca } : x)));

  const renderRelatorio = (r: ClinicalReportApi, i: number) => {
      const isOpen = relatorioAberto === r.id;
      const createdAt = new Date(r.created_at);
      const prescricoes: Array<{ medicamento: string; dosagem: string; posologia: string; duracao: string }> =
        typeof r.prescricoes === 'string' ? JSON.parse(r.prescricoes || '[]') : (r.prescricoes || []);

      return (
        <div
          key={r.id}
          className="bg-card rounded-2xl border border-border/60 shadow-card overflow-hidden animate-slide-up"
          style={{ animationDelay: `${Math.min(i, 10) * 30}ms`, animationFillMode: "both" }}
        >
          <button
            onClick={() => setRelatorioAberto(isOpen ? null : r.id)}
            className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
          >
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <p className="text-sm font-semibold text-foreground truncate">
                  {r.patient_name || 'Paciente'}
                </p>
                {r.dente_regiao && (
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium shrink-0">
                    {r.dente_regiao}
                  </span>
                )}
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium",
                  relatorioAprovado(r) ? "bg-success/10 text-success" : "bg-warning/15 text-foreground"
                )}>
                  {relatorioAprovado(r) ? "Aprovado" : r.status === 'nao_aprovado' ? "Não aprovado" : r.origem_ia_sem_revisao ? "Rascunho antigo" : "Rascunho IA"}
                </span>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium",
                  prescricoes.length > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  {prescricoes.length > 0 ? `${prescricoes.length} Rx` : 'Sem Rx'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(createdAt, "dd/MM/yyyy")}</span>
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{format(createdAt, "HH:mm")}</span>
                {r.attendant_name && (
                  <span className="flex items-center gap-1"><Stethoscope className="h-3 w-3" />{r.attendant_name}</span>
                )}
                {r.duration_seconds > 0 && (
                  <span className="flex items-center gap-1"><Activity className="h-3 w-3" />{Math.round(r.duration_seconds / 60)} min</span>
                )}
                {r.procedimento && (
                  <span className="flex items-center gap-1 truncate max-w-[200px]"><MessageSquareIcon /> {r.procedimento}</span>
                )}
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
          </button>

          {isOpen && (
            <div className="border-t border-border/40 p-5 space-y-4 animate-slide-up">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {r.queixa_principal && (
                  <InfoBlock label="Queixa Principal" value={r.queixa_principal} />
                )}
                {r.procedimento && (
                  <InfoBlock label="Procedimento" value={r.procedimento} />
                )}
                {r.dente_regiao && (
                  <InfoBlock label="Dente / Região" value={r.dente_regiao} />
                )}
                {r.duration_seconds > 0 && (
                  <InfoBlock label="Duração" value={`${Math.round(r.duration_seconds / 60)} min`} />
                )}
              </div>

              {prescricoes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <Pill className="h-3.5 w-3.5 text-primary" /> Prescrições
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {prescricoes.map((rx, j) => (
                      <div key={j} className="bg-primary/5 border border-primary/10 rounded-lg p-2.5 text-xs">
                        <p className="font-medium text-foreground">{rx.medicamento} {rx.dosagem}</p>
                        <p className="text-muted-foreground">{rx.posologia} — {rx.duracao}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {r.transcription && (
                <details className="group">
                  <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
                    <Mic className="h-3 w-3" /> Ver transcrição completa
                  </summary>
                  <div className="mt-2 bg-muted/30 rounded-xl p-4 text-xs text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {r.transcription}
                  </div>
                </details>
              )}

              <div className="bg-card border border-primary/20 rounded-xl p-5 space-y-3">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5 text-primary" /> Relatório Clínico IA
                </p>
                <RotuloRelatorioIA report={r} />
                {relatorioAprovado(r) ? (
                  <div
                    className="prose prose-sm max-w-none text-foreground text-xs leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: simpleMarkdownToHtml(r.report || ""),
                    }}
                  />
                ) : r.status === 'nao_aprovado' ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">Ver o texto guardado (não é registro do dentista)</summary>
                    <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{r.report}</p>
                  </details>
                ) : (
                  <AprovarRelatorioIA
                    key={r.id}
                    reportId={r.id}
                    textoInicial={r.report || ""}
                    onAprovado={(aprovacao, textoAprovado) => atualizarRelatorio(r.id, {
                      report: textoAprovado,
                      status: 'aprovado',
                      aprovado_por_nome: aprovacao.aprovado_por_nome,
                      aprovado_por_cro: aprovacao.aprovado_por_cro,
                      aprovado_por_outro_dentista: aprovacao.aprovado_por_outro_dentista,
                      aprovado_em: aprovacao.aprovado_em,
                      revisar_ate: null,
                      transcricao_apagada_em: aprovacao.transcricao_apagada_em,
                      ...(aprovacao.transcricao_mantida ? {} : { transcription: '' }),
                    })}
                    onNaoAprovado={(decisao) => atualizarRelatorio(r.id, {
                      status: 'nao_aprovado',
                      nao_aprovado_por_nome: decisao.nao_aprovado_por_nome,
                      nao_aprovado_por_cro: decisao.nao_aprovado_por_cro,
                      nao_aprovado_em: decisao.nao_aprovado_em,
                      revisar_ate: null,
                      transcricao_apagada_em: decisao.transcricao_apagada_em,
                      ...(decisao.transcricao_mantida ? {} : { transcription: '' }),
                    })}
                  />
                )}
                <AvisoDecisaoClinica />
              </div>
            </div>
          )}
        </div>
      );
  };

  // Só o admin exporta, e só relatórios aprovados: o servidor filtra e registra cada exportação
  const exportarPdf = async () => {
    const { data, error: err } = await aiApi.exportReportsPdfData(buildFilters());
    if (err || !data) {
      toast.error(err || "Não foi possível exportar");
      return;
    }
    if (data.reports.length === 0) {
      toast.error("Nenhum relatório aprovado para exportar");
      return;
    }
    const pacienteNome = pacienteFilter ? pacientesDisponiveis.find(p => p.id === pacienteFilter)?.nome : undefined;
    exportarRelatoriosClinicosPdf(data.reports, {
      from: dateFrom ? format(dateFrom, 'yyyy-MM-dd') : undefined,
      to: dateTo ? format(dateTo, 'yyyy-MM-dd') : undefined,
      status: statusFilter,
      paciente: pacienteNome,
    });
  };

  const exportarCsv = () => {
    if (oficiais.length === 0) {
      toast.error("Nenhum relatório aprovado para exportar");
      return;
    }
    const url = aiApi.exportReportsCsvUrl(buildFilters());
    window.open(url, '_blank');
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Relatórios Clínicos IA" />
      <main className="flex-1 p-4 sm:p-6 overflow-auto">
        <div className="max-w-[1400px] mx-auto">
          {/* Hero */}
          <div className="relative overflow-hidden rounded-2xl gradient-primary p-6 shadow-glow-primary mb-6">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-4 right-8 animate-float">
                <Bot className="h-16 w-16 text-primary-foreground" strokeWidth={0.8} />
              </div>
              <div className="absolute bottom-4 right-32 animate-float" style={{ animationDelay: "1s" }}>
                <FileText className="h-10 w-10 text-primary-foreground" strokeWidth={0.8} />
              </div>
            </div>
            <div className="relative z-10 flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-xl font-bold text-primary-foreground font-heading mb-1">
                  Relatórios Clínicos IA
                </h1>
                <p className="text-sm text-primary-foreground/80 max-w-md">
                  Filtre por período, status e paciente. Revise e aprove os rascunhos gerados por IA.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && (
                  <button
                    onClick={exportarPdf}
                    title="Só relatórios aprovados; cada exportação fica registrada"
                    className="h-9 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 transition-colors backdrop-blur"
                  >
                    <FileDown className="h-3.5 w-3.5" /> Exportar PDF
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={exportarCsv}
                    title="Só o administrador exporta; cada exportação fica registrada"
                    className="h-9 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 transition-colors backdrop-blur"
                  >
                    <Download className="h-3.5 w-3.5" /> Exportar CSV
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <KpiBox label="Relatórios" value={stats.total} />
            <KpiBox label="Pacientes" value={stats.pacientes_unicos} />
            <KpiBox label="Com Prescrição" value={stats.com_prescricao} accent />
            <KpiBox label="Sem Prescrição" value={stats.sem_prescricao} />
            <KpiBox label="Min totais" value={stats.duracao_total_min} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
            {/* Sidebar: filtros + pacientes */}
            <div className="lg:col-span-3 space-y-3">
              {/* Filtros */}
              <div className="bg-card rounded-2xl border border-border/60 p-4 shadow-card space-y-3">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Filter className="h-4 w-4 text-primary" /> Filtros
                </h2>

                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">Status</p>
                  <div className="flex flex-col gap-1">
                    {(['todos', 'com_prescricao', 'sem_prescricao'] as StatusFilter[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={cn(
                          "h-8 px-3 rounded-lg text-xs font-medium text-left transition-colors",
                          statusFilter === s
                            ? "bg-primary/10 text-primary border border-primary/30"
                            : "text-muted-foreground hover:bg-muted border border-transparent"
                        )}
                      >
                        {s === 'todos' ? 'Todos' : s === 'com_prescricao' ? 'Com prescrição' : 'Sem prescrição'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">Período</p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className={cn(
                        "w-full h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                        dateFrom ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                      )}>
                        <Calendar className="h-3.5 w-3.5" />
                        {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Data início"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus locale={ptBR} className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger asChild>
                      <button className={cn(
                        "w-full h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                        dateTo ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                      )}>
                        <Calendar className="h-3.5 w-3.5" />
                        {dateTo ? format(dateTo, "dd/MM/yyyy") : "Data fim"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent mode="single" selected={dateTo} onSelect={setDateTo} initialFocus locale={ptBR} className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                </div>

                {hasFilters && (
                  <button
                    onClick={limparFiltros}
                    className="w-full h-8 px-3 rounded-lg border border-destructive/30 text-destructive text-xs font-medium hover:bg-destructive/5 transition-colors inline-flex items-center justify-center gap-1.5"
                  >
                    <X className="h-3 w-3" /> Limpar filtros
                  </button>
                )}
              </div>

              {/* Pacientes */}
              <div className="bg-card rounded-2xl border border-border/60 p-4 shadow-card">
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" /> Pacientes
                </h2>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Filtrar pacientes por nome..."
                    aria-label="Filtrar pacientes por nome"
                    value={buscaPaciente}
                    onChange={e => setBuscaPaciente(e.target.value)}
                    className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                  <button
                    onClick={() => setPacienteFilter(null)}
                    className={cn(
                      "w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors",
                      !pacienteFilter ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    Todos os pacientes
                  </button>
                  {pacientesVisiveis.map(p => {
                    const sel = pacienteFilter === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPacienteFilter(sel ? null : p.id)}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs text-left transition-colors",
                          sel ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted"
                        )}
                      >
                        <span className="truncate">{p.nome}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">{p.count}</span>
                      </button>
                    );
                  })}
                  {loadingPacientes ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Carregando pacientes...</p>
                  ) : erroPacientes ? (
                    <div role="alert" className="text-xs text-destructive text-center py-3 space-y-2">
                      <p>Não foi possível carregar a lista de pacientes: {erroPacientes}</p>
                      <button
                        onClick={recarregarPacientes}
                        className="h-8 px-3 rounded-lg border border-destructive/30 font-medium hover:bg-destructive/10 transition-colors"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : pacientesVisiveis.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      {buscaPaciente.trim() ? "Nenhum paciente com esse nome" : "Nenhum paciente"}
                    </p>
                  )}
                  {!loadingPacientes && !erroPacientes && pacientesTruncados && (
                    <p className="text-[11px] text-muted-foreground px-2.5 py-2">
                      Lista incompleta: o período tem mais de {LIMITE_PACIENTES} relatórios. Escolha um período menor para ver todos os pacientes.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Conteúdo principal */}
            <div className="lg:col-span-9 space-y-3">
              {/* Busca geral: o servidor procura no nome do paciente, na queixa e no procedimento (não no texto do relatório) */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar por paciente, queixa ou procedimento..."
                  aria-label="Buscar por paciente, queixa ou procedimento"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {error && (
                <div role="alert" className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 text-sm text-destructive">
                  <p>Erro ao carregar relatórios: {error}</p>
                  <button
                    onClick={() => { carregar(); if (erroPacientes) recarregarPacientes(); }}
                    className="mt-2 h-8 px-3 rounded-lg border border-destructive/30 text-xs font-medium hover:bg-destructive/10 transition-colors"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {loading ? (
                <div className="bg-card rounded-2xl border border-border/60 p-12 text-center shadow-card">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3 animate-pulse">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground">Carregando relatórios...</p>
                </div>
              ) : error ? null : reports.length === 0 ? (
                <div className="bg-card rounded-2xl border-2 border-dashed border-border p-12 text-center">
                  <Stethoscope className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">Nenhum relatório encontrado</p>
                  <p className="text-xs text-muted-foreground/60">
                    {hasFilters ? "Tente ajustar os filtros" : "Gere relatórios pelo módulo de Atendimento"}
                  </p>
                </div>
              ) : (
                <>
                  {oficiais.length === 0 ? (
                    <div className="bg-card rounded-2xl border-2 border-dashed border-border p-8 text-center">
                      <p className="text-sm font-medium text-muted-foreground">Nenhum relatório aprovado neste filtro</p>
                      <p className="text-xs text-muted-foreground/60">Os rascunhos de IA aparecem abaixo até o dentista revisar.</p>
                    </div>
                  ) : oficiais.map(renderRelatorio)}

                  {pendentes.length > 0 && (
                    <details className="bg-warning/5 rounded-2xl border border-warning/30 p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">
                        Rascunhos de IA pendentes de revisão ({pendentes.length}) — não são registro do dentista
                        {pendentesVencidos > 0 && (
                          <span className="ml-2 text-xs font-medium text-destructive">{pendentesVencidos} com prazo vencido</span>
                        )}
                      </summary>
                      <p className="text-xs text-muted-foreground mt-2">
                        Ficam guardados, fora do histórico clínico oficial, da impressão e das exportações, até o dentista
                        do atendimento aprovar ou não aprovar. Prazo de revisão: {stats.prazo_revisao_dias ?? 60} dias.
                      </p>
                      <div className="space-y-3 mt-3">{pendentes.map(renderRelatorio)}</div>
                    </details>
                  )}

                  {naoAprovados.length > 0 && (
                    <details className="bg-muted/30 rounded-2xl border border-border/60 p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
                        Não aprovados ({naoAprovados.length}) — guardados só para auditoria
                      </summary>
                      <div className="space-y-3 mt-3">{naoAprovados.map(renderRelatorio)}</div>
                    </details>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiBox({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={cn(
      "bg-card rounded-xl border p-3 shadow-card",
      accent ? "border-primary/30 bg-primary/5" : "border-border/60"
    )}>
      <p className={cn("text-xl font-bold font-heading", accent ? "text-primary" : "text-foreground")}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase mt-0.5 font-semibold">{label}</p>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-xl p-3">
      <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">{label}</p>
      <p className="text-xs text-foreground">{value}</p>
    </div>
  );
}

function MessageSquareIcon() {
  return <FileText className="h-3 w-3" />;
}
