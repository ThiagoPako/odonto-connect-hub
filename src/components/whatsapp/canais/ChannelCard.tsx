import { AlertTriangle, History, Loader2, MessageCircle, MoreHorizontal, QrCode, RefreshCw, ShieldCheck, Star, Trash2, Unplug } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { channelLabel, formatChannelPhone, type ChannelState, type WhatsAppChannel } from "@/lib/whatsappChannels";

export type ChannelAction = "qr" | "check" | "disconnect" | "remove" | "primary";

const STATE_BADGE: Record<ChannelState | "unknown", { label: string; tone: string; dot: string }> = {
  open: { label: "Conectado", tone: "bg-success-soft text-success-ink", dot: "bg-success" },
  connecting: { label: "Falta ler o QR Code", tone: "bg-warning-soft text-warning-ink", dot: "bg-warning" },
  close: { label: "Desconectado", tone: "bg-danger-soft text-danger-ink", dot: "bg-destructive" },
  restricted: { label: "Restrito pelo WhatsApp", tone: "bg-danger-soft text-danger-ink", dot: "bg-destructive" },
  unknown: { label: "Sem informação", tone: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-normal break-words", className)}>
      {children}
    </span>
  );
}

export function StateBadge({ state }: { state: ChannelState | null }) {
  const b = STATE_BADGE[state ?? "unknown"];
  return (
    <Pill className={b.tone}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", b.dot)} aria-hidden="true" />
      {b.label}
    </Pill>
  );
}

function ProviderBadge({ provider }: { provider: WhatsAppChannel["provider"] }) {
  if (provider === "cloud") {
    return <Pill className="bg-accent text-accent-foreground"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />API oficial</Pill>;
  }
  if (provider === "openwa") {
    return <Pill className="bg-muted text-foreground"><QrCode className="h-3.5 w-3.5" aria-hidden="true" />QR Code · não oficial</Pill>;
  }
  return <Pill className="border border-dashed border-border text-muted-foreground"><History className="h-3.5 w-3.5" aria-hidden="true" />Sistema anterior</Pill>;
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

function Notice({ tone, title, children, action }: { tone: "warning" | "danger" | "info"; title: string; children: ReactNode; action?: ReactNode }) {
  const tones = {
    warning: "bg-warning-soft text-warning-ink border-warning/35",
    danger: "bg-danger-soft text-danger-ink border-destructive/30",
    info: "bg-info-soft text-info-ink border-info/30",
  } as const;
  return (
    <div role="status" className={cn("mx-4 mb-4 rounded-xl border p-3 sm:mx-5", tones[tone])}>
      <p className="text-sm font-semibold break-words">{title}</p>
      <p className="mt-0.5 text-sm break-words text-pretty">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

interface ChannelCardProps {
  channel: WhatsAppChannel;
  canManage: boolean;
  busy: ChannelAction | null;
  onAction: (action: ChannelAction, channel: WhatsAppChannel) => void;
}

export function ChannelCard({ channel, canManage, busy, onAction }: ChannelCardProps) {
  const phone = formatChannelPhone(channel.displayPhone);
  const label = channelLabel(channel);
  const isQr = channel.provider === "openwa";
  const isLegacy = channel.provider === "evolution";
  const isPrimary = channel.role === "primary";
  const state = channel.state;
  const connectedOn = formatDate(channel.connectedAt);
  const createdOn = formatDate(channel.createdAt);
  const disabled = !canManage || busy !== null;

  const icon = channel.provider === "cloud"
    ? <MessageCircle className="h-5 w-5 text-white" aria-hidden="true" />
    : isQr ? <QrCode className="h-5 w-5 text-foreground" aria-hidden="true" /> : <History className="h-5 w-5 text-muted-foreground" aria-hidden="true" />;

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card" aria-label={`${isPrimary ? "Principal" : "Reserva"}: ${label}`}>
      <div className="flex gap-3 p-4 sm:p-5">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          channel.provider === "cloud" ? "bg-[#25D366]" : isQr ? "border border-border bg-muted" : "bg-muted")}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isPrimary
              ? <Pill className="bg-foreground text-background">Principal</Pill>
              : <Pill className="border border-foreground/70 text-foreground">Reserva</Pill>}
            <ProviderBadge provider={channel.provider} />
            <span className="md:ml-auto"><StateBadge state={state} /></span>
          </div>
          <p className="mt-1.5 font-heading text-lg font-semibold text-foreground whitespace-nowrap">
            {phone || <span className="text-base font-medium text-muted-foreground whitespace-normal">Número aparece depois de conectar</span>}
          </p>
          <p className="text-sm text-muted-foreground break-words">
            {isQr ? "Conexão por QR Code, como um WhatsApp Web no celular." : isLegacy ? "Conexão antiga, que está sendo desligada." : "Conexão oficial da Meta."}
          </p>
        </div>
      </div>

      {isQr && state === "close" && (
        <Notice tone="danger" title="Desconectado"
          action={canManage && <Button size="sm" variant="outline" className="min-h-10 bg-card" disabled={disabled} onClick={() => onAction("qr", channel)}><QrCode className="mr-2 h-4 w-4" />Reconectar com QR Code</Button>}>
          O celular saiu do WhatsApp, ficou sem internet ou desconectou o aparelho. {isPrimary ? "Lembretes e automações não saem enquanto estiver assim." : "A reserva não assume enquanto estiver assim."}
        </Notice>
      )}
      {isQr && state === "connecting" && (
        <Notice tone="warning" title="Falta ler o QR Code no celular"
          action={canManage && <Button size="sm" variant="outline" className="min-h-10 bg-card" disabled={disabled} onClick={() => onAction("qr", channel)}><QrCode className="mr-2 h-4 w-4" />Mostrar QR Code</Button>}>
          O número só começa a funcionar depois que o celular ler o código.
        </Notice>
      )}
      {state === "restricted" && (
        <Notice tone="danger" title="O WhatsApp restringiu este número">
          Abra o WhatsApp no celular deste número para ver o aviso. Enquanto isso, as mensagens por ele podem não sair.
        </Notice>
      )}
      {isLegacy && (
        <Notice tone="info" title="Sistema anterior em desligamento">
          {isPrimary
            ? "Este número ainda é o principal, mas a conexão antiga pode não funcionar. Para não ficar sem WhatsApp, deixe como principal um número conectado por QR Code."
            : "Esta conexão antiga está sendo desligada e não precisa de nenhuma ação."}
        </Notice>
      )}

      {isQr && (
        <dl className="grid grid-cols-1 border-t border-border min-[480px]:grid-cols-2">
          <div className="p-4 sm:p-5 min-[480px]:border-r border-border">
            <dt className="text-sm font-medium text-muted-foreground">Quando é usado</dt>
            <dd className="mt-1">
              <p className="font-semibold text-foreground">{isPrimary ? "Em todos os envios" : "Se o principal cair"}</p>
              <p className="text-sm text-muted-foreground text-pretty">
                {isPrimary ? "Lembretes, confirmações e automações saem por ele." : "Assume o chat e os lembretes quando o principal está fora do ar."}
              </p>
            </dd>
          </div>
          <div className="border-t border-border p-4 sm:p-5 min-[480px]:border-t-0">
            <dt className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Risco</dt>
            <dd className="mt-1">
              <Pill className="bg-warning-soft text-warning-ink">Pode ser bloqueado</Pill>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">Conexão não autorizada pelo WhatsApp. Evite campanhas e mensagens para quem não tem o número salvo.</p>
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/50 px-4 py-3 sm:px-5">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground break-words">
          {state === "open" && connectedOn ? `Conectado em ${connectedOn}` : createdOn ? `Adicionado em ${createdOn}` : " "}
        </p>
        {!isPrimary && !isLegacy && channel.status === "active" && (
          <Button size="sm" variant="outline" className="min-h-10 bg-card" disabled={disabled} onClick={() => onAction("primary", channel)}>
            {busy === "primary" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Star className="mr-2 h-4 w-4" />}
            Tornar principal
          </Button>
        )}
        {isQr && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-10 w-10" disabled={busy !== null} aria-label={`Mais ações para ${label}`}>
                {busy && busy !== "primary" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" collisionPadding={8}>
              <DropdownMenuItem onSelect={() => onAction("check", channel)}>
                <RefreshCw className="mr-2 h-4 w-4" />Verificar conexão agora
              </DropdownMenuItem>
              {state !== "open" && (
                <DropdownMenuItem disabled={!canManage} onSelect={() => onAction("qr", channel)}>
                  <QrCode className="mr-2 h-4 w-4" />Mostrar QR Code
                </DropdownMenuItem>
              )}
              {(state === "open" || state === "connecting" || state === "restricted") && (
                <DropdownMenuItem disabled={!canManage} onSelect={() => onAction("disconnect", channel)}>
                  <Unplug className="mr-2 h-4 w-4" />Desconectar
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canManage} className="text-destructive focus:text-destructive" onSelect={() => onAction("remove", channel)}>
                <Trash2 className="mr-2 h-4 w-4" />Remover número
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </article>
  );
}
