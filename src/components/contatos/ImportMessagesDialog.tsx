import { ImportEmBreveDialog } from "@/components/contatos/ImportEmBreveDialog";

interface ImportMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

// A lista de números vinha da Evolution (src/lib/evolutionApi.ts, desativado) e a importação
// (POST /api/whatsapp/sync-chat) só funciona com a Evolution. Sem rota para os novos canais,
// mostra "disponível em breve".
export function ImportMessagesDialog({ open, onOpenChange }: ImportMessagesDialogProps) {
  return <ImportEmBreveDialog open={open} onOpenChange={onOpenChange} title="Importar conversas do WhatsApp" what="conversas antigas" />;
}
