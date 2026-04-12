import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  Play, Square, Mic, FileText, Receipt, AlertTriangle, Clock,
  User, Phone, Mail, Heart, Pill, Stethoscope, Send, Plus, Trash2,
  Save, ChevronRight, Activity, ClipboardList, ExternalLink, Timer,
  Printer, Loader2, Bot, Sparkles,
} from "lucide-react";
import { exportarPrescricaoPdf } from "@/lib/prescricaoPdfExport";
import { AudioRecorder } from "@/components/chat/AudioRecorder";
import { OdontogramaEditor } from "@/components/OdontogramaChart";
import {
  mockPacientes, getPacienteById, getPacienteIniciais, getPacienteIdade,
  getAlergias, getCondicoesCriticas, getAnamnese, getOdontograma, temAlertasMedicos,
  type Paciente
} from "@/data/registroCentral";
import { aiApi } from "@/lib/vpsApi";
import { toast } from "sonner";

export const Route = createFileRoute("/atendimento")({
  component: AtendimentoPage,
});

interface Prescricao {
  id: string;
  medicamento: string;
  dosagem: string;
  posologia: string;
  duracao: string;
}

interface GravacaoConsulta {
  id: string;
  blob: Blob;
  duration: number;
  timestamp: Date;
}

type TabAtiva = "consulta" | "odontograma" | "prescricao" | "orcamento" | "relatorio";

interface TranscriptionState {
  status: 'idle' | 'transcribing' | 'generating' | 'done' | 'error';
  transcription: string;
  report: string;
  reportId: string;
  error: string;
}

function AtendimentoPage() {
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);
  const [busca, setBusca] = useState("");
  const [atendimentoAtivo, setAtendimentoAtivo] = useState(false);
  const [tempoAtendimento, setTempoAtendimento] = useState(0);
  const [tabAtiva, setTabAtiva] = useState<TabAtiva>("consulta");
  const [notas, setNotas] = useState("");
  const [queixaPrincipal, setQueixaPrincipal] = useState("");
  const [procedimentoRealizado, setProcedimentoRealizado] = useState("");
  const [dente, setDente] = useState("");
  const [gravacoes, setGravacoes] = useState<GravacaoConsulta[]>([]);
  const [prescricoes, setPrescricoes] = useState<Prescricao[]>([]);
  const [novaPrescricao, setNovaPrescricao] = useState<Omit<Prescricao, "id">>({
    medicamento: "", dosagem: "", posologia: "", duracao: ""
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [aiState, setAiState] = useState<TranscriptionState>({
    status: 'idle', transcription: '', report: '', reportId: '', error: '',
  });

  const pacientesFiltrados = mockPacientes.filter(p =>
    p.nome.toLowerCase().includes(busca.toLowerCase())
  );

  const iniciarAtendimento = useCallback(() => {
    if (!pacienteSelecionado) return;
    setAtendimentoAtivo(true);
    setTempoAtendimento(0);
    timerRef.current = setInterval(() => setTempoAtendimento(t => t + 1), 1000);
    toast.success(`Atendimento iniciado para ${pacienteSelecionado.nome}`);
  }, [pacienteSelecionado]);

  const finalizarAtendimento = useCallback(() => {
    setAtendimentoAtivo(false);
    if (timerRef.current) clearInterval(timerRef.current);
    toast.success("Atendimento finalizado e relatório salvo!");
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const handleGravacaoCompleta = useCallback((blob: Blob, duration: number) => {
    const gravacao: GravacaoConsulta = {
      id: `grav-${Date.now()}`,
      blob,
      duration,
      timestamp: new Date(),
    };
    setGravacoes(prev => [...prev, gravacao]);
    toast.success(`Áudio gravado (${formatTime(duration)})`);
  }, []);

  const handleTranscreverIA = useCallback(async () => {
    if (gravacoes.length === 0) {
      toast.error("Grave a consulta primeiro");
      return;
    }
    setAiState(prev => ({ ...prev, status: 'transcribing', error: '' }));
    setTabAtiva("relatorio");

    try {
      // Combine all recordings into one blob
      const combinedBlob = new Blob(gravacoes.map(g => g.blob), { type: 'audio/webm' });

      // Step 1: Transcribe
      const { data: transData, error: transError } = await aiApi.transcribe(combinedBlob);
      if (transError || !transData) {
        setAiState(prev => ({ ...prev, status: 'error', error: transError || 'Erro na transcrição' }));
        toast.error(transError || 'Erro na transcrição');
        return;
      }

      setAiState(prev => ({ ...prev, transcription: transData.transcription, status: 'generating' }));

      // Step 2: Generate clinical report
      const { data: reportData, error: reportError } = await aiApi.generateReport({
        transcription: transData.transcription,
        queixaPrincipal,
        procedimento: procedimentoRealizado,
        dente,
        prescricoes,
        patientId: pacienteSelecionado?.id,
        patientName: pacienteSelecionado?.nome,
        durationSeconds: tempoAtendimento,
      });

      if (reportError || !reportData) {
        setAiState(prev => ({ ...prev, status: 'error', error: reportError || 'Erro ao gerar relatório' }));
        toast.error(reportError || 'Erro ao gerar relatório');
        return;
      }

      setAiState({
        status: 'done',
        transcription: transData.transcription,
        report: reportData.report,
        reportId: reportData.id,
        error: '',
      });
      toast.success("Relatório clínico gerado e salvo no prontuário!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setAiState(prev => ({ ...prev, status: 'error', error: msg }));
      toast.error(msg);
    }
  }, [gravacoes, queixaPrincipal, procedimentoRealizado, dente, prescricoes, pacienteSelecionado, tempoAtendimento]);

  const adicionarPrescricao = useCallback(() => {
    if (!novaPrescricao.medicamento) return;
    setPrescricoes(prev => [...prev, { ...novaPrescricao, id: `rx-${Date.now()}` }]);
    setNovaPrescricao({ medicamento: "", dosagem: "", posologia: "", duracao: "" });
    toast.success("Prescrição adicionada");
  }, [novaPrescricao]);

  const removerPrescricao = useCallback((id: string) => {
    setPrescricoes(prev => prev.filter(p => p.id !== id));
  }, []);

  const imprimirPrescricao = useCallback(() => {
    if (!pacienteSelecionado || prescricoes.length === 0) {
      toast.error("Adicione ao menos uma prescrição antes de imprimir");
      return;
    }
    exportarPrescricaoPdf({
      pacienteNome: pacienteSelecionado.nome,
      pacienteTelefone: pacienteSelecionado.telefone,
      pacienteIdade: getPacienteIdade(pacienteSelecionado),
      profissional: "Dr. Ricardo Mendes",
      croProfissional: "CRO-SP 12345",
      prescricoes,
      observacoes: notas || undefined,
    });
    toast.success("Prescrição gerada para impressão");
  }, [pacienteSelecionado, prescricoes, notas]);

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const alergias = pacienteSelecionado ? getAlergias(pacienteSelecionado.id) : [];
  const condicoes = pacienteSelecionado ? getCondicoesCriticas(pacienteSelecionado.id) : [];
  const temAlertas = pacienteSelecionado ? temAlertasMedicos(pacienteSelecionado.id) : false;

  // Odontograma state — load from patient data
  const odontogramaBase = pacienteSelecionado ? getOdontograma(pacienteSelecionado.id) : undefined;
  const [dentesOdontograma, setDentesOdontograma] = useState<import("@/data/pacientesMockData").DenteInfo[]>([]);

  // Reset odontograma when patient changes
  useEffect(() => {
    if (odontogramaBase) {
      setDentesOdontograma([...odontogramaBase.dentes]);
    } else {
      // Generate default teeth (all healthy)
      const allTeeth = [
        ...[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],
        ...[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38],
      ].map(n => ({ numero: n, status: "saudavel" as const }));
      setDentesOdontograma(allTeeth);
    }
  }, [pacienteSelecionado?.id]);

  const tabs: { key: TabAtiva; label: string; icon: typeof FileText }[] = [
    { key: "consulta", label: "Consulta", icon: Stethoscope },
    { key: "odontograma", label: "Odontograma", icon: Activity },
    { key: "prescricao", label: "Prescrição", icon: Pill },
    { key: "orcamento", label: "Orçamento", icon: Receipt },
    { key: "relatorio", label: "Relatório IA", icon: FileText },
  ];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <DashboardHeader title="Atendimento Clínico" />
          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-[1600px] mx-auto grid grid-cols-12 gap-6">

              {/* Coluna esquerda — Seleção de paciente */}
              <div className="col-span-3 space-y-4">
                <div className="bg-card rounded-2xl border border-border/60 p-4 shadow-card animate-slide-up">
                  <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" /> Paciente
                  </h2>
                  <input
                    type="text"
                    placeholder="Buscar paciente..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 mb-3"
                  />
                  <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                    {pacientesFiltrados.map(p => {
                      const sel = pacienteSelecionado?.id === p.id;
                      const iniciais = getPacienteIniciais(p);
                      return (
                        <button
                          key={p.id}
                          onClick={() => { setPacienteSelecionado(p); setBusca(""); }}
                          disabled={atendimentoAtivo && !sel}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-300 hover-lift ${
                            sel
                              ? "border border-primary bg-primary/5 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)] ring-1 ring-primary/20"
                              : "border border-transparent hover:bg-muted/60 hover:border-border/60"
                          } ${atendimentoAtivo && !sel ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                            {iniciais}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{p.nome}</p>
                            <p className="text-[11px] text-muted-foreground">{p.telefone}</p>
                          </div>
                          {temAlertasMedicos(p.id) && (
                            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 ml-auto" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Alertas médicos */}
                {pacienteSelecionado && temAlertas && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-2xl p-4 animate-slide-up" style={{ animationDelay: "50ms" }}>
                    <h3 className="text-xs font-semibold text-destructive flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="h-3.5 w-3.5" /> ALERTAS MÉDICOS
                    </h3>
                    {alergias.length > 0 && (
                      <div className="mb-2">
                        <p className="text-[10px] text-destructive/70 font-medium uppercase">Alergias</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {alergias.map(a => (
                            <span key={a} className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium">{a}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {condicoes.length > 0 && (
                      <div>
                        <p className="text-[10px] text-destructive/70 font-medium uppercase">Condições</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {condicoes.map(c => (
                            <span key={c} className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium">{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Info paciente */}
                {pacienteSelecionado && (
                  <div className="bg-card rounded-2xl border border-border/60 p-4 shadow-card animate-slide-up" style={{ animationDelay: "100ms" }}>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <p className="flex items-center gap-2"><Phone className="h-3 w-3" /> {pacienteSelecionado.telefone}</p>
                      <p className="flex items-center gap-2"><Mail className="h-3 w-3" /> {pacienteSelecionado.email}</p>
                      <p className="flex items-center gap-2"><Heart className="h-3 w-3" /> {getPacienteIdade(pacienteSelecionado)} anos</p>
                      {pacienteSelecionado.convenio && (
                        <p className="flex items-center gap-2"><ClipboardList className="h-3 w-3" /> {pacienteSelecionado.convenio}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Coluna central — Atendimento */}
              <div className="col-span-9 space-y-4">

                {/* Barra de controle do atendimento */}
                <div className={`rounded-2xl border p-4 transition-all duration-500 animate-slide-up ${
                  atendimentoAtivo
                    ? "bg-primary/5 border-primary/30 shadow-[0_0_24px_-6px_hsl(var(--primary)/0.25)] ring-1 ring-primary/10"
                    : "bg-card border-border/60 shadow-card"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {!atendimentoAtivo ? (
                        <button
                          onClick={iniciarAtendimento}
                          disabled={!pacienteSelecionado}
                          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                        >
                          <Play className="h-4 w-4" /> Iniciar Atendimento
                        </button>
                      ) : (
                        <button
                          onClick={finalizarAtendimento}
                          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-all shadow-md"
                        >
                          <Square className="h-4 w-4" /> Finalizar
                        </button>
                      )}
                      {pacienteSelecionado && (
                        <div className="text-sm">
                          <span className="text-muted-foreground">Paciente: </span>
                          <span className="font-semibold text-foreground">{pacienteSelecionado.nome}</span>
                        </div>
                      )}
                    </div>
                    {atendimentoAtivo && (
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
                        <span className="font-mono text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Timer className="h-4 w-4 text-primary" />
                          {formatTime(tempoAtendimento)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Gravação de áudio da consulta */}
                {atendimentoAtivo && (
                  <div className="bg-card rounded-2xl border border-border/60 p-4 shadow-card animate-slide-up" style={{ animationDelay: "50ms" }}>
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Mic className="h-4 w-4 text-primary" /> Gravação da Consulta
                      {gravacoes.length > 0 && (
                        <button
                          onClick={handleTranscreverIA}
                          disabled={aiState.status === 'transcribing' || aiState.status === 'generating'}
                          className="flex items-center gap-1.5 ml-auto h-7 px-3 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {aiState.status === 'transcribing' || aiState.status === 'generating' ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          {aiState.status === 'transcribing' ? 'Transcrevendo...' :
                           aiState.status === 'generating' ? 'Gerando relatório...' :
                           aiState.status === 'done' ? 'Gerar novamente' :
                           'Transcrever com IA'}
                        </button>
                      )}
                    </h3>
                    <div className="flex items-center gap-3">
                      <AudioRecorder
                        onRecordingComplete={handleGravacaoCompleta}
                      />
                      <span className="text-xs text-muted-foreground">
                        Grave a consulta para gerar relatórios automáticos com IA
                      </span>
                    </div>
                    {gravacoes.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {gravacoes.map((g, idx) => (
                          <div key={g.id} className="flex items-center gap-3 bg-muted/40 rounded-lg px-3 py-2">
                            <Activity className="h-3.5 w-3.5 text-primary" />
                            <span className="text-xs text-foreground font-medium">Gravação {idx + 1}</span>
                            <span className="text-xs text-muted-foreground">{formatTime(g.duration)}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {g.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <button
                              onClick={() => setGravacoes(prev => prev.filter(x => x.id !== g.id))}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tabs */}
                {atendimentoAtivo && (
                  <div className="animate-slide-up" style={{ animationDelay: "100ms" }}>
                    <div className="flex gap-1 bg-muted/40 rounded-xl p-1 border border-border/40">
                      {tabs.map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => setTabAtiva(tab.key)}
                          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                            tabAtiva === tab.key
                              ? "bg-card text-foreground shadow-sm border border-border/60"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <tab.icon className="h-3.5 w-3.5" /> {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4">
                      {/* Tab Consulta */}
                      {tabAtiva === "consulta" && (
                        <div className="space-y-4">
                          <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
                            <label className="text-xs font-semibold text-foreground mb-2 block">Queixa Principal</label>
                            <textarea
                              value={queixaPrincipal}
                              onChange={e => setQueixaPrincipal(e.target.value)}
                              placeholder="Descreva a queixa principal do paciente..."
                              className="w-full h-20 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
                              <label className="text-xs font-semibold text-foreground mb-2 block">Procedimento Realizado</label>
                              <textarea
                                value={procedimentoRealizado}
                                onChange={e => setProcedimentoRealizado(e.target.value)}
                                placeholder="Descreva o procedimento..."
                                className="w-full h-28 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                              />
                            </div>
                            <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
                              <label className="text-xs font-semibold text-foreground mb-2 block">Dente / Região</label>
                              <input
                                type="text"
                                value={dente}
                                onChange={e => setDente(e.target.value)}
                                placeholder="Ex: 36, quadrante superior direito..."
                                className="w-full h-9 rounded-lg border border-border bg-muted/30 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 mb-3"
                              />
                              <label className="text-xs font-semibold text-foreground mb-2 block">Observações Clínicas</label>
                              <textarea
                                value={notas}
                                onChange={e => setNotas(e.target.value)}
                                placeholder="Observações adicionais..."
                                className="w-full h-20 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Tab Prescrição */}
                      {tabAtiva === "prescricao" && (
                        <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                              <Pill className="h-4 w-4 text-primary" /> Receituário
                            </h3>
                            {prescricoes.length > 0 && (
                              <button
                                onClick={imprimirPrescricao}
                                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                              >
                                <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-3">
                            <input
                              type="text" placeholder="Medicamento"
                              value={novaPrescricao.medicamento}
                              onChange={e => setNovaPrescricao(p => ({ ...p, medicamento: e.target.value }))}
                              className="h-9 rounded-lg border border-border bg-muted/30 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <input
                              type="text" placeholder="Dosagem (ex: 500mg)"
                              value={novaPrescricao.dosagem}
                              onChange={e => setNovaPrescricao(p => ({ ...p, dosagem: e.target.value }))}
                              className="h-9 rounded-lg border border-border bg-muted/30 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <input
                              type="text" placeholder="Posologia (ex: 8/8h)"
                              value={novaPrescricao.posologia}
                              onChange={e => setNovaPrescricao(p => ({ ...p, posologia: e.target.value }))}
                              className="h-9 rounded-lg border border-border bg-muted/30 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <div className="flex gap-2">
                              <input
                                type="text" placeholder="Duração (ex: 7 dias)"
                                value={novaPrescricao.duracao}
                                onChange={e => setNovaPrescricao(p => ({ ...p, duracao: e.target.value }))}
                                className="h-9 flex-1 rounded-lg border border-border bg-muted/30 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <button
                                onClick={adicionarPrescricao}
                                className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-all shrink-0"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          {prescricoes.length > 0 && (
                            <div className="border border-border/40 rounded-xl overflow-hidden">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-muted/40 text-muted-foreground text-xs">
                                    <th className="text-left p-3 font-medium">Medicamento</th>
                                    <th className="text-left p-3 font-medium">Dosagem</th>
                                    <th className="text-left p-3 font-medium">Posologia</th>
                                    <th className="text-left p-3 font-medium">Duração</th>
                                    <th className="p-3 w-10" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {prescricoes.map(rx => (
                                    <tr key={rx.id} className="border-t border-border/30">
                                      <td className="p-3 font-medium text-foreground">{rx.medicamento}</td>
                                      <td className="p-3 text-muted-foreground">{rx.dosagem}</td>
                                      <td className="p-3 text-muted-foreground">{rx.posologia}</td>
                                      <td className="p-3 text-muted-foreground">{rx.duracao}</td>
                                      <td className="p-3">
                                        <button onClick={() => removerPrescricao(rx.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {prescricoes.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-6">Nenhuma prescrição adicionada</p>
                          )}
                        </div>
                      )}

                      {/* Tab Odontograma */}
                      {tabAtiva === "odontograma" && (
                        <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
                          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                            <Activity className="h-4 w-4 text-primary" /> Odontograma Interativo
                          </h3>
                          <OdontogramaEditor
                            dentes={dentesOdontograma}
                            onChange={setDentesOdontograma}
                          />
                        </div>
                      )}

                      {/* Tab Orçamento */}
                      {tabAtiva === "orcamento" && (
                        <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
                          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                            <Receipt className="h-4 w-4 text-primary" /> Orçamento Rápido
                          </h3>
                          <div className="text-center py-8">
                            <Receipt className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground mb-3">
                              Crie um orçamento para este atendimento
                            </p>
                            <a
                              href="/orcamentos"
                              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> Abrir módulo Orçamentos
                            </a>
                          </div>
                        </div>
                      )}

                      {/* Tab Relatório IA */}
                      {tabAtiva === "relatorio" && (
                        <div className="bg-card rounded-2xl border border-border/60 p-5 shadow-card">
                          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                            <FileText className="h-4 w-4 text-primary" /> Relatório da Consulta (IA)
                          </h3>

                          {/* Status: Transcribing */}
                          {aiState.status === 'transcribing' && (
                            <div className="flex flex-col items-center py-8 gap-3">
                              <Loader2 className="h-8 w-8 text-primary animate-spin" />
                              <p className="text-sm font-medium text-foreground">Transcrevendo áudio com Whisper...</p>
                              <p className="text-xs text-muted-foreground">Isso pode levar alguns segundos</p>
                            </div>
                          )}

                          {/* Status: Generating report */}
                          {aiState.status === 'generating' && (
                            <div className="flex flex-col items-center py-8 gap-3">
                              <Bot className="h-8 w-8 text-primary animate-pulse" />
                              <p className="text-sm font-medium text-foreground">Gerando relatório clínico com IA...</p>
                              {aiState.transcription && (
                                <div className="bg-muted/30 rounded-xl p-4 text-left w-full max-w-lg mt-2">
                                  <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Transcrição capturada</p>
                                  <p className="text-xs text-foreground line-clamp-4">{aiState.transcription}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Status: Error */}
                          {aiState.status === 'error' && (
                            <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 text-center">
                              <AlertTriangle className="h-6 w-6 text-destructive mx-auto mb-2" />
                              <p className="text-sm font-medium text-destructive mb-1">Erro na geração</p>
                              <p className="text-xs text-destructive/70">{aiState.error}</p>
                              <button
                                onClick={handleTranscreverIA}
                                className="mt-3 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                              >
                                Tentar novamente
                              </button>
                            </div>
                          )}

                          {/* Status: Done — show full report */}
                          {aiState.status === 'done' && (
                            <div className="space-y-4">
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success text-xs font-medium">
                                <Sparkles className="h-3 w-3" /> Relatório gerado e salvo no prontuário
                              </div>

                              {/* Transcription */}
                              <details className="group">
                                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
                                  <Mic className="h-3 w-3" /> Ver transcrição completa
                                </summary>
                                <div className="mt-2 bg-muted/30 rounded-xl p-4 text-xs text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
                                  {aiState.transcription}
                                </div>
                              </details>

                              {/* Report */}
                              <div className="bg-card border border-primary/20 rounded-xl p-5">
                                <div className="prose prose-sm max-w-none text-foreground text-xs leading-relaxed"
                                     dangerouslySetInnerHTML={{
                                       __html: aiState.report
                                         .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                         .replace(/^### (.*$)/gm, '<h4 class="text-sm font-semibold text-foreground mt-3 mb-1">$1</h4>')
                                         .replace(/^## (.*$)/gm, '<h3 class="text-sm font-bold text-foreground mt-4 mb-2">$1</h3>')
                                         .replace(/^# (.*$)/gm, '<h2 class="text-base font-bold text-foreground mt-4 mb-2">$1</h2>')
                                         .replace(/^- (.*$)/gm, '<li class="ml-4 list-disc text-muted-foreground">$1</li>')
                                         .replace(/\n\n/g, '<br/><br/>')
                                         .replace(/\n/g, '<br/>')
                                     }}
                                />
                              </div>
                            </div>
                          )}

                          {/* Status: Idle — show instructions */}
                          {aiState.status === 'idle' && (
                            <div className="bg-muted/30 rounded-xl border border-dashed border-border/60 p-8 text-center">
                              <Activity className="h-10 w-10 text-primary/30 mx-auto mb-3" />
                              <p className="text-sm font-medium text-foreground mb-1">Transcrição e Análise por IA</p>
                              <p className="text-xs text-muted-foreground max-w-md mx-auto mb-4">
                                Grave a consulta e clique em "Transcrever com IA" para gerar automaticamente
                                o relatório clínico. O relatório será salvo no prontuário do paciente e usado
                                para follow-ups automáticos pelo agente de IA.
                              </p>
                              {gravacoes.length > 0 ? (
                                <div className="space-y-3">
                                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success text-xs font-medium">
                                    <Mic className="h-3 w-3" /> {gravacoes.length} gravação(ões) prontas
                                  </div>
                                  <div>
                                    <button
                                      onClick={handleTranscreverIA}
                                      className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                                    >
                                      <Sparkles className="h-4 w-4" /> Transcrever e Gerar Relatório
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground/60">Grave a consulta para habilitar</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Estado vazio */}
                {!atendimentoAtivo && !pacienteSelecionado && (
                  <div className="bg-card rounded-2xl border border-border/60 p-12 shadow-card text-center animate-slide-up">
                    <Stethoscope className="h-12 w-12 text-primary/20 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">Módulo de Atendimento</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Selecione um paciente na lista ao lado para iniciar um atendimento clínico.
                      Grave a consulta, faça prescrições e gere relatórios automáticos com IA.
                    </p>
                  </div>
                )}

                {/* Paciente selecionado mas atendimento não iniciado */}
                {!atendimentoAtivo && pacienteSelecionado && (
                  <div className="bg-card rounded-2xl border border-border/60 p-8 shadow-card text-center animate-slide-up">
                    <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-lg font-bold mx-auto mb-4">
                      {getPacienteIniciais(pacienteSelecionado)}
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-1">{pacienteSelecionado.nome}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{getPacienteIdade(pacienteSelecionado)} anos • {pacienteSelecionado.telefone}</p>
                    <button
                      onClick={iniciarAtendimento}
                      className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all shadow-md hover:shadow-lg"
                    >
                      <Play className="h-4 w-4" /> Iniciar Atendimento
                    </button>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
