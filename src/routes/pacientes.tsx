import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useState, useEffect, useCallback, useMemo } from "react";
import { pacientesApi, type HistoricoConsulta } from "@/lib/vpsApi";
import { OdontogramaChart, OdontogramaEditor } from "@/components/OdontogramaChart";
import { toast } from "sonner";
import { type KanbanLead } from "@/data/crmMockData";
import { crmApi } from "@/lib/vpsApi";
import { maskCPF, cpfValido, maskTelefone, telefoneValido, telefoneParaGravar, isoParaBr } from "@/lib/formatos";
import { localDateISO } from "@/lib/utils";
import {
  Search,
  Users,
  UserPlus,
  Eye,
  Phone,
  Mail,
  Calendar,
  MapPin,
  Shield,
  X,
  FileHeart,
  ClipboardList,
  Smile,
  History,
  AlertTriangle,
  Pill,
  Heart,
  Cigarette,
  CheckCircle2,
  XCircle,
  Edit,
  Save,
  Loader2,
  Trash2,
  Filter,
  ChevronDown,
  RotateCcw,
} from "lucide-react";

export const Route = createFileRoute("/pacientes")({
  validateSearch: (search: Record<string, unknown>): { pacienteId?: string } => {
    const id = search.pacienteId;
    return typeof id === "string" && id.length > 0 ? { pacienteId: id } : {};
  },
  ssr: false,
  component: PacientesPage,
});

// Tipo do paciente vindo da API
interface PacienteAPI {
  id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  data_nascimento: string | null;
  sexo: string | null;
  endereco: string | null;
  convenio: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

/** Só a parte aaaa-mm-dd: new Date("1985-03-10") é meia-noite UTC e, no Brasil, vira 09/03. */
function dataSemHora(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : "";
}

const soDigitos = (v: string | null | undefined) => (v || "").replace(/\D/g, "");

type ErrosPaciente = Partial<Record<"nome" | "cpf" | "telefone" | "email" | "data_nascimento", string>>;

type CamposValidados = { nome: string; cpf: string; telefone: string; email: string; data_nascimento: string };

/**
 * Validação do cadastro: mensagens por campo + CPF repetido na clínica (bloqueia)
 * e telefone repetido (só avisa: famílias costumam dividir o número).
 * Com `original` (edição), só valida o que a pessoa mudou: um paciente importado
 * com CPF ruim continua editável nos outros campos.
 */
function validarPaciente(
  form: CamposValidados,
  pacientes: { id: string; nome: string; cpf: string | null; telefone: string | null }[],
  proprioId?: string,
  original?: CamposValidados,
): { erros: ErrosPaciente; telefoneRepetido: string | null } {
  const erros: ErrosPaciente = {};
  const mudou = (k: keyof CamposValidados) => !original || (form[k] || "").trim() !== (original[k] || "").trim();
  if (mudou("nome")) {
    if (!form.nome.trim()) erros.nome = "Informe o nome do paciente.";
    else if (form.nome.trim().length < 3) erros.nome = "Nome muito curto.";
  }
  const cpf = soDigitos(form.cpf);
  if (mudou("cpf") && cpf) {
    if (!cpfValido(cpf)) erros.cpf = "CPF inválido. Confira os 11 dígitos.";
    // Mesma frase do servidor (#50); não expõe quem é o outro paciente
    else if (pacientes.some((p) => p.id !== proprioId && soDigitos(p.cpf) === cpf)) erros.cpf = "Já existe um paciente com este CPF nesta clínica.";
  }
  if (mudou("telefone") && form.telefone.trim() && !telefoneValido(form.telefone)) erros.telefone = "Telefone incompleto. Use DDD + número.";
  if (mudou("email") && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) erros.email = "E-mail inválido.";
  if (mudou("data_nascimento") && form.data_nascimento) {
    if (form.data_nascimento > localDateISO()) erros.data_nascimento = "A data de nascimento não pode ser no futuro.";
    else if (form.data_nascimento < "1900-01-01") erros.data_nascimento = "Data de nascimento inválida.";
  }
  let telefoneRepetido: string | null = null;
  const tel = soDigitos(form.telefone).slice(-10);
  if (tel.length === 10) {
    const outro = pacientes.find((p) => p.id !== proprioId && soDigitos(p.telefone).slice(-10) === tel);
    if (outro) telefoneRepetido = outro.nome;
  }
  return { erros, telefoneRepetido };
}

function ErroCampo({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return <p id={`${id}-erro`} className="mt-1 text-xs text-destructive">{msg}</p>;
}
const ariaErro = (id: string, msg?: string) =>
  msg ? { "aria-invalid": true as const, "aria-describedby": `${id}-erro` } : {};

function calcularIdade(dataNasc: string | null): number | null {
  if (!dataNasc) return null;
  const [y, mo, d] = dataSemHora(dataNasc).split("-").map(Number);
  const nasc = new Date(y, (mo || 1) - 1, d || 1);
  if (isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function getInitials(nome: string) {
  return nome
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w)) // ignora "(Alfa)", "-" etc.
    .filter((_, i, arr) => i === 0 || i === arr.length - 1)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

function PacientesPage() {
  const { pacienteId } = Route.useSearch();
  const [pacientes, setPacientes] = useState<PacienteAPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedPaciente, setSelectedPaciente] = useState<PacienteAPI | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterConvenio, setFilterConvenio] = useState("");
  const [filterSexo, setFilterSexo] = useState("");
  const [filterIdadeMin, setFilterIdadeMin] = useState("");
  const [filterIdadeMax, setFilterIdadeMax] = useState("");
  const [usingDemo, setUsingDemo] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPacientes = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await pacientesApi.list();
      setLoadError(error);
      if (error) {
        toast.error("Não foi possível carregar os pacientes: " + error);
        setUsingDemo(false);
      } else if (Array.isArray(data)) {
        setPacientes(data);
        setUsingDemo(false);
        if (pacienteId) {
          const found = data.find((p: PacienteAPI) => p.id === pacienteId);
          if (found) setSelectedPaciente(found);
        }
        // Ficha aberta: troca pelos dados recém-salvos para não exibir a versão antiga
        setSelectedPaciente((prev) =>
          prev ? (data.find((p: PacienteAPI) => p.id === prev.id) ?? prev) : prev,
        );
      } else {
        setPacientes([]);
        setUsingDemo(false);
      }
    } catch (err) {
      console.error("[pacientes] load error:", err);
      setLoadError("Erro inesperado ao carregar.");
      setUsingDemo(false);
    } finally {
      setLoading(false);
    }
  }, [pacienteId]);

  useEffect(() => {
    loadPacientes();
  }, [loadPacientes]);

  // Unique convenios for filter dropdown
  const convenios = [...new Set(pacientes.map((p) => p.convenio).filter(Boolean))] as string[];

  const hasActiveFilters = filterConvenio || filterSexo || filterIdadeMin || filterIdadeMax;

  const filtered = pacientes.filter((p) => {
    // Text search
    // CPF e telefone comparam só os dígitos: "529.982" acha "52998224725" e vice-versa
    const buscaDigitos = soDigitos(searchTerm);
    const matchesSearch =
      p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (buscaDigitos.length >= 3 && (soDigitos(p.cpf).includes(buscaDigitos) || soDigitos(p.telefone).includes(buscaDigitos)));
    if (!matchesSearch) return false;

    // Convenio filter
    if (filterConvenio === "__particular") {
      if (p.convenio) return false;
    } else if (filterConvenio && p.convenio !== filterConvenio) {
      return false;
    }

    // Sexo filter
    if (filterSexo && (p.sexo || "").toLowerCase() !== filterSexo.toLowerCase()) return false;

    // Age range filter
    const idade = calcularIdade(p.data_nascimento);
    if (filterIdadeMin && idade !== null && idade < Number(filterIdadeMin)) return false;
    if (filterIdadeMax && idade !== null && idade > Number(filterIdadeMax)) return false;
    // If no birth date and age filter active, exclude
    if ((filterIdadeMin || filterIdadeMax) && idade === null) return false;

    return true;
  });

  const comConvenio = pacientes.filter((p) => p.convenio).length;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Cadastro de Pacientes" />
      <main className="flex-1 p-8 space-y-6 overflow-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 animate-slide-up" style={{ animationFillMode: 'both' }}>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Total</p>
            <p className="text-2xl font-bold text-card-foreground mt-1 font-heading">{pacientes.length}</p>
          </div>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Com Convênio</p>
            <p className="text-2xl font-bold text-primary mt-1 font-heading">{comConvenio}</p>
          </div>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Particular</p>
            <p className="text-2xl font-bold text-card-foreground mt-1 font-heading">{pacientes.length - comConvenio}</p>
          </div>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-success/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Cadastrados Hoje</p>
            <p className="text-2xl font-bold text-success mt-1 font-heading">
              {pacientes.filter((p) => {
                // Data local: toISOString() é UTC e, depois das 21h, contava o cadastro como "amanhã"
                return !!p.created_at && localDateISO(new Date(p.created_at)) === localDateISO();
              }).length}
            </p>
          </div>
        </div>

        {/* Search + Actions */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* No celular a busca ocupa a linha inteira (antes ficava com ~40 px) */}
          <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 min-w-0">
            <div className="relative flex-1 min-w-0 sm:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                aria-label="Buscar paciente por nome, CPF ou telefone"
                placeholder="Buscar por nome, CPF ou telefone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-card border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              aria-expanded={showFilters}
              className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                hasActiveFilters
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-card border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Filtros</span>
              <span className="sr-only sm:hidden">Filtros</span>
              {hasActiveFilters && (
                <span className="ml-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                  {[filterConvenio, filterSexo, filterIdadeMin || filterIdadeMax].filter(Boolean).length}
                </span>
              )}
              <ChevronDown className={`hidden sm:block h-3 w-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="w-full sm:w-auto justify-center flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <UserPlus className="h-4 w-4" />
            Novo Paciente
          </button>
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <div className="bg-card rounded-xl border border-border/60 p-4 animate-fade-in shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filtros Avançados</p>
              {hasActiveFilters && (
                <button
                  onClick={() => { setFilterConvenio(""); setFilterSexo(""); setFilterIdadeMin(""); setFilterIdadeMax(""); }}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Limpar filtros
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground mb-1 block uppercase tracking-wider">Convênio</label>
                <select
                  value={filterConvenio}
                  onChange={(e) => setFilterConvenio(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Todos</option>
                  <option value="__particular">Particular (sem convênio)</option>
                  {convenios.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground mb-1 block uppercase tracking-wider">Sexo</label>
                <select
                  value={filterSexo}
                  onChange={(e) => setFilterSexo(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Todos</option>
                  <option value="masculino">Masculino</option>
                  <option value="feminino">Feminino</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground mb-1 block uppercase tracking-wider">Idade mínima</label>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={filterIdadeMin}
                  onChange={(e) => setFilterIdadeMin(e.target.value)}
                  placeholder="Ex: 18"
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground mb-1 block uppercase tracking-wider">Idade máxima</label>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={filterIdadeMax}
                  onChange={(e) => setFilterIdadeMax(e.target.value)}
                  placeholder="Ex: 65"
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            {hasActiveFilters && (
              <p className="text-[10px] text-muted-foreground mt-3">
                {filtered.length} paciente{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Carregando pacientes...</span>
          </div>
        )}

        {/* Patient Cards */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-slide-up">
            {filtered.map((pac) => {
              const idade = calcularIdade(pac.data_nascimento);
              return (
                <div
                  key={pac.id}
                  className="bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 cursor-pointer group"
                  onClick={() => setSelectedPaciente(pac)}
                >
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                      {getInitials(pac.nome)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{pac.nome}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {idade !== null ? `${idade} anos` : ""}
                        {pac.sexo ? ` • ${pac.sexo === "masculino" ? "M" : pac.sexo === "feminino" ? "F" : "O"}` : ""}
                      </p>
                      {pac.telefone && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-2">
                          <Phone className="h-3 w-3" />{maskTelefone(pac.telefone)}
                        </span>
                      )}
                      {pac.convenio && (
                        <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                          <Shield className="h-3 w-3" />{pac.convenio}
                        </span>
                      )}
                    </div>
                    <button className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-muted/60 transition-all">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && loadError && (
          <ErroCarregar mensagem={`Não foi possível carregar os pacientes. ${loadError}`} onRetry={loadPacientes} />
        )}

        {!loading && !loadError && filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">
              {pacientes.length === 0
                ? "Nenhum paciente cadastrado ainda. Use \"Novo Paciente\" para cadastrar o primeiro."
                : "Nenhum paciente encontrado com essa busca ou filtros."}
            </p>
          </div>
        )}

        {/* New Patient Form */}
        {showForm && (
          <NovoPacienteModal
            pacientes={pacientes}
            onClose={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              loadPacientes();
            }}
          />
        )}

        {/* Patient Detail Modal */}
        {selectedPaciente && (
          <PacienteDetailModal
            paciente={selectedPaciente}
            pacientesClinica={pacientes}
            onClose={() => setSelectedPaciente(null)}
            onUpdated={() => {
              loadPacientes();
            }}
          />
        )}
      </main>
    </div>
  );
}

/* ─── Novo Paciente Modal ─── */
function NovoPacienteModal({ pacientes, onClose, onSaved }: { pacientes: PacienteAPI[]; onClose: () => void; onSaved: () => void }) {
  const [erros, setErros] = useState<ErrosPaciente>({});
  // Esc fecha o cadastro (o modal não é um Dialog do shadcn)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [saving, setSaving] = useState(false);
  const [showLeadPicker, setShowLeadPicker] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nome: "",
    cpf: "",
    data_nascimento: "",
    sexo: "",
    telefone: "",
    email: "",
    convenio: "",
    endereco: "",
    observacoes: "",
  });

  // Leads do CRM (todas as etapas), carregados ao abrir a busca
  const [leadsKanban, setLeadsKanban] = useState<Record<string, KanbanLead[]> | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    const { data, error } = await crmApi.kanban();
    setLeadsLoading(false);
    setLeadsError(error);
    if (!error) setLeadsKanban((data as Record<string, KanbanLead[]>) || {});
  }, []);
  useEffect(() => {
    if (showLeadPicker && !leadsKanban && !leadsLoading) loadLeads();
  }, [showLeadPicker, leadsKanban, leadsLoading, loadLeads]);

  const allLeads = useMemo(() => {
    const leads: { id: string; name: string; phone: string; origin: string; initials: string }[] = [];
    const seen = new Set<string>();
    const addLeads = (kanban: Record<string, KanbanLead[]>) => {
      Object.values(kanban).forEach((arr) =>
        arr.forEach((l) => {
          if (!seen.has(l.id)) {
            seen.add(l.id);
            leads.push({ id: l.id, name: l.name, phone: l.phone, origin: l.origin, initials: l.initials });
          }
        })
      );
    };
    if (leadsKanban) addLeads(leadsKanban);
    return leads;
  }, [leadsKanban]);

  const filteredLeads = useMemo(() => {
    if (!leadSearch.trim()) return allLeads;
    const q = leadSearch.toLowerCase();
    return allLeads.filter(
      (l) => l.name.toLowerCase().includes(q) || l.phone.includes(q)
    );
  }, [allLeads, leadSearch]);

  const handleSelectLead = (lead: typeof allLeads[0]) => {
    setSelectedLeadId(lead.id);
    setForm((prev) => ({
      ...prev,
      nome: lead.name,
      telefone: maskTelefone(lead.phone || ""),
      observacoes: prev.observacoes
        ? `${prev.observacoes}\nOrigem CRM: ${lead.origin}`
        : `Origem CRM: ${lead.origin}`,
    }));
    setShowLeadPicker(false);
    toast.success(`Dados do lead "${lead.name}" preenchidos`);
  };

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const telefoneRepetido = validarPaciente(form, pacientes).telefoneRepetido;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { erros: er } = validarPaciente(form, pacientes);
    setErros(er);
    if (Object.keys(er).length) {
      document.getElementById(`novo-${Object.keys(er)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const { error } = await pacientesApi.create({
        nome: form.nome.trim(),
        cpf: form.cpf.trim() || null,
        // Grava só dígitos com 55, igual ao lead do CRM (o servidor cruza por igualdade exata)
        telefone: telefoneParaGravar(form.telefone),
        email: form.email.trim() || null,
        data_nascimento: form.data_nascimento || null,
        sexo: form.sexo || null,
        convenio: form.convenio.trim() || null,
        endereco: form.endereco.trim() || null,
        observacoes: form.observacoes.trim() || null,
      });

      if (error) {
        toast.error("Erro ao cadastrar paciente: " + error);
        setSaving(false);
        return;
      }
      
      toast.success(`${form.nome} cadastrado com sucesso!`);
      // Move lead to "Orçamento Aprovado" in CRM
      if (selectedLeadId) {
        const { error: stageError } = await crmApi.updateStage(selectedLeadId, "orcamento_aprovado", "Convertido em paciente");
        if (stageError) toast.error("Paciente cadastrado, mas o lead não foi movido no CRM: " + stageError);
        else toast.success("Lead movido para 'Orçamento Aprovado' no CRM");
      }
      onSaved();
    } catch (err) {
      console.error("[pacientes] create error:", err);
      toast.error("Erro inesperado ao salvar. Verifique sua conexão.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 sticky top-0 bg-card z-10 rounded-t-2xl">
          <h2 id="novo-paciente-titulo" className="text-lg font-bold text-foreground font-heading">Novo Paciente</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <form noValidate className="p-4 sm:p-6 space-y-5" onSubmit={handleSubmit}>
          {/* Lead pre-fill banner */}
          <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold text-primary">Pré-cadastrar a partir de um Lead do CRM</span>
              </div>
              <button
                type="button"
                onClick={() => setShowLeadPicker(!showLeadPicker)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/20 transition-colors"
              >
                {selectedLeadId ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Lead vinculado
                  </>
                ) : (
                  <>
                    <Search className="h-3.5 w-3.5" />
                    Buscar Lead
                  </>
                )}
              </button>
            </div>

            {showLeadPicker && (
              <div className="mt-3 space-y-2 animate-fade-in">
                <input
                  type="text"
                  placeholder="Buscar lead por nome ou telefone..."
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="max-h-40 overflow-y-auto space-y-1 scrollbar-thin">
                  {leadsLoading && (
                    <p className="text-[11px] text-muted-foreground text-center py-3 flex items-center justify-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" /> Carregando leads...
                    </p>
                  )}
                  {!leadsLoading && leadsError && (
                    <div role="alert" className="text-[11px] text-destructive text-center py-3">
                      Não foi possível carregar os leads. {leadsError}{" "}
                      <button type="button" onClick={loadLeads} className="underline font-semibold">Tentar de novo</button>
                    </div>
                  )}
                  {!leadsLoading && !leadsError && filteredLeads.length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-3">Nenhum lead encontrado</p>
                  )}
                  {filteredLeads.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => handleSelectLead(lead)}
                      className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors ${
                        selectedLeadId === lead.id
                          ? "bg-primary/15 border border-primary/30"
                          : "hover:bg-muted/60 border border-transparent"
                      }`}
                    >
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                        {lead.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{lead.name}</p>
                        <p className="text-[10px] text-muted-foreground">{lead.phone} • {lead.origin}</p>
                      </div>
                      {selectedLeadId === lead.id && (
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="novo-nome" className="text-xs font-medium text-muted-foreground mb-1 block">Nome completo *</label>
              <input
                id="novo-nome"
                autoFocus
                autoComplete="off"
                value={form.nome}
                onChange={(e) => handleChange("nome", e.target.value)}
                placeholder="Nome do paciente"
                {...ariaErro("novo-nome", erros.nome)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-destructive"
              />
              <ErroCampo id="novo-nome" msg={erros.nome} />
            </div>
            <div>
              <label htmlFor="novo-cpf" className="text-xs font-medium text-muted-foreground mb-1 block">CPF</label>
              <input
                id="novo-cpf"
                inputMode="numeric"
                value={form.cpf}
                onChange={(e) => handleChange("cpf", maskCPF(e.target.value))}
                placeholder="000.000.000-00"
                {...ariaErro("novo-cpf", erros.cpf)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-destructive"
              />
              <ErroCampo id="novo-cpf" msg={erros.cpf} />
            </div>
            <div>
              <label htmlFor="novo-data_nascimento" className="text-xs font-medium text-muted-foreground mb-1 block">Data de nascimento</label>
              <input
                id="novo-data_nascimento"
                type="date"
                max={localDateISO()}
                min="1900-01-01"
                value={form.data_nascimento}
                onChange={(e) => handleChange("data_nascimento", e.target.value)}
                {...ariaErro("novo-data_nascimento", erros.data_nascimento)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-destructive"
              />
              <ErroCampo id="novo-data_nascimento" msg={erros.data_nascimento} />
            </div>
            <div>
              <label htmlFor="novo-sexo" className="text-xs font-medium text-muted-foreground mb-1 block">Sexo</label>
              <select
                id="novo-sexo"
                value={form.sexo}
                onChange={(e) => handleChange("sexo", e.target.value)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Não informado</option>
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div>
              <label htmlFor="novo-telefone" className="text-xs font-medium text-muted-foreground mb-1 block">Telefone (WhatsApp)</label>
              <input
                id="novo-telefone"
                type="tel"
                inputMode="tel"
                value={form.telefone}
                onChange={(e) => handleChange("telefone", maskTelefone(e.target.value))}
                placeholder="(11) 99999-0000"
                {...ariaErro("novo-telefone", erros.telefone)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-destructive"
              />
              <ErroCampo id="novo-telefone" msg={erros.telefone} />
              {!erros.telefone && telefoneRepetido && (
                <p className="mt-1 text-xs text-warning">Este telefone já está no cadastro de outro paciente da clínica. Confira se não é a mesma pessoa antes de salvar.</p>
              )}
            </div>
            <div>
              <label htmlFor="novo-email" className="text-xs font-medium text-muted-foreground mb-1 block">E-mail</label>
              <input
                id="novo-email"
                type="email"
                value={form.email}
                onChange={(e) => handleChange("email", e.target.value)}
                placeholder="email@exemplo.com"
                {...ariaErro("novo-email", erros.email)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-destructive"
              />
              <ErroCampo id="novo-email" msg={erros.email} />
            </div>
            <div>
              <label htmlFor="novo-convenio" className="text-xs font-medium text-muted-foreground mb-1 block">Convênio</label>
              <input
                id="novo-convenio"
                value={form.convenio}
                onChange={(e) => handleChange("convenio", e.target.value)}
                placeholder="Ex: Amil Dental, Particular..."
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="novo-endereco" className="text-xs font-medium text-muted-foreground mb-1 block">Endereço</label>
              <input
                id="novo-endereco"
                value={form.endereco}
                onChange={(e) => handleChange("endereco", e.target.value)}
                placeholder="Rua, número — Cidade, UF"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="novo-observacoes" className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
              <textarea
                id="novo-observacoes"
                rows={3}
                value={form.observacoes}
                onChange={(e) => handleChange("observacoes", e.target.value)}
                placeholder="Observações relevantes sobre o paciente..."
                className="w-full px-4 py-3 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/60 transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Cadastrar Paciente
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Patient Detail Modal ─── */
type DetailTab = "dados" | "anamnese" | "odontograma" | "historico";

interface AnamneseData {
  id?: string;
  paciente_id: string;
  alergias: string[];
  medicamentos: string[];
  doencas_preexistentes: string[];
  cirurgias_anteriores: string[];
  fumante: boolean;
  etilista: boolean;
  gestante: boolean;
  diabetes: boolean;
  cardiopatia: boolean;
  hepatite: boolean;
  hiv: boolean;
  hemofilia: boolean;
  epilepsia: boolean;
  pressao_arterial: string | null;
  observacoes: string | null;
  updated_at?: string;
}

function PacienteDetailModal({
  paciente,
  pacientesClinica = [],
  onClose,
  onUpdated,
}: {
  paciente: PacienteAPI;
  pacientesClinica?: PacienteAPI[];
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [errosEdicao, setErrosEdicao] = useState<ErrosPaciente>({});
  const [activeTab, setActiveTab] = useState<DetailTab>("dados");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    nome: paciente.nome,
    cpf: paciente.cpf || "",
    data_nascimento: dataSemHora(paciente.data_nascimento),
    sexo: paciente.sexo || "",
    telefone: paciente.telefone || "", // sem máscara aqui: só muda o formato gravado se a pessoa editar
    email: paciente.email || "",
    convenio: paciente.convenio || "",
    endereco: paciente.endereco || "",
    observacoes: paciente.observacoes || "",
  });

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    const original = {
      nome: paciente.nome || "", cpf: paciente.cpf || "", telefone: paciente.telefone || "",
      email: paciente.email || "", data_nascimento: dataSemHora(paciente.data_nascimento),
    };
    const { erros: er } = validarPaciente(form, pacientesClinica, paciente.id, original);
    setErrosEdicao(er);
    if (Object.keys(er).length) {
      toast.error("Confira os campos destacados.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await pacientesApi.update(paciente.id, {
        nome: form.nome.trim(),
        cpf: form.cpf.trim() || null,
        // Telefone não alterado vai como estava; alterado vai no formato de gravação (dígitos com 55)
        telefone: form.telefone.trim() === (paciente.telefone || "").trim() ? (paciente.telefone || null) : telefoneParaGravar(form.telefone),
        email: form.email.trim() || null,
        data_nascimento: form.data_nascimento || null,
        sexo: form.sexo || null,
        convenio: form.convenio.trim() || null,
        endereco: form.endereco.trim() || null,
        observacoes: form.observacoes.trim() || null,
      });
      if (error) {
        toast.error("Erro ao atualizar: " + error);
      } else {
        toast.success("Paciente atualizado!");
        setEditing(false);
        onUpdated?.();
      }
    } catch {
      toast.error("Erro inesperado ao atualizar. Verifique sua conexão.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm({
      nome: paciente.nome,
      cpf: paciente.cpf || "",
      data_nascimento: dataSemHora(paciente.data_nascimento),
      sexo: paciente.sexo || "",
      telefone: paciente.telefone || "",
      email: paciente.email || "",
      convenio: paciente.convenio || "",
      endereco: paciente.endereco || "",
      observacoes: paciente.observacoes || "",
    });
    setErrosEdicao({});
    setEditing(false);
  };

  const idade = calcularIdade(form.data_nascimento || null);
  const inputClass = "w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

  const tabs: { key: DetailTab; label: string; icon: typeof FileHeart }[] = [
    { key: "dados", label: "Dados", icon: FileHeart },
    { key: "anamnese", label: "Anamnese", icon: ClipboardList },
    { key: "odontograma", label: "Odontograma", icon: Smile },
    { key: "historico", label: "Histórico", icon: History },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden animate-slide-up flex flex-col">
        {/* Header — quebra linha no celular para os botões não saírem da tela */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {getInitials(form.nome || paciente.nome)}
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground font-heading">{editing ? form.nome : paciente.nome}</h2>
              <p className="text-xs text-muted-foreground">
                {idade !== null ? `${idade} anos` : ""}
                {(editing ? form.cpf : paciente.cpf) ? ` • CPF: ${editing ? form.cpf : paciente.cpf}` : ""}
                {(editing ? form.convenio : paciente.convenio) ? ` • ${editing ? form.convenio : paciente.convenio}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "dados" && !editing && (
              <>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-destructive/10 text-destructive text-xs font-semibold hover:bg-destructive/20 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                >
                  <Edit className="h-3.5 w-3.5" />
                  Editar
                </button>
              </>
            )}
            {activeTab === "dados" && editing && (
              <>
                <button onClick={handleCancel} className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Salvar
                </button>
              </>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-border/60 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); if (tab.key !== "dados") setEditing(false); }}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-[1px] ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "dados" && (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="col-span-1 md:col-span-2 bg-muted/30 rounded-xl p-4 flex items-start gap-3">
                  <FileHeart className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Nome</p>
                    {editing ? <><input aria-label="Nome" value={form.nome} onChange={(e) => handleChange("nome", e.target.value)} className={inputClass + " mt-1"} {...ariaErro("edit-nome", errosEdicao.nome)} /><ErroCampo id="edit-nome" msg={errosEdicao.nome} /></> : <p className="text-sm text-foreground mt-0.5">{paciente.nome}</p>}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-xl p-4 flex items-start gap-3">
                  <FileHeart className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">CPF</p>
                    {editing ? <><input aria-label="CPF" inputMode="numeric" value={form.cpf} onChange={(e) => handleChange("cpf", maskCPF(e.target.value))} placeholder="000.000.000-00" className={inputClass + " mt-1"} {...ariaErro("edit-cpf", errosEdicao.cpf)} /><ErroCampo id="edit-cpf" msg={errosEdicao.cpf} /></> : <p className="text-sm text-foreground mt-0.5">{paciente.cpf || "—"}</p>}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-xl p-4 flex items-start gap-3">
                  <Calendar className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Nascimento</p>
                    {editing ? <><input aria-label="Data de nascimento" type="date" max={localDateISO()} min="1900-01-01" value={form.data_nascimento} onChange={(e) => handleChange("data_nascimento", e.target.value)} className={inputClass + " mt-1"} {...ariaErro("edit-nasc", errosEdicao.data_nascimento)} /><ErroCampo id="edit-nasc" msg={errosEdicao.data_nascimento} /></> : <p className="text-sm text-foreground mt-0.5">{paciente.data_nascimento ? isoParaBr(dataSemHora(paciente.data_nascimento)) : "—"}</p>}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-xl p-4 flex items-start gap-3">
                  <Phone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Telefone</p>
                    {editing ? <><input aria-label="Telefone" type="tel" inputMode="tel" value={form.telefone} onChange={(e) => handleChange("telefone", maskTelefone(e.target.value))} placeholder="(11) 99999-0000" className={inputClass + " mt-1"} {...ariaErro("edit-tel", errosEdicao.telefone)} /><ErroCampo id="edit-tel" msg={errosEdicao.telefone} /></> : <p className="text-sm text-foreground mt-0.5">{paciente.telefone ? maskTelefone(paciente.telefone) : "—"}</p>}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-xl p-4 flex items-start gap-3">
                  <Mail className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">E-mail</p>
                    {editing ? <><input aria-label="E-mail" type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} placeholder="email@exemplo.com" className={inputClass + " mt-1"} {...ariaErro("edit-email", errosEdicao.email)} /><ErroCampo id="edit-email" msg={errosEdicao.email} /></> : <p className="text-sm text-foreground mt-0.5">{paciente.email || "—"}</p>}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-xl p-4 flex items-start gap-3">
                  <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Convênio</p>
                    {editing ? <input aria-label="Convênio" value={form.convenio} onChange={(e) => handleChange("convenio", e.target.value)} placeholder="Particular" className={inputClass + " mt-1"} /> : <p className="text-sm text-foreground mt-0.5">{paciente.convenio || "Particular"}</p>}
                  </div>
                </div>
                <div className="col-span-1 md:col-span-2 bg-muted/30 rounded-xl p-4 flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Endereço</p>
                    {editing ? <input aria-label="Endereço" value={form.endereco} onChange={(e) => handleChange("endereco", e.target.value)} placeholder="Rua, número — Cidade, UF" className={inputClass + " mt-1"} /> : <p className="text-sm text-foreground mt-0.5">{paciente.endereco || "—"}</p>}
                  </div>
                </div>
              </div>
              <div className="bg-warning/5 border border-warning/20 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1">Observações</p>
                {editing ? (
                  <textarea rows={3} value={form.observacoes} onChange={(e) => handleChange("observacoes", e.target.value)} placeholder="Observações relevantes..." className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none mt-1" />
                ) : (
                  <p className="text-xs text-foreground">{paciente.observacoes || "Nenhuma observação."}</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "anamnese" && (
            <AnamneseTab pacienteId={paciente.id} />
          )}

          {activeTab === "odontograma" && (
            <OdontogramaTab pacienteId={paciente.id} />
          )}

          {activeTab === "historico" && (
            <HistoricoTab pacienteId={paciente.id} />
          )}
        </div>

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-2xl">
            <div className="bg-card rounded-xl border border-border/60 shadow-lg p-6 max-w-sm mx-4 animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <Trash2 className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Excluir Paciente</h3>
                  <p className="text-xs text-muted-foreground">Esta ação não pode ser desfeita.</p>
                </div>
              </div>
              <p className="text-sm text-foreground mb-5">
                Deseja realmente excluir <strong>{paciente.nome}</strong>? Todos os dados (anamnese, odontograma, histórico) serão removidos.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      const { error } = await pacientesApi.delete(paciente.id);
                      if (error) {
                        toast.error("Erro ao excluir: " + error);
                      } else {
                        toast.success("Paciente excluído!");
                        onUpdated?.();
                        onClose();
                      }
                    } catch {
                      toast.error("Erro de conexão");
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors shadow-sm disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Anamnese Tab ─── */
function AnamneseTab({ pacienteId }: { pacienteId: string }) {
  const [anamnese, setAnamnese] = useState<AnamneseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const emptyAnamnese: AnamneseData = {
    paciente_id: pacienteId,
    alergias: [],
    medicamentos: [],
    doencas_preexistentes: [],
    cirurgias_anteriores: [],
    fumante: false,
    etilista: false,
    gestante: false,
    diabetes: false,
    cardiopatia: false,
    hepatite: false,
    hiv: false,
    hemofilia: false,
    epilepsia: false,
    pressao_arterial: "",
    observacoes: "",
  };

  const [form, setForm] = useState<AnamneseData>(emptyAnamnese);
  const [alergiasText, setAlergiasText] = useState("");
  const [medicamentosText, setMedicamentosText] = useState("");
  const [doencasText, setDoencasText] = useState("");
  const [cirurgiasText, setCirurgiasText] = useState("");

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAnamnese = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await pacientesApi.getAnamnese(pacienteId);
      setLoadError(error);
      if (error) {
        toast.error("Erro ao carregar anamnese: " + error);
      } else if (data) {
        setAnamnese(data as AnamneseData);
        setForm(data as AnamneseData);
        setAlergiasText((data as AnamneseData).alergias?.join(", ") || "");
        setMedicamentosText((data as AnamneseData).medicamentos?.join(", ") || "");
        setDoencasText((data as AnamneseData).doencas_preexistentes?.join(", ") || "");
        setCirurgiasText((data as AnamneseData).cirurgias_anteriores?.join(", ") || "");
      }
    } catch {
      // No anamnese yet — that's ok
    } finally {
      setLoading(false);
    }
  }, [pacienteId]);

  useEffect(() => { loadAnamnese(); }, [loadAnamnese]);

  const startEditing = () => {
    if (anamnese) {
      setForm(anamnese);
      setAlergiasText(anamnese.alergias?.join(", ") || "");
      setMedicamentosText(anamnese.medicamentos?.join(", ") || "");
      setDoencasText(anamnese.doencas_preexistentes?.join(", ") || "");
      setCirurgiasText(anamnese.cirurgias_anteriores?.join(", ") || "");
    } else {
      setForm(emptyAnamnese);
      setAlergiasText("");
      setMedicamentosText("");
      setDoencasText("");
      setCirurgiasText("");
    }
    setEditing(true);
  };

  const parseList = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        alergias: parseList(alergiasText),
        medicamentos: parseList(medicamentosText),
        doencas_preexistentes: parseList(doencasText),
        cirurgias_anteriores: parseList(cirurgiasText),
      };
      const { data, error } = await pacientesApi.saveAnamnese(pacienteId, payload);
      if (error) {
        toast.error("Erro ao salvar: " + error);
      } else {
        toast.success("Anamnese salva com sucesso!");
        setAnamnese(data as AnamneseData);
        setEditing(false);
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Carregando anamnese...</span>
      </div>
    );
  }

  // Sem carregar não deixa editar: salvar por cima apagaria alergias e alertas já registrados
  if (loadError) {
    return <ErroCarregar mensagem={`Não foi possível carregar a anamnese. ${loadError}`} onRetry={loadAnamnese} />;
  }

  const inputClass = "w-full h-9 px-3 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

  const boolFields: { label: string; key: keyof AnamneseData; icon: typeof Heart }[] = [
    { label: "Diabetes", key: "diabetes", icon: Heart },
    { label: "Cardiopatia", key: "cardiopatia", icon: Heart },
    { label: "Hepatite", key: "hepatite", icon: Heart },
    { label: "HIV", key: "hiv", icon: Heart },
    { label: "Hemofilia", key: "hemofilia", icon: Heart },
    { label: "Epilepsia", key: "epilepsia", icon: Heart },
    { label: "Fumante", key: "fumante", icon: Cigarette },
    { label: "Etilista", key: "etilista", icon: Pill },
    { label: "Gestante", key: "gestante", icon: Heart },
  ];

  // View mode
  if (!editing) {
    if (!anamnese) {
      return (
        <div className="text-center py-16 animate-fade-in">
          <ClipboardList className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">Anamnese não preenchida.</p>
          <button
            onClick={startEditing}
            className="mt-4 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Preencher Anamnese
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex justify-end">
          <button
            onClick={startEditing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
          >
            <Edit className="h-3.5 w-3.5" />
            Editar Anamnese
          </button>
        </div>

        {/* Alertas */}
        {((anamnese.alergias?.length ?? 0) > 0 || anamnese.cardiopatia) && (
          <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">Atenção</p>
              {(anamnese.alergias?.length ?? 0) > 0 && (
                <p className="text-xs text-destructive/80 mt-1">Alergias: <strong>{anamnese.alergias.join(", ")}</strong></p>
              )}
              {anamnese.cardiopatia && (
                <p className="text-xs text-destructive/80 mt-1">Paciente cardiopata — verificar liberação do cardiologista.</p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ListCard label="Alergias" icon={AlertTriangle} items={anamnese.alergias} color="destructive" />
          <ListCard label="Medicamentos" icon={Pill} items={anamnese.medicamentos} color="info" />
          <ListCard label="Doenças Preexistentes" icon={Heart} items={anamnese.doencas_preexistentes} color="warning" />
          <ListCard label="Cirurgias Anteriores" icon={History} items={anamnese.cirurgias_anteriores} color="muted" />
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Condições</p>
          <div className="grid grid-cols-3 gap-2">
            {boolFields.map((f) => {
              const val = anamnese[f.key] as boolean;
              return (
                <div key={f.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${val ? "bg-destructive/10 text-destructive" : "bg-muted/30 text-muted-foreground"}`}>
                  {val ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  <span className={val ? "font-semibold" : ""}>{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-muted/30 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Pressão Arterial</p>
            <p className="text-lg font-bold text-foreground font-heading">{anamnese.pressao_arterial || "—"} {anamnese.pressao_arterial ? "mmHg" : ""}</p>
          </div>
          {anamnese.updated_at && (
            <div className="bg-muted/30 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Última Atualização</p>
              <p className="text-sm text-foreground">{new Date(anamnese.updated_at).toLocaleDateString("pt-BR")}</p>
            </div>
          )}
        </div>

        {anamnese.observacoes && (
          <div className="bg-warning/5 border border-warning/20 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1">Observações</p>
            <p className="text-xs text-foreground">{anamnese.observacoes}</p>
          </div>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex justify-end gap-2">
        <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors">
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar Anamnese
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Alergias (separar por vírgula)</label>
          <input value={alergiasText} onChange={(e) => setAlergiasText(e.target.value)} placeholder="Ex: Dipirona, Amoxicilina" className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Medicamentos em uso (separar por vírgula)</label>
          <input value={medicamentosText} onChange={(e) => setMedicamentosText(e.target.value)} placeholder="Ex: Losartana, Metformina" className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Doenças preexistentes (separar por vírgula)</label>
          <input value={doencasText} onChange={(e) => setDoencasText(e.target.value)} placeholder="Ex: Hipertensão, Diabetes" className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Cirurgias anteriores (separar por vírgula)</label>
          <input value={cirurgiasText} onChange={(e) => setCirurgiasText(e.target.value)} placeholder="Ex: Apendicectomia, Cesariana" className={inputClass} />
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Condições</p>
        <div className="grid grid-cols-3 gap-3">
          {boolFields.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-xs text-foreground cursor-pointer bg-muted/30 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                checked={form[f.key] as boolean}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                className="rounded border-border accent-primary"
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Pressão Arterial</label>
          <input
            value={form.pressao_arterial || ""}
            onChange={(e) => setForm((prev) => ({ ...prev, pressao_arterial: e.target.value }))}
            placeholder="Ex: 120/80"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
        <textarea
          rows={3}
          value={form.observacoes || ""}
          onChange={(e) => setForm((prev) => ({ ...prev, observacoes: e.target.value }))}
          placeholder="Observações relevantes..."
          className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
      </div>
    </div>
  );
}

/* ─── Odontograma Tab ─── */
interface OdontogramaDBData {
  id?: string;
  paciente_id: string;
  dentes: import("@/data/pacientesMockData").DenteInfo[];
  observacoes: string | null;
  updated_at?: string;
}

function OdontogramaTab({ pacienteId }: { pacienteId: string }) {
  const [data, setData] = useState<OdontogramaDBData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingOdonto, setEditingOdonto] = useState(false);
  const [saving, setSaving] = useState(false);

  // Initialize all 32 teeth as saudavel
  const allTeeth: import("@/data/pacientesMockData").DenteInfo[] = [
    ...[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28].map(n => ({ numero: n, status: "saudavel" as const })),
    ...[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38].map(n => ({ numero: n, status: "saudavel" as const })),
  ];

  const [dentes, setDentes] = useState(allTeeth);
  const [obs, setObs] = useState("");

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOdontograma = useCallback(async () => {
    setLoading(true);
    try {
      const { data: result, error } = await pacientesApi.getOdontograma(pacienteId);
      setLoadError(error);
      if (error) {
        toast.error("Erro ao carregar odontograma: " + error);
      } else if (result) {
        const d = result as OdontogramaDBData;
        setData(d);
        const parsedDentes = typeof d.dentes === "string" ? JSON.parse(d.dentes) : d.dentes;
        if (Array.isArray(parsedDentes) && parsedDentes.length > 0) {
          // Merge with allTeeth to ensure all 32 teeth exist
          const map = new Map(parsedDentes.map((t: import("@/data/pacientesMockData").DenteInfo) => [t.numero, t]));
          setDentes(allTeeth.map(t => (map.get(t.numero) as import("@/data/pacientesMockData").DenteInfo) || t));
        }
        setObs(d.observacoes || "");
      }
    } catch {
      setLoadError("Erro inesperado ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [pacienteId]);

  useEffect(() => { loadOdontograma(); }, [loadOdontograma]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: result, error } = await pacientesApi.saveOdontograma(pacienteId, {
        dentes,
        observacoes: obs.trim() || null,
      });
      if (error) {
        toast.error("Erro ao salvar: " + error);
      } else {
        toast.success("Odontograma salvo!");
        setData(result as OdontogramaDBData);
        setEditingOdonto(false);
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Carregando odontograma...</span>
      </div>
    );
  }

  // Sem carregar não deixa editar: salvar por cima apagaria o odontograma registrado
  if (loadError) {
    return <ErroCarregar mensagem={`Não foi possível carregar o odontograma. ${loadError}`} onRetry={loadOdontograma} />;
  }

  if (!editingOdonto) {
    const hasData = data && Array.isArray(typeof data.dentes === "string" ? JSON.parse(data.dentes as unknown as string) : data.dentes) && (typeof data.dentes === "string" ? JSON.parse(data.dentes as unknown as string) : data.dentes).some((d: import("@/data/pacientesMockData").DenteInfo) => d.status !== "saudavel");

    if (!hasData) {
      return (
        <div className="text-center py-16 animate-fade-in">
          <Smile className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">Odontograma não preenchido.</p>
          <button
            onClick={() => setEditingOdonto(true)}
            className="mt-4 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Preencher Odontograma
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex justify-between items-center">
          {data?.updated_at && (
            <p className="text-[10px] text-muted-foreground">Atualizado em {new Date(data.updated_at).toLocaleDateString("pt-BR")}</p>
          )}
          <button
            onClick={() => setEditingOdonto(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
          >
            <Edit className="h-3.5 w-3.5" />
            Editar Odontograma
          </button>
        </div>
        <OdontogramaChart dentes={dentes} />
        {obs && (
          <div className="bg-warning/5 border border-warning/20 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1">Observações</p>
            <p className="text-xs text-foreground">{obs}</p>
          </div>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-end gap-2">
        <button onClick={() => setEditingOdonto(false)} className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors">
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar Odontograma
        </button>
      </div>
      <OdontogramaEditor dentes={dentes} onChange={setDentes} />
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
        <textarea
          rows={3}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Anotações sobre o odontograma..."
          className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
      </div>
    </div>
  );
}

/* ─── Histórico Tab ─── */
const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  agendado: { bg: "bg-blue-500/10", text: "text-blue-600", label: "Agendado" },
  confirmado: { bg: "bg-emerald-500/10", text: "text-emerald-600", label: "Confirmado" },
  realizado: { bg: "bg-green-500/10", text: "text-green-600", label: "Realizado" },
  atendido: { bg: "bg-green-500/10", text: "text-green-600", label: "Atendido" },
  finalizado: { bg: "bg-green-500/10", text: "text-green-600", label: "Finalizado" },
  cancelado: { bg: "bg-red-500/10", text: "text-red-600", label: "Cancelado" },
  desmarcado: { bg: "bg-orange-500/10", text: "text-orange-600", label: "Desmarcado" },
  faltou: { bg: "bg-red-500/10", text: "text-red-600", label: "Faltou" },
  em_atendimento: { bg: "bg-primary/10", text: "text-primary", label: "Em atendimento" },
};

function HistoricoTab({ pacienteId }: { pacienteId: string }) {
  const [consultas, setConsultas] = useState<HistoricoConsulta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await pacientesApi.getHistorico(pacienteId);
      setLoadError(error);
      if (error) setConsultas([]);
      else if (data) setConsultas(data);
    } catch {
      setConsultas([]);
      setLoadError("Erro inesperado ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [pacienteId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Carregando histórico...</span>
      </div>
    );
  }

  if (loadError) {
    return <ErroCarregar mensagem={`Não foi possível carregar o histórico. ${loadError}`} onRetry={load} />;
  }

  if (consultas.length === 0) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <History className="h-10 w-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground mt-3">Nenhuma consulta registrada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <p className="text-xs text-muted-foreground">{consultas.length} consulta{consultas.length !== 1 ? "s" : ""} encontrada{consultas.length !== 1 ? "s" : ""}</p>
      {consultas.map((c) => {
        const sc = statusColors[c.status] || { bg: "bg-muted/30", text: "text-muted-foreground", label: c.status };
        const dataFormatted = c.data ? new Date(c.data).toLocaleDateString("pt-BR") : "—";
        const horaFormatted = c.hora ? c.hora.slice(0, 5) : "";
        return (
          <div key={c.id} className="bg-muted/30 rounded-xl p-4 border border-border/40 hover:border-border/60 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-sm font-semibold text-foreground">{dataFormatted}</span>
                  {horaFormatted && <span className="text-xs text-muted-foreground">às {horaFormatted}</span>}
                  {c.duracao && <span className="text-[10px] text-muted-foreground">• {c.duracao}min</span>}
                </div>
                {c.procedimento && (
                  <p className="text-sm text-foreground mt-1.5 font-medium">{c.procedimento}</p>
                )}
                {c.dentista_nome && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Dr(a). {c.dentista_nome}
                    {c.dentista_especialidade && <span className="text-muted-foreground/60"> — {c.dentista_especialidade}</span>}
                  </p>
                )}
                {c.observacoes && (
                  <p className="text-xs text-muted-foreground mt-1.5 italic">"{c.observacoes}"</p>
                )}
              </div>
              <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold ${sc.bg} ${sc.text}`}>
                {sc.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Helper: List Card ─── */
function ListCard({ label, icon: Icon, items, color }: { label: string; icon: typeof AlertTriangle; items: string[]; color: string }) {
  return (
    <div className="bg-muted/30 rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </p>
      {items && items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span key={item} className={`px-2.5 py-1 rounded-full text-[11px] font-bold bg-${color}/10 text-${color}`}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum(a)</p>
      )}
    </div>
  );
}

function ErroCarregar({ mensagem, onRetry }: { mensagem: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-8 text-center animate-fade-in">
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <p className="text-sm text-destructive">{mensagem}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-4 py-2 rounded-xl border border-border/60 bg-card text-xs font-semibold text-foreground hover:bg-muted/60 transition-colors"
      >
        Tentar de novo
      </button>
    </div>
  );
}
