import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { billingReminderApi, type BillingReminderEtapa } from "@/lib/vpsApi";

export const Route = createFileRoute("/configuracoes/cobranca")({
  ssr: false,
  component: ConfiguracoesCobrancaPage,
});

const MAX_ETAPAS = 5;
const EXEMPLO = { nome: "Maria", clinica: "Sua Clínica", valor: "R$ 150,00", vencimento: "10/11/2026" };

function descreverDias(dias: number): string {
  if (dias === 0) return "No dia do vencimento";
  if (dias < 0) return `${Math.abs(dias)} dia(s) antes do vencimento`;
  return `${dias} dia(s) depois do vencimento`;
}

function previa(texto: string): string {
  return texto
    .replace(/\{\s*nome\s*\}/g, EXEMPLO.nome)
    .replace(/\{\s*clinica\s*\}/g, EXEMPLO.clinica)
    .replace(/\{\s*valor\s*\}/g, EXEMPLO.valor)
    .replace(/\{\s*vencimento\s*\}/g, EXEMPLO.vencimento);
}

function ConfiguracoesCobrancaPage() {
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [etapas, setEtapas] = useState<BillingReminderEtapa[]>([]);
  const [padrao, setPadrao] = useState<BillingReminderEtapa[]>([]);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await billingReminderApi.get();
      if (error || !data) {
        setErroCarga(error || "Não foi possível carregar a régua de cobrança.");
      } else {
        setEnabled(!!data.enabled);
        setEtapas(data.etapas || []);
        setPadrao(data.padrao || []);
      }
      setCarregando(false);
    })();
  }, []);

  const diasRepetidos = useMemo(() => {
    const vistos = new Set<number>();
    return etapas.some((e) => (vistos.has(e.dias) ? true : (vistos.add(e.dias), false)));
  }, [etapas]);

  const atualizar = (i: number, patch: Partial<BillingReminderEtapa>) =>
    setEtapas((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const salvar = async () => {
    setErroSalvar(null);
    setSalvando(true);
    const { data, error } = await billingReminderApi.update({ enabled, etapas });
    setSalvando(false);
    if (error || !data) {
      setErroSalvar(error || "Não foi possível salvar.");
      toast.error("Régua de cobrança não foi salva");
      return;
    }
    setEnabled(!!data.enabled);
    setEtapas(data.etapas || []);
    toast.success(data.enabled ? "Régua de cobrança salva e ligada" : "Régua de cobrança salva (desligada)");
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader title="Régua de cobrança" />
      <main className="container mx-auto max-w-4xl px-4 py-6 space-y-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link to="/configuracoes" className="hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Configurações
            </Link>
            <span>/</span>
            <span>Cobrança</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Régua de cobrança pelo WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Lembretes de pagamento antes e depois do vencimento das contas a receber de pacientes, enviados pelo
            WhatsApp da clínica, no horário comercial e respeitando quem pediu para não receber mensagens.
          </p>
        </div>

        {carregando ? (
          <Skeleton className="h-64 w-full" />
        ) : erroCarga ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive" role="alert">{erroCarga}</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ligar a régua</CardTitle>
                <CardDescription>
                  Vem desligada. Ao ligar, só contas em aberto (pendente, atrasado ou vencido) recebem lembrete, no
                  máximo uma mensagem por pessoa por dia (contas juntas), nunca em feriado nacional nem perto de uma
                  consulta marcada. Se houver responsável financeiro, a mensagem vai para ele; paciente menor de idade
                  sem responsável não recebe. Conta paga, cancelada ou com novo vencimento sai da fila sozinha. Se a
                  pessoa responder "já paguei" ou contestar, a cobrança daquela conta para e a recepção é avisada.
                  Negativação e protesto não são feitos pela régua.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-3">
                <Switch id="regua-ligada" checked={enabled} onCheckedChange={setEnabled} />
                <Label htmlFor="regua-ligada">{enabled ? "Ligada" : "Desligada"}</Label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Etapas e textos</CardTitle>
                <CardDescription>
                  Use {"{nome}"}, {"{clinica}"}, {"{valor}"} e {"{vencimento}"}. Todo texto precisa ter "Aqui é da{" "}
                  {"{clinica}"}" e o valor só depois disso. Fale só de pagamento e vencimento: nada de procedimento,
                  tratamento, consulta ou diagnóstico, nada que condicione o atendimento ao pagamento e nada que
                  constranja (ex.: último aviso, suspender, cartório, SPC). Sem links e sem texto todo em maiúsculas.
                  Depois do vencimento: no máximo 3 etapas, com pelo menos 3 dias entre elas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {etapas.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma etapa. Adicione uma ou restaure o padrão.</p>
                )}
                {etapas.map((etapa, i) => (
                  <div key={i} className="rounded-lg border border-border/60 p-4 space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-1">
                        <Label htmlFor={`dias-${i}`}>Dias em relação ao vencimento</Label>
                        <Input
                          id={`dias-${i}`}
                          type="number"
                          min={-7}
                          max={30}
                          className="w-28"
                          value={Number.isFinite(etapa.dias) ? etapa.dias : 0}
                          onChange={(e) => atualizar(i, { dias: parseInt(e.target.value, 10) || 0 })}
                        />
                      </div>
                      <span className="text-sm text-muted-foreground pb-2">{descreverDias(etapa.dias)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setEtapas((prev) => prev.filter((_, idx) => idx !== i))}
                        aria-label={`Remover etapa ${descreverDias(etapa.dias)}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`texto-${i}`}>Texto</Label>
                      <Textarea
                        id={`texto-${i}`}
                        rows={3}
                        maxLength={600}
                        value={etapa.texto}
                        onChange={(e) => atualizar(i, { texto: e.target.value })}
                      />
                    </div>
                    <div className="rounded-md bg-muted/60 p-3 text-sm">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Prévia (dados de exemplo)</p>
                      <p className="whitespace-pre-wrap">{previa(etapa.texto) || "—"}</p>
                    </div>
                  </div>
                ))}
                {diasRepetidos && (
                  <p className="text-sm text-destructive" role="alert">Há duas etapas com o mesmo número de dias.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={etapas.length >= MAX_ETAPAS}
                    onClick={() => setEtapas((prev) => [...prev, { dias: 10, texto: "Olá, {nome}! Aqui é da {clinica}. " }])}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Adicionar etapa
                  </Button>
                  <Button variant="outline" size="sm" disabled={padrao.length === 0} onClick={() => setEtapas(padrao)}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Restaurar textos padrão
                  </Button>
                </div>
              </CardContent>
            </Card>

            {erroSalvar && (
              <p className="text-sm text-destructive" role="alert">{erroSalvar}</p>
            )}
            <div className="flex justify-end">
              <Button onClick={salvar} disabled={salvando || diasRepetidos}>
                {salvando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
