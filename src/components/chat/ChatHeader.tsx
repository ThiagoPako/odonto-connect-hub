import { useState, useEffect } from "react";
import type { Lead } from "@/data/chatMockData";
import { Phone, Video, MoreVertical, X, ArrowRightLeft, Loader2 } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";
import { toast } from "sonner";
import { adminListUsers } from "@/lib/vpsApi";

interface Attendant {
  id: string;
  name: string;
  initials: string;
}

interface ChatHeaderProps {
  lead: Lead;
  onClose: () => void;
  onTransfer?: (lead: Lead, toAttendantId: string, toAttendantName: string) => void;
}

export function ChatHeader({ lead, onClose, onTransfer }: ChatHeaderProps) {
  const [showTransfer, setShowTransfer] = useState(false);
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!showTransfer) return;
    setLoading(true);
    adminListUsers().then(({ data, error }) => {
      if (data && Array.isArray(data)) {
        const list: Attendant[] = data
          .filter((u) => u.active)
          .map((u) => ({
            id: u.id,
            name: u.name,
            initials: u.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase(),
          }));
        setAttendants(list);
      } else if (error) {
        toast.error("Erro ao carregar atendentes");
      }
      setLoading(false);
    });
  }, [showTransfer]);

  const handleTransfer = (att: Attendant) => {
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

      {showTransfer && (
        <div className="absolute top-full right-4 mt-1 w-64 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-xs font-semibold text-foreground">Transferir para</p>
            <p className="text-[11px] text-muted-foreground">Selecione o atendente</p>
          </div>
          <div className="py-1 max-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : attendants.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum atendente disponível</p>
            ) : (
              attendants.map((att) => (
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
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
