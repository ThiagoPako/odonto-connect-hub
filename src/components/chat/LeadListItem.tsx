import type { Lead } from "@/data/chatMockData";
import { Clock, UserPlus, CheckCircle2 } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";

type PresenceStatus = "online" | "offline" | "typing" | "recording";

const CRM_STAGE_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  lead: { label: "Lead", emoji: "📥", color: "#6b7280" },
  em_atendimento: { label: "Atendimento", emoji: "💬", color: "#3b82f6" },
  orcamento: { label: "Orçamento", emoji: "📋", color: "#3b82f6" },
  orcamento_enviado: { label: "Orç. Enviado", emoji: "📨", color: "#8b5cf6" },
  orcamento_aprovado: { label: "Aprovado", emoji: "✅", color: "#22c55e" },
  followup: { label: "Follow-up", emoji: "🔄", color: "#f59e0b" },
  followup_2: { label: "Follow-up 2", emoji: "🔄", color: "#f59e0b" },
  followup_3: { label: "Follow-up 3", emoji: "🔄", color: "#ef4444" },
  sem_resposta: { label: "Sem Resposta", emoji: "⏳", color: "#6b7280" },
  orcamento_reprovado: { label: "Orç. Reprovado", emoji: "❌", color: "#ef4444" },
  desqualificado: { label: "Desqualificado", emoji: "🚫", color: "#6b7280" },
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

  return (
    <div
      onClick={() => onSelect(lead)}
      className={`lead-list-item flex items-start gap-3 px-4 py-3.5 cursor-pointer border-b border-border/30 relative overflow-hidden ${
        isSelected
          ? "bg-primary/5 border-l-[3px] border-l-primary shadow-sm"
          : "hover:bg-muted/40 border-l-[3px] border-l-transparent"
      }`}
    >
      {/* Subtle gradient overlay on selected */}
      {isSelected && (
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
      )}

      <div className="relative">
        <LeadAvatar initials={lead.initials} avatarUrl={lead.avatarUrl} avatarColor={lead.avatarColor || "bg-primary/20"} size="md" />
        {lead.status === "finished" ? (
          <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-muted border-2 border-card flex items-center justify-center">
            <CheckCircle2 className="h-2.5 w-2.5 text-muted-foreground" />
          </div>
        ) : (presence === "online" || presence === "typing" || presence === "recording") ? (
          <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-success border-2 border-card shadow-sm" />
        ) : null}
      </div>

      <div className="flex-1 min-w-0 relative z-10">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-sm font-semibold truncate transition-colors ${isSelected ? "text-primary" : "text-foreground"}`}>
              {lead.name}
            </span>
            {crmStage && CRM_STAGE_LABELS[crmStage] && crmStage !== "lead" && (
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[8px] font-bold text-white leading-4 shadow-sm shrink-0"
                style={{ backgroundColor: CRM_STAGE_LABELS[crmStage].color }}
              >
                {CRM_STAGE_LABELS[crmStage].emoji} {CRM_STAGE_LABELS[crmStage].label}
              </span>
            )}
          </div>
          <div className={`flex items-center gap-1 shrink-0 ml-1 ${getWaitUrgencyClass(lead)}`}>
            <Clock className="h-3 w-3" />
            <span className="text-[11px] font-medium">{lead.status === "waiting" ? `⏳ ${getDetailedWaitTime(lead.lastMessageTime)}` : timeAgo}</span>
          </div>
        </div>

        {presence === "typing" ? (
          <div className="flex items-center gap-1.5 h-5">
            <div className="flex items-center gap-[3px]">
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
            <span className="text-xs text-primary font-medium">digitando...</span>
          </div>
        ) : presence === "recording" ? (
          <div className="flex items-center gap-1.5 h-5">
            <div className="flex items-end gap-[2px] h-3.5">
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
            <span className="text-xs text-destructive font-medium">gravando áudio...</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground truncate leading-relaxed">{lead.lastMessage}</p>
        )}

        {tagIds.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {allTags.filter((t) => tagIds.includes(t.id)).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-semibold text-white leading-4 shadow-sm"
                style={{ backgroundColor: tag.color }}
              >
                {tag.icon} {tag.name}
              </span>
            ))}
          </div>
        )}

        {lead.queueName && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold text-white mt-1 shadow-sm"
            style={{ backgroundColor: lead.queueColor || "hsl(var(--primary))" }}
          >
            {lead.queueName}
          </span>
        )}

        <div className="flex items-center justify-between mt-2">
          {lead.unreadCount > 0 ? (
            <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shadow-sm animate-badge-pulse">
              {lead.unreadCount}
            </span>
          ) : (
            <span />
          )}

          {showAssignButton && onAssign && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAssign(lead);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all hover:shadow-md active:scale-95"
            >
              <UserPlus className="h-3 w-3" />
              Assumir
            </button>
          )}
        </div>
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
  if (diff < 900) return "text-warning";         // 5-15min — yellow
  return "text-destructive animate-pulse";       // > 15min — red pulsing
}
