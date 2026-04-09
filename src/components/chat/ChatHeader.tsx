import { useState } from "react";
import type { Lead } from "@/data/chatMockData";
import { Phone, Video, MoreVertical, X, ArrowRightLeft } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";
import { toast } from "sonner";

// Mock attendants list
const attendants = [
  { id: "att1", name: "Ana Rodrigues", initials: "AR" },
  { id: "att2", name: "Beatriz Lima", initials: "BL" },
  { id: "att3", name: "Carla Mendes", initials: "CM" },
  { id: "att4", name: "Daniel Souza", initials: "DS" },
];

interface ChatHeaderProps {
  lead: Lead;
  onClose: () => void;
  onTransfer?: (lead: Lead, toAttendantId: string, toAttendantName: string) => void;
}

export function ChatHeader({ lead, onClose, onTransfer }: ChatHeaderProps) {
  const [showTransfer, setShowTransfer] = useState(false);

  const handleTransfer = (att: typeof attendants[0]) => {
    onTransfer?.(lead, att.id, att.name);
    setShowTransfer(false);
    toast.success(`Atendimento transferido para ${att.name}`, {
      description: `${lead.name} foi transferido com sucesso`,
    });
  };

  return (
    <div className="h-16 flex items-center justify-between px-4 border-b border-border bg-card shrink-0 relative">
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
        <button
          onClick={() => setShowTransfer(!showTransfer)}
          className={`p-2 rounded-lg transition-colors ${showTransfer ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}
          title="Transferir atendimento"
        >
          <ArrowRightLeft className="h-4 w-4" />
        </button>
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

      {/* Transfer dropdown */}
      {showTransfer && (
        <div className="absolute top-full right-4 mt-1 w-64 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-xs font-semibold text-foreground">Transferir para</p>
            <p className="text-[11px] text-muted-foreground">Selecione o atendente</p>
          </div>
          <div className="py-1 max-h-48 overflow-y-auto">
            {attendants.map((att) => (
              <button
                key={att.id}
                onClick={() => handleTransfer(att)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                  {att.initials}
                </div>
                <span className="text-sm text-foreground">{att.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
