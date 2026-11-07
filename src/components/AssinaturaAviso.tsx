import { Link } from "@tanstack/react-router";
import { AlertTriangle, Download, Eye, FileText, Lock, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssinaturaSituacao } from "@/hooks/useAuth";

// Escada da assinatura vencida (vps-api-server/assinatura.mjs; docs/produto/decisoes-saas.md §3).
// O atraso só é mostrado ao admin (CDC art. 42: não expor a cobrança à equipe).

const dataCurta = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
const plural = (n: number | null | undefined, um: string, varios: string) => `${n ?? 0} ${n === 1 ? um : varios}`;
const oQueVenceu = (a: AssinaturaSituacao) => (a.motivo === "teste_vencido" ? "O período de teste" : "A assinatura");

/** D+1 a D+7 — só admin; nada bloqueado ainda. */
export function AssinaturaCarenciaBanner({ assinatura }: { assinatura: AssinaturaSituacao }) {
  return (
    <div role="alert" className="bg-warning-soft text-warning-ink border-b border-warning/40 px-4 py-2.5 text-sm shrink-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 basis-56 text-pretty">
          <strong>{oQueVenceu(assinatura)} da clínica venceu em {dataCurta(assinatura.vence_em)}.</strong>{" "}
          Em {plural(assinatura.dias_para_proxima, "dia", "dias")} ({dataCurta(assinatura.proxima_etapa_em)}) o sistema
          passa a funcionar só para consulta.
        </span>
        <Link to="/minha-assinatura" className="font-semibold underline underline-offset-2 whitespace-nowrap hover:opacity-80">
          Regularizar
        </Link>
      </div>
    </div>
  );
}

/** D+8 a D+29 — modo consulta. Admin vê o motivo e as datas; a equipe, um aviso neutro. */
export function AssinaturaSomenteLeituraBanner({ assinatura, ehAdmin }: { assinatura: AssinaturaSituacao; ehAdmin: boolean }) {
  if (!ehAdmin) {
    return (
      <div role="status" className="bg-muted text-foreground border-b px-4 py-2.5 text-sm shrink-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 basis-56 text-pretty">
            <strong>Modo consulta.</strong> Dá para ver os dados, responder pacientes e remarcar ou cancelar consultas.
            Para criar ou alterar cadastros, fale com o administrador da clínica.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="bg-destructive text-destructive-foreground px-4 py-2.5 text-sm shrink-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 basis-56 text-pretty">
          <strong>{oQueVenceu(assinatura)} venceu em {dataCurta(assinatura.vence_em)}: sistema em modo consulta.</strong>{" "}
          Dá para ver, exportar, responder pacientes e remarcar ou cancelar consultas; não dá para criar nem alterar.
          O acesso será bloqueado em {dataCurta(assinatura.bloqueio_em)}.
        </span>
        <Link to="/minha-assinatura" className="font-semibold underline underline-offset-2 whitespace-nowrap hover:opacity-80">
          Regularizar
        </Link>
      </div>
    </div>
  );
}

function textoBloqueio(a: AssinaturaSituacao, ehAdmin: boolean) {
  if (!ehAdmin) return "O acesso da clínica está suspenso. O prontuário continua disponível para consulta.";
  if (a.motivo === "suspensa") return "O acesso da clínica foi suspenso.";
  if (a.motivo === "cancelada") return "A assinatura da clínica foi cancelada.";
  if (a.situacao === "cancelado") {
    return `A assinatura foi cancelada em ${dataCurta(a.cancelamento_em)} por falta de pagamento. Exporte os dados até ${dataCurta(a.exclusao_em)}: depois dessa data eles são excluídos.`;
  }
  return `${oQueVenceu(a)} venceu em ${dataCurta(a.vence_em)} e o acesso foi bloqueado em ${dataCurta(a.bloqueio_em)}. Se não for regularizada, a assinatura será cancelada em ${dataCurta(a.cancelamento_em)}.`;
}

/** Links liberados com a clínica bloqueada/cancelada. */
function linksLiberados(ehAdmin: boolean, podeProntuario: boolean) {
  return [
    ...(podeProntuario ? [{ to: "/pacientes", label: "Pacientes e prontuário", icon: Users }] : []),
    ...(ehAdmin ? [{ to: "/exportar-dados", label: "Exportar dados", icon: Download }, { to: "/minha-assinatura", label: "Minha assinatura", icon: FileText }] : []),
  ] as const;
}

/** D+30 em diante (bloqueado/cancelado), fora das telas liberadas. */
export function AssinaturaBloqueadaTela({
  assinatura, ehAdmin, podeProntuario, onSair,
}: { assinatura: AssinaturaSituacao; ehAdmin: boolean; podeProntuario: boolean; onSair: () => void }) {
  const links = linksLiberados(ehAdmin, podeProntuario);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Lock className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-balance">
          {assinatura.situacao === "cancelado" && ehAdmin ? "Assinatura cancelada" : "Acesso da clínica bloqueado"}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">{textoBloqueio(assinatura, ehAdmin)}</p>
        <p className="text-sm text-pretty">
          <strong>Nenhum dado foi apagado.</strong> O prontuário continua disponível para consulta e impressão
          {ehAdmin ? ", e todos os dados podem ser exportados." : "."}
        </p>
        {!ehAdmin && <p className="text-sm text-muted-foreground">Avise o administrador da clínica para regularizar.</p>}
        <div className="flex flex-col gap-2 pt-2">
          {links.map((l) => (
            <Button key={l.to} asChild variant={l.to === "/minha-assinatura" ? "default" : "outline"}>
              <Link to={l.to}><l.icon className="h-4 w-4 mr-2" aria-hidden /> {l.label}</Link>
            </Button>
          ))}
          <Button variant="ghost" onClick={onSair}>
            <LogOut className="h-4 w-4 mr-2" aria-hidden /> Sair
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Barra no topo das telas liberadas com a clínica bloqueada (sem o menu completo). */
export function AssinaturaBloqueadaBarra({
  ehAdmin, podeProntuario, onSair,
}: { ehAdmin: boolean; podeProntuario: boolean; onSair: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/50 px-4 py-2 text-sm shrink-0">
      <span className="flex items-center gap-1.5 font-medium text-destructive">
        <Lock className="h-4 w-4" aria-hidden /> Acesso bloqueado — somente consulta
      </span>
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Telas disponíveis">
        <Link to="/dashboard" className="underline underline-offset-2 text-muted-foreground hover:text-foreground">Início</Link>
        {linksLiberados(ehAdmin, podeProntuario).map((l) => (
          <Link key={l.to} to={l.to} className="underline underline-offset-2 text-muted-foreground hover:text-foreground"
            activeProps={{ className: "font-semibold text-foreground no-underline" }}>
            {l.label}
          </Link>
        ))}
      </nav>
      <button onClick={onSair} className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <LogOut className="h-4 w-4" aria-hidden /> Sair
      </button>
    </div>
  );
}
