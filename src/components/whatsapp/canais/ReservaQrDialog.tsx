import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Monitor, QrCode, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  formatChannelPhone,
  qrImageSrc,
  whatsappChannelsApi,
  type ChannelStateEvent,
  type WhatsAppChannel,
} from "@/lib/whatsappChannels";

type Step = "riscos" | "gerando" | "qr" | "expirou" | "pronto" | "erro";

/** Busca o QR a cada 10 s; depois de 5 min sem leitura para (evita sessão girando sozinha). */
const QR_POLL_MS = 10_000;
const QR_GIVE_UP_MS = 5 * 60_000;

interface ReservaQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Canal QR já existente (reconectar). Sem canal: cria um novo depois do aceite do risco. */
  channel: WhatsAppChannel | null;
  /** Último evento `whatsapp_channel_state` recebido pela página (SSE). */
  liveEvent: ChannelStateEvent | null;
  /** Avisa a página para recarregar a lista (canal criado, conectado etc.). */
  onChanged: () => void;
}

export function ReservaQrDialog({ open, onOpenChange, channel, liveEvent, onChanged }: ReservaQrDialogProps) {
  const isMobile = useIsMobile();
  const [step, setStep] = useState<Step>("riscos");
  const [accepted, setAccepted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [connected, setConnected] = useState<WhatsAppChannel | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stepRef = useRef<Step>(step);
  stepRef.current = step;
  const openRef = useRef(open);
  openRef.current = open;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const stopPolling = () => { clearTimeout(timer.current); timer.current = undefined; };

  const finish = useCallback(async (id: string) => {
    stopPolling();
    setStep("pronto");
    const { data } = await whatsappChannelsApi.state(id);
    if (data?.channel) setConnected(data.channel);
    onChangedRef.current();
  }, []);

  const poll = useCallback(async (id: string) => {
    stopPolling();
    if (Date.now() - startedAt.current > QR_GIVE_UP_MS) { setStep("expirou"); return; }
    const { data, error: err } = await whatsappChannelsApi.qr(id);
    if (!openRef.current) return;
    if (stepRef.current === "pronto" || stepRef.current === "expirou" || stepRef.current === "riscos") return;
    if (err) { setError(err); setStep("erro"); return; }
    if (data?.state === "open") { await finish(id); return; }
    const src = qrImageSrc(data?.qr);
    if (src) { setQr(src); setStep("qr"); }
    // Sem QR ainda (o servidor de WhatsApp está gerando): tenta de novo mais cedo.
    timer.current = setTimeout(() => void poll(id), src ? QR_POLL_MS : 3_000);
  }, [finish]);

  const startQr = useCallback((id: string) => {
    setChannelId(id);
    setQr(null);
    setError(null);
    setStep("gerando");
    startedAt.current = Date.now();
    void poll(id);
  }, [poll]);

  // Abrir/fechar: reconectar vai direto ao QR; novo começa pelos riscos.
  useEffect(() => {
    if (!open) { stopPolling(); return; }
    setAccepted(false);
    setConnected(null);
    setError(null);
    setQr(null);
    if (channel) startQr(channel.id);
    else { setChannelId(null); setStep("riscos"); }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel?.id]);

  // Evento em tempo real do canal deste diálogo.
  useEffect(() => {
    if (!open || !liveEvent || !channelId || liveEvent.channelId !== channelId) return;
    if (liveEvent.state === "open") { void finish(channelId); return; }
    const src = qrImageSrc(liveEvent.qr);
    if (src && (stepRef.current === "gerando" || stepRef.current === "qr")) { setQr(src); setStep("qr"); }
  }, [liveEvent, open, channelId, finish]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    const { data, error: err } = await whatsappChannelsApi.createReserva();
    setCreating(false);
    if (err || !data?.channel) {
      setError(err || "Não foi possível conectar o número reserva. Tente de novo em alguns minutos.");
      setStep("erro");
      return;
    }
    onChangedRef.current();
    if (data.channel.state === "open") { setChannelId(data.channel.id); void finish(data.channel.id); return; }
    startQr(data.channel.id);
  };

  const retry = () => {
    if (channelId) startQr(channelId);
    else { setError(null); setStep("riscos"); }
  };

  const phone = formatChannelPhone(connected?.displayPhone);
  const isPrimary = connected?.role === "primary";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {step === "riscos" && (
          <>
            <DialogHeader>
              <DialogTitle>Conectar número reserva por QR Code</DialogTitle>
              <DialogDescription className="text-pretty">
                O número reserva assume o chat e os lembretes se o principal cair. Ele é conectado como um WhatsApp Web, sem autorização do WhatsApp.
              </DialogDescription>
            </DialogHeader>

            <div role="note" className="rounded-xl border border-destructive/30 bg-danger-soft p-4 text-danger-ink">
              <p className="flex items-start gap-2 font-semibold">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Este número pode ser bloqueado pelo WhatsApp
              </p>
              <p className="mt-1 text-sm text-pretty">
                Conexões por QR Code não são oficiais. O WhatsApp pode banir o número, principalmente se ele enviar muitas mensagens para quem não tem o contato salvo. <strong>Use um número que a clínica aceita perder.</strong>
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-semibold text-foreground">O que a clínica precisa</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>Celular com o WhatsApp deste número, ligado e com internet.</li>
                  <li>Que o celular não peça <strong className="text-foreground">chave de acesso (passkey)</strong> para conectar aparelhos.</li>
                  <li>Um computador para mostrar o QR Code (o celular não lê a própria tela).</li>
                </ul>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-semibold text-foreground">Para diminuir o risco</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>Use um número em uso há algum tempo, com conversas reais.</li>
                  <li>Não faça campanhas nem disparos por este número.</li>
                  <li>Não use o mesmo número da API oficial.</li>
                </ul>
              </div>
            </div>

            <label htmlFor="aceite-risco-qr" className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <Checkbox id="aceite-risco-qr" checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
              <span className="text-sm font-medium text-foreground">Entendi o risco de bloqueio e quero usar este número como reserva.</span>
            </label>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button className="min-h-10" disabled={!accepted || creating} onClick={() => void handleCreate()}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                {creating ? "Preparando…" : "Gerar QR Code"}
              </Button>
            </DialogFooter>
          </>
        )}

        {(step === "gerando" || step === "qr" || step === "expirou") && (
          <>
            <DialogHeader>
              <DialogTitle>Leia o QR Code com o celular</DialogTitle>
              <DialogDescription>Use o celular do número reserva.</DialogDescription>
            </DialogHeader>

            {isMobile && (
              <div role="status" className="rounded-xl border border-info/30 bg-info-soft p-3 text-info-ink">
                <p className="flex items-center gap-2 text-sm font-semibold"><Monitor className="h-4 w-4 shrink-0" aria-hidden="true" />Abra esta tela num computador</p>
                <p className="mt-0.5 text-sm text-pretty">O celular que vai ler o código não consegue ler a própria tela. Entre no Odonto Connect pelo computador da recepção ou use outro aparelho.</p>
              </div>
            )}

            <div className="flex flex-col items-center gap-5 md:flex-row md:items-start">
              <div className="relative flex h-[248px] w-[248px] shrink-0 items-center justify-center rounded-2xl border border-border bg-white p-3 sm:h-[280px] sm:w-[280px]">
                {step === "gerando" || !qr ? (
                  <Skeleton className="h-full w-full motion-reduce:animate-none" aria-label="Gerando o QR Code…" />
                ) : (
                  <img src={qr} alt="QR Code para conectar o número reserva" className={cn("h-full w-full object-contain", step === "expirou" && "opacity-15")} />
                )}
                {step === "expirou" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                    <p className="font-semibold text-neutral-900">O código expirou</p>
                    <Button size="sm" className="min-h-10" onClick={retry}><RefreshCw className="mr-2 h-4 w-4" />Gerar outro</Button>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
                  <li>Abra o WhatsApp no celular do número reserva.</li>
                  <li>Android: toque em <strong>⋮ › Aparelhos conectados</strong>. iPhone: <strong>Configurações › Aparelhos conectados</strong>.</li>
                  <li>Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o código.</li>
                </ol>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
                  {step === "gerando"
                    ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Gerando o código…</>
                    : step === "expirou"
                      ? "Paramos de gerar códigos depois de 5 minutos sem leitura."
                      : <><RefreshCw className="h-4 w-4" aria-hidden="true" />O código muda sozinho. A tela atualiza sozinha.</>}
                </p>
                <div className="flex gap-2 rounded-xl border border-border bg-muted/60 p-3 text-sm text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-pretty">Deixe o celular ligado e com internet. Se ele ficar desligado muito tempo, a reserva desconecta e é preciso ler o código de novo.</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </>
        )}

        {step === "pronto" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-success" aria-hidden="true" />
            <DialogHeader className="items-center text-center sm:text-center">
              <DialogTitle>{isPrimary ? "WhatsApp conectado" : "Reserva conectada"}</DialogTitle>
              <DialogDescription className="text-pretty">
                {phone ? <strong className="whitespace-nowrap text-foreground">{phone}</strong> : "O número"}{" "}
                {isPrimary ? "agora é o número principal da clínica: lembretes e automações saem por ele." : "assume o chat e os lembretes se o principal cair."}
              </DialogDescription>
            </DialogHeader>
            <Button className="mt-2 min-h-10" onClick={() => onOpenChange(false)}>Concluir</Button>
          </div>
        )}

        {step === "erro" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />Não foi possível continuar</DialogTitle>
            </DialogHeader>
            <p role="alert" className="text-sm text-foreground text-pretty">{error}</p>
            <p className="text-sm text-muted-foreground text-pretty">Se continuar, fale com o suporte. O número principal continua como está.</p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button className="min-h-10" onClick={retry}><RefreshCw className="mr-2 h-4 w-4" />Tentar de novo</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
