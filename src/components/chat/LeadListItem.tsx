import type { Lead } from "@/data/chatMockData";
import type { LeadTagApi } from "@/lib/vpsApi";
import { Clock, UserPlus } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";

interface LeadListItemProps {
  lead: Lead;
  isSelected: boolean;
  onSelect: (lead: Lead) => void;
  showAssignButton?: boolean;
  onAssign?: (lead: Lead) => void;
  tagIds?: string[];
  allTags?: LeadTagApi[];
}

export function LeadListItem({ lead, isSelected, onSelect, showAssignButton, onAssign, tagIds = [], allTags = [] }: LeadListItemProps) {
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
        {lead.status === "active" && (
          <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-success border-2 border-card" />
        )}
      </div>

      <div className="flex-1 min-w-0 relative z-10">
        <div className="flex items-center justify-between mb-0.5">
          <span className={`text-sm font-semibold truncate transition-colors ${isSelected ? "text-primary" : "text-foreground"}`}>
            {lead.name}
          </span>
          <div className="flex items-center gap-1 text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            <span className="text-[11px] font-medium">{timeAgo}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground truncate leading-relaxed">{lead.lastMessage}</p>

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
