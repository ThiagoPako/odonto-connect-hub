import { Button } from "@/components/ui/button";
import { Smartphone, Wifi, WifiOff, QrCode, Trash2, RotateCcw, Loader2, LogOut, Star, StarOff } from "lucide-react";
import { useState } from "react";
import { deleteInstance, logoutInstance, restartInstance } from "@/lib/evolutionApi";

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

  const handleAction = async (action: string, fn: () => Promise<unknown>) => {
    setActionLoading(action);
    try {
      await fn();
      onRefresh();
    } catch (err) {
      console.error(`Erro ao ${action}:`, err);
    } finally {
      setActionLoading(null);
    }
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
              onClick={() => handleAction("logout", () => logoutInstance(instanceName))}
            >
              {actionLoading === "logout" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            </Button>
          </>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={actionLoading === "restart"}
          onClick={() => handleAction("restart", () => restartInstance(instanceName))}
        >
          {actionLoading === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={actionLoading === "delete"}
          onClick={() => {
            if (confirm(`Tem certeza que deseja excluir "${instanceName}"?`)) {
              handleAction("delete", () => deleteInstance(instanceName));
            }
          }}
        >
          {actionLoading === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
