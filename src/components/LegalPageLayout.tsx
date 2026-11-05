import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { DOCUMENTOS_ATUALIZADOS_EM, legalIncompleto } from "@/lib/legal";

interface Props {
  titulo: string;
  versao: string;
  children: ReactNode;
}

export function LegalPageLayout({ titulo, versao, children }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <h1 className="mt-6 text-3xl font-heading font-bold text-foreground">{titulo}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Versão {versao} · Atualizado em {DOCUMENTOS_ATUALIZADOS_EM}
        </p>
        {legalIncompleto && (
          <p className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
            Documento em revisão: dados cadastrais da empresa pendentes.
          </p>
        )}
        <div className="legal-doc mt-8 space-y-6 text-callout leading-relaxed text-foreground/90 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-foreground [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline">
          {children}
        </div>
      </div>
    </div>
  );
}
