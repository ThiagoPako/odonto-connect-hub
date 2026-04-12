import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, FileText, Camera, FlaskConical, Upload, ChevronRight,
  AlertCircle, Pill, Heart, User, Calendar, Phone, Loader2, Plus, X,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { prontuariosApi, pacientesApi } from "@/lib/vpsApi";
import { toast } from "sonner";

export const Route = createFileRoute("/prontuario")({
  ssr: false,
  component: ProntuarioPage,
});

interface PacienteRow {
  id: string;
  nome: string;
  cpf: string;
  telefone: string;
  data_nascimento: string;
}

interface ProntuarioRow {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  dentista_nome: string;
  descricao: string;
  tipo: string;
  titulo: string;
  created_at: string;
}

const entryTypeConfig: Record<string, { label: string; color: string }> = {
  anamnese: { label: "Anamnese", color: "bg-chart-1/15 text-chart-1" },
  evolucao: { label: "Evolução", color: "bg-dental-cyan/15 text-dental-cyan" },
  procedimento: { label: "Procedimento", color: "bg-primary/15 text-primary" },
  receita: { label: "Receita", color: "bg-chart-3/15 text-chart-3" },
  atestado: { label: "Atestado", color: "bg-chart-4/15 text-chart-4" },
};

function getInitials(name: string) {
  return name.split(" ").filter((_, i, a) => i === 0 || i === a.length - 1).map(n => n[0]).join("").toUpperCase();
}

const AVATAR_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-primary"];

function ProntuarioPage() {
  const [pacientes, setPacientes] = useState<PacienteRow[]>([]);
  const [prontuarios, setProntuarios] = useState<ProntuarioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPacienteId, setSelectedPacienteId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [pRes, prRes] = await Promise.all([pacientesApi.list(), prontuariosApi.list()]);
      const pData = (pRes as any).data || pRes || [];
      const prData = (prRes as any).data || prRes || [];
      setPacientes(Array.isArray(pData) ? pData : []);
      setProntuarios(Array.isArray(prData) ? prData.map((r: any) => ({
        id: r.id,
        paciente_id: r.paciente_id,
        paciente_nome: r.paciente_nome || '',
        dentista_nome: r.dentista_nome || '',
        descricao: r.descricao || '',
        tipo: r.tipo || 'evolucao',
        titulo: r.titulo || '',
        created_at: r.created_at || '',
      })) : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Group prontuarios by paciente
  const pacienteIds = [...new Set(prontuarios.map(p => p.paciente_id))];
  const pacientesWithRecords = pacientes.filter(p =>
    pacienteIds.includes(p.id) &&
    (!searchTerm || p.nome.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Also show pacientes without records if searching
  const allFiltered = searchTerm
    ? pacientes.filter(p => p.nome.toLowerCase().includes(searchTerm.toLowerCase()))
    : pacientesWithRecords.length > 0 ? pacientesWithRecords : pacientes.slice(0, 20);

  const selectedPaciente = pacientes.find(p => p.id === selectedPacienteId);
  const selectedEntries = prontuarios.filter(p => p.paciente_id === selectedPacienteId);

  const handleAddEntry = async (data: { paciente_id: string; tipo: string; titulo: string; descricao: string }) => {
    const { error } = await prontuariosApi.create(data);
    if (error) { toast.error("Erro: " + error); return; }
    toast.success("Registro adicionado");
    setShowAdd(false);
    loadAll();
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Prontuário Eletrônico" />
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Prontuário Eletrônico" />
      <main className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full">
          {/* Patient list */}
          <div className="lg:col-span-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input type="text" placeholder="Buscar paciente..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto">
              {allFiltered.map((p, i) => {
                const count = prontuarios.filter(pr => pr.paciente_id === p.id).length;
                return (
                  <button key={p.id} onClick={() => setSelectedPacienteId(p.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${selectedPacienteId === p.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"}`}>
                    <div className={`h-8 w-8 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                      {getInitials(p.nome)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{p.nome}</p>
                      <p className="text-[10px] text-muted-foreground">{count} registros</p>
                    </div>
                  </button>
                );
              })}
              {allFiltered.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhum paciente encontrado</p>}
            </div>
          </div>

          {/* Patient details */}
          <div className="lg:col-span-9 space-y-4">
            {selectedPaciente ? (
              <>
                {/* Header card */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-start gap-4">
                    <div className={`h-14 w-14 rounded-full bg-primary flex items-center justify-center text-lg font-bold text-primary-foreground shrink-0`}>
                      {getInitials(selectedPaciente.nome)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-foreground">{selectedPaciente.nome}</h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        {selectedPaciente.cpf && <span className="flex items-center gap-1"><User className="h-3 w-3" /> CPF: {selectedPaciente.cpf}</span>}
                        {selectedPaciente.telefone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {selectedPaciente.telefone}</span>}
                      </div>
                    </div>
                    <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                      <Plus className="h-3.5 w-3.5" /> Nova Evolução
                    </button>
                  </div>
                </div>

                {/* Clinical history */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <h4 className="text-sm font-semibold text-card-foreground mb-4">Histórico Clínico ({selectedEntries.length} registros)</h4>
                  <div className="space-y-3">
                    {selectedEntries.map(entry => {
                      const cfg = entryTypeConfig[entry.tipo] || entryTypeConfig.evolucao;
                      return (
                        <div key={entry.id} className="border border-border/50 rounded-lg p-3 space-y-2 hover:bg-muted/30 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
                              <span className="text-xs font-medium text-foreground">{entry.titulo || 'Sem título'}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {entry.created_at ? new Date(entry.created_at).toLocaleDateString("pt-BR") : ''}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{entry.descricao}</p>
                          {entry.dentista_nome && (
                            <div className="text-[10px] text-muted-foreground">{entry.dentista_nome}</div>
                          )}
                        </div>
                      );
                    })}
                    {selectedEntries.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">Nenhum registro clínico para este paciente.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um paciente</h3>
                <p className="text-xs text-muted-foreground">Escolha um paciente ao lado para ver o prontuário completo.</p>
              </div>
            )}
          </div>
        </div>

        {/* Add entry modal */}
        {showAdd && selectedPacienteId && (
          <AddEntryModal pacienteId={selectedPacienteId} onSave={handleAddEntry} onClose={() => setShowAdd(false)} />
        )}
      </main>
    </div>
  );
}

function AddEntryModal({ pacienteId, onSave, onClose }: { pacienteId: string; onSave: (d: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({ tipo: 'evolucao', titulo: '', descricao: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.descricao) return;
    setSaving(true);
    await onSave({ paciente_id: pacienteId, ...form });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-lg mx-4 animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h2 className="text-lg font-bold text-foreground font-heading">Novo Registro Clínico</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo</label>
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="evolucao">Evolução</option>
              <option value="anamnese">Anamnese</option>
              <option value="procedimento">Procedimento</option>
              <option value="receita">Receita</option>
              <option value="atestado">Atestado</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Título</label>
            <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Descrição</label>
            <textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={4} required
              className="w-full px-4 py-3 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/60">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
