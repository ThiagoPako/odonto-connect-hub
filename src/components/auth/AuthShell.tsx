import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import logoHorizontal from "@/assets/logo-horizontal.png";
import { AgendaFragment } from "@/components/marketing/AgendaFragment";
import { useForceLightTheme } from "@/hooks/useForceLightTheme";

/**
 * Moldura das telas de entrada (login, cadastro, recuperar senha).
 * Computador: formulário à esquerda, palco azul-marinho com a agenda à direita.
 * Celular: só o formulário, com o logotipo no topo. Ver DESIGN.md › Entrada.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useForceLightTheme();
  return (
    <div className="min-h-dvh w-full grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] bg-background">
      <div className="flex flex-col px-5 sm:px-10 lg:px-16 py-6 sm:py-10">
        <Link to="/" className="self-start" aria-label="Odonto Connect — página inicial">
          <img src={logoHorizontal} alt="Odonto Connect" className="h-6 sm:h-7 w-auto" />
        </Link>

        <main className="flex-1 flex items-center py-10">
          <div className="w-full max-w-[400px] mx-auto lg:mx-0 animate-slide-up">
            <h1 className="text-[1.75rem] sm:text-[2rem] leading-tight font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {description && <p className="mt-2 text-base text-muted-foreground">{description}</p>}
            <div className="mt-8">{children}</div>
          </div>
        </main>

        {footer && <div className="text-sm text-muted-foreground">{footer}</div>}
      </div>

      <aside
        className="hidden lg:flex flex-col justify-center gap-14 bg-stage text-stage-foreground px-14 xl:px-20 py-14 overflow-hidden"
        aria-label="Prévia do sistema"
      >
        <div className="max-w-[460px]">
          <p className="text-[1.75rem] xl:text-[2rem] leading-[1.15] font-heading font-semibold tracking-tight">
            A rotina da clínica, do primeiro contato ao pagamento.
          </p>
          <p className="mt-4 text-[0.9375rem] text-stage-muted leading-relaxed">
            Agenda, prontuário, orçamentos, WhatsApp e financeiro no mesmo lugar.
          </p>
        </div>
        <AgendaFragment compact className="w-full max-w-[520px]" />
      </aside>
    </div>
  );
}
