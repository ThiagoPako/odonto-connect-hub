import { useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { aiApi, type AprovacaoRelatorioApi, type ClinicalReportApi, type NaoAprovacaoRelatorioApi } from "@/lib/vpsApi";

// Rótulos da auditoria jurídica de IA (docs/juridico/auditoria-ia.md, R-1, R-1b, R-1c, R-2 e R-5)
// e do parecer do PR #79 (docs/juridico/parecer-pr76-pr79.md): só o dentista aprova, com CRO;
// rascunhos antigos e não aprovados ficam fora do histórico clínico oficial.

export function nomeDentista(nome?: string | null, cro?: string | null): string {
  const n = String(nome || "").trim();
  const base = !n ? "Dr(a)." : /^dr(a)?\.?\s/i.test(n) ? n : `Dr(a). ${n}`;
  return cro ? `${base} (CRO ${cro})` : base;
}

function dataHora(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

type StatusRelatorio = Pick<ClinicalReportApi,
  "status" | "aprovado_por_nome" | "aprovado_por_cro" | "aprovado_por_outro_dentista" | "aprovado_em" |
  "origem_ia_sem_revisao" | "revisar_ate" | "nao_aprovado_por_nome" | "nao_aprovado_por_cro" | "nao_aprovado_em" | "nao_aprovado_motivo">;

export function relatorioAprovado(r: Pick<ClinicalReportApi, "status">): boolean {
  return r.status === "aprovado";
}

/** Faixa de status: rascunho (R-1), rascunho antigo, não aprovado ou aprovado (R-2, com CRO). */
export function RotuloRelatorioIA({ report, compacto = false }: { report: Partial<StatusRelatorio>; compacto?: boolean }) {
  if (report.status === "aprovado") {
    const quem = nomeDentista(report.aprovado_por_nome, report.aprovado_por_cro);
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            {report.aprovado_por_outro_dentista
              ? `Revisado e aprovado por ${quem}, que não realizou o atendimento, em ${dataHora(report.aprovado_em)}`
              : `Aprovado por ${quem} em ${dataHora(report.aprovado_em)}`}
          </p>
          {!compacto && <p className="text-success/80">Relatório elaborado com apoio de IA, revisado e aprovado pelo dentista.</p>}
        </div>
      </div>
    );
  }
  if (report.status === "nao_aprovado") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
        <Ban className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            Não aprovado por {nomeDentista(report.nao_aprovado_por_nome, report.nao_aprovado_por_cro)} em {dataHora(report.nao_aprovado_em)}
          </p>
          <p className="text-muted-foreground">
            Guardado só para auditoria. Não é registro do dentista e não entra no prontuário, na impressão nem em exportações.
            {report.nao_aprovado_motivo ? ` Motivo: ${report.nao_aprovado_motivo}` : ""}
          </p>
        </div>
      </div>
    );
  }
  const antigo = !!report.origem_ia_sem_revisao;
  const prazo = report.revisar_ate ? new Date(report.revisar_ate) : null;
  const vencido = !!prazo && prazo.getTime() < Date.now();
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="font-semibold">
          {antigo
            ? "Rascunho antigo de IA, gerado sem revisão — não é registro do dentista"
            : "Rascunho gerado por IA — revise antes de aprovar"}
        </p>
        {!compacto && (
          <p className="text-muted-foreground">
            A IA pode errar ou incluir algo que não foi dito. Só o texto que o dentista do atendimento aprovar entra no prontuário.
          </p>
        )}
        {prazo && (
          <p className={vencido ? "text-destructive font-medium flex items-center gap-1" : "text-muted-foreground flex items-center gap-1"}>
            <Clock className="h-3 w-3" aria-hidden="true" />
            {vencido
              ? `Prazo de revisão vencido em ${prazo.toLocaleDateString("pt-BR")}`
              : `Revisar até ${prazo.toLocaleDateString("pt-BR")}`}
          </p>
        )}
      </div>
    </div>
  );
}

/** Rodapé fixo das telas de IA clínica (R-5). */
export function AvisoDecisaoClinica() {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
      A IA apoia, e a decisão clínica é sempre do cirurgião-dentista.
    </p>
  );
}

/** Edição do rascunho, "Revisei e aprovo o relatório" (R-1b) e "Não aprovar". O servidor só aceita o dentista do atendimento. */
export function AprovarRelatorioIA({
  reportId, textoInicial, onAprovado, onNaoAprovado,
}: {
  reportId: string;
  textoInicial: string;
  onAprovado: (aprovacao: AprovacaoRelatorioApi, textoAprovado: string) => void;
  onNaoAprovado?: (decisao: NaoAprovacaoRelatorioApi) => void;
}) {
  const [texto, setTexto] = useState(textoInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoRecusa, setConfirmandoRecusa] = useState(false);
  const [motivo, setMotivo] = useState("");
  const campoId = `relatorio-${reportId}`;

  const aprovar = async () => {
    const final = texto.trim();
    if (!final) { setErro("O relatório não pode ficar vazio."); return; }
    setSalvando(true);
    setErro(null);
    const { data, error } = await aiApi.approveReport(reportId, final);
    setSalvando(false);
    if (error || !data) {
      setErro(error || "Não foi possível aprovar o relatório.");
      toast.error(error || "Não foi possível aprovar o relatório.");
      return;
    }
    toast.success(`Relatório aprovado por ${nomeDentista(data.aprovado_por_nome)} e salvo no prontuário.`);
    onAprovado(data, final);
  };

  const naoAprovar = async () => {
    setSalvando(true);
    setErro(null);
    const { data, error } = await aiApi.rejectReport(reportId, motivo.trim() || undefined);
    setSalvando(false);
    if (error || !data) {
      setErro(error || "Não foi possível registrar a decisão.");
      toast.error(error || "Não foi possível registrar a decisão.");
      return;
    }
    toast.success("Rascunho marcado como não aprovado. Ele fica guardado só para auditoria.");
    setConfirmandoRecusa(false);
    onNaoAprovado?.(data);
  };

  return (
    <div className="space-y-2">
      <label htmlFor={campoId} className="text-xs font-semibold text-foreground">
        Texto do relatório (edite o que for preciso antes de aprovar)
      </label>
      <Textarea
        id={campoId}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={14}
        className="text-xs font-mono leading-relaxed"
        disabled={salvando}
      />
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={aprovar}
          disabled={salvando || !texto.trim()}
          className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
        >
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Revisei e aprovo o relatório
        </button>
        {onNaoAprovado && !confirmandoRecusa && (
          <button
            type="button"
            onClick={() => setConfirmandoRecusa(true)}
            disabled={salvando}
            className="h-9 px-4 rounded-lg border border-border text-foreground text-xs font-medium hover:bg-muted transition-colors inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Ban className="h-3.5 w-3.5" /> Não aprovar
          </button>
        )}
      </div>
      {onNaoAprovado && confirmandoRecusa && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <label htmlFor={`${campoId}-motivo`} className="text-xs font-semibold text-foreground">
            Motivo (opcional)
          </label>
          <Textarea
            id={`${campoId}-motivo`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={500}
            className="text-xs"
            disabled={salvando}
          />
          <p className="text-[11px] text-muted-foreground">
            O texto fica guardado só para auditoria e sai da lista de pendentes. Não entra no prontuário.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={naoAprovar}
              disabled={salvando}
              className="h-8 px-4 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              Confirmar: não aprovar
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoRecusa(false)}
              disabled={salvando}
              className="h-8 px-4 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
            >
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
