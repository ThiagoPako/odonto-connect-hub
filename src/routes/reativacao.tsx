import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  RefreshCcw, MessageSquare, Send, Clock, Users, Plus, X,
  Filter, Instagram, Facebook, Globe, Phone, Search,
  CheckCircle2, AlertCircle, ChevronRight, Trash2, Edit2,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/reativacao")({
  ssr: false,
  component: ReativacaoPage,
});

type ChannelOrigin = "instagram" | "facebook" | "google" | "indicacao" | "whatsapp" | "site" | "todos";

interface ReactivationRule {
  id: string;
  name: string;
  inactiveDays: number;
  origin: ChannelOrigin;
  messageTemplate: string;
  status: "ativo" | "pausado" | "rascunho";
  matchedPatients: number;
  sentCount: number;
  responseRate: number;
  lastRun?: string;
}

interface InactivePatient {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  lastVisit: string;
  daysSince: number;
  origin: ChannelOrigin;
  phone: string;
  treatments: string;
  selected: boolean;
}

const originConfig: Record<ChannelOrigin, { label: string; icon: React.ElementType; color: string }> = {
  instagram: { label: "Instagram", icon: Instagram, color: "text-chart-3" },
  facebook: { label: "Facebook", icon: Facebook, color: "text-chart-1" },
  google: { label: "Google Ads", icon: Globe, color: "text-chart-4" },
  indicacao: { label: "Indicação", icon: Users, color: "text-chart-2" },
  whatsapp: { label: "WhatsApp", icon: Phone, color: "text-success" },
  site: { label: "Site", icon: Globe, color: "text-primary" },
  todos: { label: "Todos", icon: Users, color: "text-muted-foreground" },
};

const mockRules: ReactivationRule[] = [
  { id: "r1", name: "Inativos 6m — Instagram", inactiveDays: 180, origin: "instagram", messageTemplate: "Olá {nome}! Sentimos sua falta 😊 Que tal agendar uma consulta de revisão? Temos horários disponíveis esta semana!", status: "ativo", matchedPatients: 14, sentCount: 10, responseRate: 40, lastRun: "05/04/2026" },
  { id: "r2", name: "Inativos 3m — Todos", inactiveDays: 90, origin: "todos", messageTemplate: "Oi {nome}, tudo bem? Já faz um tempo que não te vemos por aqui. Agende sua consulta de retorno!", status: "ativo", matchedPatients: 23, sentCount: 18, responseRate: 33, lastRun: "03/04/2026" },
  { id: "r3", name: "Inativos 1 ano — Google", inactiveDays: 365, origin: "google", messageTemplate: "Olá {nome}! Já faz mais de 1 ano desde sua última visita. Cuide do seu sorriso, agende agora!", status: "pausado", matchedPatients: 8, sentCount: 0, responseRate: 0 },
  { id: "r4", name: "Inativos 6m — Facebook", inactiveDays: 180, origin: "facebook", messageTemplate: "Oi {nome}! Estamos com condições especiais para retorno. Aproveite e agende sua consulta!", status: "rascunho", matchedPatients: 5, sentCount: 0, responseRate: 0 },
];

const mockPatients: InactivePatient[] = [
  { id: "pt1", name: "Camila Rodrigues", initials: "CR", avatarColor: "bg-chart-1", lastVisit: "15/09/2025", daysSince: 205, origin: "instagram", phone: "(11) 99123-4567", treatments: "Limpeza, Clareamento", selected: false },
  { id: "pt2", name: "Bruno Almeida", initials: "BA", avatarColor: "bg-chart-2", lastVisit: "20/08/2025", daysSince: 231, origin: "instagram", phone: "(11) 98765-4321", treatments: "Restauração, Profilaxia", selected: false },
  { id: "pt3", name: "Fernanda Costa", initials: "FC", avatarColor: "bg-chart-3", lastVisit: "01/10/2025", daysSince: 189, origin: "instagram", phone: "(11) 97654-3210", treatments: "Ortodontia", selected: false },
  { id: "pt4", name: "Rafael Souza", initials: "RS", avatarColor: "bg-chart-4", lastVisit: "10/07/2025", daysSince: 272, origin: "instagram", phone: "(11) 96543-2109", treatments: "Implante, Coroa", selected: false },
  { id: "pt5", name: "Julia Martins", initials: "JM", avatarColor: "bg-chart-5", lastVisit: "05/11/2025", daysSince: 154, origin: "facebook", phone: "(11) 95432-1098", treatments: "Limpeza", selected: false },
  { id: "pt6", name: "Diego Pereira", initials: "DP", avatarColor: "bg-chart-1", lastVisit: "12/06/2025", daysSince: 300, origin: "google", phone: "(11) 94321-0987", treatments: "Canal, Restauração", selected: false },
  { id: "pt7", name: "Larissa Ferreira", initials: "LF", avatarColor: "bg-chart-2", lastVisit: "28/09/2025", daysSince: 192, origin: "instagram", phone: "(11) 93210-9876", treatments: "Profilaxia", selected: false },
  { id: "pt8", name: "Thiago Nunes", initials: "TN", avatarColor: "bg-chart-3", lastVisit: "03/08/2025", daysSince: 248, origin: "indicacao", phone: "(11) 92109-8765", treatments: "Extração, Prótese", selected: false },
];

const statusCfg: Record<ReactivationRule["status"], { label: string; color: string }> = {
  ativo: { label: "Ativo", color: "bg-success/15 text-success" },
  pausado: { label: "Pausado", color: "bg-warning/15 text-warning" },
  rascunho: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
};

function ReativacaoPage() {
  const [rules, setRules] = useState(mockRules);
  const [selectedRule, setSelectedRule] = useState<ReactivationRule | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [patients, setPatients] = useState(mockPatients);
  const [searchTerm, setSearchTerm] = useState("");

  // New rule form state
  const [newName, setNewName] = useState("");
  const [newDays, setNewDays] = useState(180);
  const [newOrigin, setNewOrigin] = useState<ChannelOrigin>("instagram");
  const [newMessage, setNewMessage] = useState("Olá {nome}! Sentimos sua falta 😊 Agende sua consulta de retorno!");

  const filteredPatients = patients.filter((p) => {
    const matchesRule = selectedRule
      ? (selectedRule.origin === "todos" || p.origin === selectedRule.origin) && p.daysSince >= selectedRule.inactiveDays
      : true;
    const matchesSearch = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesRule && matchesSearch;
  });

  const selectedCount = filteredPatients.filter((p) => p.selected).length;

  const handleCreateRule = () => {
    if (!newName.trim()) return;
    const newRule: ReactivationRule = {
      id: `r${Date.now()}`,
      name: newName,
      inactiveDays: newDays,
      origin: newOrigin,
      messageTemplate: newMessage,
      status: "rascunho",
      matchedPatients: mockPatients.filter(
        (p) => (newOrigin === "todos" || p.origin === newOrigin) && p.daysSince >= newDays
      ).length,
      sentCount: 0,
      responseRate: 0,
    };
    setRules([newRule, ...rules]);
    setSelectedRule(newRule);
    setShowNewForm(false);
    setNewName("");
    setNewDays(180);
    setNewOrigin("instagram");
    setNewMessage("Olá {nome}! Sentimos sua falta 😊 Agende sua consulta de retorno!");
  };

  const togglePatient = (id: string) => {
    setPatients(patients.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)));
  };

  const selectAll = () => {
    const ids = new Set(filteredPatients.map((p) => p.id));
    const allSelected = filteredPatients.every((p) => p.selected);
    setPatients(patients.map((p) => (ids.has(p.id) ? { ...p, selected: !allSelected } : p)));
  };

  // KPIs
  const totalActive = rules.filter((r) => r.status === "ativo").length;
  const totalMatched = rules.reduce((s, r) => s + r.matchedPatients, 0);
  const totalSent = rules.reduce((s, r) => s + r.sentCount, 0);
  const avgResponse = rules.filter((r) => r.sentCount > 0).length > 0
    ? (rules.filter((r) => r.sentCount > 0).reduce((s, r) => s + r.responseRate, 0) / rules.filter((r) => r.sentCount > 0).length)
    : 0;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Reativação Inteligente" />
      <main className="flex-1 p-6 overflow-auto space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiBox icon={RefreshCcw} label="Regras Ativas" value={String(totalActive)} color="text-primary" />
          <KpiBox icon={Users} label="Pacientes Inativos" value={String(totalMatched)} color="text-warning" />
          <KpiBox icon={Send} label="Mensagens Enviadas" value={String(totalSent)} color="text-chart-1" />
          <KpiBox icon={MessageSquare} label="Taxa de Resposta" value={`${avgResponse.toFixed(0)}%`} color="text-success" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Rules list */}
          <div className="lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Regras de Reativação</h3>
              <button
                onClick={() => { setShowNewForm(true); setSelectedRule(null); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90"
              >
                <Plus className="h-3 w-3" /> Nova Regra
              </button>
            </div>

            {rules.map((rule) => {
              const oCfg = originConfig[rule.origin];
              const sCfg = statusCfg[rule.status];
              return (
                <button
                  key={rule.id}
                  onClick={() => { setSelectedRule(rule); setShowNewForm(false); }}
                  className={`w-full text-left px-3 py-3 rounded-xl border transition-all ${
                    selectedRule?.id === rule.id ? "bg-primary/5 border-primary/30" : "border-transparent hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-foreground truncate pr-2">{rule.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${sCfg.color}`}>{sCfg.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                      <oCfg.icon className={`h-2.5 w-2.5 ${oCfg.color}`} /> {oCfg.label}
                    </span>
                    <span>≥{rule.inactiveDays} dias</span>
                    <span>{rule.matchedPatients} pacientes</span>
                  </div>
                  {rule.sentCount > 0 && (
                    <div className="flex items-center gap-3 mt-1 text-[10px]">
                      <span className="text-chart-1">{rule.sentCount} enviadas</span>
                      <span className="text-success">{rule.responseRate}% resposta</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Detail / Form */}
          <div className="lg:col-span-8 space-y-4">
            {showNewForm ? (
              <div className="bg-card rounded-xl border border-border p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Nova Regra de Reativação</h3>
                  <button onClick={() => setShowNewForm(false)} className="p-1 rounded-md hover:bg-muted">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Nome da Regra</label>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Ex: Inativos 6m — Instagram"
                      className="mt-1 w-full h-9 px-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Dias de Inatividade (mínimo)</label>
                    <input
                      type="number"
                      value={newDays}
                      onChange={(e) => setNewDays(Number(e.target.value))}
                      min={30}
                      className="mt-1 w-full h-9 px-3 rounded-lg bg-muted border-0 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Origem do Paciente</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(Object.keys(originConfig) as ChannelOrigin[]).map((key) => {
                      const cfg = originConfig[key];
                      return (
                        <button
                          key={key}
                          onClick={() => setNewOrigin(key)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                            newOrigin === key
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <cfg.icon className="h-3 w-3" /> {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Modelo de Mensagem</label>
                  <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    rows={3}
                    placeholder="Use {nome} para personalizar..."
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                  <p className="text-[9px] text-muted-foreground mt-1">Variáveis: {"{nome}"}, {"{tratamento}"}, {"{dias_inativo}"}</p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    <Users className="inline h-3 w-3 mr-1" />
                    {mockPatients.filter((p) => (newOrigin === "todos" || p.origin === newOrigin) && p.daysSince >= newDays).length} pacientes correspondem
                  </p>
                  <button
                    onClick={handleCreateRule}
                    disabled={!newName.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-3.5 w-3.5" /> Criar Regra
                  </button>
                </div>
              </div>
            ) : selectedRule ? (
              <>
                {/* Rule detail header */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{selectedRule.name}</h3>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          {(() => { const C = originConfig[selectedRule.origin]; return <><C.icon className={`h-3 w-3 ${C.color}`} /> {C.label}</>; })()}
                        </span>
                        <span>≥ {selectedRule.inactiveDays} dias inativo</span>
                        {selectedRule.lastRun && <span>Último envio: {selectedRule.lastRun}</span>}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusCfg[selectedRule.status].color}`}>
                      {statusCfg[selectedRule.status].label}
                    </span>
                  </div>

                  <div className="bg-muted/50 rounded-lg p-3 mb-3">
                    <p className="text-[10px] text-muted-foreground uppercase font-medium mb-1">Mensagem</p>
                    <p className="text-xs text-foreground">{selectedRule.messageTemplate}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Pacientes</p>
                      <p className="text-sm font-bold text-foreground">{selectedRule.matchedPatients}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Enviadas</p>
                      <p className="text-sm font-bold text-chart-1">{selectedRule.sentCount}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-muted-foreground">Resposta</p>
                      <p className="text-sm font-bold text-success">{selectedRule.responseRate}%</p>
                    </div>
                  </div>
                </div>

                {/* Patients list */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-foreground">Pacientes Correspondentes</h4>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <input
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Buscar..."
                          className="h-7 pl-6 pr-2 w-36 rounded-md bg-muted border-0 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <button onClick={selectAll} className="px-2 py-1 rounded-md bg-muted text-[10px] font-medium text-muted-foreground hover:text-foreground">
                        {filteredPatients.every((p) => p.selected) ? "Desmarcar" : "Selecionar"} Todos
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    {filteredPatients.map((patient) => {
                      const oCfg = originConfig[patient.origin];
                      return (
                        <div
                          key={patient.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
                            patient.selected ? "bg-primary/5" : "hover:bg-muted/50"
                          }`}
                          onClick={() => togglePatient(patient.id)}
                        >
                          <input
                            type="checkbox"
                            checked={patient.selected}
                            onChange={() => togglePatient(patient.id)}
                            className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
                          />
                          <div className={`h-7 w-7 rounded-full ${patient.avatarColor} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
                            {patient.initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{patient.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{patient.treatments}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-warning font-medium">{patient.daysSince} dias</p>
                            <p className="text-[9px] text-muted-foreground">{patient.lastVisit}</p>
                          </div>
                          <span className={`flex items-center gap-0.5 text-[9px] shrink-0 ${oCfg.color}`}>
                            <oCfg.icon className="h-2.5 w-2.5" /> {oCfg.label}
                          </span>
                        </div>
                      );
                    })}
                    {filteredPatients.length === 0 && (
                      <div className="py-8 text-center text-xs text-muted-foreground">Nenhum paciente encontrado com esses critérios.</div>
                    )}
                  </div>

                  {selectedCount > 0 && (
                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        <CheckCircle2 className="inline h-3 w-3 text-primary mr-1" />
                        {selectedCount} paciente{selectedCount > 1 ? "s" : ""} selecionado{selectedCount > 1 ? "s" : ""}
                      </p>
                      <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success text-white text-xs font-medium hover:bg-success/90">
                        <Send className="h-3.5 w-3.5" /> Enviar Mensagem via WhatsApp
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <RefreshCcw className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione ou crie uma regra</h3>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Crie regras para reativar pacientes inativos filtrados por origem (Instagram, Facebook, Google, etc.) e tempo sem visita.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiBox({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
