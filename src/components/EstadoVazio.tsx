import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EstadoVazioAcao {
  label: string;
  /** Rota do app. Use `to` ou `onClick`. */
  to?: string;
  onClick?: () => void;
  icon?: LucideIcon;
}

/**
 * Estado vazio de uma tela: diz o que é a tela e qual é o primeiro passo.
 * Usado quando a clínica ainda não tem nada cadastrado (não para "busca sem resultado").
 */
export function EstadoVazio({
  icon: Icon,
  titulo,
  descricao,
  acao,
  acaoSecundaria,
  compacto = false,
  className,
  children,
}: {
  icon: LucideIcon;
  titulo: string;
  descricao: ReactNode;
  acao?: EstadoVazioAcao;
  acaoSecundaria?: EstadoVazioAcao;
  /** Versão menor, para listas laterais e células de tabela. */
  compacto?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const renderAcao = (a: EstadoVazioAcao, variant: "default" | "outline") => {
    const conteudo = (
      <>
        {a.icon && <a.icon className="h-4 w-4 mr-1.5" aria-hidden="true" />}
        {a.label}
      </>
    );
    return a.to ? (
      <Button asChild size="sm" variant={variant}>
        <Link to={a.to}>{conteudo}</Link>
      </Button>
    ) : (
      <Button size="sm" variant={variant} onClick={a.onClick}>
        {conteudo}
      </Button>
    );
  };

  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center text-center",
        compacto ? "px-3 py-6" : "px-4 py-10 sm:py-12",
        className,
      )}
    >
      <div
        className={cn(
          "mb-3 flex items-center justify-center rounded-xl bg-primary/10",
          compacto ? "h-10 w-10" : "h-12 w-12",
        )}
        aria-hidden="true"
      >
        <Icon className={cn("text-primary", compacto ? "h-5 w-5" : "h-6 w-6")} />
      </div>
      <p className={cn("font-semibold text-foreground", compacto ? "text-sm" : "text-base")}>{titulo}</p>
      <p className={cn("mt-1 text-muted-foreground", compacto ? "text-xs" : "text-sm")}>{descricao}</p>
      {(acao || acaoSecundaria) && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {acao && renderAcao(acao, "default")}
          {acaoSecundaria && renderAcao(acaoSecundaria, "outline")}
        </div>
      )}
      {children}
    </div>
  );
}
