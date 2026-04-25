import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calendar, Stethoscope, MapPin, Phone, Mail, MessageSquare, BellRing, Repeat, Search, Sparkles, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { agendaApi, pacientesApi, dentistasApi, type AgendamentoVPS, type MarcadorAgenda } from "@/lib/vpsApi";
import { AnalogTimePicker } from "./AnalogTimePicker";
import { MarcadoresSelector } from "./MarcadoresSelector";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate: string; // YYYY-MM-DD
  defaultHora?: string;
  defaultDentistaId?: string;
  onCreated: () => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CATEGORIAS = [
  { label: "Avaliação", value: "avaliacao", cor: "bg-chart-2/30" },
  { label: "Profilaxia", value: "profilaxia", cor: "bg-chart-1/30" },
  { label: "Restauração", value: "restauracao", cor: "bg-chart-3/30" },
  { label: "Endodontia", value: "endodontia", cor: "bg-chart-4/30" },
  { label: "Ortodontia", value: "ortodontia", cor: "bg-chart-5/30" },
  { label: "Cirurgia", value: "cirurgia", cor: "bg-destructive/20" },
  { label: "Retorno", value: "retorno", cor: "bg-success/20" },
];

const QUANDO_OPCOES = [
  { label: "Não enviar", value: "_none" },
  { label: "Enviar agora", value: "agora" },
  { label: "1 dia antes", value: "1d" },
  { label: "2 dias antes", value: "2d" },
  { label: "3 dias antes", value: "3d" },
  { label: "1 semana antes", value: "7d" },
];

interface Paciente { id: string; nome: string; telefone?: string; email?: string }
interface Dentista { id: string; nome: string; especialidade?: string | null }

export function NovoAgendamentoModal({
  open, onOpenChange, defaultDate, defaultHora, defaultDentistaId, onCreated,
}: Props) {
  const [tab, setTab] = useState<"consulta" | "compromisso" | "evento">("consulta");
  const [saving, setSaving] = useState(false);

  // Listas
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [dentistas, setDentistas] = useState<Dentista[]>([]);
  const [search, setSearch] = useState("");
  const [showSugg, setShowSugg] = useState(false);
  const [pacienteError, setPacienteError] = useState(false);
  const sugRef = useRef<HTMLDivElement>(null);

  // Refs para foco em validação
  const pacienteInputRef = useRef<HTMLInputElement>(null);
  const dentistaTriggerRef = useRef<HTMLButtonElement>(null);
  const dataInputRef = useRef<HTMLInputElement>(null);
  const horaInputRef = useRef<HTMLInputElement>(null);
  const duracaoInputRef = useRef<HTMLInputElement>(null);
  const telefoneFieldRef = useRef<HTMLDivElement>(null);

  // Form Consulta
  const [pacienteId, setPacienteId] = useState("");
  const [pacienteNome, setPacienteNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [dentistaId, setDentistaId] = useState(defaultDentistaId || "");
  const [data, setData] = useState(defaultDate);
  const [hora, setHora] = useState(defaultHora || "09:00");
  const [duracao, setDuracao] = useState(30);
  const [procedimento, setProcedimento] = useState("");
  const [categoria, setCategoria] = useState<string>("avaliacao");
  const [primeiraConsulta, setPrimeiraConsulta] = useState(false);
  const [observacoes, setObservacoes] = useState("");
  const [sala, setSala] = useState("Sala 1");

  // Confirmação
  const [confirmacaoCanal, setConfirmacaoCanal] = useState<string>("whatsapp");
  const [confirmacaoQuando, setConfirmacaoQuando] = useState("agora");

  // Alerta de retorno
  const [retornoCanal, setRetornoCanal] = useState<string>("whatsapp");
  const [retornoQuando, setRetornoQuando] = useState("");

  // Múltiplo agendamento
  const [multiplo, setMultiplo] = useState(false);
  const [qtdSessoes, setQtdSessoes] = useState(4);
  const [intervaloDias, setIntervaloDias] = useState(7);

  // Marcadores + Como conheceu (Fase A)
  const [marcadores, setMarcadores] = useState<MarcadorAgenda[]>([]);
  const [comoConheceu, setComoConheceu] = useState<string>("");

  // Compromisso/Evento
  const [escopo, setEscopo] = useState<"dentista" | "clinica">("dentista");
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [eventoTitulo, setEventoTitulo] = useState("");
  const [horaFim, setHoraFim] = useState("18:00");

  const categoriaSel = useMemo(() => CATEGORIAS.find((c) => c.value === categoria), [categoria]);

  useEffect(() => {
    if (!open) return;
    setData(defaultDate);
    if (defaultHora) setHora(defaultHora);
    if (defaultDentistaId) setDentistaId(defaultDentistaId);
    pacientesApi.list().then(({ data }) => Array.isArray(data) && setPacientes(data as Paciente[]));
    dentistasApi.list().then(({ data }) => {
      if (Array.isArray(data) && data.length > 0) {
        setDentistas(data as Dentista[]);
        if (!dentistaId && !defaultDentistaId) setDentistaId((data[0] as Dentista).id);
      }
    });
  }, [open, defaultDate, defaultHora, defaultDentistaId]);

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setTab("consulta");
        setPacienteId(""); setPacienteNome(""); setTelefone(""); setEmail("");
        setProcedimento(""); setObservacoes(""); setSala("Sala 1");
        setPrimeiraConsulta(false); setMultiplo(false); setQtdSessoes(4); setIntervaloDias(7);
        setRetornoQuando(""); setSearch(""); setPacienteError(false);
        setMarcadores([]); setComoConheceu("");
        setEventoTitulo(""); setDiaInteiro(false); setEscopo("dentista");
      }, 300);
    }
  }, [open]);

  const filteredPacientes = useMemo(() => {
    if (!search || search.length < 2) return [];
    const q = search.toLowerCase();
    return pacientes.filter((p) => p.nome?.toLowerCase().includes(q)).slice(0, 6);
  }, [search, pacientes]);

  const handleSelectPaciente = (p: Paciente) => {
    setPacienteId(p.id);
    setPacienteNome(p.nome);
    setTelefone(p.telefone || "");
    setEmail(p.email || "");
    setSearch(p.nome);
    setShowSugg(false);
    setPacienteError(false);
  };

  // Validação básica
  type CampoErro = "paciente" | "dentista" | "data" | "hora" | "duracao" | "telefone" | "outro";
  const validateConsulta = (): { msg: string; campo: CampoErro } | null => {
    if (!pacienteId || !UUID_RE.test(pacienteId)) {
      return {
        msg: search.trim().length > 0 ? "Clique no nome do paciente da lista" : "Busque e selecione um paciente",
        campo: "paciente",
      };
    }
    if (!dentistaId || !UUID_RE.test(dentistaId)) return { msg: "Selecione um profissional", campo: "dentista" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { msg: "Informe a data", campo: "data" };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { msg: "Informe o horário (HH:MM)", campo: "hora" };
    if (duracao < 5 || duracao > 480) return { msg: "Duração entre 5 e 480 minutos", campo: "duracao" };
    if (multiplo && (qtdSessoes < 2 || qtdSessoes > 52)) return { msg: "Sessões entre 2 e 52", campo: "outro" };
    if (multiplo && (intervaloDias < 1 || intervaloDias > 180)) return { msg: "Intervalo entre 1 e 180 dias", campo: "outro" };
    if (confirmacaoCanal === "whatsapp" && confirmacaoQuando && !telefone.replace(/\D/g, ""))
      return { msg: "Informe o telefone para WhatsApp", campo: "telefone" };
    return null;
  };

  const focusCampo = (campo: CampoErro) => {
    const refMap: Record<CampoErro, React.RefObject<HTMLElement | null>> = {
      paciente: pacienteInputRef,
      dentista: dentistaTriggerRef,
      data: dataInputRef,
      hora: horaInputRef,
      duracao: duracaoInputRef,
      telefone: telefoneFieldRef,
      outro: pacienteInputRef,
    };
    const el = refMap[campo]?.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        if (typeof (el as HTMLInputElement).focus === "function") (el as HTMLInputElement).focus();
      }, 200);
    }
  };

  const handleSubmitConsulta = async () => {
    console.log("[Agenda] Submit consulta", { pacienteId, dentistaId, data, hora, duracao });
    const err = validateConsulta();
    if (err) {
      toast.error(err.msg, { duration: 5000 });
      if (err.campo === "paciente") {
        setPacienteError(true);
        setShowSugg(true);
      }
      focusCampo(err.campo);
      return;
    }
    setSaving(true);
    const profName = dentistas.find((d) => d.id === dentistaId)?.nome || "";
    const cat = CATEGORIAS.find((c) => c.value === categoria);

    try {
      if (multiplo) {
        const { data: serieData, error } = await agendaApi.createSerie({
          paciente_id: pacienteId,
          dentista_id: dentistaId,
          data_inicio: data,
          hora,
          duracao,
          procedimento: procedimento || cat?.label || "Consulta",
          quantidade: qtdSessoes,
          intervalo_dias: intervaloDias,
          categoria,
          categoria_cor: cat?.cor,
          primeira_consulta: primeiraConsulta,
          confirmacao_canal: confirmacaoQuando ? confirmacaoCanal : "",
          confirmacao_quando: confirmacaoQuando,
          sala,
          observacoes,
        });
        if (error) { toast.error("Erro ao criar série: " + error); return; }
        toast.success(`Série criada: ${serieData?.total} agendamentos`);
      } else {
        const { error } = await agendaApi.create({
          paciente_id: pacienteId,
          paciente_nome: pacienteNome,
          dentista_id: dentistaId,
          dentista_nome: profName,
          data, hora, duracao,
          procedimento: procedimento || cat?.label || "Consulta",
          status: "agendado",
          observacoes,
          sala,
          tipo: "consulta",
          primeira_consulta: primeiraConsulta,
          categoria,
          categoria_cor: cat?.cor,
          confirmacao_canal: confirmacaoQuando ? confirmacaoCanal : null,
          confirmacao_quando: confirmacaoQuando || null,
          alerta_retorno_canal: retornoQuando ? retornoCanal : null,
          alerta_retorno_quando: retornoQuando || null,
          marcadores: marcadores.length ? marcadores : undefined,
          como_conheceu: comoConheceu || null,
        } as Partial<AgendamentoVPS>);
        if (error) { toast.error("Erro ao criar agendamento: " + error); return; }
        toast.success("Agendamento criado");
      }
      onCreated();
      onOpenChange(false);
    } catch (e: any) {
      console.error("[Agenda] Erro inesperado", e);
      toast.error("Erro inesperado: " + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitCompromissoEvento = async () => {
    if (!data) { toast.error("Informe a data."); return; }
    if (!diaInteiro && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) { toast.error("Horário inválido."); return; }
    if (escopo === "dentista" && !dentistaId) { toast.error("Selecione um profissional ou marque 'Clínica'."); return; }
    if (!eventoTitulo.trim()) { toast.error("Informe um título."); return; }
    setSaving(true);
    try {
      const profName = dentistas.find((d) => d.id === dentistaId)?.nome || "Clínica";
      const dur = diaInteiro ? 1440 : Math.max(15, computeDur(hora, horaFim));
      const { error } = await agendaApi.create({
        dentista_id: escopo === "dentista" ? dentistaId : null,
        dentista_nome: escopo === "dentista" ? profName : "Clínica",
        data,
        hora: diaInteiro ? "00:00" : hora,
        duracao: dur,
        procedimento: eventoTitulo,
        evento_titulo: eventoTitulo,
        status: "agendado",
        observacoes,
        tipo: tab,
        escopo,
        dia_inteiro: diaInteiro,
        categoria_cor: tab === "evento" ? "bg-chart-4/20" : "bg-muted",
      } as Partial<AgendamentoVPS>);
      if (error) { toast.error("Erro: " + error); return; }
      toast.success(`${tab === "compromisso" ? "Compromisso" : "Evento"} criado`);
      onCreated();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Agendamento</DialogTitle>
          <DialogDescription>
            Crie uma consulta, compromisso interno ou evento de clínica.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="consulta">Consulta</TabsTrigger>
            <TabsTrigger value="compromisso">Compromisso</TabsTrigger>
            <TabsTrigger value="evento">Evento</TabsTrigger>
          </TabsList>

          {/* ════ CONSULTA ════ */}
          <TabsContent value="consulta" className="mt-4">
          <form
            onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void handleSubmitConsulta(); }}
            className="space-y-4"
          >
            {/* Paciente search */}
            <div className="relative">
              <Label className={`mb-1 block ${pacienteError ? "text-destructive" : ""}`}>Paciente</Label>
              <div className="relative">
                <Search
                  className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${
                    pacienteError ? "text-destructive" : "text-muted-foreground"
                  }`}
                />
                <Input
                  ref={pacienteInputRef}
                  placeholder="Buscar paciente por nome..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShowSugg(true);
                    setPacienteId("");
                    setPacienteError(false);
                  }}
                  onFocus={() => setShowSugg(true)}
                  aria-invalid={pacienteError}
                  className={`pl-9 ${pacienteError ? "pr-9 border-destructive ring-2 ring-destructive/30 focus-visible:ring-destructive" : ""}`}
                />
                {pacienteError && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive animate-pulse" />
                )}
              </div>
              {showSugg && filteredPacientes.length > 0 && (
                <div ref={sugRef} className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {filteredPacientes.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPaciente(p)}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                    >
                      <div className="font-medium">{p.nome}</div>
                      {p.telefone && <div className="text-xs text-muted-foreground">{p.telefone}</div>}
                    </button>
                  ))}
                </div>
              )}
              {pacienteId && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary"><Phone className="h-3 w-3 mr-1" />{telefone || "—"}</Badge>
                  {email && <Badge variant="secondary"><Mail className="h-3 w-3 mr-1" />{email}</Badge>}
                  <label className="flex items-center gap-1.5 text-sm ml-auto">
                    <Switch checked={primeiraConsulta} onCheckedChange={setPrimeiraConsulta} />
                    Primeira consulta
                  </label>
                </div>
              )}
              {!pacienteId && search.trim().length >= 2 && filteredPacientes.length === 0 && (
                <p className="mt-1.5 text-xs text-warning">
                  Nenhum paciente encontrado com esse nome. Cadastre o paciente antes de agendar.
                </p>
              )}
              {!pacienteId && search.trim().length >= 2 && filteredPacientes.length > 0 && (
                <p className={`mt-1.5 text-xs flex items-center gap-1 ${pacienteError ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  <AlertCircle className="h-3 w-3" />
                  Clique em um paciente da lista acima para selecioná-lo.
                </p>
              )}
            </div>

            {/* Profissional + Categoria */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Profissional</Label>
                <Select value={dentistaId} onValueChange={setDentistaId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {dentistas.filter((d) => d?.id).map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block">Categoria</Label>
                <Select value={categoria} onValueChange={setCategoria}>
                  <SelectTrigger>
                    <div className="flex items-center gap-2">
                      {categoriaSel && <span className={`h-3 w-3 rounded ${categoriaSel.cor}`} />}
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        <div className="flex items-center gap-2">
                          <span className={`h-3 w-3 rounded ${c.cor}`} />
                          {c.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Data / Hora / Duração */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label className="mb-1 block">Data</Label>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block">Horário</Label>
                <AnalogTimePicker value={hora} onChange={setHora} />
              </div>
              <div>
                <Label className="mb-1 block">Duração (min)</Label>
                <Input type="number" min={5} max={480} value={duracao} onChange={(e) => setDuracao(Number(e.target.value))} />
              </div>
              <div>
                <Label className="mb-1 block">Sala</Label>
                <Input value={sala} onChange={(e) => setSala(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="mb-1 block">Procedimento</Label>
              <Input value={procedimento} onChange={(e) => setProcedimento(e.target.value)} placeholder={categoriaSel?.label || "Ex: Restauração dente 16"} />
            </div>

            {/* Marcadores + Como conheceu (Fase A) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/60 p-3 bg-gradient-to-br from-card to-muted/20">
                <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                  Marcadores
                </Label>
                <MarcadoresSelector value={marcadores} onChange={setMarcadores} />
              </div>
              <div className="rounded-lg border border-border/60 p-3 bg-gradient-to-br from-card to-muted/20">
                <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Como conheceu?
                </Label>
                <Select value={comoConheceu || "_none"} onValueChange={(v) => setComoConheceu(v === "_none" ? "" : v)}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Origem do paciente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Não informado</SelectItem>
                    <SelectItem value="indicacao">👥 Indicação</SelectItem>
                    <SelectItem value="instagram">📸 Instagram</SelectItem>
                    <SelectItem value="facebook">👍 Facebook</SelectItem>
                    <SelectItem value="google">🔍 Google</SelectItem>
                    <SelectItem value="site">🌐 Site da clínica</SelectItem>
                    <SelectItem value="whatsapp">💬 WhatsApp</SelectItem>
                    <SelectItem value="passou">🚶 Passou em frente</SelectItem>
                    <SelectItem value="convenio">🏥 Convênio</SelectItem>
                    <SelectItem value="outro">✨ Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Múltiplo agendamento */}
            <div className="rounded-lg border border-border/60 p-3 bg-muted/20">
              <label className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium text-sm">
                  <Repeat className="h-4 w-4 text-primary" /> Múltiplo agendamento (sessões)
                </span>
                <Switch checked={multiplo} onCheckedChange={setMultiplo} />
              </label>
              {multiplo && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <Label className="mb-1 block text-xs">Quantidade de sessões</Label>
                    <Input type="number" min={2} max={52} value={qtdSessoes} onChange={(e) => setQtdSessoes(Number(e.target.value))} />
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs">Intervalo entre sessões (dias)</Label>
                    <Input type="number" min={1} max={180} value={intervaloDias} onChange={(e) => setIntervaloDias(Number(e.target.value))} />
                  </div>
                </div>
              )}
            </div>

            {/* Confirmação + Alerta de retorno */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                  <MessageSquare className="h-4 w-4 text-primary" /> Confirmação
                </div>
                <Select value={confirmacaoQuando || "_none"} onValueChange={(v) => setConfirmacaoQuando(v === "_none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUANDO_OPCOES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {confirmacaoQuando && (
                  <Badge variant="secondary" className="mt-2">WhatsApp</Badge>
                )}
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                  <BellRing className="h-4 w-4 text-warning" /> Alerta de retorno
                </div>
                <Select value={retornoQuando || "_none"} onValueChange={(v) => setRetornoQuando(v === "_none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUANDO_OPCOES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {retornoQuando && (
                  <Badge variant="secondary" className="mt-2">WhatsApp</Badge>
                )}
              </div>
            </div>

            <div>
              <Label className="mb-1 block">Observações</Label>
              <Textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {multiplo ? `Agendar ${qtdSessoes} sessões` : "Agendar"}
              </Button>
            </div>
          </form>
          </TabsContent>

          {/* ════ COMPROMISSO ════ */}
          <TabsContent value="compromisso" className="mt-4">
          <form
            onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void handleSubmitCompromissoEvento(); }}
            className="space-y-4"
          >
            <CompromissoEventoForm
              titulo="Compromisso"
              eventoTitulo={eventoTitulo} setEventoTitulo={setEventoTitulo}
              escopo={escopo} setEscopo={setEscopo}
              dentistaId={dentistaId} setDentistaId={setDentistaId}
              dentistas={dentistas}
              data={data} setData={setData}
              hora={hora} setHora={setHora}
              horaFim={horaFim} setHoraFim={setHoraFim}
              diaInteiro={diaInteiro} setDiaInteiro={setDiaInteiro}
              observacoes={observacoes} setObservacoes={setObservacoes}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar compromisso
              </Button>
            </div>
          </form>
          </TabsContent>

          {/* ════ EVENTO ════ */}
          <TabsContent value="evento" className="mt-4">
          <form
            onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void handleSubmitCompromissoEvento(); }}
            className="space-y-4"
          >
            <CompromissoEventoForm
              titulo="Evento"
              eventoTitulo={eventoTitulo} setEventoTitulo={setEventoTitulo}
              escopo={escopo} setEscopo={setEscopo}
              dentistaId={dentistaId} setDentistaId={setDentistaId}
              dentistas={dentistas}
              data={data} setData={setData}
              hora={hora} setHora={setHora}
              horaFim={horaFim} setHoraFim={setHoraFim}
              diaInteiro={diaInteiro} setDiaInteiro={setDiaInteiro}
              observacoes={observacoes} setObservacoes={setObservacoes}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar evento
              </Button>
            </div>
          </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function CompromissoEventoForm(props: {
  titulo: string;
  eventoTitulo: string; setEventoTitulo: (v: string) => void;
  escopo: "dentista" | "clinica"; setEscopo: (v: "dentista" | "clinica") => void;
  dentistaId: string; setDentistaId: (v: string) => void;
  dentistas: Dentista[];
  data: string; setData: (v: string) => void;
  hora: string; setHora: (v: string) => void;
  horaFim: string; setHoraFim: (v: string) => void;
  diaInteiro: boolean; setDiaInteiro: (v: boolean) => void;
  observacoes: string; setObservacoes: (v: string) => void;
}) {
  return (
    <>
      <div>
        <Label className="mb-1 block">{props.titulo}</Label>
        <Input value={props.eventoTitulo} onChange={(e) => props.setEventoTitulo(e.target.value)} placeholder="Ex: Reunião de equipe / Manutenção do equipamento" />
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-sm">Escopo:</Label>
        <div className="flex rounded-md border border-border/60 overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => props.setEscopo("dentista")}
            className={`px-3 py-1.5 ${props.escopo === "dentista" ? "bg-primary text-primary-foreground" : "bg-card text-foreground"}`}
          >
            <Stethoscope className="h-3 w-3 inline mr-1" /> Dentista
          </button>
          <button
            type="button"
            onClick={() => props.setEscopo("clinica")}
            className={`px-3 py-1.5 ${props.escopo === "clinica" ? "bg-primary text-primary-foreground" : "bg-card text-foreground"}`}
          >
            <MapPin className="h-3 w-3 inline mr-1" /> Clínica
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm ml-auto">
          <Switch checked={props.diaInteiro} onCheckedChange={props.setDiaInteiro} />
          Dia inteiro
        </label>
      </div>

      {props.escopo === "dentista" && (
        <div>
          <Label className="mb-1 block">Profissional</Label>
          <Select value={props.dentistaId} onValueChange={props.setDentistaId}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {props.dentistas.filter((d) => d?.id).map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="mb-1 block flex items-center gap-1"><Calendar className="h-3 w-3" /> Data</Label>
          <Input type="date" value={props.data} onChange={(e) => props.setData(e.target.value)} />
        </div>
        {!props.diaInteiro && (
          <>
            <div>
              <Label className="mb-1 block">Início</Label>
              <AnalogTimePicker value={props.hora} onChange={props.setHora} />
            </div>
            <div>
              <Label className="mb-1 block">Fim</Label>
              <AnalogTimePicker value={props.horaFim} onChange={props.setHoraFim} />
            </div>
          </>
        )}
      </div>

      <div>
        <Label className="mb-1 block">Observações</Label>
        <Textarea rows={2} value={props.observacoes} onChange={(e) => props.setObservacoes(e.target.value)} />
      </div>
    </>
  );
}

function computeDur(inicio: string, fim: string): number {
  const [hi, mi] = inicio.split(":").map(Number);
  const [hf, mf] = fim.split(":").map(Number);
  return Math.max(15, (hf * 60 + mf) - (hi * 60 + mi));
}
