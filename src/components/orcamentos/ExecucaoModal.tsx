/**
 * Modal de Execução — Fase C
 * Lista os itens de um orçamento aprovado, marca cada um como "executado"
 * e (opcional) coleta assinatura eletrônica do paciente com geolocalização.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, FileSignature, MapPin, Lock } from "lucide-react";
import { execucoesApi, type ExecucaoRow } from "@/lib/vpsApi";
import { toast } from "sonner";
import { SignaturePad, type SignatureResult } from "@/components/SignaturePad";
import { LgpdConsent, emptyLgpdConsent, type LgpdConsentValue } from "@/components/LgpdConsent";

interface OrcamentoMin {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  dentista_id?: string | null;
  itens: any[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orcamento: OrcamentoMin | null;
  onChanged?: () => void;
}

export function ExecucaoModal({ open, onOpenChange, orcamento, onChanged }: Props) {
  const [execucoes, setExecucoes] = useState<ExecucaoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [executingItem, setExecutingItem] = useState<any | null>(null);
  const [hasSig, setHasSig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consent, setConsent] = useState<LgpdConsentValue>(emptyLgpdConsent());
  const sigRef = useRef<(() => SignatureResult | null) | null>(null);

  const load = useCallback(async () => {
    if (!orcamento) return;
    setLoading(true);
    try {
      const res = await execucoesApi.listByOrcamento(orcamento.id);
      const data = ((res as any).data || res || []) as ExecucaoRow[];
      setExecucoes(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, [orcamento]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (!open) setExecutingItem(null); }, [open]);

  if (!orcamento) return null;

  // Identifica itens já executados — match por procedimento+dente
  const executedKey = (e: { procedimento_nome: string; dente: number | null }) =>
    `${e.procedimento_nome}|${e.dente ?? ""}`;
  const executedSet = new Set(execucoes.map(executedKey));

  const itens = Array.isArray(orcamento.itens) ? orcamento.itens : [];
  const totalItens = itens.length;
  const totalExecutados = execucoes.length;

  const confirmarExecucao = async () => {
    if (!executingItem) return;
    setSaving(true);
    try {
      const sig = sigRef.current?.() ?? null;
      const res = await execucoesApi.create({
        orcamento_id: orcamento.id,
        orcamento_item_id: executingItem.id || null,
        paciente_id: orcamento.paciente_id,
        dentista_id: orcamento.dentista_id || null,
        procedimento_id: executingItem.procedimento_id || null,
        procedimento_nome: executingItem.procedimento || executingItem.procedimento_nome,
        dente: executingItem.dente || null,
        faces: executingItem.faces || [],
        valor: Number(executingItem.valor || executingItem.valor_total || 0),
        assinatura: sig
          ? { base64: sig.base64, lat: sig.lat, lng: sig.lng, accuracy: sig.accuracy, canal: 'none' }
          : null,
      });
      if ((res as any).error) throw new Error((res as any).error);
      toast.success(sig ? "Procedimento executado e assinado ✍️" : "Procedimento executado");
      setExecutingItem(null);
      setHasSig(false);
      load();
      onChanged?.();
    } catch (err: any) {
      toast.error("Erro: " + (err?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            Execução do Plano de Tratamento
            <span className="text-xs font-normal text-muted-foreground">— {orcamento.paciente_nome}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Progresso */}
        <div className="bg-muted/40 border border-border rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Progresso</span>
            <span className="font-semibold">{totalExecutados} de {totalItens} executados</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: totalItens ? `${(totalExecutados / totalItens) * 100}%` : "0%" }}
            />
          </div>
        </div>

        {executingItem ? (
          /* Tela de assinatura */
          <div className="space-y-3">
            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Confirmando execução</p>
              <p className="text-sm font-semibold mt-1">{executingItem.procedimento || executingItem.procedimento_nome}</p>
              {executingItem.dente && (
                <p className="text-xs text-muted-foreground">
                  Dente {executingItem.dente}
                  {executingItem.faces?.length ? ` · Faces ${executingItem.faces.join(",")}` : ""}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                <FileSignature className="h-3.5 w-3.5" /> Assinatura do paciente (opcional)
              </p>
              <SignaturePad signatureRef={sigRef} onChange={setHasSig} />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="ghost" size="sm" onClick={() => { setExecutingItem(null); setHasSig(false); }} className="h-9 text-xs">
                Cancelar
              </Button>
              <Button size="sm" onClick={confirmarExecucao} disabled={saving} className="h-9 text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                Confirmar execução{hasSig ? " com assinatura" : " sem assinatura"}
              </Button>
            </div>
          </div>
        ) : (
          /* Lista de itens */
          <>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : (
              <div className="space-y-2 mb-4">
                {itens.length === 0 && (
                  <p className="text-xs text-center text-muted-foreground py-6">Orçamento sem itens</p>
                )}
                {itens.map((it: any, i: number) => {
                  const key = `${it.procedimento || it.procedimento_nome}|${it.dente ?? ""}`;
                  const done = executedSet.has(key);
                  return (
                    <div key={i} className={`border rounded-lg p-3 flex items-center justify-between gap-3 transition ${done ? "border-success/30 bg-success/5" : "border-border bg-card"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {done && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
                          <span className="text-sm font-medium text-foreground truncate">{it.procedimento || it.procedimento_nome}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {it.dente ? `Dente ${it.dente}` : "Sem dente"}
                          {it.faces?.length ? ` · ${it.faces.join(",")}` : ""}
                          {it.valor || it.valor_total ? ` · R$ ${Number(it.valor || it.valor_total).toFixed(2)}` : ""}
                        </p>
                      </div>
                      {done ? (
                        <span className="text-[10px] uppercase tracking-wider text-success font-semibold">Executado</span>
                      ) : (
                        <Button size="sm" onClick={() => setExecutingItem(it)} className="h-8 text-xs">
                          Executar
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Histórico de execuções com assinatura */}
            {execucoes.length > 0 && (
              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Histórico de execuções</p>
                {execucoes.map(e => (
                  <div key={e.id} className="border border-border rounded-lg p-2.5 text-xs flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">{e.procedimento_nome}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(e.executado_em).toLocaleString("pt-BR")}
                        {e.dentista_nome && ` · ${e.dentista_nome}`}
                      </p>
                      {e.assinatura_id && (
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-success">
                          <Lock className="h-3 w-3" /> Assinado eletronicamente
                          {e.latitude && e.longitude && (
                            <a
                              href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <MapPin className="h-3 w-3" /> ver mapa
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    {e.assinatura_base64 && (
                      <img src={e.assinatura_base64} alt="Assinatura" className="h-12 border border-border rounded bg-white" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
