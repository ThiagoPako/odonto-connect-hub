import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { EstadoVazio } from "@/components/EstadoVazio";
import {
  Plus, DollarSign, CheckCircle2, XCircle, Clock, TrendingUp,
  FileText, CreditCard, ExternalLink, Loader2, Printer, Pencil, Trash2,
  PlayCircle,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { BarraFiltros } from "@/components/filtros/BarraFiltros";
import { useFiltroUrl } from "@/components/filtros/useFiltroUrl";
import { orcamentosApi, pacientesApi, dentistasApi } from "@/lib/vpsApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NovoOrcamentoModal } from "@/components/orcamentos/NovoOrcamentoModal";
import { ExecucaoModal } from "@/components/orcamentos/ExecucaoModal";
import { OrcamentoPrintPreview } from "@/components/orcamentos/OrcamentoPrintPreview";
import { DEFAULT_PRINT_CONFIG } from "@/components/orcamentos/types";
import { formatBRL } from "@/lib/formatos";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/orcamentos")({
  ssr: false,
  component: OrcamentosPage,
});

interface OrcamentoRow {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  dentista_id?: string | null;
  dentista_nome: string;
  dentista_cro?: string;
  dentista_especialidade?: string;
  titulo?: string;
  itens: any[];
  valor_total: number;
  desconto: number;
  status: string;
  forma_pagamento: string;
  parcelas: number;
  observacoes: string;
  created_at: string;
  print_config?: any;
  odontograma_snapshot?: any[];
  raw?: any;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pendente: { label: "Pendente", color: "bg-warning/15 text-warning" },
  aprovado: { label: "Aprovado", color: "bg-success/15 text-success" },
  reprovado: { label: "Reprovado", color: "bg-destructive/15 text-destructive" },
  em_tratamento: { label: "Em Tratamento", color: "bg-primary/15 text-primary" },
  finalizado: { label: "Finalizado", color: "bg-muted text-muted-foreground" },
};

function getInitials(name: string) {
  // Só palavras que começam com letra: "Pedro Lima (Alfa)" vira "PL", não "P("
  const partes = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  return partes.filter((_, i, arr) => i === 0 || i === arr.length - 1).map(n => n[0]).join("").toUpperCase() || "?";
}

const AVATAR_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"];

function mapOrcamento(r: any): OrcamentoRow {
  let itens = r.itens || [];
  if (typeof itens === 'string') try { itens = JSON.parse(itens); } catch { itens = []; }
  let odon = r.odontograma_snapshot || [];
  if (typeof odon === 'string') try { odon = JSON.parse(odon); } catch { odon = []; }
  let pcfg = r.print_config || null;
  if (typeof pcfg === 'string') try { pcfg = JSON.parse(pcfg); } catch { pcfg = null; }
  return {
    id: r.id,
    paciente_id: r.paciente_id || '',
    paciente_nome: r.paciente_nome || r.paciente_id || '',
    paciente_telefone: r.paciente_telefone || '',
    paciente_cpf: r.paciente_cpf || '',
    dentista_id: r.dentista_id || null,
    dentista_nome: r.dentista_nome || '',
    dentista_cro: r.dentista_cro || '',
    dentista_especialidade: r.dentista_especialidade || '',
    titulo: r.titulo || 'Plano de tratamento',
    itens: Array.isArray(itens) ? itens : [],
    valor_total: Number(r.valor_total) || 0,
    desconto: Number(r.desconto) || 0,
    status: r.status || 'pendente',
    forma_pagamento: r.forma_pagamento || '',
    parcelas: Number(r.parcelas) || 1,
    observacoes: r.observacoes || '',
    created_at: r.created_at ? new Date(r.created_at).toLocaleDateString("pt-BR") : '',
    print_config: pcfg,
    odontograma_snapshot: Array.isArray(odon) ? odon : [],
    raw: r,
  };
}

function OrcamentosPage() {
  const [orcamentos, setOrcamentos] = useState<OrcamentoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useFiltroUrl("status", Object.keys(statusConfig));
  const [searchTerm, setSearchTerm] = useState("");
  const [novoOpen, setNovoOpen] = useState(false);
  const [execOpen, setExecOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [editing, setEditing] = useState<OrcamentoRow | null>(null);
  const [pacienteCache, setPacienteCache] = useState<Record<string, any>>({});
  const [dentistaCache, setDentistaCache] = useState<Record<string, any>>({});

  const [loadError, setLoadError] = useState<string | null>(null);
  // Confirmação de ações que não têm volta (excluir) ou que mexem no CRM (reprovar)
  const [confirmAcao, setConfirmAcao] = useState<{ tipo: "excluir" | "reprovar"; orc: OrcamentoRow } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const selecionar = (id: string) => {
    setSelectedId(id);
    // No celular a lista e o detalhe ficam um embaixo do outro: leva a pessoa até o detalhe
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const loadAll = useCallback(async () => {
    const { data, error } = await orcamentosApi.list();
    setLoadError(error);
    if (error) toast.error("Não foi possível carregar os orçamentos: " + error);
    else setOrcamentos(Array.isArray(data) ? data.map(mapOrcamento) : []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Pré-carrega pacientes/dentistas para enriquecer o print preview
  useEffect(() => {
    Promise.all([pacientesApi.list(), dentistasApi.list()]).then(([p, d]) => {
      // Só enriquece a impressão; sem os dados a impressão sai sem endereço/CRO
      if (p.error || d.error) toast.error("Dados de paciente/dentista para impressão não carregaram: " + (p.error || d.error));
      const pacs = (Array.isArray(p.data) ? p.data : []) as any[];
      const dens = (Array.isArray(d.data) ? d.data : []) as any[];
      const pMap: Record<string, any> = {}; pacs.forEach(x => { pMap[x.id] = x; });
      const dMap: Record<string, any> = {}; dens.forEach(x => { dMap[x.id] = x; });
      setPacienteCache(pMap);
      setDentistaCache(dMap);
    });
  }, []);

  const handleExcluir = async (id: string): Promise<boolean> => {
    const res = await orcamentosApi.delete(id);
    if (res.error) { toast.error("Erro ao excluir: " + res.error); return false; }
    toast.success("Orçamento excluído");
    if (selectedId === id) setSelectedId(null);
    loadAll();
    return true;
  };

  const handleEditar = (o: OrcamentoRow) => {
    setEditing(o);
    setNovoOpen(true);
  };

  const handleImprimir = (o: OrcamentoRow) => {
    setSelectedId(o.id);
    setPrintOpen(true);
  };

  const filtered = orcamentos
    .filter(b => !filterStatus || b.status === filterStatus)
    .filter(b => {
      const q = searchTerm.trim().toLowerCase();
      if (!q) return true;
      return (b.paciente_nome || "").toLowerCase().includes(q) || (b.titulo || "").toLowerCase().includes(q);
    });

  const totalPending = orcamentos.filter(b => b.status === "pendente").reduce((a, b) => a + (b.valor_total - b.desconto), 0);
  const totalApproved = orcamentos.filter(b => ["aprovado", "em_tratamento"].includes(b.status)).reduce((a, b) => a + (b.valor_total - b.desconto), 0);
  const conversionRate = orcamentos.length > 0
    ? ((orcamentos.filter(b => ["aprovado", "em_tratamento", "finalizado"].includes(b.status)).length / orcamentos.length) * 100).toFixed(0) : "0";

  const selected = orcamentos.find(o => o.id === selectedId) || null;

  const handleStatusChange = async (id: string, newStatus: string): Promise<boolean> => {
    const { data, error } = await orcamentosApi.updateStatus(id, newStatus);
    if (error) { toast.error("Erro ao mudar o status: " + error); return false; }
    const label = newStatus === 'aprovado' ? 'aprovado' : newStatus === 'reprovado' ? 'reprovado' : (statusConfig[newStatus]?.label ?? newStatus).toLowerCase();
    toast.success(`Orçamento ${label}`);
    if ((data as any)?.leadMoved) {
      const dest = newStatus === 'reprovado' ? 'Recuperação de Vendas' : 'Orçamento Aprovado';
      toast.info(`Lead movido automaticamente para "${dest}" no CRM`);
    }
    loadAll();
    return true;
  };

  const executarConfirmacao = async () => {
    if (!confirmAcao) return;
    setConfirmando(true);
    const ok = confirmAcao.tipo === "excluir"
      ? await handleExcluir(confirmAcao.orc.id)
      : await handleStatusChange(confirmAcao.orc.id, "reprovado");
    setConfirmando(false);
    if (ok) setConfirmAcao(null);
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Orçamentos e Vendas" />
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Orçamentos e Vendas" />
      <div className="flex-1 p-4 sm:p-6 space-y-5 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-slide-up" style={{ animationFillMode: 'both' }}>
          <KpiMini icon={FileText} label="Total Orçamentos" value={orcamentos.length.toString()} />
          <KpiMini icon={Clock} label="Valor Pendente" value={formatBRL(totalPending)} />
          <KpiMini icon={DollarSign} label="Valor Aprovado" value={formatBRL(totalApproved)} />
          <KpiMini icon={TrendingUp} label="Taxa Conversão" value={`${conversionRate}%`} />
        </div>

        {/* Busca + filtros */}
        <BarraFiltros
          busca={{ valor: searchTerm, onChange: setSearchTerm, placeholder: "Paciente ou título", rotulo: "Buscar orçamento por paciente ou título" }}
          filtros={[{
            id: "status",
            rotulo: "Status",
            valor: filterStatus,
            onChange: setFilterStatus,
            opcoes: Object.entries(statusConfig).map(([valor, c]) => ({ valor, rotulo: c.label })),
          }]}
          onLimpar={() => { setSearchTerm(""); setFilterStatus(""); }}
          resultado={`${filtered.length} orçamento${filtered.length !== 1 ? "s" : ""}`}
          acoes={
            <Button onClick={() => setNovoOpen(true)} className="h-10 gap-1.5">
              <Plus className="h-4 w-4" /> Novo orçamento
            </Button>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Budget list */}
          <div className="lg:col-span-1 space-y-2">
            {filtered.map((b, i) => {
              const cfg = statusConfig[b.status] || statusConfig.pendente;
              const finalValue = b.valor_total - b.desconto;
              return (
                <button type="button" key={b.id} onClick={() => selecionar(b.id)} aria-pressed={selectedId === b.id}
                  className={`block w-full text-left bg-card rounded-xl border p-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-all duration-300 hover-lift ${selectedId === b.id ? "border-primary ring-1 ring-primary/20 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)]" : "border-border hover:border-primary/40 hover:shadow-glow-primary"}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`h-7 w-7 shrink-0 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-[9px] font-bold text-white`}>
                        {getInitials(b.paciente_nome)}
                      </div>
                      <span className="text-xs font-medium text-foreground break-words min-w-0">{b.paciente_nome}</span>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-muted-foreground">
                    <span>{b.itens.length} itens · {b.created_at}</span>
                    <span className="text-sm font-bold text-foreground">{formatBRL(finalValue)}</span>
                  </div>
                </button>
              );
            })}
            {loadError && (
              <div role="alert" className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-xs text-destructive">Não foi possível carregar os orçamentos. {loadError}</p>
                <Button size="sm" variant="outline" onClick={loadAll}>Tentar de novo</Button>
              </div>
            )}
            {!loadError && filtered.length === 0 && (orcamentos.length === 0 ? (
              <EstadoVazio
                compacto
                icon={FileText}
                titulo="Nenhum orçamento ainda"
                descricao="Monte o orçamento do paciente com os procedimentos do catálogo. Ao aprovar, ele vira tratamento."
                acao={{ label: "Novo orçamento", icon: Plus, onClick: () => setNovoOpen(true) }}
                acaoSecundaria={{ label: "Ver catálogo", to: "/procedimentos" }}
              />
            ) : <p className="text-xs text-muted-foreground text-center py-8">Nenhum orçamento com esse filtro</p>)}
          </div>

          {/* Budget detail */}
          <div className="lg:col-span-2 scroll-mt-4" ref={detailRef}>
            {selected ? (
              <BudgetDetail
                budget={selected}
                onStatusChange={handleStatusChange}
                onExecute={() => setExecOpen(true)}
                onPrint={() => handleImprimir(selected)}
                onEdit={() => handleEditar(selected)}
                onDelete={() => setConfirmAcao({ tipo: "excluir", orc: selected })}
                onReject={() => setConfirmAcao({ tipo: "reprovar", orc: selected })}
              />
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 hidden lg:flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um orçamento</h3>
                <p className="text-xs text-muted-foreground">Clique em um orçamento para ver os detalhes.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={!!confirmAcao} onOpenChange={(o) => { if (!o && !confirmando) setConfirmAcao(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAcao?.tipo === "excluir" ? "Excluir este orçamento?" : "Reprovar este orçamento?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAcao && (
                <>
                  {confirmAcao.orc.titulo || "Plano de tratamento"} · {confirmAcao.orc.paciente_nome} ·{" "}
                  {formatBRL(confirmAcao.orc.valor_total - confirmAcao.orc.desconto)}.{" "}
                  {confirmAcao.tipo === "excluir"
                    ? "Esta ação não pode ser desfeita."
                    : "Se o paciente veio de um lead, ele vai para \u201cRecuperação de Vendas\u201d no CRM."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmando}
              onClick={(e) => { e.preventDefault(); executarConfirmacao(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmAcao?.tipo === "excluir" ? "Excluir orçamento" : "Reprovar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NovoOrcamentoModal
        open={novoOpen}
        onOpenChange={(v) => { setNovoOpen(v); if (!v) setEditing(null); }}
        orcamentoEditar={editing ? {
          id: editing.id,
          paciente_id: editing.paciente_id,
          dentista_id: editing.dentista_id,
          titulo: editing.titulo,
          itens: editing.itens,
          valor_total: editing.valor_total,
          desconto: editing.desconto,
          observacoes: editing.observacoes,
          forma_pagamento: editing.forma_pagamento,
          parcelas: editing.parcelas,
          print_config: editing.print_config,
          odontograma_snapshot: editing.odontograma_snapshot as any,
        } : null}
        onSaved={loadAll}
      />
      <ExecucaoModal
        open={execOpen}
        onOpenChange={setExecOpen}
        orcamento={selected ? {
          id: selected.id,
          paciente_id: selected.paciente_id,
          paciente_nome: selected.paciente_nome,
          dentista_id: selected.dentista_id,
          itens: selected.itens,
        } : null}
        onChanged={loadAll}
      />

      {selected && (
        <OrcamentoPrintPreview
          open={printOpen}
          onOpenChange={setPrintOpen}
          paciente={{
            nome: selected.paciente_nome,
            telefone: pacienteCache[selected.paciente_id]?.telefone || selected.paciente_telefone,
            cpf: pacienteCache[selected.paciente_id]?.cpf || selected.paciente_cpf,
          }}
          dentista={selected.dentista_id ? {
            nome: dentistaCache[selected.dentista_id]?.nome || selected.dentista_nome,
            cro: dentistaCache[selected.dentista_id]?.cro,
            especialidade: dentistaCache[selected.dentista_id]?.especialidade,
          } : null}
          titulo={selected.titulo || "Plano de tratamento"}
          itens={selected.itens.map((it: any) => ({
            id: it.id || String(Math.random()),
            procedimento_id: it.procedimento_id || "",
            procedimento_nome: it.procedimento_nome || it.procedimento || it.descricao || "Procedimento",
            procedimento_codigo: it.procedimento_codigo || it.codigo || null,
            dente: it.dente ?? null,
            faces: Array.isArray(it.faces) ? it.faces : [],
            quantidade: Number(it.quantidade) || 1,
            valor_unitario: Number(it.valor_unitario || it.valor) || 0,
            valor_total: Number(it.valor_total || it.valor) || 0,
            cor: it.cor,
          }))}
          subtotal={selected.valor_total}
          desconto={selected.desconto}
          total={selected.valor_total - selected.desconto}
          observacoes={selected.observacoes}
          formaPagamento={selected.forma_pagamento}
          parcelas={selected.parcelas}
          selections={selected.odontograma_snapshot || []}
          config={selected.print_config || DEFAULT_PRINT_CONFIG}
        />
      )}
    </div>
  );
}

function KpiMini({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="group bg-card rounded-xl border border-border p-4 space-y-1 hover-lift hover:shadow-glow-primary transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
      <div className="flex items-center gap-2 text-muted-foreground relative z-10">
        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center group-hover:shadow-[0_0_10px_-2px_hsl(var(--primary)/0.3)] transition-shadow duration-300">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-[11px] font-medium leading-tight">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground relative z-10">{value}</p>
    </div>
  );
}

interface BudgetDetailProps {
  budget: OrcamentoRow;
  onStatusChange: (id: string, status: string) => Promise<boolean>;
  onExecute: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReject: () => void;
}

function BudgetDetail({ budget: b, onStatusChange, onExecute, onPrint, onEdit, onDelete, onReject }: BudgetDetailProps) {
  const cfg = statusConfig[b.status] || statusConfig.pendente;
  const [updating, setUpdating] = useState(false);
  const finalValue = b.valor_total - b.desconto;
  // Edição/exclusão só permitidas em estágios iniciais
  const podeEditar = b.status === "pendente";
  const podeExcluir = b.status === "pendente" || b.status === "reprovado";

  const handleChange = async (newStatus: string) => {
    setUpdating(true);
    await onStatusChange(b.id, newStatus);
    setUpdating(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex flex-col-reverse sm:flex-row sm:items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground truncate">{b.titulo || "Plano de tratamento"}</h3>
            <p className="text-xs text-muted-foreground truncate">
              <span className="font-medium text-foreground">{b.paciente_nome}</span> ·{" "}
              {b.dentista_nome || "Sem dentista"} · Criado em {b.created_at}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
            <button
              onClick={onPrint}
              title="Imprimir orçamento"
              aria-label="Imprimir orçamento"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition"
            >
              <Printer className="h-3.5 w-3.5" />
            </button>
            {podeEditar && (
              <button
                onClick={onEdit}
                title="Editar orçamento"
                aria-label="Editar orçamento"
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {podeExcluir && (
              <button
                onClick={onDelete}
                title="Excluir orçamento"
                aria-label="Excluir orçamento"
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Items table */}
        {b.itens.length > 0 && (
          <div className="overflow-x-auto mb-4">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase">Procedimento</th>
                <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-center">Dente / Faces</th>
                <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-center">Qtd</th>
                <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {b.itens.map((item: any, i: number) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="py-2 text-xs text-foreground">
                    <div className="flex items-center gap-1.5">
                      {item.cor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.cor }} />}
                      <span>{item.procedimento_nome || item.procedimento || item.descricao || '-'}</span>
                      {item.procedimento_versao && (
                        <span
                          title="Versão do catálogo congelada neste orçamento"
                          className="px-1 py-0.5 rounded bg-muted text-muted-foreground text-[9px] font-mono"
                        >
                          v{item.procedimento_versao}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 text-xs text-muted-foreground text-center">
                    {item.dente ? (
                      <span>
                        {item.dente}
                        {Array.isArray(item.faces) && item.faces.length > 0 && (
                          <span className="ml-1 text-[10px] text-primary">{item.faces.join("")}</span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-2 text-xs text-foreground text-center">{item.quantidade || item.quantity || 1}</td>
                  <td className="py-2 text-xs font-medium text-foreground text-right">{formatBRL(Number(item.valor_total || item.valor || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {/* Totals */}
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatBRL(b.valor_total)}</span>
          </div>
          {b.desconto > 0 && (
            <div className="flex justify-between text-xs text-success">
              <span>Desconto</span>
              <span>- {formatBRL(b.desconto)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-foreground pt-1">
            <span>Total</span>
            <span>{formatBRL(finalValue)}</span>
          </div>
        </div>
      </div>

      {/* Payment & actions */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-card-foreground mb-3">Pagamento</h4>
        {b.forma_pagamento ? (
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-foreground">{b.forma_pagamento}</p>
              {b.parcelas > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  {b.parcelas}x de {formatBRL(finalValue / b.parcelas)}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Pagamento não definido</p>
        )}

        {b.status === "pendente" && (
          <div className="flex items-center gap-2 mt-4">
            <button disabled={updating} onClick={() => handleChange("aprovado")}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-success text-white text-xs font-medium hover:bg-success/90 disabled:opacity-50">
              {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Aprovar
            </button>
            <button disabled={updating} onClick={onReject}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-destructive text-white text-xs font-medium hover:bg-destructive/90 disabled:opacity-50">
              <XCircle className="h-3.5 w-3.5" /> Reprovar
            </button>
          </div>
        )}

        {(b.status === "aprovado" || b.status === "em_tratamento") && (
          <button onClick={onExecute}
            className="mt-4 flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition">
            <PlayCircle className="h-4 w-4" /> Executar plano de tratamento
          </button>
        )}

        {b.status === "reprovado" && (
          <div className="mt-3 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
            Orçamento reprovado
          </div>
        )}
        {b.status === "aprovado" && (
          <div className="mt-3 p-2 rounded-lg bg-success/10 text-success text-xs">
            Orçamento aprovado. Use &ldquo;Executar plano de tratamento&rdquo; a cada procedimento realizado.
          </div>
        )}
      </div>
    </div>
  );
}
