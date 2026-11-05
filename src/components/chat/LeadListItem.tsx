import type { Lead } from "@/data/chatMockData";
import { Clock, UserPlus, CheckCircle2, Flame, AlertCircle } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";
import { Button } from "@/components/ui/button";

type PresenceStatus = "online" | "offline" | "typing" | "recording";

const CRM_STAGE_LABELS: Record<string, { label: string; color: string }> = {
  lead: { label: "Lead", color: "#6b7280" },
  em_atendimento: { label: "Atendimento", color: "#3b82f6" },
  orcamento: { label: "Orçamento", color: "#3b82f6" },
  orcamento_enviado: { label: "Orç. Enviado", color: "#8b5cf6" },
  orcamento_aprovado: { label: "Aprovado", color: "#22c55e" },
  followup: { label: "Follow-up", color: "#f59e0b" },
  followup_2: { label: "Follow-up 2", color: "#f59e0b" },
  followup_3: { label: "Follow-up 3", color: "#ef4444" },
  sem_resposta: { label: "Sem Resposta", color: "#6b7280" },
  orcamento_reprovado: { label: "Orç. Reprovado", color: "#ef4444" },
  desqualificado: { label: "Desqualificado", color: "#6b7280" },
};

interface LeadListItemProps {
  lead: Lead;
  isSelected: boolean;
  onSelect: (lead: Lead) => void;
  showAssignButton?: boolean;
  onAssign?: (lead: Lead) => void;
  presence?: PresenceStatus;
  crmStage?: string;
}

export function LeadListItem({ lead, isSelected, onSelect, showAssignButton, onAssign, presence = "offline", crmStage }: LeadListItemProps) {
  const timeAgo = getTimeAgo(lead.lastMessageTime);
  const isWaiting = lead.status === "waiting";
  const longWait = isWaiting && isLongWait(lead.lastMessageTime);
  const showStageChip = !!(crmStage && CRM_STAGE_LABELS[crmStage] && crmStage !== "lead");
  const showMetaRow = !!(lead.priority || showStageChip || lead.queueName);
  const showAssign = !!(showAssignButton && onAssign);

  return (
    <div
      onClick={() => onSelect(lead)}
      className={`lead-list-item flex items-start gap-3 px-4 py-3.5 cursor-pointer border-b border-border/30 relative overflow-hidden ${
        lead.priority
          ? isSelected
            ? "bg-warning/10 border-l-[3px] border-l-warning"
            : "bg-warning/5 border-l-[3px] border-l-warning hover:bg-warning/10"
          : isSelected
            ? "bg-primary/10 border-l-[3px] border-l-primary"
            : "hover:bg-muted/40 border-l-[3px] border-l-transparent"
      }`}
    >
      {/* Botão que cobre o item: dá foco e Enter/Espaço sem aninhar o botão Assumir dentro de outro botão */}
      <button
        type="button"
        aria-current={isSelected ? "true" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(lead);
        }}
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="sr-only">Abrir conversa com {lead.name}</span>
      </button>
      <div className="relative shrink-0">
        <LeadAvatar initials={lead.initials} avatarUrl={lead.avatarUrl} avatarColor={lead.avatarColor || "bg-primary/20"} size="md" />
        {lead.status === "finished" ? (
          <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-muted border-2 border-card flex items-center justify-center">
            <CheckCircle2 className="h-2.5 w-2.5 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Atendimento finalizado</span>
          </div>
        ) : (presence === "online" || presence === "typing" || presence === "recording") ? (
          <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-success border-2 border-card">
            <span className="sr-only">Online</span>
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-w-0 relative z-10">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <span className="text-sm font-semibold truncate text-foreground min-w-0">
            {lead.name}
          </span>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className={`flex items-center gap-1 text-xs font-medium tabular-nums ${getWaitUrgencyClass(lead)}`}>
              {isWaiting ? (
                <>
                  {longWait ? (
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>
                    <span className="sr-only">{longWait ? "Espera longa: aguardando há " : "Aguardando há "}</span>
                    {getDetailedWaitTime(lead.lastMessageTime)}
                  </span>
                </>
              ) : (
                <span>{timeAgo}</span>
              )}
            </div>
            {lead.unreadCount > 0 && (
              <span className="min-h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold tabular-nums flex items-center justify-center">
                <span aria-hidden="true">{lead.unreadCount > 99 ? "99+" : lead.unreadCount}</span>
                <span className="sr-only">{lead.unreadCount} mensagens não lidas</span>
              </span>
            )}
          </div>
        </div>

        {presence === "typing" ? (
          <div className="flex items-center gap-1.5 min-h-5">
            <div className="flex items-center gap-[3px]" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-[5px] h-[5px] rounded-full bg-primary/70"
                  style={{
                    animation: `typingBounce 1s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-primary font-medium">digitando…</span>
          </div>
        ) : presence === "recording" ? (
          <div className="flex items-center gap-1.5 min-h-5">
            <div className="flex items-end gap-[2px] h-3.5" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="w-[2.5px] rounded-full bg-destructive/70"
                  style={{
                    animation: `soundwave 0.8s ease-in-out ${i * 0.12}s infinite alternate`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-destructive font-medium">gravando áudio…</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground truncate leading-relaxed">{lead.lastMessage}</p>
        )}

        {showMetaRow && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {lead.priority && (
              <span className="inline-flex min-h-6 items-center gap-1 rounded-md bg-warning/15 px-2 text-xs font-semibold text-warning-text">
                <Flame className="h-3.5 w-3.5" aria-hidden="true" /> Recuperação
              </span>
            )}
            {showStageChip && crmStage && (
              <span className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 text-xs font-medium text-foreground">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: CRM_STAGE_LABELS[crmStage].color }} />
                {CRM_STAGE_LABELS[crmStage].label}
              </span>
            )}
            {lead.queueName && (
              <span className="inline-flex min-h-6 items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium text-foreground">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: lead.queueColor || "var(--color-primary)" }} />
                {lead.queueName}
              </span>
            )}
          </div>
        )}

        {showAssign && (
          <div className="flex items-center justify-end mt-2">
            <Button
              type="button"
              size="sm"
              aria-label={`Assumir conversa com ${lead.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onAssign?.(lead);
              }}
              className="h-11 md:h-9 gap-1.5 px-3 text-sm"
            >
              <UserPlus />
              Assumir
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function getTimeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function getDetailedWaitTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "agora";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} min`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function getWaitUrgencyClass(lead: { status: string; lastMessageTime: Date }): string {
  if (lead.status !== "waiting") return "text-muted-foreground";
  const diff = Math.floor((Date.now() - lead.lastMessageTime.getTime()) / 1000);
  if (diff < 300) return "text-success";        // < 5min — green
  if (diff < 900) return "text-warning-text";    // 5-15min — aviso
  return "text-destructive font-semibold";       // > 15min — espera longa (ícone muda também)
}

function isLongWait(date: Date): boolean {
  return Math.floor((Date.now() - date.getTime()) / 1000) >= 900;
}
