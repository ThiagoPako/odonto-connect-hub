import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { aiApi, type AprovacaoRelatorioApi, type ClinicalReportApi } from "@/lib/vpsApi";

// Rótulos da auditoria jurídica de IA (docs/juridico/auditoria-ia.md, R-1, R-1b, R-1c, R-2 e R-5).

export function nomeDentista(nome?: string | null): string {
  const n = String(nome || "").trim();
  if (!n) return "Dr(a).";
  return /^dr(a)?\.?\s/i.test(n) ? n : `Dr(a). ${n}`;
}

function dataHora(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

type StatusRelatorio = Pick<ClinicalReportApi, "status" | "aprovado_por_nome" | "aprovado_em" | "origem_ia_sem_revisao">;

export function relatorioAprovado(r: StatusRelatorio): boolean {
  return r.status === "aprovado";
}

/** Faixa de status do relatório: rascunho (R-1), antigo sem revisão ou aprovado (R-2). */
export function RotuloRelatorioIA({ report, compacto = false }: { report: StatusRelatorio; compacto?: boolean }) {
  if (relatorioAprovado(report)) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            Aprovado por {nomeDentista(report.aprovado_por_nome)} em {dataHora(report.aprovado_em)}
          </p>
          {!compacto && <p className="text-success/80">Relatório elaborado com apoio de IA, revisado e aprovado pelo dentista.</p>}
        </div>
      </div>
    );
  }
  const antigo = !!report.origem_ia_sem_revisao;
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <div>
        <p className="font-semibold">
          {antigo
            ? "Gerado por IA antes da revisão obrigatória — ainda não revisado por um dentista"
            : "Rascunho gerado por IA — revise antes de aprovar"}
        </p>
        {!compacto && (
          <p className="text-muted-foreground">
            A IA pode errar ou incluir algo que não foi dito. Só o texto que você aprovar entra no prontuário.
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

/** Edição do rascunho e botão "Revisei e aprovo o relatório" (R-1b). */
export function AprovarRelatorioIA({
  reportId, textoInicial, onAprovado,
}: {
  reportId: string;
  textoInicial: string;
  onAprovado: (aprovacao: AprovacaoRelatorioApi, textoAprovado: string) => void;
}) {
  const [texto, setTexto] = useState(textoInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
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
      <button
        type="button"
        onClick={aprovar}
        disabled={salvando || !texto.trim()}
        className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
      >
        {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        Revisei e aprovo o relatório
      </button>
    </div>
  );
}
