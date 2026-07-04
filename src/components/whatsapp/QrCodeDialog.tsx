import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, CheckCircle2, WifiOff, Wifi, QrCode, Download, Users } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { whatsappApi } from "@/lib/vpsApi";
import { playNotificationSound } from "@/lib/notificationSound";
import { toast } from "sonner";

type ConnectionPhase = "initializing" | "waiting_qr" | "qr_ready" | "connecting" | "connected" | "failed";

const phaseConfig: Record<ConnectionPhase, { label: string; color: string }> = {
  initializing: { label: "Iniciando conexão…", color: "text-muted-foreground" },
  waiting_qr: { label: "Aguardando QR Code…", color: "text-warning" },
  qr_ready: { label: "Escaneie o QR Code", color: "text-primary" },
  connecting: { label: "Conectando ao WhatsApp…", color: "text-warning" },
  connected: { label: "Conectado com sucesso!", color: "text-success" },
  failed: { label: "Falha na conexão", color: "text-destructive" },
};

function extractQrBase64(data: unknown): string {
  const raw = data as any;
  const qr = raw?.qrcode ?? raw?.qrCode ?? raw;
  return qr?.base64 || raw?.base64 || "";
}

function extractConnectionState(data: unknown): "open" | "close" | "connecting" {
  const raw = data as any;
  const value = raw?.instance?.state ?? raw?.state ?? raw?.connectionStatus ?? raw?.status;
  return value === "open" || value === "connecting" ? value : "close";
}

interface QrCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName: string;
  onConnected?: () => void;
}

export function QrCodeDialog({ open, onOpenChange, instanceName, onConnected }: QrCodeDialogProps) {
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [phase, setPhase] = useState<ConnectionPhase>("initializing");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  const fetchQr = useCallback(async (silent = false) => {
    if (!silent) {
      setPhase("initializing");
      setErrorMsg(null);
    }

    try {
      const { data, error } = await whatsappApi.connect(instanceName);
      if (error) {
        throw new Error(error);
      }

      const base64 = extractQrBase64(data);
      if (base64) {
        setQrBase64(base64);
        setPhase("qr_ready");
        return true;
      }
      if (!silent) setPhase("waiting_qr");
      return false;
    } catch (err) {
      if (!silent) {
        setPhase("failed");
        setErrorMsg(err instanceof Error ? err.message : "Erro ao iniciar conexão");
      }
      return false;
    }
  }, [instanceName]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setQrBase64(null);
    setPhase("initializing");
    setErrorMsg(null);
    setElapsed(0);
    setImporting(false);
    setImportResult(null);
    void fetchQr();
  }, [open, fetchQr]);

  // Elapsed timer
  useEffect(() => {
    if (!open || phase === "connected" || phase === "failed") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [open, phase]);

  // Auto-link the connected channel to Comercial/Chat and import recent conversations.
  const autoImportContacts = useCallback(async () => {
    setImporting(true);
    try {
      // Give WhatsApp a few seconds to finish pairing before reading history.
      await new Promise((r) => setTimeout(r, 4000));

      toast.info("Vinculando WhatsApp ao Comercial/Chat e importando conversas…");
      const { data, error } = await whatsappApi.syncChat(instanceName, 30);
      if (error) throw new Error(error);
      const imported = data?.imported ?? 0;
      const skipped = data?.skipped ?? 0;
      setImportResult({ imported, skipped });
      toast.success(imported > 0
        ? `${imported} ${imported === 1 ? "mensagem importada" : "mensagens importadas"} para o Comercial/Chat.`
        : "WhatsApp vinculado ao Comercial/Chat. Novas mensagens já devem aparecer em tempo real."
      );
    } catch (err: any) {
      toast.error(err?.message || "Erro ao vincular WhatsApp ao chat");
    } finally {
      setImporting(false);
    }
  }, [instanceName]);

  // Poll for state + retry QR
  useEffect(() => {
    if (!open || phase === "connected" || phase === "failed") return;

    let cancelled = false;
    let qrRetries = 0;

    const interval = setInterval(async () => {
      if (cancelled) return;

      try {
        const { data, error } = await whatsappApi.state(instanceName);
        let state = extractConnectionState(data);
        if (error) {
          throw new Error(error);
        }
        if (cancelled) return;

        if (state === "open") {
          setPhase("connected");
          playNotificationSound();
          toast.success(`WhatsApp "${instanceName}" conectado!`);
          onConnected?.();
          clearInterval(interval);
          // Kick off automatic chat synchronization
          void autoImportContacts();
          return;
        }

        if (state === "connecting" && phase !== "qr_ready") {
          setPhase("connecting");
        }

        // Retry QR ONLY if we don't have one and after a few state polls
        // (calling /instance/connect repeatedly is the #1 trigger for WhatsApp block)
        if (!qrBase64 && qrRetries < 3) {
          qrRetries += 1;
          const got = await fetchQr(true);
          if (got) setPhase("qr_ready");
        }
      } catch {
        // ignore
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, phase, instanceName, onConnected, qrBase64, fetchQr, autoImportContacts]);

  // Auto-refresh QR every 45s (QR code itself expires ~60s on WhatsApp side)
  useEffect(() => {
    if (!open || phase !== "qr_ready") return;
    const t = setInterval(() => void fetchQr(true), 45000);
    return () => clearInterval(t);
  }, [open, phase, fetchQr]);

  const cfg = phaseConfig[phase];

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp — {instanceName}</DialogTitle>
        </DialogHeader>

        {/* Status bar */}
        <div className="flex items-center gap-2 px-1">
          <StatusDot phase={phase} />
          <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
          {phase !== "connected" && phase !== "failed" && (
            <span className="text-xs text-muted-foreground ml-auto">{formatTime(elapsed)}</span>
          )}
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-between px-4 py-2">
          <Step active={phase !== "initializing"} done={["qr_ready", "connecting", "connected"].includes(phase)} label="Iniciar" />
          <StepLine active={["qr_ready", "connecting", "connected"].includes(phase)} />
          <Step active={["qr_ready", "connecting", "connected"].includes(phase)} done={["connecting", "connected"].includes(phase)} label="QR Code" />
          <StepLine active={["connecting", "connected"].includes(phase)} />
          <Step active={phase === "connected"} done={phase === "connected"} label="Conectado" />
        </div>

        {/* Main content */}
        <div className="flex flex-col items-center gap-4 py-2">
          {phase === "connected" ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle2 className="h-16 w-16 text-success" />
              <p className="text-sm font-medium text-success">WhatsApp conectado!</p>

              {importResult ? (
                <div className="bg-muted/50 rounded-lg p-3 text-center space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    <Users className="h-4 w-4 inline mr-1" />
                    {importResult.imported} {importResult.imported === 1 ? "mensagem importada" : "mensagens importadas"}
                  </p>
                  {importResult.skipped > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {importResult.skipped} já existiam ou estavam fora do período
                    </p>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={importing}
                  onClick={async () => {
                    setImporting(true);
                    try {
                      const { data, error } = await whatsappApi.syncChat(instanceName, 30);
                      if (error) throw new Error(error);
                      setImportResult({ imported: data?.imported ?? 0, skipped: data?.skipped ?? 0 });
                      const imported = data?.imported ?? 0;
                      toast.success(`${imported} ${imported === 1 ? "mensagem importada" : "mensagens importadas"} para o Comercial/Chat!`);
                    } catch (err: any) {
                      toast.error(err?.message || "Erro ao vincular WhatsApp ao chat");
                    } finally {
                      setImporting(false);
                    }
                  }}
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {importing ? "Vinculando ao chat…" : "Vincular conversas ao Comercial/Chat"}
                </Button>
              )}
            </div>
          ) : phase === "failed" ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <WifiOff className="h-12 w-12 text-destructive" />
              <p className="text-sm text-destructive text-center">{errorMsg}</p>
              <Button variant="outline" size="sm" onClick={() => void fetchQr()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar novamente
              </Button>
            </div>
          ) : qrBase64 ? (
            <>
              <div className="bg-white p-3 rounded-xl shadow-sm">
                <img
                  src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code WhatsApp"
                  className="w-64 h-64"
                />
              </div>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                WhatsApp → Menu (⋮) → Aparelhos conectados → Conectar um aparelho → Escaneie o código
              </p>
              <Button variant="ghost" size="sm" onClick={() => void fetchQr()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Atualizar QR Code
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Aguardando QR Code…</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                O código será exibido automaticamente assim que estiver pronto.
              </p>
              <Button variant="ghost" size="sm" onClick={() => void fetchQr()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar agora
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusDot({ phase }: { phase: ConnectionPhase }) {
  if (phase === "connected") return <Wifi className="h-4 w-4 text-success" />;
  if (phase === "failed") return <WifiOff className="h-4 w-4 text-destructive" />;
  if (phase === "qr_ready") return <QrCode className="h-4 w-4 text-primary" />;
  return <Loader2 className="h-4 w-4 animate-spin text-warning" />;
}

function Step({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`h-3 w-3 rounded-full border-2 transition-colors ${
          done
            ? "bg-success border-success"
            : active
              ? "bg-primary border-primary"
              : "bg-muted border-border"
        }`}
      />
      <span className={`text-[10px] font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
    </div>
  );
}

function StepLine({ active }: { active: boolean }) {
  return <div className={`flex-1 h-0.5 mx-1 rounded transition-colors ${active ? "bg-success" : "bg-border"}`} />;
}
