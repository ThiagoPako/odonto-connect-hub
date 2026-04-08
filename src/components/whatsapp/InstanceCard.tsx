import { Button } from "@/components/ui/button";
import { Radio, Wifi, WifiOff, QrCode, Trash2, RotateCcw, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import { deleteInstance, logoutInstance, restartInstance } from "@/lib/evolutionApi";

interface InstanceCardProps {
  instanceName: string;
  instanceId: string;
  status: "open" | "close" | "connecting";
  onConnect: (name: string) => void;
  onRefresh: () => void;
}

export function InstanceCard({ instanceName, instanceId, status, onConnect, onRefresh }: InstanceCardProps) {
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

  const statusConfig = {
    open: { icon: Wifi, label: "Conectado", className: "text-success" },
    close: { icon: WifiOff, label: "Desconectado", className: "text-destructive" },
    connecting: { icon: Loader2, label: "Conectando...", className: "text-warning animate-spin" },
  };

  const s = statusConfig[status] || statusConfig.close;
  const StatusIcon = s.icon;

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4 hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-primary" />
          <span className="font-medium text-card-foreground">{instanceName}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground font-mono truncate">{instanceId}</p>

      <div className="flex items-center gap-2">
        <StatusIcon className={`h-4 w-4 ${s.className}`} />
        <span className={`text-xs font-medium ${s.className}`}>{s.label}</span>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        {status !== "open" && (
          <Button variant="default" size="sm" onClick={() => onConnect(instanceName)}>
            <QrCode className="h-3.5 w-3.5 mr-1.5" />
            QR Code
          </Button>
        )}

        {status === "open" && (
          <Button
            variant="outline"
            size="sm"
            disabled={actionLoading === "logout"}
            onClick={() => handleAction("logout", () => logoutInstance(instanceName))}
          >
            {actionLoading === "logout" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5 mr-1.5" />}
            Desconectar
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          disabled={actionLoading === "restart"}
          onClick={() => handleAction("restart", () => restartInstance(instanceName))}
        >
          {actionLoading === "restart" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
          Reiniciar
        </Button>

        <Button
          variant="destructive"
          size="sm"
          disabled={actionLoading === "delete"}
          onClick={() => {
            if (confirm(`Tem certeza que deseja excluir "${instanceName}"?`)) {
              handleAction("delete", () => deleteInstance(instanceName));
            }
          }}
        >
          {actionLoading === "delete" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
          Excluir
        </Button>
      </div>
    </div>
  );
}
