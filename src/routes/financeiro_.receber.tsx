import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  contasReceberApi,
  type ContaReceber,
  type ContasReceberResposta,
  type FormaRecebimento,
  type SituacaoReceber,
} from "@/lib/vpsApi";
import { formatBRL, hojeIso, isoParaBR } from "@/lib/parcelas";

// Rota fora do layout de /financeiro (sufixo "_"): a tela do Financeiro não precisa de <Outlet />.
export const Route = createFileRoute("/financeiro_/receber")({
  ssr: false,
  component: ContasReceberPage,
});

const FILTROS: { id: SituacaoReceber; label: string }[] = [
  { id: "aberto", label: "A vencer" },
  { id: "vencido", label: "Vencidas" },
  { id: "pago", label: "Pagas" },
  { id: "todos", label: "Todas" },
];

const FORMAS: { id: FormaRecebimento; label: string }[] = [
  { id: "pix", label: "Pix" },
  { id: "dinheiro", label: "Dinheiro" },
  { id: "cartao_credito", label: "Cartão de crédito" },
  { id: "cartao_debito", label: "Cartão de débito" },
  { id: "boleto", label: "Boleto" },
  { id: "transferencia", label: "Transferência" },
  { id: "outro", label: "Outro" },
];

function rotuloParcela(c: ContaReceber): string {
  if (c.parcela_atual === 0) return "Entrada";
  if (c.parcelas && c.parcelas > 1) return `${c.parcela_atual}/${c.parcelas}`;
  return "Única";
}

function rotuloSituacao(c: ContaReceber): { texto: string; classe: string } {
  if (c.status === "pago") return { texto: `Paga em ${isoParaBR(c.pago_em)}`, classe: "text-success" };
  if (c.status === "cancelado") return { texto: "Cancelada", classe: "text-muted-foreground" };
  if (c.vencida) return { texto: "Vencida", classe: "text-destructive" };
  return { texto: "A vencer", classe: "text-foreground" };
}

function ContasReceberPage() {
  const [situacao, setSituacao] = useState<SituacaoReceber>("aberto");
  const [dados, setDados] = useState<ContasReceberResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [baixa, setBaixa] = useState<ContaReceber | null>(null);
  const [pagoEm, setPagoEm] = useState(hojeIso());
  const [forma, setForma] = useState<FormaRecebimento>("pix");
  const [salvando, setSalvando] = useState(false);
  const [erroBaixa, setErroBaixa] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await contasReceberApi.list(situacao);
    if (error || !data) setErro(error || "Não foi possível carregar as contas a receber.");
    else { setErro(null); setDados(data); }
    setCarregando(false);
  }, [situacao]);
  useEffect(() => { void carregar(); }, [carregar]);

  const abrirBaixa = (c: ContaReceber) => {
    setBaixa(c); setPagoEm(hojeIso()); setForma("pix"); setErroBaixa(null);
  };

  const confirmarBaixa = async () => {
    if (!baixa) return;
    setSalvando(true);
    const { error } = await contasReceberApi.baixa(baixa.id, { pago_em: pagoEm, forma_pagamento: forma });
    setSalvando(false);
    if (error) { setErroBaixa(error); return; }
    toast.success("Pagamento registrado. Lembretes de cobrança desta conta foram cancelados.");
    setBaixa(null);
    void carregar();
  };

  const totais = dados?.totais;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Contas a receber" />
      <main className="flex-1 overflow-auto p-6 space-y-6">
        <div>
          <Link to="/financeiro" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Financeiro
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Contas a receber</h1>
          <p className="text-sm text-muted-foreground">
            Parcelas e contas de pacientes. Contas geradas a partir do orçamento aprovado aparecem aqui.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard title="A vencer" value={totais ? formatBRL(totais.aVencer) : "—"} icon={CalendarClock} />
          <KpiCard title="Vencido" value={totais ? formatBRL(totais.vencido) : "—"} icon={AlertTriangle}
            changeType={totais && totais.vencido > 0 ? "negative" : "neutral"} />
          <KpiCard title="Recebido no mês" value={totais ? formatBRL(totais.recebidoMes) : "—"} icon={Wallet} changeType="positive" />
        </div>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar contas">
          {FILTROS.map((f) => (
            <Button key={f.id} size="sm" role="tab" aria-selected={situacao === f.id}
              variant={situacao === f.id ? "default" : "outline"} onClick={() => setSituacao(f.id)}>
              {f.label}
            </Button>
          ))}
        </div>

        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          {carregando ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : erro ? (
            <div className="p-6 text-sm text-destructive flex items-center justify-between gap-3" role="alert">
              <span>{erro}</span>
              <Button size="sm" variant="outline" onClick={() => void carregar()}>Tentar de novo</Button>
            </div>
          ) : !dados || dados.contas.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma conta nesta situação. Para gerar parcelas, abra um orçamento aprovado e use "Gerar parcelas".
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 font-medium">Paciente</th>
                  <th className="px-4 py-2 font-medium">Parcela</th>
                  <th className="px-4 py-2 font-medium">Vencimento</th>
                  <th className="px-4 py-2 font-medium text-right">Valor</th>
                  <th className="px-4 py-2 font-medium">Situação</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {dados.contas.map((c) => {
                  const sit = rotuloSituacao(c);
                  const emAberto = c.status !== "pago" && c.status !== "cancelado";
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">{c.paciente_nome || "—"}</td>
                      <td className="px-4 py-2">{rotuloParcela(c)}</td>
                      <td className="px-4 py-2 tabular-nums">{isoParaBR(c.vencimento)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(c.valor)}</td>
                      <td className={`px-4 py-2 ${sit.classe}`}>{sit.texto}</td>
                      <td className="px-4 py-2 text-right">
                        {emAberto && (
                          <Button size="sm" variant="outline" onClick={() => abrirBaixa(c)}>
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Dar baixa
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <Dialog open={!!baixa} onOpenChange={(o) => { if (!o) setBaixa(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              {baixa ? `${baixa.paciente_nome || "Paciente"} · ${rotuloParcela(baixa)} · ${formatBRL(baixa.valor)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="baixa-data">Data do pagamento</Label>
              <Input id="baixa-data" type="date" max={hojeIso()} value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="baixa-forma">Forma de pagamento</Label>
              <select id="baixa-forma" value={forma} onChange={(e) => setForma(e.target.value as FormaRecebimento)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                {FORMAS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            {erroBaixa && <p className="text-xs text-destructive" role="alert">{erroBaixa}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBaixa(null)}>Cancelar</Button>
            <Button onClick={confirmarBaixa} disabled={salvando || !pagoEm}>
              {salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
