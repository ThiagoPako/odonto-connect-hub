import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { connectInstance, getInstanceState } from "@/lib/evolutionApi";

interface QrCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName: string;
  onConnected?: () => void;
}

export function QrCodeDialog({ open, onOpenChange, instanceName, onConnected }: QrCodeDialogProps) {
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQr = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const res = await connectInstance(instanceName);
      if (res.base64) {
        setQrBase64(res.base64);
        setError(null);
        return true;
      }

      return false;
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Erro ao iniciar conexão");
      }
      return false;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [instanceName]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setConnected(false);
    setQrBase64(null);
    setError(null);
    void fetchQr();
  }, [open, fetchQr]);

  useEffect(() => {
    if (!open || connected) {
      return;
    }

    let cancelled = false;
    let qrAttempts = 0;

    const interval = setInterval(async () => {
      try {
        const state = await getInstanceState(instanceName);
        if (cancelled) {
          return;
        }

        if (state.state === "open") {
          setConnected(true);
          setError(null);
          onConnected?.();
          clearInterval(interval);
          return;
        }

        if (!qrBase64 && qrAttempts < 8) {
          qrAttempts += 1;
          await fetchQr(true);
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, connected, instanceName, onConnected, qrBase64, fetchQr]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp — {instanceName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {connected ? (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle2 className="h-16 w-16 text-success" />
              <p className="text-sm font-medium text-success">Conectado com sucesso!</p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Iniciando conexão...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-destructive text-center">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void fetchQr()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar novamente
              </Button>
            </div>
          ) : qrBase64 ? (
            <>
              <div className="bg-white p-3 rounded-xl">
                <img
                  src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code WhatsApp"
                  className="w-64 h-64"
                />
              </div>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Abra o WhatsApp no celular → Menu (⋮) → Aparelhos conectados → Conectar um aparelho → Escaneie o código
              </p>
              <Button variant="ghost" size="sm" onClick={() => void fetchQr()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Atualizar QR Code
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Aguardando QR Code...</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                A conexão foi iniciada e vamos atualizar automaticamente até o código aparecer.
              </p>
              <Button variant="ghost" size="sm" onClick={() => void fetchQr()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Atualizar agora
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
