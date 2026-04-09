import type { Lead } from "@/data/chatMockData";
import { Phone, Video, MoreVertical, X } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";

interface ChatHeaderProps {
  lead: Lead;
  onClose: () => void;
}

export function ChatHeader({ lead, onClose }: ChatHeaderProps) {
  return (
    <div className="h-16 flex items-center justify-between px-4 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-3">
        <LeadAvatar initials={lead.initials} avatarUrl={lead.avatarUrl} avatarColor={lead.avatarColor || "bg-primary/20"} size="md" />
        <div>
          <p className="text-sm font-medium text-foreground">{lead.name}</p>
          <p className="text-xs text-success flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
            Online
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <Phone className="h-4 w-4" />
        </button>
        <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <Video className="h-4 w-4" />
        </button>
        <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <MoreVertical className="h-4 w-4" />
        </button>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground ml-1">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
