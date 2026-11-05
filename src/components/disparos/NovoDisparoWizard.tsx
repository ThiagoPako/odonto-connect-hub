import { useState, useEffect } from "react";
import {
  X, ChevronRight, ChevronLeft, Users, FileText, CalendarDays, Eye,
  Check, Clock, AlertTriangle, Send, Phone, Loader2,
} from "lucide-react";
import {
  diasSemanaOptions, publicoOptions, templatesProntos,
  type DisparoTemplate, type DisparoProgramado,
} from "@/data/disparosMockData";
import { WhatsAppPreview } from "./WhatsAppPreview";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";

interface NovoDisparoWizardProps {
  open: boolean;
  onClose: () => void;
  /** Resolve true quando o servidor salvou; o assistente só fecha nesse caso. */
  onSave: (disparo: Omit<DisparoProgramado, "id" | "stats" | "criadoEm">) => Promise<boolean>;
  editData?: DisparoProgramado | null;
}

const steps = [
  { id: 1, label: "Público", icon: Users },
  { id: 2, label: "Conteúdo", icon: FileText },
  { id: 3, label: "Agendamento", icon: CalendarDays },
  { id: 4, label: "Revisão", icon: Eye },
];

export function NovoDisparoWizard({ open, onClose, onSave, editData }: NovoDisparoWizardProps) {
  const { connected: connectedInstances, instances: allInstances } = useWhatsAppInstances({ active: open });
  const [step, setStep] = useState(1);
  const [publico, setPublico] = useState<"todos" | "ativos" | "inativos" | "aniversariantes" | "custom">("todos");
  const [mensagem, setMensagem] = useState("");
  const [templateSelecionado, setTemplateSelecionado] = useState<string | null>(null);
  const [nomeDisparo, setNomeDisparo] = useState("");
  const [tipo, setTipo] = useState<"recorrente" | "unico">("recorrente");
  const [diasSemana, setDiasSemana] = useState<string[]>(["SEG", "QUA", "SEX"]);
  const [horarioInicio, setHorarioInicio] = useState("08:00");
  const [horarioFim, setHorarioFim] = useState("18:00");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [campanhaPerpetua, setCampanhaPerpetua] = useState(false);
  const [usarHorarioClinica, setUsarHorarioClinica] = useState(false);
  const [intervaloSpam, setIntervaloSpam] = useState(7);
  const [numeroEnvio, setNumeroEnvio] = useState(connectedInstances[0]?.instanceName || "");

  const isEditing = !!editData;
  const [saving, setSaving] = useState(false);

  // Pre-fill form when editing
  useEffect(() => {
    if (open && editData) {
      setStep(1);
      setPublico(editData.publico);
      setMensagem(editData.template.mensagem);
      setTemplateSelecionado(editData.template.id);
      setNomeDisparo(editData.nome);
      setTipo(editData.tipo);
      setDiasSemana(editData.diasSemana || ["SEG", "QUA", "SEX"]);
      setHorarioInicio(editData.horarioInicio || "08:00");
      setHorarioFim(editData.horarioFim || "18:00");
      setDataInicio(editData.dataInicio || "");
      setDataFim(editData.dataFim || "");
      setCampanhaPerpetua(editData.campanhaPerpetua || false);
      setUsarHorarioClinica(editData.usarHorarioClinica || false);
      setIntervaloSpam(editData.intervaloSpam);
      setNumeroEnvio(editData.numeroEnvio);
    } else if (open && !editData) {
      setStep(1);
      setPublico("todos");
      setMensagem("");
      setTemplateSelecionado(null);
      setNomeDisparo("");
      setTipo("recorrente");
      setDiasSemana(["SEG", "QUA", "SEX"]);
      setHorarioInicio("08:00");
      setHorarioFim("18:00");
      setDataInicio("");
      setDataFim("");
      setCampanhaPerpetua(false);
      setUsarHorarioClinica(false);
      setIntervaloSpam(7);
      setNumeroEnvio(connectedInstances[0]?.instanceName || "");
    }
  }, [open, editData]);

  // A contagem real de contatos só é conhecida no envio (o servidor grava em contatos_alcancaveis).
  // Antes havia números fixos (255/156/89/12) que também limitavam o envio via capacidade diária.
  const contatosAlcancaveis = editData?.contatosAlcancaveis ?? 0;
  const capacidadeDiaria = 232;

  const hoje = new Date().toISOString().slice(0, 10);
  const stepErrors: Record<number, string[]> = {
    1: [
      ...(!numeroEnvio ? ["Escolha o número de WhatsApp que vai enviar."] : []),
      ...(!Number.isFinite(intervaloSpam) || intervaloSpam < 1 || intervaloSpam > 30 ? ["O intervalo entre campanhas deve ser de 1 a 30 dias."] : []),
    ],
    2: [
      ...(!mensagem.trim() ? ["Escreva a mensagem do disparo."] : []),
    ],
    3: tipo === "recorrente"
      ? [
          ...(diasSemana.length === 0 ? ["Escolha pelo menos um dia da semana."] : []),
          ...(!usarHorarioClinica && horarioFim <= horarioInicio ? ["O horário de término deve ser depois do início."] : []),
          ...(!campanhaPerpetua && dataInicio && dataFim && dataFim < dataInicio ? ["A data de término deve ser depois da data de início."] : []),
        ]
      : [
          ...(!dataInicio ? ["Escolha a data do envio."] : dataInicio < hoje ? ["A data do envio já passou."] : []),
          ...(horarioFim <= horarioInicio ? ["O horário de término deve ser depois do início."] : []),
        ],
    4: [],
  };
  const firstInvalidStep = [1, 2, 3].find((n) => stepErrors[n].length > 0);
  const currentErrors = step === 4 && firstInvalidStep ? stepErrors[firstInvalidStep] : stepErrors[step] ?? [];

  if (!open) return null;

  const selectTemplate = (tpl: DisparoTemplate) => {
    setTemplateSelecionado(tpl.id);
    setMensagem(tpl.mensagem);
    if (!nomeDisparo) setNomeDisparo(tpl.nome);
  };

  const toggleDia = (dia: string) => {
    setDiasSemana((prev) =>
      prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]
    );
  };

  const insertVariable = (v: string) => {
    setMensagem((prev) => prev + `{{${v}}}`);
  };

  const handleSave = async () => {
    if (saving || firstInvalidStep) return;
    const tpl = templatesProntos.find((t) => t.id === templateSelecionado) || {
      id: "custom",
      nome: nomeDisparo,
      mensagem,
      variaveis: (mensagem.match(/\{\{(\w+)\}\}/g) || []).map((m) => m.replace(/[{}]/g, "")),
    };
    const payload = ({
      nome: nomeDisparo || "Novo Disparo",
      template: tpl,
      tipo,
      diasSemana: tipo === "recorrente" ? diasSemana : undefined,
      horarioInicio,
      horarioFim,
      dataInicio: dataInicio || undefined,
      dataFim: dataFim || undefined,
      campanhaPerpetua: tipo === "recorrente" ? campanhaPerpetua : false,
      usarHorarioClinica,
      publico,
      contatosAlcancaveis,
      capacidadeDiaria,
      intervaloSpam,
      numeroEnvio,
      ativo: isEditing ? (editData?.ativo ?? false) : false,
    });
    setSaving(true);
    const ok = await onSave(payload);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-[900px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {isEditing ? "Editar disparo" : "Novo disparo programado"}
          </h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-1 px-3 sm:px-6 py-3 border-b border-border">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1">
              <button
                onClick={() => s.id < step && setStep(s.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  step === s.id
                    ? "bg-primary text-primary-foreground"
                    : step > s.id
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step > s.id ? <Check className="h-3 w-3" /> : <s.icon className="h-3 w-3" />}
                <span className={step === s.id ? "" : "sr-only sm:not-sr-only"}>{s.label}</span>
              </button>
              {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              {step === 1 && <StepPublico publico={publico} setPublico={setPublico} contatosAlcancaveis={contatosAlcancaveis} intervaloSpam={intervaloSpam} setIntervaloSpam={setIntervaloSpam} numeroEnvio={numeroEnvio} setNumeroEnvio={setNumeroEnvio} />}
              {step === 2 && <StepConteudo mensagem={mensagem} setMensagem={setMensagem} templateSelecionado={templateSelecionado} selectTemplate={selectTemplate} insertVariable={insertVariable} nomeDisparo={nomeDisparo} setNomeDisparo={setNomeDisparo} />}
              {step === 3 && <StepAgendamento tipo={tipo} setTipo={setTipo} diasSemana={diasSemana} toggleDia={toggleDia} horarioInicio={horarioInicio} setHorarioInicio={setHorarioInicio} horarioFim={horarioFim} setHorarioFim={setHorarioFim} dataInicio={dataInicio} setDataInicio={setDataInicio} dataFim={dataFim} setDataFim={setDataFim} campanhaPerpetua={campanhaPerpetua} setCampanhaPerpetua={setCampanhaPerpetua} usarHorarioClinica={usarHorarioClinica} setUsarHorarioClinica={setUsarHorarioClinica} capacidadeDiaria={capacidadeDiaria} />}
              {step === 4 && <StepRevisao nomeDisparo={nomeDisparo} publico={publico} tipo={tipo} diasSemana={diasSemana} horarioInicio={horarioInicio} horarioFim={horarioFim} dataInicio={dataInicio} dataFim={dataFim} campanhaPerpetua={campanhaPerpetua} contatosAlcancaveis={contatosAlcancaveis} intervaloSpam={intervaloSpam} mensagem={mensagem} numeroEnvio={numeroEnvio} />}
            </div>
            <div className="w-[280px] shrink-0 hidden lg:block">
              <WhatsAppPreview mensagem={mensagem} />
            </div>
          </div>
        </div>

        {currentErrors.length > 0 && (
          <div role="alert" className="mx-4 sm:mx-6 mb-0 mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive space-y-0.5">
            {currentErrors.map((e) => <p key={e}>{e}</p>)}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-border">
          <button
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            {step > 1 ? "Voltar" : "Cancelar"}
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={currentErrors.length > 0}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Próximo
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving || !!firstInvalidStep}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {saving ? "Salvando..." : isEditing ? "Salvar alterações" : "Criar disparo"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== STEP 1: PÚBLICO ===== */
function StepPublico({
  publico, setPublico, contatosAlcancaveis, intervaloSpam, setIntervaloSpam, numeroEnvio, setNumeroEnvio,
}: {
  publico: string;
  setPublico: (v: any) => void;
  contatosAlcancaveis: number;
  intervaloSpam: number;
  setIntervaloSpam: (v: number) => void;
  numeroEnvio: string;
  setNumeroEnvio: (v: string) => void;
}) {
  const { instances: allInstances } = useWhatsAppInstances();
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Selecione o público-alvo</h3>
        <p className="text-xs text-muted-foreground">Escolha para quem as mensagens serão enviadas</p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {publicoOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setPublico(opt.id)}
            className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
              publico === opt.id
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              publico === opt.id ? "border-primary bg-primary" : "border-muted-foreground/40"
            }`}>
              {publico === opt.id && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs">
        <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          {contatosAlcancaveis > 0
            ? <>No último envio, <strong>{contatosAlcancaveis}</strong> contatos se encaixaram neste público.</>
            : "O número exato de contatos é calculado na hora do envio, com a base atual da clínica."}
        </span>
      </div>

      {/* Spam control */}
      <div className="bg-muted/50 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <h4 className="text-sm font-medium text-foreground">Controle de Spam</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Defina um intervalo (de 1 a 30 dias) entre campanhas para o mesmo cliente. Isso evita incômodo, protege seu número e aumenta o impacto das mensagens.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={30}
            value={intervaloSpam}
            onChange={(e) => setIntervaloSpam(Number(e.target.value))}
            className="w-16 h-8 rounded-lg border border-border bg-background px-2 text-sm text-center text-foreground"
          />
          <span className="text-xs text-muted-foreground">dias de intervalo</span>
        </div>
      </div>

      {/* Número de envio */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium text-foreground">Número de envio</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Selecione qual número WhatsApp será usado para este disparo</p>
        <div className="grid grid-cols-1 gap-2">
          {allInstances.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Nenhuma instância configurada. Configure em Canais.</p>
          ) : allInstances.map((inst) => {
            const isConnected = inst.connectionState === "open";
            return (
              <button
                key={inst.instanceName}
                onClick={() => isConnected && setNumeroEnvio(inst.instanceName)}
                disabled={!isConnected}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  numeroEnvio === inst.instanceName
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : !isConnected
                    ? "border-border opacity-50 cursor-not-allowed"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  numeroEnvio === inst.instanceName ? "border-primary bg-primary" : "border-muted-foreground/40"
                }`}>
                  {numeroEnvio === inst.instanceName && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{inst.instanceName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{inst.owner || inst.instanceId?.slice(0, 12) || "—"}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  isConnected
                    ? "bg-success/15 text-success"
                    : "bg-destructive/15 text-destructive"
                }`}>
                  {isConnected ? "Conectado" : "Desconectado"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ===== STEP 2: CONTEÚDO ===== */
function StepConteudo({
  mensagem, setMensagem, templateSelecionado, selectTemplate, insertVariable, nomeDisparo, setNomeDisparo,
}: {
  mensagem: string;
  setMensagem: (v: string) => void;
  templateSelecionado: string | null;
  selectTemplate: (t: DisparoTemplate) => void;
  insertVariable: (v: string) => void;
  nomeDisparo: string;
  setNomeDisparo: (v: string) => void;
}) {
  const variaveis = ["nome", "data", "horario", "dentista", "procedimento"];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Conteúdo da mensagem</h3>
        <p className="text-xs text-muted-foreground">Personalize a mensagem com dados de cada cliente</p>
      </div>

      <div>
        <label className="text-xs font-medium text-foreground mb-1 block">Nome do disparo</label>
        <input
          type="text"
          value={nomeDisparo}
          onChange={(e) => setNomeDisparo(e.target.value)}
          placeholder="Ex: Reativação Semanal"
          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-foreground mb-2 block">Templates prontos</label>
        <div className="flex flex-wrap gap-2">
          {templatesProntos.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => selectTemplate(tpl)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                templateSelecionado === tpl.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {tpl.nome}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-foreground mb-1.5 block">
          Variáveis disponíveis <span className="text-muted-foreground font-normal">(clique para inserir)</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {variaveis.map((v) => (
            <button
              key={v}
              onClick={() => insertVariable(v)}
              className="px-2 py-1 rounded-md bg-primary/10 text-primary text-[11px] font-mono hover:bg-primary/20 transition-colors"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-foreground mb-1 block">Escreva a mensagem do disparo</label>
        <textarea
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          rows={6}
          placeholder="Digite sua mensagem aqui..."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none"
        />
      </div>

      {/* Antes havia aqui uma área de "escolher mídia" sem upload de verdade: o disparo saía só com texto. */}
      <p className="text-[11px] text-muted-foreground">
        <span className="mr-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Em breve</span>
        Envio de foto ou vídeo junto com o disparo. Por enquanto o disparo envia só o texto.
      </p>
    </div>
  );
}

/* ===== STEP 3: AGENDAMENTO ===== */
function StepAgendamento({
  tipo, setTipo, diasSemana, toggleDia, horarioInicio, setHorarioInicio, horarioFim, setHorarioFim,
  dataInicio, setDataInicio, dataFim, setDataFim, campanhaPerpetua, setCampanhaPerpetua,
  usarHorarioClinica, setUsarHorarioClinica, capacidadeDiaria,
}: {
  tipo: "recorrente" | "unico";
  setTipo: (v: "recorrente" | "unico") => void;
  diasSemana: string[];
  toggleDia: (d: string) => void;
  horarioInicio: string;
  setHorarioInicio: (v: string) => void;
  horarioFim: string;
  setHorarioFim: (v: string) => void;
  dataInicio: string;
  setDataInicio: (v: string) => void;
  dataFim: string;
  setDataFim: (v: string) => void;
  campanhaPerpetua: boolean;
  setCampanhaPerpetua: (v: boolean) => void;
  usarHorarioClinica: boolean;
  setUsarHorarioClinica: (v: boolean) => void;
  capacidadeDiaria: number;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Tipo de campanha</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setTipo("recorrente")}
          className={`relative p-4 rounded-xl border text-left transition-all ${
            tipo === "recorrente"
              ? "border-primary ring-1 ring-primary/20 bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
        >
          {tipo === "recorrente" && (
            <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="h-3 w-3 text-primary-foreground" />
            </div>
          )}
          <CalendarDays className="h-6 w-6 text-primary mb-2" />
          <p className="text-sm font-semibold text-foreground">Campanha recorrente</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Enviada periodicamente nos dias selecionados</p>
        </button>
        <button
          onClick={() => setTipo("unico")}
          className={`relative p-4 rounded-xl border text-left transition-all ${
            tipo === "unico"
              ? "border-primary ring-1 ring-primary/20 bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
        >
          {tipo === "unico" && (
            <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="h-3 w-3 text-primary-foreground" />
            </div>
          )}
          <Clock className="h-6 w-6 text-muted-foreground mb-2" />
          <p className="text-sm font-semibold text-foreground">Campanha de único dia</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Enviada uma única vez na data escolhida</p>
        </button>
      </div>

      {tipo === "recorrente" ? (
        <>
          <div>
            <label className="text-xs font-medium text-foreground mb-2 block">Dias de envio</label>
            <div className="flex gap-1.5">
              {diasSemanaOptions.map((d) => (
                <button
                  key={d.id}
                  onClick={() => toggleDia(d.id)}
                  className={`w-10 h-9 rounded-lg text-xs font-medium transition-colors ${
                    diasSemana.includes(d.id)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setUsarHorarioClinica(!usarHorarioClinica)}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
                usarHorarioClinica ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            >
              <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                usarHorarioClinica ? "translate-x-5" : "translate-x-0.5"
              }`} />
            </div>
            <span className="text-xs text-foreground">Usar horários de funcionamento da clínica</span>
          </label>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Capacidade média por dia: <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-bold">~{capacidadeDiaria} mensagens</span>
          </div>

          {!usarHorarioClinica && (
            <div>
              <label className="text-xs font-medium text-foreground mb-2 block">Horários de envio</label>
              {diasSemana.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground w-full sm:w-20">
                      {diasSemana.length === 7 ? "Todos os dias" : diasSemana.join(", ")}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">Início</span>
                      <input type="time" value={horarioInicio} onChange={(e) => setHorarioInicio(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">Término</span>
                      <input type="time" value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs font-medium text-foreground">Até quando a campanha será enviada?</p>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setCampanhaPerpetua(!campanhaPerpetua)}
                className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
                  campanhaPerpetua ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              >
                <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                  campanhaPerpetua ? "translate-x-5" : "translate-x-0.5"
                }`} />
              </div>
              <span className="text-xs text-foreground">Campanha perpétua (sem data de término)</span>
            </label>

            {!campanhaPerpetua && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Data de início</label>
                  <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Data de término</label>
                  <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground mb-2 block">Data e período de envio</label>
            <div className="space-y-3">
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
              <div className="flex items-center gap-2">
                <input type="time" value={horarioInicio} onChange={(e) => setHorarioInicio(e.target.value)} className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
                <span className="text-xs text-muted-foreground">até</span>
                <input type="time" value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)} className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-xs text-foreground" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Capacidade média: <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-bold">~{capacidadeDiaria} mensagens</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== STEP 4: REVISÃO ===== */
function StepRevisao({
  nomeDisparo, publico, tipo, diasSemana, horarioInicio, horarioFim, dataInicio, dataFim,
  campanhaPerpetua, contatosAlcancaveis, intervaloSpam, mensagem, numeroEnvio,
}: {
  nomeDisparo: string;
  publico: string;
  tipo: string;
  diasSemana: string[];
  horarioInicio: string;
  horarioFim: string;
  dataInicio: string;
  dataFim: string;
  campanhaPerpetua: boolean;
  contatosAlcancaveis: number;
  intervaloSpam: number;
  mensagem: string;
  numeroEnvio: string;
}) {
  const publicoLabel = publicoOptions.find((p) => p.id === publico)?.label || publico;
  const numeroLabel = numeroEnvio || "Não selecionado";

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Revisão do disparo</h3>
        <p className="text-xs text-muted-foreground">Confirme os detalhes antes de criar</p>
      </div>

      <div className="bg-muted/50 rounded-xl p-4 space-y-3">
        <ReviewRow label="Nome" value={nomeDisparo || "Sem nome"} />
        <ReviewRow label="Público" value={publicoLabel} />
        <ReviewRow label="Contatos" value={contatosAlcancaveis > 0 ? `${contatosAlcancaveis} no último envio` : "calculado no envio"} />
        <ReviewRow label="Tipo" value={tipo === "recorrente" ? "Campanha Recorrente" : "Campanha Única"} />
        {tipo === "recorrente" && <ReviewRow label="Dias" value={diasSemana.join(", ") || "Nenhum"} />}
        <ReviewRow label="Horário" value={`${horarioInicio} — ${horarioFim}`} />
        {tipo === "recorrente" && <ReviewRow label="Período" value={campanhaPerpetua ? "Perpétua" : `${dataInicio || "?"} a ${dataFim || "?"}`} />}
        {tipo === "unico" && dataInicio && <ReviewRow label="Data" value={dataInicio} />}
        <ReviewRow label="Intervalo anti-spam" value={`${intervaloSpam} dias`} />
        <ReviewRow label="Número de envio" value={numeroLabel || "Não selecionado"} />
      </div>

      <div className="bg-muted/50 rounded-xl p-4">
        <p className="text-xs font-medium text-foreground mb-2">Mensagem:</p>
        <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{mensagem || "Nenhuma mensagem definida"}</p>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 text-warning text-xs">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        O disparo será criado como <strong>inativo</strong>. Ative-o na lista quando estiver pronto.
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground text-right break-words min-w-0">{value}</span>
    </div>
  );
}
