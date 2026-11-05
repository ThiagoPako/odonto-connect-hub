import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { contasReceberApi, type ContaReceber } from "@/lib/vpsApi";
import { addMesesIso, dividirEmParcelasCentavos, formatBRL, hojeIso, isoParaBR, reaisParaCentavos } from "@/lib/parcelas";

interface Props {
  orcamentoId: string;
  total: number; // valor final do orçamento (já com desconto)
}

// Botão "Gerar parcelas" do orçamento aprovado: mostra as parcelas já geradas ou abre o formulário.
export function GerarParcelasButton({ orcamentoId, total }: Props) {
  const [existentes, setExistentes] = useState<ContaReceber[] | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [n, setN] = useState(1);
  const [primeiro, setPrimeiro] = useState(() => addMesesIso(hojeIso(), 1));
  const [entrada, setEntrada] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await contasReceberApi.parcelasDoOrcamento(orcamentoId);
    if (error) { setErroCarga(error); return; }
    setErroCarga(null);
    setExistentes((data || []).filter((p) => p.status !== "cancelado"));
  }, [orcamentoId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const entradaNum = entrada.trim() ? Number(entrada.replace(",", ".")) : 0;
  const totalC = reaisParaCentavos(total);
  const entradaC = Number.isFinite(entradaNum) ? reaisParaCentavos(entradaNum) : NaN;
  const invalido =
    !Number.isInteger(n) || n < 1 || n > 48 || !primeiro || !Number.isFinite(entradaC) || entradaC < 0 || entradaC >= totalC;

  const previa = useMemo(() => {
    if (invalido) return [];
    const linhas = dividirEmParcelasCentavos(totalC - entradaC, n).map((c, i) => ({
      rotulo: `${i + 1}/${n}`, valor: c / 100, vencimento: addMesesIso(primeiro, i),
    }));
    return entradaC > 0 ? [{ rotulo: "Entrada", valor: entradaC / 100, vencimento: hojeIso() }, ...linhas] : linhas;
  }, [invalido, totalC, entradaC, n, primeiro]);

  const gerar = async () => {
    setErro(null);
    setSalvando(true);
    const { error } = await contasReceberApi.gerarParcelas(orcamentoId, {
      parcelas: n, primeiro_vencimento: primeiro, ...(entradaC > 0 ? { entrada: entradaC / 100 } : {}),
    });
    setSalvando(false);
    if (error) { setErro(error); return; }
    toast.success("Parcelas geradas em Contas a receber");
    setAberto(false);
    void carregar();
  };

  if (erroCarga) return <p className="mt-3 text-xs text-destructive" role="alert">Parcelas: {erroCarga}</p>;
  if (existentes === null) return null;

  if (existentes.length > 0) {
    return (
      <div className="mt-3 rounded-lg border border-border p-3 text-xs space-y-1">
        <p className="font-medium text-foreground">Parcelas geradas</p>
        {existentes.map((p) => (
          <div key={p.id} className="flex justify-between text-muted-foreground">
            <span>{p.parcela_atual === 0 ? "Entrada" : `${p.parcela_atual}/${p.parcelas}`} · {isoParaBR(p.vencimento)}</span>
            <span>{formatBRL(p.valor)} · {p.status === "pago" ? "pago" : "em aberto"}</span>
          </div>
        ))}
        <Link to="/financeiro/receber" className="inline-block pt-1 text-primary hover:underline">Ver em Contas a receber</Link>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setAberto(true)}>
        <CalendarClock className="h-4 w-4 mr-1" /> Gerar parcelas
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gerar parcelas</DialogTitle>
            <DialogDescription>Total do orçamento: {formatBRL(total)}. As parcelas entram em Contas a receber.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="gp-n">Parcelas</Label>
              <Input id="gp-n" type="number" min={1} max={48} value={n} onChange={(e) => setN(parseInt(e.target.value, 10) || 0)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gp-venc">1º vencimento</Label>
              <Input id="gp-venc" type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gp-entrada">Entrada (R$)</Label>
              <Input id="gp-entrada" inputMode="decimal" placeholder="0,00" value={entrada} onChange={(e) => setEntrada(e.target.value)} />
            </div>
          </div>
          {invalido ? (
            <p className="text-xs text-destructive" role="alert">
              Confira: 1 a 48 parcelas, data de vencimento e entrada menor que o total.
            </p>
          ) : (
            <div className="max-h-48 overflow-auto rounded-md border border-border text-xs">
              {previa.map((l) => (
                <div key={l.rotulo} className="flex justify-between px-3 py-1.5 border-b border-border last:border-0">
                  <span>{l.rotulo} · {isoParaBR(l.vencimento)}</span>
                  <span className="tabular-nums">{formatBRL(l.valor)}</span>
                </div>
              ))}
            </div>
          )}
          {erro && <p className="text-xs text-destructive" role="alert">{erro}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={gerar} disabled={invalido || salvando}>
              {salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Gerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
