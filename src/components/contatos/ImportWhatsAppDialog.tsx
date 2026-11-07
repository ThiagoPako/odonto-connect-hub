import { ImportEmBreveDialog } from "@/components/contatos/ImportEmBreveDialog";

interface ImportWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

// A busca de contatos ia direto à Evolution (src/lib/evolutionApi.ts, desativado) e sempre falhava.
// Sem rota no backend para os novos canais, mostra "disponível em breve".
export function ImportWhatsAppDialog({ open, onOpenChange }: ImportWhatsAppDialogProps) {
  return <ImportEmBreveDialog open={open} onOpenChange={onOpenChange} title="Importar contatos do WhatsApp" what="contatos" />;
}
