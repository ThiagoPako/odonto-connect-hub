import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, FileText, Camera, FlaskConical, Upload, ChevronRight,
  AlertCircle, Pill, Heart, User, Calendar, Phone, Loader2, Plus, X,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { prontuariosApi, pacientesApi } from "@/lib/vpsApi";
import { AlertasMedicosBanner, type EstadoAnamnese } from "@/components/AlertasMedicosBanner";
import { extrairAlertasMedicos, type AnamneseVPS } from "@/lib/alertasMedicos";
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
  const partes = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)); // ignora "(Alfa)"
  return partes.filter((_, i, a) => i === 0 || i === a.length - 1).map(n => n[0]).join("").toUpperCase() || "?";
}

const AVATAR_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-primary"];

function ProntuarioPage() {
  const [pacientes, setPacientes] = useState<PacienteRow[]>([]);
  const [prontuarios, setProntuarios] = useState<ProntuarioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPacienteId, setSelectedPacienteId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const selecionar = (id: string) => {
    setSelectedPacienteId(id);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  // Alergias e alertas da anamnese, como na consulta: quem abre o prontuário para
  // escrever uma evolução ou receita precisa ver isso antes.
  const [estadoAnamnese, setEstadoAnamnese] = useState<EstadoAnamnese>({ status: "carregando" });
  const [recarregarAnamnese, setRecarregarAnamnese] = useState(0);
  useEffect(() => {
    if (!selectedPacienteId) return;
    let cancelado = false;
    setEstadoAnamnese({ status: "carregando" });
    pacientesApi.getAnamnese(selectedPacienteId).then(({ data, error }) => {
      if (cancelado) return;
      if (error) setEstadoAnamnese({ status: "erro", mensagem: error });
      else if (!data) setEstadoAnamnese({ status: "vazia" });
      else setEstadoAnamnese({ status: "ok", alertas: extrairAlertasMedicos(data as AnamneseVPS) });
    });
    return () => { cancelado = true; };
  }, [selectedPacienteId, recarregarAnamnese]);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [pRes, prRes] = await Promise.all([pacientesApi.list(), prontuariosApi.list()]);
      const erro = pRes.error || prRes.error;
      setLoadError(erro);
      if (erro) toast.error("Não foi possível carregar o prontuário: " + erro);
      const pData: any = pRes.data || [];
      const prData: any = prRes.data || [];
      if (!pRes.error) setPacientes(Array.isArray(pData) ? pData : []);
      if (!prRes.error) setProntuarios(Array.isArray(prData) ? prData.map((r: any) => ({
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
  // Mais recente primeiro (a ordem do servidor não é garantida)
  const selectedEntries = prontuarios
    .filter(p => p.paciente_id === selectedPacienteId)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const handleAddEntry = async (data: { paciente_id: string; tipo: string; titulo: string; descricao: string }): Promise<boolean> => {
    const { error } = await prontuariosApi.create(data);
    if (error) { toast.error("Erro ao salvar o registro: " + error); return false; }
    toast.success("Registro adicionado ao prontuário");
    setShowAdd(false);
    loadAll();
    return true;
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
      {/* div e não main: o __root já tem o <main> */}
      <div className="flex-1 p-4 sm:p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full">
          {/* Patient list */}
          <div className="lg:col-span-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input type="search" aria-label="Buscar paciente" placeholder="Buscar paciente..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto">
              {allFiltered.map((p, i) => {
                const count = prontuarios.filter(pr => pr.paciente_id === p.id).length;
                return (
                  <button key={p.id} onClick={() => selecionar(p.id)} aria-pressed={selectedPacienteId === p.id}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${selectedPacienteId === p.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"}`}>
                    <div className={`h-8 w-8 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                      {getInitials(p.nome)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{p.nome}</p>
                      <p className="text-[10px] text-muted-foreground">{count === 1 ? "1 registro" : `${count} registros`}</p>
                    </div>
                  </button>
                );
              })}
              {allFiltered.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhum paciente encontrado</p>}
            </div>
          </div>

          {/* Patient details */}
          <div className="lg:col-span-9 space-y-4 scroll-mt-4" ref={detailRef}>
            {selectedPaciente ? (
              <>
                {/* Header card */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex flex-wrap items-start gap-4">
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
                    <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                      <Plus className="h-3.5 w-3.5" /> Novo registro
                    </button>
                  </div>
                </div>

                <AlertasMedicosBanner estado={estadoAnamnese} onTentarNovamente={() => setRecarregarAnamnese((n) => n + 1)} />

                {/* Clinical history */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <h4 className="text-sm font-semibold text-card-foreground mb-4">Histórico clínico ({selectedEntries.length === 1 ? "1 registro" : `${selectedEntries.length} registros`})</h4>
                  <div className="space-y-3">
                    {selectedEntries.map(entry => {
                      const cfg = entryTypeConfig[entry.tipo] || entryTypeConfig.evolucao;
                      return (
                        <div key={entry.id} className="border border-border/50 rounded-lg p-3 space-y-2 hover:bg-muted/30 transition-colors">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
                              <span className="text-xs font-medium text-foreground">{entry.titulo || 'Sem título'}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {entry.created_at ? new Date(entry.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ''}
                            </span>
                          </div>
                          {/* pre-wrap: a evolução é escrita em várias linhas e perdia as quebras */}
                          <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">{entry.descricao}</p>
                          {entry.dentista_nome && (
                            <div className="text-[10px] text-muted-foreground">{entry.dentista_nome}</div>
                          )}
                        </div>
                      );
                    })}
                    {loadError ? (
                      <div role="alert" className="text-center py-8 space-y-2">
                        <p className="text-xs text-destructive">Não foi possível carregar os registros clínicos. Não conclua que o paciente não tem histórico. {loadError}</p>
                        <button type="button" onClick={loadAll} className="text-xs font-semibold underline">Tentar de novo</button>
                      </div>
                    ) : selectedEntries.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">Nenhum registro clínico para este paciente.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 hidden lg:flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um paciente</h3>
                <p className="text-xs text-muted-foreground">Escolha um paciente ao lado para ver o prontuário completo.</p>
              </div>
            )}
          </div>
        </div>

        {/* Add entry modal */}
        {showAdd && selectedPacienteId && (
          <AddEntryModal pacienteId={selectedPacienteId} pacienteNome={selectedPaciente?.nome ?? ""} onSave={handleAddEntry} onClose={() => setShowAdd(false)} />
        )}
      </div>
    </div>
  );
}

function AddEntryModal({ pacienteId, pacienteNome, onSave, onClose }: {
  pacienteId: string; pacienteNome: string;
  onSave: (d: { paciente_id: string; tipo: string; titulo: string; descricao: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ tipo: 'evolucao', titulo: '', descricao: '' });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Esc fecha, mas não joga fora um texto já escrito sem perguntar
  const pedirFechar = useCallback(() => {
    if (saving) return;
    if (form.descricao.trim() && !window.confirm("Descartar o texto deste registro?")) return;
    onClose();
  }, [form.descricao, onClose, saving]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") pedirFechar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pedirFechar]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.descricao.trim()) { setErro("Escreva a descrição do registro."); return; }
    setErro(null);
    setSaving(true);
    await onSave({ paciente_id: pacienteId, ...form, titulo: form.titulo.trim(), descricao: form.descricao.trim() });
    setSaving(false);
  };

  const fieldCls = "w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="novo-registro-titulo" className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border/60">
          <div className="min-w-0">
            <h2 id="novo-registro-titulo" className="text-lg font-bold text-foreground font-heading">Novo registro clínico</h2>
            {pacienteNome && <p className="text-xs text-muted-foreground truncate">Paciente: <span className="font-medium text-foreground">{pacienteNome}</span></p>}
          </div>
          <button onClick={pedirFechar} aria-label="Fechar" className="p-2 rounded-lg hover:bg-muted/60"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <form noValidate onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          <div>
            <label htmlFor="reg-tipo" className="text-xs font-medium text-muted-foreground mb-1 block">Tipo</label>
            <select id="reg-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={fieldCls}>
              <option value="evolucao">Evolução</option>
              <option value="anamnese">Anamnese</option>
              <option value="procedimento">Procedimento</option>
              <option value="receita">Receita</option>
              <option value="atestado">Atestado</option>
            </select>
          </div>
          <div>
            <label htmlFor="reg-titulo" className="text-xs font-medium text-muted-foreground mb-1 block">Título</label>
            <input id="reg-titulo" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder="Ex: Retorno pós-extração" className={fieldCls} />
          </div>
          <div>
            <label htmlFor="reg-desc" className="text-xs font-medium text-muted-foreground mb-1 block">Descrição *</label>
            <textarea id="reg-desc" autoFocus value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={6}
              aria-invalid={!!erro || undefined} aria-describedby={erro ? "reg-desc-erro" : undefined}
              className="w-full px-4 py-3 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y aria-[invalid=true]:border-destructive" />
            {erro && <p id="reg-desc-erro" className="mt-1 text-xs text-destructive">{erro}</p>}
            <p className="mt-1 text-[11px] text-muted-foreground">O registro entra no histórico do paciente com data e hora.</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={pedirFechar} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/60">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saving ? "Salvando…" : "Salvar no prontuário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
