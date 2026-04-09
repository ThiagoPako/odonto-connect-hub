import type { Lead } from "@/data/chatMockData";
import { Clock, UserPlus } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";

interface LeadListItemProps {
  lead: Lead;
  isSelected: boolean;
  onSelect: (lead: Lead) => void;
  showAssignButton?: boolean;
  onAssign?: (lead: Lead) => void;
}

export function LeadListItem({ lead, isSelected, onSelect, showAssignButton, onAssign }: LeadListItemProps) {
  const timeAgo = getTimeAgo(lead.lastMessageTime);

  return (
    <div
      onClick={() => onSelect(lead)}
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-border/50 ${
        isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/50"
      }`}
    >
      <LeadAvatar initials={lead.initials} avatarUrl={lead.avatarUrl} avatarColor={lead.avatarColor || "bg-primary/20"} size="md" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm font-medium text-foreground truncate">{lead.name}</span>
          <div className="flex items-center gap-1 text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            <span className="text-[11px]">{timeAgo}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground truncate">{lead.lastMessage}</p>

        <div className="flex items-center justify-between mt-1.5">
          {lead.unreadCount > 0 && (
            <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {lead.unreadCount}
            </span>
          )}
          {lead.unreadCount === 0 && <span />}

          {showAssignButton && onAssign && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAssign(lead);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
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
