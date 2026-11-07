import { Link } from "@tanstack/react-router";
import { AlertTriangle, Lock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssinaturaSituacao } from "@/hooks/useAuth";

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

function oQueVenceu(a: AssinaturaSituacao) {
  return a.motivo === "teste_vencido" ? "O período de teste" : "A assinatura";
}

/** Faixa fixa no topo durante os 5 dias de carência (não dá para fechar: é o aviso antes do bloqueio). */
export function AssinaturaCarenciaBanner({ assinatura, ehAdmin }: { assinatura: AssinaturaSituacao; ehAdmin: boolean }) {
  const dias = assinatura.dias_para_bloqueio ?? 0;
  return (
    <div role="alert" className="bg-warning-soft text-warning-ink border-b border-warning/40 px-4 py-2.5 text-sm shrink-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 basis-56 text-pretty">
          <strong>{oQueVenceu(assinatura)} da clínica venceu em {dataCurta(assinatura.vence_em)}.</strong>{" "}
          O acesso será bloqueado em {dias} dia{dias !== 1 ? "s" : ""} ({dataCurta(assinatura.bloqueio_em)}).
          {ehAdmin ? "" : " Avise o administrador da clínica."}
        </span>
        {ehAdmin && (
          <Link to="/minha-assinatura" className="font-semibold underline underline-offset-2 whitespace-nowrap hover:opacity-80">
            Regularizar
          </Link>
        )}
      </div>
    </div>
  );
}

/** Tela inteira quando a carência acabou (ou a clínica foi suspensa/cancelada). */
export function AssinaturaBloqueadaTela({
  assinatura, ehAdmin, onSair,
}: { assinatura: AssinaturaSituacao; ehAdmin: boolean; onSair: () => void }) {
  const motivo =
    assinatura.motivo === "suspensa" ? "O acesso da clínica foi suspenso."
    : assinatura.motivo === "cancelada" ? "A assinatura da clínica foi cancelada."
    : `${oQueVenceu(assinatura)} venceu em ${dataCurta(assinatura.vence_em)} e o prazo de 5 dias para regularizar terminou em ${dataCurta(assinatura.bloqueio_em)}.`;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Lock className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-balance">Acesso da clínica bloqueado</h1>
        <p className="text-sm text-muted-foreground text-pretty">{motivo}</p>
        <p className="text-sm text-pretty">
          <strong>Nenhum dado foi apagado.</strong> Pacientes, agenda e prontuários continuam guardados e voltam assim que a
          assinatura for regularizada.
        </p>
        <p className="text-sm text-muted-foreground text-pretty">
          {ehAdmin
            ? "Para regularizar, fale com o suporte do Odonto Connect."
            : "Avise o administrador da clínica para regularizar."}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          {ehAdmin && (
            <Button asChild>
              <Link to="/minha-assinatura">Ver minha assinatura</Link>
            </Button>
          )}
          <Button variant="outline" onClick={onSair}>
            <LogOut className="h-4 w-4 mr-2" aria-hidden /> Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
