import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useState, useEffect, useCallback } from "react";
import { pacientesApi } from "@/lib/vpsApi";
import { OdontogramaChart, OdontogramaEditor } from "@/components/OdontogramaChart";
import { toast } from "sonner";
import {
  Search,
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
} from "lucide-react";

export const Route = createFileRoute("/pacientes")({
  validateSearch: (search: Record<string, unknown>) => ({
    pacienteId: (search.pacienteId as string) || undefined,
  }),
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

function calcularIdade(dataNasc: string | null): number | null {
  if (!dataNasc) return null;
  const nasc = new Date(dataNasc);
  if (isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function getInitials(nome: string) {
  return nome
    .split(" ")
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

  const loadPacientes = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await pacientesApi.list();
      if (error) {
        toast.error("Erro ao carregar pacientes: " + error);
      } else if (Array.isArray(data)) {
        setPacientes(data);
        // Se veio pacienteId na URL, selecionar
        if (pacienteId) {
          const found = data.find((p: PacienteAPI) => p.id === pacienteId);
          if (found) setSelectedPaciente(found);
        }
      }
    } catch {
      toast.error("Erro de conexão ao carregar pacientes");
    } finally {
      setLoading(false);
    }
  }, [pacienteId]);

  useEffect(() => {
    loadPacientes();
  }, [loadPacientes]);

  const filtered = pacientes.filter(
    (p) =>
      p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.cpf && p.cpf.includes(searchTerm)) ||
      (p.telefone && p.telefone.includes(searchTerm))
  );

  const comConvenio = pacientes.filter((p) => p.convenio).length;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Cadastro de Pacientes" />
      <main className="flex-1 p-8 space-y-6 overflow-auto">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 animate-slide-up" style={{ animationFillMode: 'both' }}>
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
                const today = new Date().toISOString().split("T")[0];
                return p.created_at?.startsWith(today);
              }).length}
            </p>
          </div>
        </div>

        {/* Search + Actions */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nome, CPF ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-card border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <UserPlus className="h-4 w-4" />
            Novo Paciente
          </button>
        </div>

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
                          <Phone className="h-3 w-3" />{pac.telefone}
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

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">Nenhum paciente encontrado.</p>
          </div>
        )}

        {/* New Patient Form */}
        {showForm && (
          <NovoPacienteModal
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
            onClose={() => setSelectedPaciente(null)}
          />
        )}
      </main>
    </div>
  );
}

/* ─── Novo Paciente Modal ─── */
function NovoPacienteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    cpf: "",
    data_nascimento: "",
    sexo: "masculino",
    telefone: "",
    email: "",
    convenio: "",
    endereco: "",
    observacoes: "",
  });

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const { error } = await pacientesApi.create({
        nome: form.nome.trim(),
        cpf: form.cpf.trim() || null,
        telefone: form.telefone.trim() || null,
        email: form.email.trim() || null,
        data_nascimento: form.data_nascimento || null,
        endereco: form.endereco.trim() || null,
        observacoes: form.observacoes.trim() || null,
      });
      if (error) {
        toast.error("Erro ao cadastrar: " + error);
      } else {
        toast.success(`${form.nome} cadastrado com sucesso!`);
        onSaved();
      }
    } catch {
      toast.error("Erro de conexão ao cadastrar paciente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 sticky top-0 bg-card z-10 rounded-t-2xl">
          <h2 className="text-lg font-bold text-foreground font-heading">Novo Paciente</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <form className="p-6 space-y-5" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome completo *</label>
              <input
                required
                value={form.nome}
                onChange={(e) => handleChange("nome", e.target.value)}
                placeholder="Nome do paciente"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">CPF</label>
              <input
                value={form.cpf}
                onChange={(e) => handleChange("cpf", e.target.value)}
                placeholder="000.000.000-00"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Data de Nascimento</label>
              <input
                type="date"
                value={form.data_nascimento}
                onChange={(e) => handleChange("data_nascimento", e.target.value)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Sexo</label>
              <select
                value={form.sexo}
                onChange={(e) => handleChange("sexo", e.target.value)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Telefone</label>
              <input
                value={form.telefone}
                onChange={(e) => handleChange("telefone", e.target.value)}
                placeholder="(11) 99999-0000"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">E-mail</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleChange("email", e.target.value)}
                placeholder="email@exemplo.com"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Convênio</label>
              <input
                value={form.convenio}
                onChange={(e) => handleChange("convenio", e.target.value)}
                placeholder="Ex: Amil Dental, Particular..."
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Endereço</label>
              <input
                value={form.endereco}
                onChange={(e) => handleChange("endereco", e.target.value)}
                placeholder="Rua, número — Cidade, UF"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
              <textarea
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
function PacienteDetailModal({
  paciente,
  onClose,
}: {
  paciente: PacienteAPI;
  onClose: () => void;
}) {
  const idade = calcularIdade(paciente.data_nascimento);

  const fields = [
    { icon: FileHeart, label: "Nome", value: paciente.nome },
    { icon: Calendar, label: "Nascimento", value: paciente.data_nascimento ? new Date(paciente.data_nascimento).toLocaleDateString("pt-BR") : "—" },
    { icon: Phone, label: "Telefone", value: paciente.telefone || "—" },
    { icon: Mail, label: "E-mail", value: paciente.email || "—" },
    { icon: MapPin, label: "Endereço", value: paciente.endereco || "—" },
    { icon: Shield, label: "Convênio", value: paciente.convenio || "Particular" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden animate-slide-up flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {getInitials(paciente.nome)}
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground font-heading">{paciente.nome}</h2>
              <p className="text-xs text-muted-foreground">
                {idade !== null ? `${idade} anos` : ""}
                {paciente.cpf ? ` • CPF: ${paciente.cpf}` : ""}
                {paciente.convenio ? ` • ${paciente.convenio}` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in">
            {fields.map((f) => (
              <div key={f.label} className="bg-muted/30 rounded-xl p-4 flex items-start gap-3">
                <f.icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{f.label}</p>
                  <p className="text-sm text-foreground mt-0.5">{f.value}</p>
                </div>
              </div>
            ))}
          </div>

          {paciente.observacoes && (
            <div className="mt-4 bg-warning/5 border border-warning/20 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1">Observações</p>
              <p className="text-xs text-foreground">{paciente.observacoes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
