import { useCallback, useEffect, useId, useState } from "react";
import { FileText, X, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { legalApi, NOME_DOCUMENTO, ROTA_DOCUMENTO, type PendenciasLegais, type DocumentoLegal } from "@/lib/legalApi";

const dataBr = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });

/** "Termos de Uso" · "Termos de Uso e Política de Privacidade" */
const juntar = (nomes: string[]) =>
  nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;

const CHAVE_AVISO = "oc:aviso-legal-dispensado";

/**
 * Novas versões dos Termos e da Política (backend: PR #70, vps-api-server/legal.mjs).
 * - Durante os 30 dias de aviso: faixa discreta com link para os textos novos (todos os usuários).
 * - Depois que a versão vale: o admin da clínica vê um diálogo de aceite obrigatório (ler, marcar
 *   "li e aceito", aceitar). Quem não é admin não é bloqueado: vê só a faixa.
 * Montado em __root, dentro da casca autenticada.
 */
export function AceiteDocumentosGate() {
  const { user, isAuthenticated } = useAuth();
  const [estado, setEstado] = useState<PendenciasLegais | null>(null);
  const [dispensado, setDispensado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await legalApi.pendencias();
    // Sem resposta (rede, migração pendente): não bloqueia ninguém nem mostra aviso.
    setEstado(data ?? null);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    setDispensado(sessionStorage.getItem(CHAVE_AVISO));
    void carregar();
  }, [isAuthenticated, user?.id, carregar]);

  if (!estado) return null;

  // Faixa: avisos do período de 30 dias, e pendências vigentes para quem não pode aceitar
  const itensFaixa = [
    ...estado.avisos.map((a) => ({ documento: a.documento, versao: a.versao, quando: a.vigente_em, vigente: false })),
    ...(estado.precisa_aceitar ? [] : estado.pendentes.map((p) => ({ documento: p.documento, versao: p.versao, quando: p.vigente_em, vigente: true }))),
  ];
  const assinaturaFaixa = itensFaixa.map((i) => `${i.documento}@${i.versao}`).sort().join(",");
  const mostrarFaixa = itensFaixa.length > 0 && dispensado !== assinaturaFaixa;

  return (
    <>
      {mostrarFaixa && (
        <AvisoFaixa
          itens={itensFaixa}
          onFechar={() => {
            sessionStorage.setItem(CHAVE_AVISO, assinaturaFaixa);
            setDispensado(assinaturaFaixa);
          }}
        />
      )}
      {estado.precisa_aceitar && estado.pendentes.length > 0 && (
        <DialogoAceite pendentes={estado.pendentes} onAceito={carregar} />
      )}
    </>
  );
}

function AvisoFaixa({
  itens,
  onFechar,
}: {
  itens: { documento: DocumentoLegal; versao: string; quando: string; vigente: boolean }[];
  onFechar: () => void;
}) {
  const futuros = itens.filter((i) => !i.vigente);
  const nomes = juntar([...new Set(itens.map((i) => NOME_DOCUMENTO[i.documento]))]);
  const quando = futuros.length ? futuros.map((i) => i.quando).sort()[0] : null;
  return (
    <div role="status" className="shrink-0 flex items-start sm:items-center gap-3 border-b border-border bg-accent px-4 py-2 text-footnote text-accent-foreground">
      <FileText className="size-4 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
      <p className="flex-1 min-w-0">
        {quando ? (
          <>Novas versões: {nomes}. Passam a valer em {dataBr(quando)}.</>
        ) : (
          <>Novas versões: {nomes}. O administrador da clínica precisa aceitá-las.</>
        )}{" "}
        {[...new Map(itens.map((i) => [i.documento, i])).values()].map((i, n) => (
          <span key={i.documento}>
            {n > 0 && " · "}
            <a href={ROTA_DOCUMENTO[i.documento]} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
              Ler {NOME_DOCUMENTO[i.documento]}
            </a>
          </span>
        ))}
      </p>
      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 -my-1 hover:bg-primary/10" onClick={onFechar} aria-label="Fechar aviso">
        <X />
      </Button>
    </div>
  );
}

function DialogoAceite({ pendentes, onAceito }: { pendentes: PendenciasLegais["pendentes"]; onAceito: () => Promise<void> }) {
  const [li, setLi] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idCaixa = useId();
  const idErro = useId();
  const nomes = juntar(pendentes.map((p) => `${NOME_DOCUMENTO[p.documento]} (versão ${p.versao})`));

  const aceitar = async () => {
    setEnviando(true);
    setErro(null);
    for (const p of pendentes) {
      const { error } = await legalApi.aceitar(p.documento, p.versao);
      if (error) {
        setErro(`Não foi possível registrar o aceite (${NOME_DOCUMENTO[p.documento]}). ${error}`);
        setEnviando(false);
        return;
      }
    }
    setEnviando(false);
    toast.success("Aceite registrado", { description: nomes });
    await onAceito();
  };

  return (
    // Obrigatório: sem botão de fechar, Esc e clique fora não fecham (onOpenChange ignorado)
    <AlertDialog open onOpenChange={() => {}}>
      <AlertDialogContent
        className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Novas versões dos documentos</AlertDialogTitle>
          <AlertDialogDescription>
            Para continuar usando o sistema, o administrador da clínica precisa ler e aceitar: {nomes}.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-body text-foreground">
          <p className="font-semibold">O que mudou</p>
          <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
            <li>A Política separa quando somos controladores (clínica e equipe) e operadores (dados dos pacientes).</li>
            <li>Lista dos fornecedores que tratam dados (suboperadores), com o país de cada um.</li>
            <li>O que cada recurso de inteligência artificial envia e o que fica com a clínica revisar.</li>
            <li>Os Termos ganham o Anexo I, Acordo de Tratamento de Dados, e a regra dos textos escritos pela clínica.</li>
            <li>Na saída, a guarda do prontuário por 20 anos continua sendo da clínica.</li>
          </ul>
          <ul className="space-y-1">
            {pendentes.map((p) => (
              <li key={p.documento}>
                <a href={ROTA_DOCUMENTO[p.documento]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 min-h-touch md:min-h-0 font-semibold text-primary underline-offset-4 hover:underline">
                  <FileText className="size-4" aria-hidden="true" /> Ler {NOME_DOCUMENTO[p.documento]} completo (versão {p.versao})
                </a>
              </li>
            ))}
          </ul>

          <label htmlFor={idCaixa} className="flex items-start gap-3 rounded-md border border-input p-3 cursor-pointer has-[:checked]:border-primary">
            <Checkbox
              id={idCaixa}
              checked={li}
              onCheckedChange={(v) => setLi(v === true)}
              className="mt-0.5"
              aria-describedby={erro ? idErro : undefined}
            />
            <span>Li e aceito, em nome da clínica: {nomes}.</span>
          </label>

          {erro && (
            <p id={idErro} role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-footnote text-foreground">
              <AlertCircle className="size-4 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
              {erro}
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <Button type="button" onClick={aceitar} disabled={!li || enviando} aria-busy={enviando || undefined} className="w-full sm:w-auto">
            {enviando && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {enviando ? "Registrando aceite…" : "Aceitar e continuar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
