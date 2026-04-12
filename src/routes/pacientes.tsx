import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useState } from "react";
import {
  mockPacientes,
  mockAnamneses,
  mockOdontogramas,
  mockHistoricos,
  convenios,
  type Paciente,
  type Anamnese,
  type HistoricoPaciente,
  type DenteInfo,
} from "@/data/pacientesMockData";
import { OdontogramaChart, OdontogramaEditor } from "@/components/OdontogramaChart";
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
} from "lucide-react";

export const Route = createFileRoute("/pacientes")({
  validateSearch: (search: Record<string, unknown>) => ({
    pacienteId: (search.pacienteId as string) || undefined,
  }),
  ssr: false,
  component: PacientesPage,
});

type DetailTab = "dados" | "anamnese" | "odontograma" | "historico";

function PacientesPage() {
  const { pacienteId } = Route.useSearch();
  const [pacientes] = useState<Paciente[]>(mockPacientes);
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedPaciente, setSelectedPaciente] = useState<Paciente | null>(
    pacienteId ? mockPacientes.find((p) => p.id === pacienteId) ?? null : null
  );
  const [activeTab, setActiveTab] = useState<DetailTab>("dados");

  const filtered = pacientes.filter(
    (p) =>
      p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.cpf.includes(searchTerm) ||
      p.telefone.includes(searchTerm)
  );

  const calcularIdade = (nascimento: Date) => {
    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const m = hoje.getMonth() - nascimento.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nascimento.getDate())) idade--;
    return idade;
  };

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
            <p className="text-2xl font-bold text-primary mt-1 font-heading">{pacientes.filter((p) => p.convenio).length}</p>
          </div>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Particular</p>
            <p className="text-2xl font-bold text-card-foreground mt-1 font-heading">{pacientes.filter((p) => !p.convenio).length}</p>
          </div>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-success/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Com Anamnese</p>
            <p className="text-2xl font-bold text-success mt-1 font-heading">{Object.keys(mockAnamneses).length}</p>
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

        {/* Patient Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-slide-up">
          {filtered.map((pac) => {
            const anamnese = mockAnamneses[pac.id];
            const hasAlergias = anamnese?.alergias && anamnese.alergias.length > 0;
            return (
              <div
                key={pac.id}
                className="bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 cursor-pointer group"
                onClick={() => {
                  setSelectedPaciente(pac);
                  setActiveTab("dados");
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {pac.nome
                      .split(" ")
                      .filter((_, i, arr) => i === 0 || i === arr.length - 1)
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {pac.nome}
                      </p>
                      {hasAlergias && (
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {calcularIdade(pac.dataNascimento)} anos • {pac.sexo === "masculino" ? "M" : pac.sexo === "feminino" ? "F" : "O"}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />{pac.telefone}
                      </span>
                    </div>
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

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">Nenhum paciente encontrado.</p>
          </div>
        )}

        {/* New Patient Form */}
        {showForm && (
          <NovoPacienteModal onClose={() => setShowForm(false)} />
        )}

        {/* Patient Detail Modal */}
        {selectedPaciente && (
          <PacienteDetailModal
            paciente={selectedPaciente}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onClose={() => setSelectedPaciente(null)}
          />
        )}
      </main>
    </div>
  );
}

/* ─── Novo Paciente Modal ─── */
function NovoPacienteModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 sticky top-0 bg-card z-10 rounded-t-2xl">
          <h2 className="text-lg font-bold text-foreground font-heading">Novo Paciente</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <form className="p-6 space-y-5" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome completo *</label>
              <input required placeholder="Nome do paciente" className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">CPF *</label>
              <input required placeholder="000.000.000-00" className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Data de Nascimento *</label>
              <input type="date" required className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Sexo</label>
              <select className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Telefone *</label>
              <input required placeholder="(11) 99999-0000" className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">E-mail</label>
              <input type="email" placeholder="email@exemplo.com" className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Convênio</label>
              <select className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                {convenios.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Endereço</label>
              <input placeholder="Rua, número — Cidade, UF" className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          {/* Quick Anamnese */}
          <div className="border-t border-border/60 pt-5">
            <h3 className="text-sm font-bold text-foreground font-heading mb-3 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              Anamnese Rápida
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Alergias</label>
                <input placeholder="Ex: Dipirona, Amoxicilina (separar por vírgula)" className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Medicamentos em uso</label>
                <input placeholder="Ex: Losartana, Metformina (separar por vírgula)" className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Doenças preexistentes</label>
                <input placeholder="Ex: Hipertensão, Diabetes (separar por vírgula)" className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-3">
                {[
                  { label: "Fumante", key: "fumante" },
                  { label: "Gestante", key: "gestante" },
                  { label: "Diabético", key: "diabetes" },
                  { label: "Cardiopata", key: "cardiopatia" },
                  { label: "Hemofílico", key: "hemofilia" },
                  { label: "Epiléptico", key: "epilepsia" },
                ].map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input type="checkbox" className="rounded border-border" />
                    {item.label}
                  </label>
                ))}
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
                <textarea rows={3} placeholder="Observações relevantes sobre o paciente..." className="w-full px-4 py-3 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/60 transition-colors">
              Cancelar
            </button>
            <button type="submit" className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm">
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
  activeTab,
  onTabChange,
  onClose,
}: {
  paciente: Paciente;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onClose: () => void;
}) {
  const anamnese = mockAnamneses[paciente.id];
  const odontograma = mockOdontogramas[paciente.id];
  const historico = mockHistoricos.filter((h) => h.pacienteId === paciente.id);

  const tabs: { key: DetailTab; label: string; icon: typeof FileHeart }[] = [
    { key: "dados", label: "Dados", icon: FileHeart },
    { key: "anamnese", label: "Anamnese", icon: ClipboardList },
    { key: "odontograma", label: "Odontograma", icon: Smile },
    { key: "historico", label: "Histórico", icon: History },
  ];

  const calcularIdade = (nascimento: Date) => {
    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const m = hoje.getMonth() - nascimento.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nascimento.getDate())) idade--;
    return idade;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden animate-slide-up flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {paciente.nome.split(" ").filter((_, i, arr) => i === 0 || i === arr.length - 1).map((n) => n[0]).join("")}
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground font-heading">{paciente.nome}</h2>
              <p className="text-xs text-muted-foreground">
                {calcularIdade(paciente.dataNascimento)} anos • CPF: {paciente.cpf}
                {paciente.convenio && ` • ${paciente.convenio}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-border/60 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
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
          {activeTab === "dados" && <DadosTab paciente={paciente} />}
          {activeTab === "anamnese" && <AnamneseTab anamnese={anamnese} />}
          {activeTab === "odontograma" && <OdontogramaTab odontograma={odontograma} />}
          {activeTab === "historico" && <HistoricoTab historico={historico} />}
        </div>
      </div>
    </div>
  );
}

function DadosTab({ paciente }: { paciente: Paciente }) {
  const fields = [
    { icon: FileHeart, label: "Nome", value: paciente.nome },
    { icon: Calendar, label: "Nascimento", value: paciente.dataNascimento.toLocaleDateString("pt-BR") },
    { icon: Phone, label: "Telefone", value: paciente.telefone },
    { icon: Mail, label: "E-mail", value: paciente.email },
    { icon: MapPin, label: "Endereço", value: paciente.endereco },
    { icon: Shield, label: "Convênio", value: paciente.convenio ?? "Particular" },
  ];

  return (
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
  );
}

function AnamneseTab({ anamnese }: { anamnese?: Anamnese }) {
  if (!anamnese) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <ClipboardList className="h-10 w-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground mt-3">Anamnese não preenchida.</p>
        <button className="mt-4 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
          Preencher Anamnese
        </button>
      </div>
    );
  }

  const boolFields: { label: string; value: boolean; icon: typeof Heart }[] = [
    { label: "Diabetes", value: anamnese.diabetes, icon: Heart },
    { label: "Cardiopatia", value: anamnese.cardiopatia, icon: Heart },
    { label: "Hepatite", value: anamnese.hepatite, icon: Heart },
    { label: "HIV", value: anamnese.hiv, icon: Heart },
    { label: "Hemofilia", value: anamnese.hemofilia, icon: Heart },
    { label: "Epilepsia", value: anamnese.epilepsia, icon: Heart },
    { label: "Fumante", value: anamnese.fumante, icon: Cigarette },
    { label: "Etilista", value: anamnese.etilista, icon: Pill },
    { label: "Gestante", value: anamnese.gestante, icon: Heart },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Alertas */}
      {(anamnese.alergias.length > 0 || anamnese.cardiopatia) && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-destructive">Atenção</p>
            {anamnese.alergias.length > 0 && (
              <p className="text-xs text-destructive/80 mt-1">
                Alergias: <strong>{anamnese.alergias.join(", ")}</strong>
              </p>
            )}
            {anamnese.cardiopatia && (
              <p className="text-xs text-destructive/80 mt-1">
                Paciente cardiopata — verificar liberação do cardiologista.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Dados clínicos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-muted/30 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> Alergias
          </p>
          {anamnese.alergias.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {anamnese.alergias.map((a) => (
                <span key={a} className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-destructive/10 text-destructive">
                  {a}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma alergia conhecida</p>
          )}
        </div>
        <div className="bg-muted/30 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
            <Pill className="h-3 w-3" /> Medicamentos
          </p>
          {anamnese.medicamentos.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {anamnese.medicamentos.map((m) => (
                <span key={m} className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-info/10 text-info">
                  {m}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum medicamento em uso</p>
          )}
        </div>
        <div className="bg-muted/30 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Doenças Preexistentes</p>
          {anamnese.doencasPreexistentes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {anamnese.doencasPreexistentes.map((d) => (
                <span key={d} className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-warning/10 text-warning">
                  {d}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma</p>
          )}
        </div>
        <div className="bg-muted/30 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Cirurgias Anteriores</p>
          {anamnese.cirurgiasAnteriores.length > 0 ? (
            <ul className="space-y-1">
              {anamnese.cirurgiasAnteriores.map((c) => (
                <li key={c} className="text-xs text-foreground">• {c}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma</p>
          )}
        </div>
      </div>

      {/* Bool flags */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Condições</p>
        <div className="grid grid-cols-3 gap-2">
          {boolFields.map((f) => (
            <div key={f.label} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${f.value ? "bg-destructive/10 text-destructive" : "bg-muted/30 text-muted-foreground"}`}>
              {f.value ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              <span className={f.value ? "font-semibold" : ""}>{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* PA + Obs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-muted/30 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Pressão Arterial</p>
          <p className="text-lg font-bold text-foreground font-heading">{anamnese.pressaoArterial} mmHg</p>
        </div>
        <div className="bg-muted/30 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Última Atualização</p>
          <p className="text-sm text-foreground">{anamnese.atualizadoEm.toLocaleDateString("pt-BR")}</p>
        </div>
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

function OdontogramaTab({ odontograma, onUpdate }: { odontograma?: { dentes: DenteInfo[]; atualizadoEm: Date }; onUpdate?: (dentes: DenteInfo[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [localDentes, setLocalDentes] = useState<DenteInfo[]>(odontograma?.dentes ?? []);

  if (!odontograma) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <Smile className="h-10 w-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground mt-3">Odontograma não registrado.</p>
      </div>
    );
  }

  const handleSave = () => {
    onUpdate?.(localDentes);
    setEditing(false);
  };

  const handleCancel = () => {
    setLocalDentes(odontograma.dentes);
    setEditing(false);
  };

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Atualizado em: {odontograma.atualizadoEm.toLocaleDateString("pt-BR")}
        </p>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Edit className="h-3.5 w-3.5" />
            Editar Odontograma
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-success text-success-foreground text-xs font-semibold hover:bg-success/90 transition-colors shadow-sm"
            >
              <Save className="h-3.5 w-3.5" />
              Salvar
            </button>
          </div>
        )}
      </div>
      <div className="bg-muted/20 rounded-2xl p-6">
        {editing ? (
          <OdontogramaEditor dentes={localDentes} onChange={setLocalDentes} />
        ) : (
          <OdontogramaChart dentes={odontograma.dentes} />
        )}
      </div>
    </div>
  );
}

function HistoricoTab({ historico }: { historico: HistoricoPaciente[] }) {
  const tipoConfig: Record<string, { label: string; color: string }> = {
    consulta: { label: "Consulta", color: "bg-info/10 text-info" },
    procedimento: { label: "Procedimento", color: "bg-primary/10 text-primary" },
    retorno: { label: "Retorno", color: "bg-muted text-muted-foreground" },
    urgencia: { label: "Urgência", color: "bg-destructive/10 text-destructive" },
  };

  if (historico.length === 0) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <History className="h-10 w-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground mt-3">Nenhum histórico registrado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {historico
        .sort((a, b) => b.data.getTime() - a.data.getTime())
        .map((h) => {
          const tipo = tipoConfig[h.tipo];
          return (
            <div key={h.id} className="bg-muted/20 rounded-xl p-4 border-l-4 border-l-primary/40">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${tipo.color}`}>
                    {tipo.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {h.data.toLocaleDateString("pt-BR")}
                  </span>
                </div>
                {h.valor && (
                  <span className="text-sm font-bold text-foreground font-heading">
                    R$ {h.valor.toLocaleString("pt-BR")}
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-foreground">{h.procedimento}</p>
              <p className="text-xs text-muted-foreground mt-1">{h.dentista}</p>
              <p className="text-xs text-foreground/80 mt-2">{h.observacoes}</p>
            </div>
          );
        })}
    </div>
  );
}
