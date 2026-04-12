import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, CheckCircle2, Clock, Pause, PlayCircle, CalendarDays,
  FileText, Plus, Loader2, X, Trash2, Download,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { tratamentosApi, dentistasApi, pacientesApi } from "@/lib/vpsApi";
import { toast } from "sonner";
import { exportarTratamentosPdf } from "@/lib/tratamentosPdfExport";

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
  return name.split(" ").filter((_, i, a) => i === 0 || i === a.length - 1).map(n => n[0]).join("").toUpperCase();
}

const AVATAR_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-primary"];

function TratamentosPage() {
  const [tratamentos, setTratamentos] = useState<TratamentoRow[]>([]);
  const [etapas, setEtapas] = useState<EtapaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const res = await tratamentosApi.list();
      const data = (res as any).data || res || [];
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

  const loadEtapas = useCallback(async (tratId: string) => {
    try {
      const res = await tratamentosApi.getEtapas(tratId);
      const data = (res as any).data || res || [];
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
    if (tratId && data.etapas.length > 0) {
      for (let i = 0; i < data.etapas.length; i++) {
        const et = data.etapas[i];
        await tratamentosApi.addEtapa(tratId, {
          descricao: et.descricao,
          dente: et.dente,
          valor: Number(et.valor) || 0,
          ordem: i + 1,
          status: 'pendente',
        });
      }
    }
    toast.success("Tratamento criado com sucesso!");
    setShowAddModal(false);
    loadAll();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await tratamentosApi.delete(deleteTarget) as any;
    if (error) { toast.error("Erro ao excluir: " + error); return; }
    toast.success("Tratamento excluído com sucesso!");
    setDeleteTarget(null);
    if (selectedId === deleteTarget) { setSelectedId(null); setEtapas([]); }
    loadAll();
  };

  const filtered = tratamentos.filter(
    t => !searchTerm || t.paciente_nome.toLowerCase().includes(searchTerm.toLowerCase()) || t.descricao.toLowerCase().includes(searchTerm.toLowerCase())
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
      <main className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Treatment list */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input type="text" placeholder="Buscar tratamento..." value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <button onClick={() => setShowAddModal(true)}
                className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 flex items-center gap-1 shrink-0">
                <Plus className="h-3.5 w-3.5" /> Novo
              </button>
            </div>
            <div className="space-y-1.5 max-h-[calc(100vh-200px)] overflow-y-auto">
              {filtered.map((t, i) => {
                const cfg = treatmentStatusCfg[t.status] || treatmentStatusCfg.planejado;
                return (
                  <button key={t.id} onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left px-3 py-3 rounded-xl border transition-all duration-300 hover-lift ${selectedId === t.id ? "bg-primary/5 border-primary/30 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)]" : "border-transparent hover:bg-muted hover:shadow-card"}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`h-7 w-7 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
                        {getInitials(t.paciente_nome || '?')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{t.paciente_nome}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{t.dentista_nome || t.descricao}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-[10px] text-muted-foreground">R$ {t.valor.toLocaleString("pt-BR")}</span>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">Nenhum tratamento encontrado</p>}
            </div>
          </div>

          {/* Detail area */}
          <div className="lg:col-span-9 space-y-4">
            {selected ? (
              <>
                {/* Header */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{selected.paciente_nome}</h3>
                      <p className="text-xs text-muted-foreground">{selected.dentista_nome} · {selected.descricao}</p>
                      {selected.plano && <p className="text-xs text-muted-foreground mt-0.5">Plano: {selected.plano}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${(treatmentStatusCfg[selected.status] || treatmentStatusCfg.planejado).color}`}>
                        {(treatmentStatusCfg[selected.status] || treatmentStatusCfg.planejado).label}
                      </span>
                      <button onClick={() => setDeleteTarget(selected.id)}
                        className="p-1.5 rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                        title="Excluir tratamento">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <StatBox label="Progresso" value={totalSteps > 0 ? `${progress.toFixed(0)}%` : 'N/A'} />
                    <StatBox label="Etapas" value={`${completedSteps}/${totalSteps}`} />
                    <StatBox label="Valor Total" value={`R$ ${(selected.valor / 1000).toFixed(1)}k`} />
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
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs font-medium text-foreground">{step.descricao}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${sCfg.color}`}>{sCfg.label}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                {step.dente && <span>Dente: {step.dente}</span>}
                                {step.dentista_nome && <span>· {step.dentista_nome}</span>}
                                {step.data_realizada && (
                                  <span className="flex items-center gap-0.5">
                                    <CheckCircle2 className="h-2.5 w-2.5 text-success" />
                                    {new Date(step.data_realizada).toLocaleDateString("pt-BR")}
                                  </span>
                                )}
                                {step.valor > 0 && <span>· R$ {step.valor.toLocaleString("pt-BR")}</span>}
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
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um tratamento</h3>
                <p className="text-xs text-muted-foreground">Clique em um tratamento ao lado para ver detalhes.</p>
              </div>
            )}
          </div>
        </div>

        {showAddModal && <AddTratamentoModal onSave={handleCreate} onClose={() => setShowAddModal(false)} />}

        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-sm mx-4 animate-slide-up p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-destructive/15 flex items-center justify-center">
                  <Trash2 className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Excluir Tratamento</h3>
                  <p className="text-xs text-muted-foreground">Esta ação não pode ser desfeita.</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Tem certeza que deseja excluir este tratamento e todas as suas etapas permanentemente?</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-border hover:bg-muted transition-colors">
                  Cancelar
                </button>
                <button onClick={handleDelete}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors">
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
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
        const dData = (dRes as any).data || dRes || [];
        const pData = (pRes as any).data || pRes || [];
        const dList = Array.isArray(dData) ? dData.map((d: any) => ({ id: d.id, nome: d.nome, especialidade: d.especialidade || '' })) : [];
        const pList = Array.isArray(pData) ? pData.map((p: any) => ({ id: p.id, nome: p.nome })) : [];
        setDentistas(dList);
        setPacientes(pList);
        setForm(f => ({ ...f, dentista_id: dList[0]?.id || '', paciente_id: pList[0]?.id || '' }));
      } catch (err) { console.error(err); }
      finally { setLoadingData(false); }
    })();
  }, []);

  const filteredPacientes = pacientes.filter(p =>
    !pacienteSearch || p.nome.toLowerCase().includes(pacienteSearch.toLowerCase())
  ).slice(0, 50);

  const addEtapa = () => setEtapasForm([...etapasForm, { descricao: '', dente: '', valor: '' }]);
  const removeEtapa = (idx: number) => setEtapasForm(etapasForm.filter((_, i) => i !== idx));
  const updateEtapa = (idx: number, field: keyof EtapaForm, value: string) => {
    const updated = [...etapasForm];
    updated[idx] = { ...updated[idx], [field]: value };
    setEtapasForm(updated);
  };

  const valorTotal = etapasForm.reduce((s, e) => s + (Number(e.valor) || 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.paciente_id || !form.dentista_id || !form.descricao) return;
    const validEtapas = etapasForm.filter(et => et.descricao.trim());
    setSaving(true);
    await onSave({ ...form, etapas: validEtapas });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-2xl mx-4 animate-slide-up max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
          <h2 className="text-lg font-bold text-foreground font-heading">Novo Tratamento</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Paciente</label>
                <input type="text" placeholder="Buscar paciente..." value={pacienteSearch}
                  onChange={(e) => setPacienteSearch(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground mb-1 focus:outline-none focus:ring-1 focus:ring-primary" />
                <select value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                  {filteredPacientes.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Dentista</label>
                <select value={form.dentista_id} onChange={(e) => setForm({ ...form, dentista_id: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 mt-[calc(2.25rem+0.25rem)]">
                  {dentistas.map(d => <option key={d.id} value={d.id}>{d.nome} — {d.especialidade}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Descrição do Tratamento</label>
              <input type="text" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Ex: Implante dentário superior" required
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Plano/Convênio</label>
                <input type="text" value={form.plano} onChange={(e) => setForm({ ...form, plano: e.target.value })}
                  placeholder="Particular, Amil, etc."
                  className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor Total (etapas)</label>
                <div className="h-10 px-4 rounded-xl bg-muted/50 border border-border/60 flex items-center text-sm font-bold text-foreground">
                  R$ {valorTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
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
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <input type="text" value={et.descricao} onChange={(e) => updateEtapa(idx, 'descricao', e.target.value)}
                        placeholder="Procedimento"
                        className="col-span-1 h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                      <input type="text" value={et.dente} onChange={(e) => updateEtapa(idx, 'dente', e.target.value)}
                        placeholder="Dente (ex: 14)"
                        className="h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                      <input type="number" value={et.valor} onChange={(e) => updateEtapa(idx, 'valor', e.target.value)}
                        placeholder="Valor (R$)" min="0" step="0.01"
                        className="h-8 px-3 rounded-lg bg-background border border-border/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                    </div>
                    {etapasForm.length > 1 && (
                      <button type="button" onClick={() => removeEtapa(idx)}
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
              <button type="submit" disabled={saving || !form.paciente_id || !form.dentista_id || !form.descricao}
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
