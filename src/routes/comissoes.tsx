import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  DollarSign, CheckCircle2, Clock, CreditCard, Users, ChevronRight, Loader2, Plus, X,
} from "lucide-react";
import { Trash2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { comissoesApi, dentistasApi, pacientesApi } from "@/lib/vpsApi";
import { toast } from "sonner";

export const Route = createFileRoute("/comissoes")({
  ssr: false,
  component: ComissoesPage,
});

interface DentistaRow {
  id: string;
  nome: string;
  especialidade: string;
  comissao_percentual: number;
}

interface ComissaoRow {
  id: string;
  dentista_id: string;
  dentista_nome: string;
  paciente_nome: string;
  procedimento: string;
  valor: number;
  percentual: number;
  data: string;
  status: "pendente" | "aprovado" | "pago";
}

const statusCfg: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pendente: { label: "Pendente", color: "bg-warning/15 text-warning", icon: Clock },
  aprovado: { label: "Aprovado", color: "bg-chart-1/15 text-chart-1", icon: CheckCircle2 },
  pago: { label: "Pago", color: "bg-success/15 text-success", icon: CreditCard },
};

const AVATAR_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-primary"];

function getInitials(name: string) {
  return name.split(" ").filter((_, i, a) => i === 0 || i === a.length - 1).map(n => n[0]).join("").toUpperCase();
}

function ComissoesPage() {
  const [dentistas, setDentistas] = useState<DentistaRow[]>([]);
  const [pacientes, setPacientes] = useState<{ id: string; nome: string }[]>([]);
  const [comissoes, setComissoes] = useState<ComissaoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDentista, setSelectedDentista] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [dRes, cRes, pRes] = await Promise.all([dentistasApi.list(), comissoesApi.list(), pacientesApi.list()]);
      const dData = (dRes as any).data || dRes || [];
      const cData = (cRes as any).data || cRes || [];
      const pData = (pRes as any).data || pRes || [];
      setDentistas(Array.isArray(dData) ? dData : []);
      setPacientes(Array.isArray(pData) ? pData.map((p: any) => ({ id: p.id, nome: p.nome })) : []);
      setComissoes(Array.isArray(cData) ? cData.map((r: any) => ({
        id: r.id,
        dentista_id: r.dentista_id,
        dentista_nome: r.dentista_nome || '',
        paciente_nome: r.paciente_nome || '',
        procedimento: r.procedimento || r.descricao || '',
        valor: Number(r.valor) || 0,
        percentual: Number(r.percentual) || 0,
        data: r.data ? new Date(r.data).toLocaleDateString("pt-BR") : '',
        status: r.status || 'pendente',
      })) : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleStatusChange = async (id: string, newStatus: string) => {
    const { error } = await comissoesApi.update(id, { status: newStatus });
    if (error) { toast.error("Erro: " + error); return; }
    toast.success(`Comissão ${newStatus === 'pago' ? 'paga' : newStatus === 'aprovado' ? 'aprovada' : newStatus}`);
    loadAll();
  };

  const handleCreateComissao = async (data: { dentista_id: string; paciente_id: string; procedimento: string; valor: number; percentual: number }) => {
    const comissaoValor = (data.valor * data.percentual) / 100;
    const { error } = await comissoesApi.create({
      dentista_id: data.dentista_id,
      paciente_id: data.paciente_id,
      procedimento: data.procedimento,
      valor: comissaoValor,
      percentual: data.percentual,
      status: 'pendente',
    });
    if (error) { toast.error("Erro ao criar comissão: " + error); return; }
    toast.success("Comissão registrada com sucesso!");
    setShowAddModal(false);
    loadAll();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await comissoesApi.delete(deleteTarget);
    if (error) { toast.error("Erro ao excluir: " + error); return; }
    toast.success("Comissão excluída com sucesso!");
    setDeleteTarget(null);
    loadAll();
  };

  const profComissoes = (dId: string) => comissoes.filter(c => c.dentista_id === dId);

  const filteredEntries = (selectedDentista
    ? profComissoes(selectedDentista)
    : comissoes
  ).filter(c => statusFilter === "todos" || c.status === statusFilter);

  const totalPending = comissoes.filter(c => c.status === "pendente").reduce((s, c) => s + c.valor, 0);
  const totalApproved = comissoes.filter(c => c.status === "aprovado").reduce((s, c) => s + c.valor, 0);
  const totalPaid = comissoes.filter(c => c.status === "pago").reduce((s, c) => s + c.valor, 0);
  const totalAll = comissoes.reduce((s, c) => s + c.valor, 0);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Gestão de Comissões" />
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Gestão de Comissões" />
      <main className="flex-1 p-6 overflow-auto space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-slide-up" style={{ animationFillMode: 'both' }}>
          <KpiBox icon={DollarSign} label="Total Comissões" value={`R$ ${(totalAll / 1000).toFixed(1)}k`} color="text-primary" />
          <KpiBox icon={Clock} label="Pendente" value={`R$ ${totalPending.toFixed(0)}`} color="text-warning" />
          <KpiBox icon={CheckCircle2} label="Aprovado" value={`R$ ${totalApproved.toFixed(0)}`} color="text-chart-1" />
          <KpiBox icon={CreditCard} label="Pago" value={`R$ ${totalPaid.toFixed(0)}`} color="text-success" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Dentist cards */}
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Profissionais</h3>
            <button onClick={() => setSelectedDentista(null)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all text-xs font-medium ${!selectedDentista ? "bg-primary/5 border-primary/30 text-primary" : "border-transparent hover:bg-muted text-muted-foreground"}`}>
              <Users className="inline h-3.5 w-3.5 mr-1.5" /> Todos os profissionais
            </button>
            {dentistas.map((d, i) => {
              const comms = profComissoes(d.id);
              const earned = comms.reduce((s, c) => s + c.valor, 0);
              const pending = comms.filter(c => c.status === "pendente").reduce((s, c) => s + c.valor, 0);
              return (
                <button key={d.id} onClick={() => setSelectedDentista(d.id)}
                  className={`w-full text-left px-3 py-3 rounded-xl border transition-all duration-300 hover-lift ${selectedDentista === d.id ? "bg-primary/5 border-primary/30 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)]" : "border-transparent hover:bg-muted hover:shadow-card"}`}>
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={`h-8 w-8 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                      {getInitials(d.nome)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{d.nome}</p>
                      <p className="text-[10px] text-muted-foreground">{d.especialidade} · {d.comissao_percentual || 0}%</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MiniStat label="Registros" value={comms.length.toString()} />
                    <MiniStat label="Total" value={`R$ ${earned.toFixed(0)}`} />
                    <MiniStat label="Pendente" value={`R$ ${pending.toFixed(0)}`} accent />
                  </div>
                </button>
              );
            })}
            {dentistas.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhum dentista cadastrado</p>}
          </div>

          {/* Entries table */}
          <div className="lg:col-span-8 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {selectedDentista ? `Comissões — ${dentistas.find(d => d.id === selectedDentista)?.nome}` : "Todas as Comissões"}
              </h3>
              <div className="flex items-center gap-1.5">
                {["todos", "pendente", "aprovado", "pago"].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                    {s === "todos" ? "Todos" : statusCfg[s]?.label || s}
                  </button>
                ))}
                <button onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 ml-2">
                  <Plus className="h-3 w-3" /> Nova
                </button>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Profissional</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Paciente</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Procedimento</th>
                      <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">%</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Comissão</th>
                      <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Data</th>
                      <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                      <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map(entry => {
                      const cfg = statusCfg[entry.status] || statusCfg.pendente;
                      return (
                        <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 text-foreground font-medium">{entry.dentista_nome}</td>
                          <td className="px-4 py-2.5 text-foreground">{entry.paciente_nome}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{entry.procedimento}</td>
                          <td className="px-4 py-2.5 text-center text-muted-foreground">{entry.percentual}%</td>
                          <td className="px-4 py-2.5 text-right font-bold text-foreground">
                            R$ {entry.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-2.5 text-center text-muted-foreground">{entry.data}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>
                              <cfg.icon className="h-2.5 w-2.5" /> {cfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {entry.status === "pendente" && (
                                <button onClick={() => handleStatusChange(entry.id, "aprovado")}
                                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-chart-1/15 text-chart-1 hover:bg-chart-1/25">
                                  Aprovar
                                </button>
                              )}
                              {entry.status === "aprovado" && (
                                <button onClick={() => handleStatusChange(entry.id, "pago")}
                                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-success/15 text-success hover:bg-success/25">
                                  Pagar
                                </button>
                              )}
                              <button onClick={() => setDeleteTarget(entry.id)}
                                className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                                title="Excluir comissão">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredEntries.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Nenhuma comissão encontrada.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {showAddModal && (
          <AddComissaoModal
            dentistas={dentistas}
            pacientes={pacientes}
            onSave={handleCreateComissao}
            onClose={() => setShowAddModal(false)}
          />
        )}
      </main>
    </div>
  );
}

function KpiBox({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="group bg-card rounded-xl border border-border p-4 hover-lift hover:shadow-glow-primary transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
      <div className="flex items-center gap-2 mb-1 relative z-10">
        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center group-hover:shadow-[0_0_10px_-2px_currentColor] transition-shadow duration-300">
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground relative z-10">{value}</p>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`text-[11px] font-bold ${accent ? "text-warning" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function AddComissaoModal({
  dentistas, pacientes, onSave, onClose,
}: {
  dentistas: DentistaRow[];
  pacientes: { id: string; nome: string }[];
  onSave: (data: { dentista_id: string; paciente_id: string; procedimento: string; valor: number; percentual: number }) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    dentista_id: dentistas[0]?.id ?? '',
    paciente_id: pacientes[0]?.id ?? '',
    procedimento: '',
    valor: '',
    percentual: dentistas[0]?.comissao_percentual?.toString() || '30',
  });
  const [saving, setSaving] = useState(false);
  const [pacienteSearch, setPacienteSearch] = useState('');

  const valorNum = Number(form.valor) || 0;
  const percNum = Number(form.percentual) || 0;
  const comissaoValor = (valorNum * percNum) / 100;

  const filteredPacientes = pacientes.filter(p =>
    !pacienteSearch || p.nome.toLowerCase().includes(pacienteSearch.toLowerCase())
  ).slice(0, 50);

  const handleDentistaChange = (id: string) => {
    const d = dentistas.find(d => d.id === id);
    setForm({ ...form, dentista_id: id, percentual: d?.comissao_percentual?.toString() || form.percentual });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.dentista_id || !form.paciente_id || !form.procedimento || !form.valor) return;
    setSaving(true);
    await onSave({
      dentista_id: form.dentista_id,
      paciente_id: form.paciente_id,
      procedimento: form.procedimento,
      valor: valorNum,
      percentual: percNum,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-lg mx-4 animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h2 className="text-lg font-bold text-foreground font-heading">Nova Comissão</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Profissional (Dentista)</label>
            <select value={form.dentista_id} onChange={(e) => handleDentistaChange(e.target.value)}
              className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
              {dentistas.map(d => <option key={d.id} value={d.id}>{d.nome} — {d.especialidade} ({d.comissao_percentual}%)</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Paciente</label>
            <input type="text" placeholder="Buscar paciente..." value={pacienteSearch}
              onChange={(e) => setPacienteSearch(e.target.value)}
              className="w-full h-8 px-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary mb-1" />
            <select value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })} size={4}
              className="w-full px-4 py-1 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
              {filteredPacientes.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Procedimento</label>
            <input value={form.procedimento} onChange={(e) => setForm({ ...form, procedimento: e.target.value })} required placeholder="Ex: Implante dentário"
              className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor do Procedimento (R$)</label>
              <input type="number" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} required min={0} step="0.01"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">% Comissão</label>
              <input type="number" value={form.percentual} onChange={(e) => setForm({ ...form, percentual: e.target.value })} required min={0} max={100}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          {valorNum > 0 && percNum > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Valor da comissão calculada</p>
              <p className="text-lg font-bold text-primary">R$ {comissaoValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/60">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Registrar Comissão
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
