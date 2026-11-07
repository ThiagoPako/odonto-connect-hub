import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Importação de contatos/conversas do WhatsApp: dependia do sistema anterior (Evolution), que foi
 * desligado. Até existir a rota para os novos canais (QR Code e API oficial), a tela explica em vez
 * de falhar.
 */
export function ImportEmBreveDialog({ open, onOpenChange, title, what }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  what: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-info-soft text-info-ink">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle>{title}: disponível em breve</DialogTitle>
          <DialogDescription className="text-pretty">
            A importação de {what} usava a conexão antiga do WhatsApp, que foi desligada. Ela volta quando os novos canais
            (QR Code e API oficial) tiverem essa opção. As mensagens novas chegam no chat pelos números conectados em Canais.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" className="min-h-10" asChild>
            <Link to="/canais" onClick={() => onOpenChange(false)}>Ver canais do WhatsApp</Link>
          </Button>
          <Button className="min-h-10" onClick={() => onOpenChange(false)}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
