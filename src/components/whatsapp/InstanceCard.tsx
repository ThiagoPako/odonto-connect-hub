import { Button } from "@/components/ui/button";
import { Smartphone, Wifi, WifiOff, QrCode, Trash2, RotateCcw, Loader2, LogOut, Star, StarOff } from "lucide-react";
import { useState } from "react";
import { whatsappApi } from "@/lib/vpsApi";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";

interface InstanceCardProps {
  instanceName: string;
  instanceId: string;
  status: "open" | "close" | "connecting";
  isPrimary?: boolean;
  onConnect: (name: string) => void;
  onRefresh: () => void;
  onSetPrimary?: (name: string) => void;
}

export function InstanceCard({ instanceName, instanceId, status, isPrimary, onConnect, onRefresh, onSetPrimary }: InstanceCardProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  // Antes a falha só ia para o console: a recepção clicava e não sabia se tinha funcionado.
  const handleAction = async (action: string, fn: () => Promise<unknown>, okMsg: string, errMsg: string) => {
    setActionLoading(action);
    try {
      await fn();
      toast.success(okMsg);
      onRefresh();
    } catch (err) {
      toast.error(`${errMsg}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogout = async () => {
    const ok = await confirm({
      title: `Desconectar "${instanceName}"?`,
      description: "Este número para de enviar e receber mensagens pelo sistema até alguém ler o QR Code de novo no celular da clínica. Lembretes e disparos que usam este número ficam parados.",
      confirmLabel: "Desconectar",
      destructive: true,
    });
    if (!ok) return;
    void handleAction("logout", async () => {
      const { error } = await whatsappApi.logout(instanceName);
      if (error) throw new Error(error);
    }, `"${instanceName}" desconectado`, "Não foi possível desconectar");
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Excluir o número "${instanceName}"?`,
      description: isPrimary
        ? "Esta é a conexão PRINCIPAL da clínica. Ao excluir, mensagens automáticas param até outro número ser definido como principal. Para usar este número de novo será preciso cadastrá-lo e ler o QR Code."
        : "O número sai do sistema e para de enviar e receber mensagens. Para usá-lo de novo será preciso cadastrá-lo e ler o QR Code.",
      confirmLabel: "Excluir número",
      destructive: true,
    });
    if (!ok) return;
    void handleAction("delete", async () => {
      const { error } = await whatsappApi.delete(instanceName);
      if (error) throw new Error(error);
    }, `"${instanceName}" excluído`, "Não foi possível excluir");
  };

  const isConnected = status === "open";
  const isConnecting = status === "connecting";

  return (
    <div className={`relative bg-card rounded-2xl border-2 p-6 transition-all duration-500 group ${
      isConnected
        ? "border-success/40 shadow-[0_0_24px_-6px_hsl(var(--success)/0.25)]"
        : isConnecting
          ? "border-warning/30"
          : "border-border"
    }`}>
      {/* Primary badge */}
      {isPrimary && (
        <div className="absolute -top-2.5 left-4 px-3 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider rounded-full shadow-md">
          Principal
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`relative h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-500 ${
            isConnected
              ? "bg-success/10"
              : "bg-muted"
          }`}>
            <Smartphone className={`h-6 w-6 transition-colors duration-500 ${
              isConnected ? "text-success" : "text-muted-foreground"
            }`} />
            {/* Pulse ring for connected */}
            {isConnected && (
              <span className="absolute inset-0 rounded-xl border-2 border-success/40 animate-[pulseRing_2s_ease-out_infinite]" />
            )}
          </div>
          <div>
            <p className="font-semibold text-card-foreground text-sm">{instanceName}</p>
            <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[160px]">{instanceId}</p>
          </div>
        </div>
      </div>

      {/* Status indicator */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-4 ${
        isConnected
          ? "bg-success/8"
          : isConnecting
            ? "bg-warning/8"
            : "bg-muted/50"
      }`}>
        <div className="relative flex items-center justify-center">
          {isConnected ? (
            <>
              <Wifi className="h-4 w-4 text-success" />
              <span className="absolute h-2 w-2 rounded-full bg-success animate-ping" style={{ top: -2, right: -2 }} />
            </>
          ) : isConnecting ? (
            <Loader2 className="h-4 w-4 text-warning animate-spin" />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground/60" />
          )}
        </div>
        <span className={`text-xs font-semibold ${
          isConnected ? "text-success" : isConnecting ? "text-warning" : "text-muted-foreground/60"
        }`}>
          {isConnected ? "Conectado" : isConnecting ? "Conectando..." : "Desconectado"}
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-3 border-t border-border/50">
        {!isConnected && (
          <Button variant="default" size="sm" className="flex-1" onClick={() => onConnect(instanceName)}>
            <QrCode className="h-3.5 w-3.5 mr-1.5" />
            QR Code
          </Button>
        )}

        {isConnected && (
          <>
            {onSetPrimary && !isPrimary && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => onSetPrimary(instanceName)}
              >
                <Star className="h-3.5 w-3.5 mr-1.5" />
                Tornar Principal
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading === "logout"}
              onClick={handleLogout}
              aria-label={`Desconectar ${instanceName}`}
              title="Desconectar"
            >
              {actionLoading === "logout" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            </Button>
          </>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={actionLoading === "restart"}
          onClick={() => handleAction("restart", async () => {
            const { error } = await whatsappApi.restart(instanceName);
            if (error) throw new Error(error);
          }, `"${instanceName}" reiniciado`, "Não foi possível reiniciar")}
          aria-label={`Reiniciar conexão ${instanceName}`}
          title="Reiniciar conexão"
        >
          {actionLoading === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={actionLoading === "delete"}
          onClick={handleDelete}
          aria-label={`Excluir número ${instanceName}`}
          title="Excluir número"
        >
          {actionLoading === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {confirmDialog}
    </div>
  );
}
