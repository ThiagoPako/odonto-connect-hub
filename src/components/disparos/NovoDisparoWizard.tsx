import { useState, useEffect } from "react";
import {
  X, ChevronRight, ChevronLeft, Users, FileText, CalendarDays, Eye,
  Check, Upload, Clock, AlertTriangle, Send, Phone,
} from "lucide-react";
import {
  diasSemanaOptions, publicoOptions, templatesProntos, numerosDisponiveis,
  type DisparoTemplate, type DisparoProgramado,
} from "@/data/disparosMockData";
import { WhatsAppPreview } from "./WhatsAppPreview";

interface NovoDisparoWizardProps {
  open: boolean;
  onClose: () => void;
  onSave: (disparo: Omit<DisparoProgramado, "id" | "stats" | "criadoEm">) => void;
  editData?: DisparoProgramado | null;
}

const steps = [
  { id: 1, label: "Público", icon: Users },
  { id: 2, label: "Conteúdo", icon: FileText },
  { id: 3, label: "Agendamento", icon: CalendarDays },
  { id: 4, label: "Revisão", icon: Eye },
];

export function NovoDisparoWizard({ open, onClose, onSave, editData }: NovoDisparoWizardProps) {
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
  const [numeroEnvio, setNumeroEnvio] = useState(numerosDisponiveis.find(n => n.status === "conectado")?.id || "n1");

  const isEditing = !!editData;

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
    }
  }, [open, editData]);

  const contatosAlcancaveis = publico === "todos" ? 255 : publico === "ativos" ? 156 : publico === "inativos" ? 89 : publico === "aniversariantes" ? 12 : 0;
  const capacidadeDiaria = Math.min(232, contatosAlcancaveis);

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

  const handleSave = () => {
    const tpl = templatesProntos.find((t) => t.id === templateSelecionado) || {
      id: "custom",
      nome: nomeDisparo,
      mensagem,
      variaveis: (mensagem.match(/\{\{(\w+)\}\}/g) || []).map((m) => m.replace(/[{}]/g, "")),
    };
    onSave({
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
      ativo: isEditing ? (editData?.ativo ?? false) : false,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-[900px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {isEditing ? "Editar disparo" : "Novo disparo programado"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-1 px-6 py-3 border-b border-border">
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
                {s.label}
              </button>
              {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              {step === 1 && <StepPublico publico={publico} setPublico={setPublico} contatosAlcancaveis={contatosAlcancaveis} intervaloSpam={intervaloSpam} setIntervaloSpam={setIntervaloSpam} />}
              {step === 2 && <StepConteudo mensagem={mensagem} setMensagem={setMensagem} templateSelecionado={templateSelecionado} selectTemplate={selectTemplate} insertVariable={insertVariable} nomeDisparo={nomeDisparo} setNomeDisparo={setNomeDisparo} />}
              {step === 3 && <StepAgendamento tipo={tipo} setTipo={setTipo} diasSemana={diasSemana} toggleDia={toggleDia} horarioInicio={horarioInicio} setHorarioInicio={setHorarioInicio} horarioFim={horarioFim} setHorarioFim={setHorarioFim} dataInicio={dataInicio} setDataInicio={setDataInicio} dataFim={dataFim} setDataFim={setDataFim} campanhaPerpetua={campanhaPerpetua} setCampanhaPerpetua={setCampanhaPerpetua} usarHorarioClinica={usarHorarioClinica} setUsarHorarioClinica={setUsarHorarioClinica} capacidadeDiaria={capacidadeDiaria} />}
              {step === 4 && <StepRevisao nomeDisparo={nomeDisparo} publico={publico} tipo={tipo} diasSemana={diasSemana} horarioInicio={horarioInicio} horarioFim={horarioFim} dataInicio={dataInicio} dataFim={dataFim} campanhaPerpetua={campanhaPerpetua} contatosAlcancaveis={contatosAlcancaveis} intervaloSpam={intervaloSpam} mensagem={mensagem} />}
            </div>
            <div className="w-[280px] shrink-0 hidden lg:block">
              <WhatsAppPreview mensagem={mensagem} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
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
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Próximo
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Send className="h-4 w-4" />
              {isEditing ? "Salvar Alterações" : "Criar Disparo"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== STEP 1: PÚBLICO ===== */
function StepPublico({
  publico, setPublico, contatosAlcancaveis, intervaloSpam, setIntervaloSpam,
}: {
  publico: string;
  setPublico: (v: any) => void;
  contatosAlcancaveis: number;
  intervaloSpam: number;
  setIntervaloSpam: (v: number) => void;
}) {
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

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-medium">
        <Users className="h-3.5 w-3.5" />
        Contatos Alcançáveis: <span className="font-bold">{contatosAlcancaveis}</span>
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

      <div>
        <label className="text-xs font-medium text-foreground mb-1 block">Selecione uma mídia para o disparo</label>
        <div className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center text-center hover:border-primary/40 transition-colors cursor-pointer">
          <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-xs font-medium text-muted-foreground">Escolher arquivo de mídia</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            Arraste uma foto ou vídeo aqui ou clique para selecionar
          </p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            Tamanho máximo: 100 MB · JPG, JPEG, PNG, MP4, WEBP
          </p>
        </div>
      </div>
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-20">
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
  campanhaPerpetua, contatosAlcancaveis, intervaloSpam, mensagem,
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
}) {
  const publicoLabel = publicoOptions.find((p) => p.id === publico)?.label || publico;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Revisão do disparo</h3>
        <p className="text-xs text-muted-foreground">Confirme os detalhes antes de criar</p>
      </div>

      <div className="bg-muted/50 rounded-xl p-4 space-y-3">
        <ReviewRow label="Nome" value={nomeDisparo || "Sem nome"} />
        <ReviewRow label="Público" value={publicoLabel} />
        <ReviewRow label="Contatos" value={`${contatosAlcancaveis} alcançáveis`} />
        <ReviewRow label="Tipo" value={tipo === "recorrente" ? "Campanha Recorrente" : "Campanha Única"} />
        {tipo === "recorrente" && <ReviewRow label="Dias" value={diasSemana.join(", ") || "Nenhum"} />}
        <ReviewRow label="Horário" value={`${horarioInicio} — ${horarioFim}`} />
        {tipo === "recorrente" && <ReviewRow label="Período" value={campanhaPerpetua ? "Perpétua" : `${dataInicio || "?"} a ${dataFim || "?"}`} />}
        {tipo === "unico" && dataInicio && <ReviewRow label="Data" value={dataInicio} />}
        <ReviewRow label="Intervalo anti-spam" value={`${intervaloSpam} dias`} />
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
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}
