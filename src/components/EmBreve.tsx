import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Tela de funcionalidade ainda não disponível. Usada no lugar de telas que
 * mostravam números ou pessoas inventadas, para a clínica não decidir com base
 * em dado falso.
 */
export function EmBreve({
  titulo,
  descricao,
  atalhos = [],
}: {
  titulo: string;
  descricao: string;
  atalhos?: { to: string; label: string }[];
}) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border bg-card p-6 sm:p-8 text-center shadow-card">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Clock className="h-6 w-6 text-primary" />
      </div>
      <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
        Em breve
      </span>
      <h2 className="mt-3 text-lg font-semibold text-foreground">{titulo}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{descricao}</p>
      {atalhos.length > 0 && (
        <div className="mt-5 flex flex-col sm:flex-row justify-center gap-2">
          {atalhos.map((a) => (
            <Button key={a.to} asChild variant="outline" size="sm">
              <Link to={a.to}>{a.label}</Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
