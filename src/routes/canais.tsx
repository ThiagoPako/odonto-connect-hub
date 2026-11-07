import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, MessageCircle, QrCode, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChannelCard, type ChannelAction } from "@/components/whatsapp/canais/ChannelCard";
import { ReservaQrDialog } from "@/components/whatsapp/canais/ReservaQrDialog";
import { useAuth } from "@/hooks/useAuth";
import { useVpsEvent } from "@/hooks/useVpsEvent";
import {
  channelLabel,
  whatsappChannelsApi,
  type ChannelStateEvent,
  type WhatsAppChannel,
} from "@/lib/whatsappChannels";

export const Route = createFileRoute("/canais")({
  ssr: false,
  component: CanaisPage,
});

type Confirm = { kind: "disconnect" | "remove" | "primary"; channel: WhatsAppChannel } | null;

function CanaisPage() {
  const { user } = useAuth();
  const canManage = user?.role === "admin";
  const [channels, setChannels] = useState<WhatsAppChannel[] | null>(null);
  const [openwaAvailable, setOpenwaAvailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: ChannelAction } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrChannel, setQrChannel] = useState<WhatsAppChannel | null>(null);
  const [liveEvent, setLiveEvent] = useState<ChannelStateEvent | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const { data, error } = await whatsappChannelsApi.list();
    if (seq !== loadSeq.current) return;
    if (error || !data) {
      setLoadError(error || "Resposta vazia do servidor.");
      return;
    }
    setLoadError(null);
    setChannels(data.channels.filter((c) => c.status === "active"));
    setOpenwaAvailable(!!data.openwaAvailable);
  }, []);

  // Primeira carga + recarga silenciosa a cada 60 s (sem esqueleto).
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Estado em tempo real dos canais QR (conectou, caiu, novo QR).
  useVpsEvent<ChannelStateEvent>("whatsapp_channel_state", (evt) => {
    if (!evt?.channelId) return;
    setLiveEvent(evt);
    setChannels((prev) => prev?.map((c) => (c.id === evt.channelId ? { ...c, state: evt.state } : c)) ?? prev);
    if (evt.state === "open" || evt.state === "close") void load();
  });

  const reload = async () => {
    setReloading(true);
    await load();
    setReloading(false);
  };

  const sorted = useMemo(
    () => (channels ? [...channels].sort((a, b) => Number(b.role === "primary") - Number(a.role === "primary")) : null),
    [channels],
  );
  const hasQr = !!channels?.some((c) => c.provider === "openwa");
  const attention = (channels ?? []).filter((c) => c.provider !== "evolution" && c.state !== "open");
  const hasPrimary = !!channels?.some((c) => c.role === "primary");

  const connectBlocked = !canManage
    ? "Só o administrador da clínica pode conectar números."
    : !openwaAvailable
      ? "O número reserva por QR Code ainda não está disponível. Fale com o suporte."
      : hasQr
        ? "A clínica já tem um número reserva por QR Code. Para trocar, remova o atual."
        : null;

  const openNewQr = () => { setQrChannel(null); setQrOpen(true); };

  const runAction = async (action: ChannelAction, channel: WhatsAppChannel) => {
    setBusy({ id: channel.id, action });
    const label = channelLabel(channel);
    try {
      if (action === "check") {
        const { data, error } = await whatsappChannelsApi.state(channel.id);
        if (error || !data) { toast.error(error || "Não foi possível verificar a conexão."); return; }
        if (!data.live) toast.warning("O servidor de WhatsApp não respondeu. Mostrando o último estado conhecido.");
        else toast.success(data.channel.state === "open" ? `${label} está conectado.` : `Estado de ${label} atualizado.`);
        await load();
        return;
      }
      const call = action === "disconnect" ? whatsappChannelsApi.disconnect
        : action === "remove" ? whatsappChannelsApi.remove
          : whatsappChannelsApi.setPrimary;
      const { error } = await call(channel.id);
      if (error) { toast.error(error); return; }
      toast.success(
        action === "disconnect" ? `${label} foi desconectado.`
          : action === "remove" ? `${label} foi removido da clínica.`
            : `${label} agora é o número principal.`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onAction = (action: ChannelAction, channel: WhatsAppChannel) => {
    if (action === "qr") { setQrChannel(channel); setQrOpen(true); return; }
    if (action === "check") { void runAction("check", channel); return; }
    setConfirm({ kind: action, channel });
  };

  const confirmText = confirm && (() => {
    const label = channelLabel(confirm.channel);
    if (confirm.kind === "primary") {
      return {
        title: `Tornar ${label} o número principal?`,
        body: <>Os lembretes e automações passam a sair por ele. O principal atual vira reserva. Conversas abertas continuam no mesmo paciente.
          {confirm.channel.provider === "openwa" && <><br /><br /><strong>Atenção:</strong> por QR Code o risco de bloqueio é maior. Evite campanhas por este número.</>}</>,
        action: "Tornar principal",
        destructive: false,
      };
    }
    if (confirm.kind === "disconnect") {
      return {
        title: `Desconectar ${label}?`,
        body: <>O Odonto Connect para de enviar e receber por este número. As conversas já salvas continuam aqui. Para voltar, é só ler o QR Code de novo.</>,
        action: "Desconectar",
        destructive: true,
      };
    }
    return {
      title: `Remover ${label}?`,
      body: <>O número sai da clínica e a conexão é apagada no servidor de WhatsApp. As conversas já salvas continuam aqui. Para usar de novo, será preciso conectar do começo, com um QR Code novo.</>,
      action: "Remover número",
      destructive: true,
    };
  })();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DashboardHeader title="Canais do WhatsApp" />
      <div className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <section className="space-y-3">
            <p className="text-sm text-muted-foreground text-pretty">
              Os números que a clínica usa com os pacientes. O principal envia lembretes e automações; a reserva assume se o principal cair.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button className="min-h-10 w-full sm:w-auto" disabled={!!connectBlocked || channels === null} onClick={openNewQr}>
                <QrCode className="mr-2 h-4 w-4" />Conectar número reserva (QR Code)
              </Button>
              <Button variant="outline" className="min-h-10 w-full sm:w-auto" disabled={reloading} onClick={() => void reload()}>
                <RefreshCw className={reloading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />Atualizar
              </Button>
            </div>
            {connectBlocked && channels !== null && (
              <p className="text-sm text-muted-foreground text-pretty">{connectBlocked}</p>
            )}
          </section>

          {attention.length > 0 && (
            <div role="alert" className="flex gap-3 rounded-xl border border-destructive/30 bg-danger-soft p-4 text-danger-ink">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{attention.length === 1 ? "Atenção em 1 número" : `Atenção em ${attention.length} números`}</p>
                <p className="text-sm text-pretty">Resolva os avisos abaixo para não parar lembretes e confirmações.</p>
              </div>
            </div>
          )}

          <section aria-labelledby="numeros-titulo" className="space-y-3">
            <h2 id="numeros-titulo" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Números da clínica</h2>

            {sorted === null && !loadError && (
              <div aria-busy="true" className="space-y-3">
                <span className="sr-only">Carregando os canais…</span>
                {[0, 1].map((i) => (
                  <div key={i} className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex gap-3">
                      <Skeleton className="h-11 w-11 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-6 w-52" />
                        <Skeleton className="h-4 w-64 max-w-full" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loadError && sorted !== null && (
              <p role="status" className="rounded-xl border border-warning/35 bg-warning-soft p-3 text-sm text-warning-ink text-pretty">
                Não foi possível atualizar a lista agora ({loadError}). Mostrando o último estado carregado.
              </p>
            )}

            {loadError && sorted === null && (
              <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center">
                <WifiOff className="h-10 w-10 text-destructive" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-foreground">Não foi possível carregar os canais</p>
                  <p className="mt-1 text-sm text-muted-foreground text-pretty">
                    {loadError} Se continuar, fale com o suporte. Seus números continuam funcionando.
                  </p>
                </div>
                <Button variant="outline" className="min-h-10" disabled={reloading} onClick={() => void reload()}>
                  {reloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Tentar de novo
                </Button>
              </div>
            )}

            {sorted && sorted.length === 0 && (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-accent">
                  <MessageCircle className="h-10 w-10 text-accent-foreground" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-heading text-lg font-semibold text-foreground">Nenhum WhatsApp conectado</p>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground text-pretty">
                    Conecte um número para conversar com pacientes, enviar lembretes e confirmar consultas pelo Odonto Connect. Por enquanto, a conexão disponível é a reserva por QR Code; a API oficial da Meta chega em breve.
                  </p>
                </div>
                <Button className="min-h-10" disabled={!!connectBlocked} onClick={openNewQr}>
                  <QrCode className="mr-2 h-4 w-4" />Conectar número reserva (QR Code)
                </Button>
              </div>
            )}

            {sorted && sorted.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                canManage={canManage}
                busy={busy?.id === c.id ? busy.action : null}
                onAction={onAction}
              />
            ))}

            {sorted && sorted.length > 0 && !hasPrimary && (
              <p className="text-sm text-muted-foreground">A clínica está sem número principal. Use <strong className="text-foreground">Tornar principal</strong> em um dos números.</p>
            )}
            {!canManage && sorted && sorted.length > 0 && (
              <p className="text-sm text-muted-foreground">Só o administrador da clínica pode conectar, desconectar ou trocar o número principal.</p>
            )}
          </section>
        </div>
      </div>

      <ReservaQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        channel={qrChannel}
        liveEvent={liveEvent}
        onChanged={() => void load()}
      />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          {confirmText && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmText.title}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="text-sm text-muted-foreground text-pretty">{confirmText.body}</div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-10">Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className={confirmText.destructive ? "min-h-10 bg-destructive text-destructive-foreground hover:bg-destructive/90" : "min-h-10"}
                  onClick={() => { const c = confirm; setConfirm(null); if (c) void runAction(c.kind, c.channel); }}
                >
                  {confirmText.action}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
