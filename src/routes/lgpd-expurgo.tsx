import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, Trash2, FlaskConical, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { vpsApiFetch } from "@/lib/vpsApi";

// Revisão das listas de expurgo por prazo de guarda (LGPD). O sistema só gera a lista;
// nada é apagado sem aprovação item a item, simulação (dry-run) e a palavra ELIMINAR.
export const Route = createFileRoute("/lgpd-expurgo")({
  ssr: false,
  component: LgpdExpurgoPage,
});

interface Lista {
  id: string;
  competencia: string;
  status: "pendente" | "executada" | "descartada";
  gerada_em: string;
  dry_run_em: string | null;
  executada_em: string | null;
}
interface Item {
  id: number;
  categoria: string;
  referencia: string | null;
  quantidade: number;
  detalhe: Record<string, number> | null;
  corte: string;
  acao: "eliminar" | "devolver";
  prazo_ate: string | null;
  aprovado: boolean;
  aprovado_papel: string | null;
  aprovado_em: string | null;
  resultado: Record<string, unknown> | null;
}

const NOMES: Record<string, string> = {
  leads: "Leads sem interação há mais de 2 anos (com funil e conversas)",
  fila: "Fila de envios com mais de 1 ano",
  conversas: "Conversas com mais de 5 anos",
  acessos: "Registro de acesso ao prontuário com mais de 5 anos",
  solicitacoes: "Pedidos do titular encerrados há mais de 5 anos",
  prontuario: "Prontuário com prazo de guarda vencido",
};
const data = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

function LgpdExpurgoPage() {
  const [listas, setListas] = useState<Lista[]>([]);
  const [lista, setLista] = useState<Lista | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [podeProntuario, setPodeProntuario] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [frase, setFrase] = useState("");

  const abrir = useCallback(async (id: string) => {
    const { data: d, error } = await vpsApiFetch<{ lista: Lista; itens: Item[] }>(`/api/lgpd/expurgo/listas/${id}`);
    if (error || !d) { toast.error(error || "Não foi possível abrir a lista"); return; }
    setLista(d.lista);
    setItens(d.itens);
    setDryRun(null);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data: d, error } = await vpsApiFetch<{ listas: Lista[]; pode_aprovar_prontuario: boolean; admin: boolean }>("/api/lgpd/expurgo/listas");
    setCarregando(false);
    if (error || !d) { setErro(error || "Não foi possível carregar"); return; }
    setErro(null);
    setListas(d.listas);
    setPodeProntuario(d.pode_aprovar_prontuario);
    setAdmin(d.admin);
    if (d.listas[0]) await abrir(d.listas[0].id);
  }, [abrir]);

  useEffect(() => { carregar(); }, [carregar]);

  const gerar = async () => {
    setOcupado(true);
    const { error } = await vpsApiFetch("/api/lgpd/expurgo/listas/gerar", { method: "POST" });
    setOcupado(false);
    if (error) { toast.error(error); return; }
    toast.success("Lista do mês gerada. Nada foi apagado.");
    carregar();
  };

  const aprovar = async (item: Item, valor: boolean) => {
    const { error } = await vpsApiFetch(`/api/lgpd/expurgo/itens/${item.id}/aprovar`, { method: "POST", body: { aprovar: valor } });
    if (error) { toast.error(error); return; }
    if (lista) abrir(lista.id);
  };

  const simular = async () => {
    if (!lista) return;
    setOcupado(true);
    const { data: d, error } = await vpsApiFetch<{ dry_run: Record<string, unknown> }>(`/api/lgpd/expurgo/listas/${lista.id}/dry-run`, { method: "POST" });
    setOcupado(false);
    if (error || !d) { toast.error(error || "Falha na simulação"); return; }
    setDryRun(d.dry_run);
    toast.success("Simulação feita. Nada foi apagado. Vale por 1 hora.");
  };

  const executar = async () => {
    if (!lista) return;
    setOcupado(true);
    const { error } = await vpsApiFetch(`/api/lgpd/expurgo/listas/${lista.id}/executar`, { method: "POST", body: { frase } });
    setOcupado(false);
    setConfirmar(false);
    setFrase("");
    if (error) { toast.error(error); return; }
    toast.success("Itens aprovados eliminados. O registro ficou na lista.");
    abrir(lista.id);
  };

  if (carregando) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Expurgo LGPD" icon={ShieldCheck} />
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  const pendente = lista?.status === "pendente";
  const algumAprovado = itens.some(i => i.aprovado);

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Expurgo LGPD" icon={ShieldCheck} />
      <main className="flex-1 p-6 overflow-auto space-y-5">
        <p className="text-sm text-muted-foreground max-w-3xl">
          Todo mês o sistema lista o que passou do prazo de guarda. Nada é apagado sozinho: aprove item a item,
          faça a simulação e confirme. Prontuário só sai com aprovação de um dentista da clínica
          (Lei 13.787/2018, art. 6º). Quando o paciente pediu a devolução, o prontuário não é eliminado.
        </p>

        {erro && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{erro}</div>}

        <div className="flex flex-wrap items-center gap-2">
          {listas.length > 0 && (
            <select
              aria-label="Lista do mês"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={lista?.id || ""}
              onChange={e => abrir(e.target.value)}
            >
              {listas.map(l => <option key={l.id} value={l.id}>{l.competencia} · {l.status}</option>)}
            </select>
          )}
          {admin && (
            <Button variant="outline" size="sm" onClick={gerar} disabled={ocupado}>
              <RefreshCw className="h-4 w-4 mr-1" /> Gerar lista do mês
            </Button>
          )}
        </div>

        {!lista && !erro && (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">
            Ainda não há lista. Ela é gerada automaticamente no início de cada mês.
          </div>
        )}

        {lista && (
          <>
            <div className="text-sm text-muted-foreground">
              Gerada em {data(lista.gerada_em)} · Simulação: {data(lista.dry_run_em)} · Execução: {data(lista.executada_em)}
            </div>
            {itens.length === 0 ? (
              <div className="rounded-md border p-6 text-sm text-muted-foreground">Nada venceu o prazo neste mês.</div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2">O quê</th>
                      <th className="p-2">Registros</th>
                      <th className="p-2">Anterior a</th>
                      <th className="p-2">Ação</th>
                      <th className="p-2">Aprovação</th>
                      <th className="p-2">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map(i => {
                      const ehProntuario = i.categoria === "prontuario";
                      const pode = pendente && (ehProntuario ? podeProntuario : admin);
                      return (
                        <tr key={i.id} className="border-t align-top">
                          <td className="p-2">
                            {NOMES[i.categoria] || i.categoria}
                            {ehProntuario && i.referencia && <div className="text-xs text-muted-foreground">Paciente {i.referencia.slice(0, 8)}…</div>}
                          </td>
                          <td className="p-2">{i.quantidade}</td>
                          <td className="p-2">{data(i.corte)}</td>
                          <td className="p-2">{i.acao === "devolver" ? "Devolver ao paciente" : "Eliminar"}</td>
                          <td className="p-2">
                            {i.aprovado ? `Aprovado (${i.aprovado_papel}) em ${data(i.aprovado_em)}` : "Não aprovado"}
                            {pode && (
                              <div className="mt-1">
                                <Button size="sm" variant={i.aprovado ? "outline" : "default"} onClick={() => aprovar(i, !i.aprovado)}>
                                  {i.aprovado ? "Desfazer" : "Aprovar"}
                                </Button>
                              </div>
                            )}
                            {pendente && ehProntuario && !podeProntuario && !i.aprovado && (
                              <div className="text-xs text-muted-foreground mt-1">Só um dentista da clínica aprova.</div>
                            )}
                          </td>
                          <td className="p-2 text-xs">
                            {i.resultado ? JSON.stringify(i.resultado) : dryRun?.[String(i.id)] ? `Simulação: ${JSON.stringify(dryRun[String(i.id)])}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {pendente && itens.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={simular} disabled={ocupado || !algumAprovado}>
                  <FlaskConical className="h-4 w-4 mr-1" /> Simular (não apaga)
                </Button>
                <Button variant="destructive" onClick={() => setConfirmar(true)} disabled={ocupado || !dryRun}>
                  <Trash2 className="h-4 w-4 mr-1" /> Eliminar aprovados
                </Button>
              </div>
            )}
          </>
        )}

        <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminar os itens aprovados?</AlertDialogTitle>
              <AlertDialogDescription>
                Não dá para desfazer. Fica registrado quem aprovou, quem executou e quantos registros saíram.
                Digite ELIMINAR para confirmar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input aria-label="Digite ELIMINAR" value={frase} onChange={e => setFrase(e.target.value)} placeholder="ELIMINAR" />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={frase.trim().toUpperCase() !== "ELIMINAR" || ocupado} onClick={executar}>
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
