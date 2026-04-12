import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useState, useEffect, useCallback } from "react";
import {
  Search, FileText, Calendar, User, Clock, Stethoscope,
  Pill, ChevronRight, ChevronDown, Mic, Bot, Sparkles,
  Filter, X, CalendarCheck, MessageSquare, Activity,
} from "lucide-react";
import { aiApi, type ClinicalReportApi } from "@/lib/vpsApi";
import { mockPacientes, type Paciente } from "@/data/registroCentral";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/relatorios-clinicos")({
  ssr: false,
  component: RelatoriosClinicosPage,
});

function RelatoriosClinicosPage() {
  const [busca, setBusca] = useState("");
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);
  const [relatorios, setRelatorios] = useState<ClinicalReportApi[]>([]);
  const [loading, setLoading] = useState(false);
  const [relatorioAberto, setRelatorioAberto] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const pacientesFiltrados = mockPacientes.filter(p =>
    p.nome.toLowerCase().includes(busca.toLowerCase())
  );

  const carregarRelatorios = useCallback(async (patientId: string) => {
    setLoading(true);
    try {
      const { data, error } = await aiApi.getReports(patientId);
      if (data && !error) {
        setRelatorios(data);
      } else {
        setRelatorios([]);
      }
    } catch {
      setRelatorios([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pacienteSelecionado) {
      carregarRelatorios(pacienteSelecionado.id);
      setRelatorioAberto(null);
    } else {
      setRelatorios([]);
    }
  }, [pacienteSelecionado, carregarRelatorios]);

  const relatoriosFiltrados = relatorios.filter(r => {
    if (dateFrom) {
      const rDate = new Date(r.created_at);
      if (rDate < dateFrom) return false;
    }
    if (dateTo) {
      const rDate = new Date(r.created_at);
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      if (rDate > endOfDay) return false;
    }
    return true;
  });

  const limparFiltros = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const hasFilters = !!dateFrom || !!dateTo;

  const getPacienteIniciais = (p: Paciente) => {
    const parts = p.nome.split(" ");
    return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : p.nome.slice(0, 2);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Relatórios Clínicos IA" />
      <main className="flex-1 p-6 overflow-auto">
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
            <div className="relative z-10">
              <h1 className="text-xl font-bold text-primary-foreground font-heading mb-1">
                Histórico de Relatórios Clínicos
              </h1>
              <p className="text-sm text-primary-foreground/80 max-w-md">
                Consulte relatórios gerados pela IA durante os atendimentos. Filtre por paciente e data.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-6">
            {/* Lista de pacientes */}
            <div className="col-span-3 space-y-3">
              <div className="bg-card rounded-2xl border border-border/60 p-4 shadow-card">
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" /> Pacientes
                </h2>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Buscar paciente..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                  {pacientesFiltrados.map(p => {
                    const sel = pacienteSelecionado?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setPacienteSelecionado(p); setBusca(""); }}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-300 hover-lift ${
                          sel
                            ? "border border-primary bg-primary/5 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)] ring-1 ring-primary/20"
                            : "border border-transparent hover:bg-muted/60 hover:border-border/60"
                        }`}
                      >
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                          {getPacienteIniciais(p)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{p.nome}</p>
                          <p className="text-[11px] text-muted-foreground">{p.telefone}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Conteúdo principal */}
            <div className="col-span-9 space-y-4">
              {pacienteSelecionado ? (
                <>
                  {/* Header do paciente + filtros */}
                  <div className="bg-card rounded-2xl border border-border/60 p-4 shadow-card">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
                          {getPacienteIniciais(pacienteSelecionado)}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">{pacienteSelecionado.nome}</h3>
                          <p className="text-xs text-muted-foreground">{relatoriosFiltrados.length} relatório(s) encontrado(s)</p>
                        </div>
                      </div>

                      {/* Filtros de data */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className={cn(
                              "h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                              dateFrom ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}>
                              <Calendar className="h-3.5 w-3.5" />
                              {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Data início"}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="end">
                            <CalendarComponent
                              mode="single"
                              selected={dateFrom}
                              onSelect={setDateFrom}
                              initialFocus
                              locale={ptBR}
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>

                        <Popover>
                          <PopoverTrigger asChild>
                            <button className={cn(
                              "h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                              dateTo ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}>
                              <Calendar className="h-3.5 w-3.5" />
                              {dateTo ? format(dateTo, "dd/MM/yyyy") : "Data fim"}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="end">
                            <CalendarComponent
                              mode="single"
                              selected={dateTo}
                              onSelect={setDateTo}
                              initialFocus
                              locale={ptBR}
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>

                        {hasFilters && (
                          <button
                            onClick={limparFiltros}
                            className="h-9 px-3 rounded-lg border border-destructive/30 text-destructive text-xs font-medium hover:bg-destructive/5 transition-colors inline-flex items-center gap-1.5"
                          >
                            <X className="h-3 w-3" /> Limpar
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Lista de relatórios */}
                  {loading ? (
                    <div className="bg-card rounded-2xl border border-border/60 p-12 text-center shadow-card">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3 animate-pulse">
                        <Bot className="h-5 w-5 text-primary" />
                      </div>
                      <p className="text-sm text-muted-foreground">Carregando relatórios...</p>
                    </div>
                  ) : relatoriosFiltrados.length === 0 ? (
                    <div className="bg-card rounded-2xl border-2 border-dashed border-border p-12 text-center">
                      <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground mb-1">Nenhum relatório encontrado</p>
                      <p className="text-xs text-muted-foreground/60">
                        {hasFilters
                          ? "Tente ajustar os filtros de data"
                          : "Gere relatórios pelo módulo de Atendimento"
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {relatoriosFiltrados.map((r, i) => {
                        const isOpen = relatorioAberto === r.id;
                        const createdAt = new Date(r.created_at);
                        const prescricoes: Array<{ medicamento: string; dosagem: string; posologia: string; duracao: string }> = 
                          typeof r.prescricoes === 'string' ? JSON.parse(r.prescricoes || '[]') : (r.prescricoes || []);

                        return (
                          <div
                            key={r.id}
                            className="bg-card rounded-2xl border border-border/60 shadow-card overflow-hidden animate-slide-up"
                            style={{ animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
                          >
                            {/* Header do relatório */}
                            <button
                              onClick={() => setRelatorioAberto(isOpen ? null : r.id)}
                              className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
                            >
                              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                <Sparkles className="h-5 w-5 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <p className="text-sm font-semibold text-foreground truncate">
                                    {r.procedimento || r.queixa_principal || "Relatório Clínico"}
                                  </p>
                                  {r.dente_regiao && (
                                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium shrink-0">
                                      {r.dente_regiao}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {format(createdAt, "dd/MM/yyyy")}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {format(createdAt, "HH:mm")}
                                  </span>
                                  {r.duration_seconds > 0 && (
                                    <span className="flex items-center gap-1">
                                      <Activity className="h-3 w-3" />
                                      {Math.round(r.duration_seconds / 60)} min
                                    </span>
                                  )}
                                  {prescricoes.length > 0 && (
                                    <span className="flex items-center gap-1">
                                      <Pill className="h-3 w-3" />
                                      {prescricoes.length} prescrição(ões)
                                    </span>
                                  )}
                                </div>
                              </div>
                              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                            </button>

                            {/* Conteúdo expandido */}
                            {isOpen && (
                              <div className="border-t border-border/40 p-5 space-y-4 animate-slide-up">
                                {/* Dados do atendimento */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                  {r.queixa_principal && (
                                    <div className="bg-muted/30 rounded-xl p-3">
                                      <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Queixa Principal</p>
                                      <p className="text-xs text-foreground">{r.queixa_principal}</p>
                                    </div>
                                  )}
                                  {r.procedimento && (
                                    <div className="bg-muted/30 rounded-xl p-3">
                                      <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Procedimento</p>
                                      <p className="text-xs text-foreground">{r.procedimento}</p>
                                    </div>
                                  )}
                                  {r.dente_regiao && (
                                    <div className="bg-muted/30 rounded-xl p-3">
                                      <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Dente / Região</p>
                                      <p className="text-xs text-foreground">{r.dente_regiao}</p>
                                    </div>
                                  )}
                                  {r.duration_seconds > 0 && (
                                    <div className="bg-muted/30 rounded-xl p-3">
                                      <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Duração</p>
                                      <p className="text-xs text-foreground">{Math.round(r.duration_seconds / 60)} minutos</p>
                                    </div>
                                  )}
                                </div>

                                {/* Prescrições */}
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

                                {/* Transcrição */}
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

                                {/* Relatório */}
                                <div className="bg-card border border-primary/20 rounded-xl p-5">
                                  <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                                    <Bot className="h-3.5 w-3.5 text-primary" /> Relatório Clínico IA
                                  </p>
                                  <div
                                    className="prose prose-sm max-w-none text-foreground text-xs leading-relaxed"
                                    dangerouslySetInnerHTML={{
                                      __html: (r.report || "")
                                        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                                        .replace(/^### (.*$)/gm, '<h4 class="text-sm font-semibold text-foreground mt-3 mb-1">$1</h4>')
                                        .replace(/^## (.*$)/gm, '<h3 class="text-sm font-bold text-foreground mt-4 mb-2">$1</h3>')
                                        .replace(/^# (.*$)/gm, '<h2 class="text-base font-bold text-foreground mt-4 mb-2">$1</h2>')
                                        .replace(/^- (.*$)/gm, '<li class="ml-4 list-disc text-muted-foreground">$1</li>')
                                        .replace(/\n\n/g, "<br/><br/>")
                                        .replace(/\n/g, "<br/>"),
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-card rounded-2xl border-2 border-dashed border-border p-16 text-center">
                  <Stethoscope className="h-12 w-12 text-primary/20 mx-auto mb-4 animate-float" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">Relatórios Clínicos</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Selecione um paciente para visualizar o histórico de relatórios clínicos gerados pela IA durante os atendimentos.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
