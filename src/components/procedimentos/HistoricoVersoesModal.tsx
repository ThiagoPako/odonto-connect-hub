/**
 * HistoricoVersoesModal — timeline de versões de um procedimento.
 * Cada alteração de preço, requisitos ou nome cria uma versão imutável
 * que orçamentos antigos continuam referenciando.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, History, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { procedimentosCatalogoApi, type ProcedimentoVersao } from "@/lib/vpsApi";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  procedimentoId: string | null;
  procedimentoNome?: string;
}

const fmt = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function deltaPreco(atual: number, anterior: number | undefined) {
  if (anterior === undefined) return null;
  const diff = Number(atual) - Number(anterior);
  if (Math.abs(diff) < 0.005) return { tipo: "igual" as const, diff: 0 };
  return { tipo: diff > 0 ? ("alta" as const) : ("queda" as const), diff };
}

export function HistoricoVersoesModal({ open, onOpenChange, procedimentoId, procedimentoNome }: Props) {
  const [versoes, setVersoes] = useState<ProcedimentoVersao[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !procedimentoId) return;
    setLoading(true);
    procedimentosCatalogoApi.versoes(procedimentoId).then((res) => {
      const data = ((res as any).data || res || []) as ProcedimentoVersao[];
      setVersoes(Array.isArray(data) ? data : []);
    }).finally(() => setLoading(false));
  }, [open, procedimentoId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Histórico de versões
            {procedimentoNome && <span className="text-muted-foreground font-normal">— {procedimentoNome}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : versoes.length === 0 ? (
            <p className="text-xs text-center text-muted-foreground py-12">Nenhum histórico registrado.</p>
          ) : (
            <ol className="relative border-l-2 border-border ml-3 space-y-4 py-2">
              {versoes.map((v, idx) => {
                const anterior = versoes[idx + 1]; // próximo no array é mais antigo
                const dPart = deltaPreco(v.valor_particular, anterior?.valor_particular);
                const vigente = !v.valido_ate;
                return (
                  <li key={v.id} className="ml-5 relative">
                    <span
                      className={`absolute -left-[27px] top-1 w-4 h-4 rounded-full border-2 ${
                        vigente
                          ? "bg-primary border-primary ring-4 ring-primary/20"
                          : "bg-background border-border"
                      }`}
                    />
                    <div className="bg-card border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground">v{v.versao}</span>
                          {vigente && (
                            <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-semibold uppercase">
                              vigente
                            </span>
                          )}
                          {v.motivo && (
                            <span className="text-[11px] text-muted-foreground italic">— {v.motivo}</span>
                          )}
                        </div>
                        <span className="text-[10.5px] text-muted-foreground">{fmtData(v.valido_desde)}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
                        <div>
                          <p className="text-muted-foreground">Nome</p>
                          <p className="font-medium text-foreground">{v.nome}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Categoria</p>
                          <p className="font-medium text-foreground">{v.categoria || "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Particular</p>
                          <p className="font-semibold text-foreground flex items-center gap-1">
                            {fmt(v.valor_particular)}
                            {dPart && dPart.tipo !== "igual" && (
                              <span
                                className={`inline-flex items-center gap-0.5 text-[10px] ${
                                  dPart.tipo === "alta" ? "text-destructive" : "text-success"
                                }`}
                              >
                                {dPart.tipo === "alta" ? (
                                  <TrendingUp className="h-2.5 w-2.5" />
                                ) : (
                                  <TrendingDown className="h-2.5 w-2.5" />
                                )}
                                {fmt(Math.abs(dPart.diff))}
                              </span>
                            )}
                            {dPart && dPart.tipo === "igual" && (
                              <Minus className="h-2.5 w-2.5 text-muted-foreground" />
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Convênio</p>
                          <p className="font-semibold text-foreground">{fmt(v.valor_convenio)}</p>
                        </div>
                        <div className="col-span-2 flex gap-2 pt-1">
                          {v.requer_dente && (
                            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">
                              Requer dente
                            </span>
                          )}
                          {v.requer_face && (
                            <span className="px-1.5 py-0.5 rounded bg-accent/30 text-accent-foreground text-[10px]">
                              Requer face
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                            {v.duracao_minutos} min
                          </span>
                        </div>
                      </div>

                      {!vigente && (
                        <p className="mt-2 text-[10px] text-muted-foreground border-t border-border pt-1.5">
                          Vigente até {fmtData(v.valido_ate!)}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground border-t border-border pt-2 mt-2">
          Orçamentos criados antes de uma alteração mantêm referência à versão vigente naquela data,
          preservando preço e requisitos históricos.
        </p>
      </DialogContent>
    </Dialog>
  );
}
