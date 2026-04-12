import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { WifiOff, X } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";

export function WhatsAppConnectionBanner() {
  const { instances, connected, loading } = useWhatsAppInstances();
  const [dismissed, setDismissed] = useState(false);

  // Don't show while loading, if dismissed, or if no instances exist yet
  if (loading || dismissed || instances.length === 0) return null;

  // All good — at least one connected
  if (connected.length > 0) return null;

  return (
    <div className="bg-destructive text-destructive-foreground px-4 py-2.5 flex items-center justify-between gap-3 text-sm animate-fade-in shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span className="font-medium truncate">
          Nenhum WhatsApp conectado — o sistema não consegue enviar ou receber mensagens.
        </span>
        <Link
          to="/canais"
          className="underline underline-offset-2 font-semibold whitespace-nowrap hover:opacity-80"
        >
          Reconectar
        </Link>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 hover:bg-destructive-foreground/20 transition-colors"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
