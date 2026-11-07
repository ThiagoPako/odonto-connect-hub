import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { EstadoVazio } from "@/components/EstadoVazio";
import {
  CheckCircle2, Clock, Pause, PlayCircle, CalendarDays,
  FileText, Plus, Loader2, X, Trash2, Download, ClipboardList,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { BarraFiltros } from "@/components/filtros/BarraFiltros";
import { useFiltroUrl } from "@/components/filtros/useFiltroUrl";
import { tratamentosApi, dentistasApi, pacientesApi } from "@/lib/vpsApi";
import { toast } from "sonner";
import { exportarTratamentosPdf } from "@/lib/tratamentosPdfExport";
import { useTratamentoRealtime } from "@/hooks/useTratamentoRealtime";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatBRL, parseValorBRL, maskValorDigitado, isoParaBr } from "@/lib/formatos";

export const Route = createFileRoute("/tratamentos")({
  ssr: false,
  component: TratamentosPage,
});

interface TratamentoRow {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  dentista_nome: string;
  descricao: string;
  dente: string;
  valor: number;
  status: string;
  plano: string;
  observacoes: string;
  created_at: string;
}

interface EtapaRow {
  id: string;
  tratamento_id: string;
  descricao: string;
  dente: string;
  valor: number;
  status: string;
  dentista_nome: string;
  data_realizada: string;
  ordem: number;
  observacoes: string;
}

interface EtapaForm {
  descricao: string;
  dente: string;
  valor: string;
}

const treatmentStatusCfg: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  planejado: { label: "Planejado", color: "bg-chart-1/15 text-chart-1", icon: FileText },
  em_andamento: { label: "Em Andamento", color: "bg-primary/15 text-primary", icon: PlayCircle },
  pausado: { label: "Pausado", color: "bg-warning/15 text-warning", icon: Pause },
  finalizado: { label: "Finalizado", color: "bg-muted text-muted-foreground", icon: CheckCircle2 },
};

const stepStatusCfg: Record<string, { label: string; color: string }> = {
  pendente: { label: "Pendente", color: "bg-muted text-muted-foreground" },
  agendado: { label: "Agendado", color: "bg-chart-1/15 text-chart-1" },
  realizado: { label: "Realizado", color: "bg-success/15 text-success" },
  cancelado: { label: "Cancelado", color: "bg-destructive/15 text-destructive" },
};

function getInitials(name: string) {
  const partes = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)); // ignora "(Alfa)"
  return partes.filter((_, i, a) => i === 0 || i === a.length - 1).map(n => n[0]).join("").toUpperCase() || "?";
}

/** DATE do banco: usa só aaaa-mm-dd. new Date("2026-11-05") é meia-noite UTC e aparece como 04/11 no Brasil. */
function dataBr(v: string | null | undefined): string {
  return v ? isoParaBr(String(v).slice(0, 10)) : "-";
}

// Status que encerram o tratamento: pedem confirmação antes de gravar
const STATUS_ENCERRA = new Set(["finalizado", "cancelado"]);

// Data de hoje no fuso do aparelho (AAAA-MM-DD); a coluna data_realizada é DATE.
function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const AVATAR_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-primary"];

function TratamentosPage() {
  const [tratamentos, setTratamentos] = useState<TratamentoRow[]>([]);
  const [etapas, setEtapas] = useState<EtapaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useFiltroUrl("status", Object.keys(treatmentStatusCfg));
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const res = await tratamentosApi.list();
      setLoadError(res.error);
      if (res.error) { toast.error("Não foi possível carregar os tratamentos: " + res.error); return; }
      const data: any = res.data || [];
      setTratamentos(Array.isArray(data) ? data.map((r: any) => ({
        id: r.id,
        paciente_id: r.paciente_id || '',
        paciente_nome: r.paciente_nome || '',
        dentista_nome: r.dentista_nome || '',
        descricao: r.descricao || '',
        dente: r.dente || '',
        valor: Number(r.valor) || 0,
        status: r.status || 'planejado',
        plano: r.plano || '',
        observacoes: r.observacoes || '',
        created_at: r.created_at || '',
      })) : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Real-time updates for treatments
  useTratamentoRealtime(() => {
    loadAll();
    if (selectedId) loadEtapas(selectedId);
  });


  const loadEtapas = useCallback(async (tratId: string) => {
    try {
      const res = await tratamentosApi.getEtapas(tratId);
      if (res.error) { toast.error("Não foi possível carregar as etapas: " + res.error); return; }
      const data: any = res.data || [];
      setEtapas(Array.isArray(data) ? data.map((r: any) => ({
        id: r.id,
        tratamento_id: r.tratamento_id,
        descricao: r.descricao || '',
        dente: r.dente || '',
        valor: Number(r.valor) || 0,
        status: r.status || 'pendente',
        dentista_nome: r.dentista_nome || '',
        data_realizada: r.data_realizada || '',
        ordem: Number(r.ordem) || 0,
        observacoes: r.observacoes || '',
      })) : []);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    if (selectedId) loadEtapas(selectedId);
    else setEtapas([]);
  }, [selectedId, loadEtapas]);

  const handleCreate = async (data: { paciente_id: string; dentista_id: string; descricao: string; plano: string; observacoes: string; etapas: EtapaForm[] }) => {
    const valorTotal = data.etapas.reduce((s, e) => s + (Number(e.valor) || 0), 0);
    const { error, data: created } = await tratamentosApi.create({
      paciente_id: data.paciente_id,
      dentista_id: data.dentista_id,
      descricao: data.descricao,
      plano: data.plano,
      observacoes: data.observacoes,
      valor: valorTotal,
      status: 'planejado',
    }) as any;
    if (error) { toast.error("Erro ao criar tratamento: " + error); return; }

    const tratId = created?.id || (created as any)?.rows?.[0]?.id;
    let etapasFalhas = 0;
    if (tratId && data.etapas.length > 0) {
      for (let i = 0; i < data.etapas.length; i++) {
        const et = data.etapas[i];
        const { error: etapaError } = await tratamentosApi.addEtapa(tratId, {
          descricao: et.descricao,
          dente: et.dente,
          valor: Number(et.valor) || 0,
          ordem: i + 1,
          status: 'pendente',
        });
        if (etapaError) etapasFalhas++;
      }
    }
    if (etapasFalhas > 0) toast.error(`Tratamento criado, mas ${etapasFalhas} etapa(s) não foram salvas. Confira e adicione de novo.`);
    else toast.success("Tratamento criado com sucesso!");
    setShowAddModal(false);
    loadAll();
  };

  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingEtapaId, setUpdatingEtapaId] = useState<string | null>(null);
  const [confirmEtapa, setConfirmEtapa] = useState<EtapaRow | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const selecionar = (id: string) => {
    setSelectedId(id);
    // No celular o detalhe fica embaixo da lista: leva a pessoa até ele
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    setUpdatingStatus(true);
    const { error } = await tratamentosApi.update(id, { status });
    setUpdatingStatus(false);
    if (error) { toast.error("Não foi possível mudar o status: " + error); return; }
    toast.success(`Status alterado para ${(treatmentStatusCfg[status] || treatmentStatusCfg.planejado).label}.`);
    loadAll();
  };

  const handleMarcarRealizada = async (step: EtapaRow) => {
    setUpdatingEtapaId(step.id);
    const { error } = await tratamentosApi.updateEtapa(step.id, { status: 'realizado', data_realizada: hojeLocal() });
    setUpdatingEtapaId(null);
    if (error) { toast.error("Não foi possível marcar a etapa: " + error); return; }
    toast.success(`Etapa "${step.descricao}" marcada como realizada.`);
    loadEtapas(step.tratamento_id);
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const { error } = await tratamentosApi.delete(deleteTarget);
    setDeleting(false);
    if (error) { toast.error("Erro ao excluir: " + error); return; }
    toast.success("Tratamento excluído com sucesso!");
    setDeleteTarget(null);
    if (selectedId === deleteTarget) { setSelectedId(null); setEtapas([]); }
    loadAll();
  };

  const [exporting, setExporting] = useState(false);

  const handleExportPdf = async () => {
    const ativos = tratamentos.filter(t => t.status !== 'finalizado');
    if (ativos.length === 0) { toast.error("Nenhum tratamento em andamento para exportar."); return; }
    // Abre a janela já no clique: depois do await o navegador (Safari/iPhone e Chrome
    // após alguns segundos) bloqueia o pop-up.
    const janela = window.open("", "_blank");
    if (!janela) {
      toast.error("O navegador bloqueou a janela do relatório. Permita pop-ups para este site e tente de novo.");
      return;
    }
    janela.document.write('<p style="font-family:sans-serif;padding:24px;color:#555">Carregando relatório...</p>');
    setExporting(true);
    // Busca as etapas de cada tratamento para o progresso sair real no relatório.
    const contagens = await Promise.all(ativos.map(async t => {
      const res = await tratamentosApi.getEtapas(t.id);
      const lista: { status?: string }[] = Array.isArray(res.data) ? (res.data as { status?: string }[]) : [];
      return { erro: !!res.error, total: lista.length, concluidas: lista.filter(e => e.status === 'realizado').length };
    }));
    setExporting(false);
    if (janela.closed) return;
    if (contagens.some(c => c.erro)) {
      janela.close();
      toast.error("Não foi possível carregar as etapas de todos os tratamentos. Tente de novo para o progresso sair certo.");
      return;
    }
    // exportarTratamentosPdf chama window.open por conta própria; aqui ele recebe a
    // janela que já abrimos no clique (troca só durante esta chamada síncrona).
    const abrirOriginal = window.open;
    window.open = (() => { janela.document.open(); return janela; }) as typeof window.open;
    try {
      exportarTratamentosPdf(ativos.map((t, i) => ({
        ...t,
        etapas_total: contagens[i].total,
        etapas_concluidas: contagens[i].concluidas,
      })));
    } finally {
      window.open = abrirOriginal;
    }
    janela.focus();
  };

  const termo = searchTerm.trim().toLowerCase();
  const filtered = tratamentos.filter(t =>
    (!filterStatus || t.status === filterStatus) &&
    (!termo || (t.paciente_nome || "").toLowerCase().includes(termo) || (t.descricao || "").toLowerCase().includes(termo))
  );

  const selected = tratamentos.find(t => t.id === selectedId) || null;
  const completedSteps = etapas.filter(e => e.status === "realizado").length;
  const totalSteps = etapas.length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Gestão de Tratamentos" />
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Gestão de Tratamentos" />
      {/* div e não main: o __root já tem o <main> da página (B5, main aninhado) */}
      <div className="flex-1 p-4 sm:p-6 overflow-auto space-y-5">
        <BarraFiltros
          busca={{ valor: searchTerm, onChange: setSearchTerm, placeholder: "Paciente ou descrição", rotulo: "Buscar tratamento por paciente ou descrição" }}
          filtros={[{
            id: "status",
            rotulo: "Status",
            valor: filterStatus,
            onChange: setFilterStatus,
            opcoes: Object.entries(treatmentStatusCfg).map(([valor, c]) => ({ valor, rotulo: c.label })),
          }]}
          onLimpar={() => { setSearchTerm(""); setFilterStatus(""); }}
          resultado={`${filtered.length} tratamento${filtered.length !== 1 ? "s" : ""}`}
          acoes={
            <>
              <button type="button" onClick={handleExportPdf} disabled={exporting}
                className="h-10 px-4 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 disabled:opacity-50">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar PDF
              </button>
              <button type="button" onClick={() => setShowAddModal(true)}
                className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> Novo tratamento
              </button>
            </>
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Treatment list */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-3">
            <div className="space-y-1.5 max-h-[calc(100vh-200px)] overflow-y-auto">
              {filtered.map((t, i) => {
                const cfg = treatmentStatusCfg[t.status] || treatmentStatusCfg.planejado;
                return (
                  <button key={t.id} onClick={() => selecionar(t.id)} aria-pressed={selectedId === t.id}
                    className={`w-full text-left px-3 py-3 rounded-xl border transition-all duration-300 hover-lift ${selectedId === t.id ? "bg-primary/5 border-primary/30 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)]" : "border-transparent hover:bg-muted hover:shadow-card"}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`h-7 w-7 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
                        {getInitials(t.paciente_nome || '?')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground break-words">{t.paciente_nome}</p>
                        <p className="text-[10px] text-muted-foreground break-words">{t.dentista_nome || t.descricao}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-[10px] text-muted-foreground">{formatBRL(t.valor)}</span>
                    </div>
                  </button>
                );
              })}
              {loadError && (
                <div role="alert" className="text-center py-8 space-y-2">
                  <p className="text-xs text-destructive">Não foi possível carregar os tratamentos. {loadError}</p>
                  <button type="button" onClick={loadAll} className="text-xs font-semibold underline">Tentar de novo</button>
                </div>
              )}
              {!loadError && filtered.length === 0 && (tratamentos.length === 0 ? (
                <EstadoVazio
                  compacto
                  icon={ClipboardList}
                  titulo="Nenhum tratamento ainda"
                  descricao="Um tratamento acompanha as etapas clínicas de um paciente. Ele nasce de um orçamento aprovado ou daqui mesmo."
                  acao={{ label: "Novo tratamento", icon: Plus, onClick: () => setShowAddModal(true) }}
                  acaoSecundaria={{ label: "Ver orçamentos", to: "/orcamentos" }}
                />
              ) : <p className="text-xs text-muted-foreground text-center py-8">Nenhum tratamento com essa busca.</p>)}
            </div>
          </div>

          {/* Detail area */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-4 scroll-mt-4" ref={detailRef}>
            {selected ? (
              <>
                {/* Header */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-foreground">{selected.paciente_nome}</h3>
                      <p className="text-xs text-muted-foreground">{selected.dentista_nome} · {selected.descricao}</p>
                      {selected.plano && <p className="text-xs text-muted-foreground mt-0.5">Plano: {selected.plano}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={selected.status} disabled={updatingStatus}
                        onChange={(e) => {
                          const novo = e.target.value;
                          if (STATUS_ENCERRA.has(novo)) setConfirmStatus(novo);
                          else handleStatusChange(selected.id, novo);
                        }}
                        aria-label="Status do tratamento"
                        className={`h-8 px-2.5 rounded-full text-xs font-medium border-0 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 ${(treatmentStatusCfg[selected.status] || treatmentStatusCfg.planejado).color}`}>
                        {Object.entries(treatmentStatusCfg).map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
                      </select>
                      <button onClick={() => setDeleteTarget(selected.id)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Excluir tratamento" title="Excluir tratamento">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatBox label="Progresso" value={totalSteps > 0 ? `${progress.toFixed(0)}%` : 'N/A'} />
                    <StatBox label="Etapas" value={`${completedSteps}/${totalSteps}`} />
                    <StatBox label="Valor Total" value={formatBRL(selected.valor)} />
                    <StatBox label="Criado em" value={selected.created_at ? new Date(selected.created_at).toLocaleDateString("pt-BR") : '-'} />
                  </div>
                  {totalSteps > 0 && (
                    <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                </div>

                {/* Steps timeline */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <h4 className="text-sm font-semibold text-card-foreground mb-4">Etapas do Tratamento</h4>
                  {etapas.length > 0 ? (
                    <div className="space-y-0">
                      {etapas.map((step, i) => {
                        const sCfg = stepStatusCfg[step.status] || stepStatusCfg.pendente;
                        return (
                          <div key={step.id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                step.status === "realizado" ? "bg-success text-white" :
                                step.status === "agendado" ? "bg-chart-1/20 text-chart-1" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                {step.status === "realizado" ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.ordem || (i + 1)}
                              </div>
                              {i < etapas.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
                            </div>
                            <div className={`flex-1 ${i < etapas.length - 1 ? "pb-4" : ""}`}>
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-0.5">
                                <span className="text-xs font-medium text-foreground">{step.descricao}</span>
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${sCfg.color}`}>{sCfg.label}</span>
                                  {step.status !== "realizado" && step.status !== "cancelado" && (
                                    <button type="button" onClick={() => setConfirmEtapa(step)} disabled={updatingEtapaId === step.id}
                                      className="h-8 px-2.5 rounded-lg text-[11px] font-medium bg-success/15 text-success hover:bg-success/25 flex items-center gap-1 disabled:opacity-50">
                                      {updatingEtapaId === step.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                      Marcar como realizada
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                {step.dente && <span>Dente: {step.dente}</span>}
                                {step.dentista_nome && <span>· {step.dentista_nome}</span>}
                                {step.data_realizada && (
                                  <span className="flex items-center gap-0.5">
                                    <CheckCircle2 className="h-2.5 w-2.5 text-success" />
                                    {dataBr(step.data_realizada)}
                                  </span>
                                )}
                                {step.valor > 0 && <span>· {formatBRL(step.valor)}</span>}
                              </div>
                              {step.observacoes && <p className="text-[10px] text-muted-foreground/70 mt-1 italic">{step.observacoes}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-8">Nenhuma etapa cadastrada para este tratamento.</p>
                  )}
                </div>

                {/* Observações */}
                {selected.observacoes && (
                  <div className="bg-card rounded-xl border border-border p-5">
                    <h4 className="text-sm font-semibold text-card-foreground mb-2">Observações</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">{selected.observacoes}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 hidden lg:flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um tratamento</h3>
                <p className="text-xs text-muted-foreground">Clique em um tratamento ao lado para ver detalhes.</p>
              </div>
            )}
          </div>
        </div>

        {showAddModal && <AddTratamentoModal onSave={handleCreate} onClose={() => setShowAddModal(false)} />}

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir este tratamento?</AlertDialogTitle>
              <AlertDialogDescription>
                {(() => {
                  const t = tratamentos.find((x) => x.id === deleteTarget);
                  return t ? `${t.descricao} · ${t.paciente_nome}. ` : "";
                })()}
                O tratamento e todas as etapas serão apagados. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(e) => { e.preventDefault(); handleDelete(); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Excluir tratamento
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!confirmStatus} onOpenChange={(o) => { if (!o) setConfirmStatus(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmStatus === "cancelado" ? "Cancelar este tratamento?" : "Marcar o tratamento como finalizado?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {selected ? `${selected.descricao} · ${selected.paciente_nome}. ` : ""}
                {totalSteps > completedSteps
                  ? `Ainda há ${totalSteps - completedSteps} etapa(s) não realizada(s).`
                  : "Todas as etapas estão realizadas."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (selected && confirmStatus) handleStatusChange(selected.id, confirmStatus);
                  setConfirmStatus(null);
                }}
              >
                {confirmStatus === "cancelado" ? "Cancelar tratamento" : "Finalizar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Confirmar etapa clínica realizada (não há como desmarcar por esta tela) */}
        <AlertDialog open={!!confirmEtapa} onOpenChange={(o) => { if (!o) setConfirmEtapa(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Marcar a etapa como realizada hoje?</AlertDialogTitle>
              <AlertDialogDescription>
                "{confirmEtapa?.descricao}" vai entrar no histórico do tratamento como realizada em{" "}
                {new Date().toLocaleDateString("pt-BR")}. Depois de confirmar, não dá para desmarcar por esta tela.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const step = confirmEtapa;
                  setConfirmEtapa(null);
                  if (step) handleMarcarRealizada(step);
                }}
              >
                Marcar como realizada
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function AddTratamentoModal({
  onSave,
  onClose,
}: {
  onSave: (data: { paciente_id: string; dentista_id: string; descricao: string; plano: string; observacoes: string; etapas: EtapaForm[] }) => void;
  onClose: () => void;
}) {
  const [dentistas, setDentistas] = useState<{ id: string; nome: string; especialidade: string }[]>([]);
  const [pacientes, setPacientes] = useState<{ id: string; nome: string }[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pacienteSearch, setPacienteSearch] = useState('');

  const [form, setForm] = useState({
    paciente_id: '',
    dentista_id: '',
    descricao: '',
    plano: '',
    observacoes: '',
  });

  const [etapasForm, setEtapasForm] = useState<EtapaForm[]>([
    { descricao: '', dente: '', valor: '' },
  ]);

  useEffect(() => {
    (async () => {
      try {
        const [dRes, pRes] = await Promise.all([dentistasApi.list(), pacientesApi.list()]);
        if (dRes.error || pRes.error) toast.error("Não foi possível carregar " + (pRes.error ? "pacientes" : "dentistas") + ": " + (pRes.error || dRes.error));
        const dData: any = dRes.data || [];
        const pData: any = pRes.data || [];
        const dList = Array.isArray(dData) ? dData.map((d: any) => ({ id: d.id, nome: d.nome, especialidade: d.especialidade || '' })) : [];
        const pList = Array.isArray(pData) ? pData.map((p: any) => ({ id: p.id, nome: p.nome })) : [];
        setDentistas(dList);
        setPacientes(pList);
        // Paciente começa vazio: quem cadastra precisa escolher de propósito.
        setForm(f => ({ ...f, dentista_id: dList[0]?.id || '', paciente_id: '' }));
      } catch (err) { console.error(err); }
      finally { setLoadingData(false); }
    })();
  }, []);

  const filteredPacientes = pacientes.filter(p =>
    !pacienteSearch || p.nome.toLowerCase().includes(pacienteSearch.toLowerCase())
  ).slice(0, 50);
  const pacienteSelecionado = pacientes.find(p => p.id === form.paciente_id) || null;

  // Se o paciente escolhido sair do filtro da busca, limpa a seleção
  // para não gravar o tratamento em outro paciente sem a pessoa ver.
  const handlePacienteSearch = (value: string) => {
    setPacienteSearch(value);
    const termo = value.toLowerCase();
    const atual = pacientes.find(p => p.id === form.paciente_id);
    if (atual && termo && !atual.nome.toLowerCase().includes(termo)) {
      setForm(f => ({ ...f, paciente_id: '' }));
    }
  };

  const addEtapa = () => setEtapasForm([...etapasForm, { descricao: '', dente: '', valor: '' }]);
  const removeEtapa = (idx: number) => setEtapasForm(etapasForm.filter((_, i) => i !== idx));
  const updateEtapa = (idx: number, field: keyof EtapaForm, value: string) => {
    const updated = [...etapasForm];
    updated[idx] = { ...updated[idx], [field]: value };
    setEtapasForm(updated);
  };

  // Valor digitado como "1.234,56"; o servidor recebe número
  const valorTotal = etapasForm.reduce((s, e) => s + (parseValorBRL(e.valor) || 0), 0);
  const [erros, setErros] = useState<Record<string, string>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!form.paciente_id) er.paciente = "Escolha o paciente.";
    if (!form.dentista_id) er.dentista = dentistas.length === 0 ? "Cadastre um dentista em Dentistas antes." : "Escolha o dentista.";
    if (!form.descricao.trim()) er.descricao = "Descreva o tratamento.";
    etapasForm.forEach((et, i) => {
      if (et.valor.trim() && parseValorBRL(et.valor) === null) er[`valor-${i}`] = "Valor inválido.";
      if (!et.descricao.trim() && (et.valor.trim() || et.dente.trim())) er[`desc-${i}`] = "Informe o procedimento da etapa.";
    });
    setErros(er);
    if (Object.keys(er).length) return;
    const validEtapas = etapasForm
      .filter(et => et.descricao.trim())
      .map(et => ({ ...et, valor: String(parseValorBRL(et.valor) ?? 0) }));
    setSaving(true);
    await onSave({ ...form, etapas: validEtapas });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-2xl mx-4 animate-slide-up max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
          <h2 className="text-lg font-bold text-foreground font-heading">Novo Tratamento</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-2 rounded-lg hover:bg-muted/60"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <form noValidate onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="trat-busca-paciente" className="text-xs font-medium text-muted-foreground mb-1 block">Paciente *</label>
                <input id="trat-busca-paciente" type="search" placeholder="Buscar paciente..." value={pacienteSearch}
                  onChange={(e) => handlePacienteSearch(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground mb-1 focus:outline-none focus:ring-1 focus:ring-primary" />
                <select value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })} required
                  aria-label="Paciente"
                  className="w-full h-10 px-3 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">{filteredPacientes.length === 0 ? "Nenhum paciente encontrado" : "Selecione o paciente"}</option>
                  {filteredPacientes.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
                {pacienteSelecionado && (
                  <p className="text-[11px] text-muted-foreground mt-1">Paciente selecionado: <span className="font-medium text-foreground">{pacienteSelecionado.nome}</span></p>
                )}
                {erros.paciente && <p className="text-[11px] text-destructive mt-1">{erros.paciente}</p>}
              </div>
              <div>
                <label htmlFor="trat-dentista" className="text-xs font-medium text-muted-foreground mb-1 block sm:mb-[calc(2.25rem+0.5rem)]">Dentista *</label>
                <select id="trat-dentista" value={form.dentista_id} onChange={(e) => setForm({ ...form, dentista_id: e.target.value })}
                  aria-invalid={!!erros.dentista || undefined}
                  className="w-full h-10 px-3 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-destructive">
                  {dentistas.length === 0 && <option value="">Nenhum dentista cadastrado</option>}
                  {dentistas.map(d => <option key={d.id} value={d.id}>{d.nome}{d.especialidade ? ` — ${d.especialidade}` : ""}</option>)}
                </select>
                {erros.dentista && <p className="text-[11px] text-destructive mt-1">{erros.dentista}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="trat-desc" className="text-xs font-medium text-muted-foreground mb-1 block">Descrição do tratamento *</label>
              <input id="trat-desc" type="text" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Ex: Implante dentário superior"
                aria-invalid={!!erros.descricao || undefined}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-destructive" />
              {erros.descricao && <p className="text-[11px] text-destructive mt-1">{erros.descricao}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Plano/Convênio</label>
                <input type="text" value={form.plano} onChange={(e) => setForm({ ...form, plano: e.target.value })}
                  placeholder="Particular, Amil, etc."
                  className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor Total (etapas)</label>
                <div className="h-10 px-4 rounded-xl bg-muted/50 border border-border/60 flex items-center text-sm font-bold text-foreground">
                  {formatBRL(valorTotal)}
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
              <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                placeholder="Notas adicionais..." rows={2}
                className="w-full px-4 py-2 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
            </div>

            {/* Etapas */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-foreground">Etapas do Tratamento</label>
                <button type="button" onClick={addEtapa}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20">
                  <Plus className="h-3 w-3" /> Adicionar Etapa
                </button>
              </div>
              <div className="space-y-2">
                {etapasForm.map((et, idx) => (
                  <div key={idx} className="flex items-start gap-2 bg-muted/30 rounded-lg p-3 border border-border/40">
                    <span className="h-6 w-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="col-span-2 sm:col-span-1">
                        <input type="text" value={et.descricao} onChange={(e) => updateEtapa(idx, 'descricao', e.target.value)}
                          placeholder="Procedimento" aria-label={`Procedimento da etapa ${idx + 1}`}
                          aria-invalid={!!erros[`desc-${idx}`] || undefined}
                          className="w-full h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid=true]:border-destructive" />
                        {erros[`desc-${idx}`] && <p className="text-[10px] text-destructive mt-0.5">{erros[`desc-${idx}`]}</p>}
                      </div>
                      <input type="text" inputMode="numeric" value={et.dente} onChange={(e) => updateEtapa(idx, 'dente', e.target.value)}
                        placeholder="Dente (ex: 14)" aria-label={`Dente da etapa ${idx + 1}`}
                        className="h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                      <div>
                        <input type="text" inputMode="decimal" value={et.valor} onChange={(e) => updateEtapa(idx, 'valor', maskValorDigitado(e.target.value))}
                          placeholder="Valor (R$)" aria-label={`Valor da etapa ${idx + 1}`}
                          aria-invalid={!!erros[`valor-${idx}`] || undefined}
                          className="w-full h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid=true]:border-destructive" />
                        {erros[`valor-${idx}`] && <p className="text-[10px] text-destructive mt-0.5">{erros[`valor-${idx}`]}</p>}
                      </div>
                    </div>
                    {etapasForm.length > 1 && (
                      <button type="button" onClick={() => removeEtapa(idx)} aria-label={`Remover etapa ${idx + 1}`}
                        className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive shrink-0 mt-0.5">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-border hover:bg-muted transition-colors">Cancelar</button>
              {/* Habilitado: ao clicar, mostra o que falta em vez de ficar cinza sem explicar */}
              <button type="submit" disabled={saving}
                className="px-5 py-2 rounded-xl text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
                {saving && <Loader2 className="h-3 w-3 animate-spin" />} Criar Tratamento
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}
