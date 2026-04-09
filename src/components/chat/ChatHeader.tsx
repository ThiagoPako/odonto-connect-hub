import { useState, useEffect } from "react";
import type { Lead } from "@/data/chatMockData";
import { Phone, Video, MoreVertical, X, ArrowRightLeft, Loader2, ArrowLeft, Tags, Check, CheckCircle2 } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";
import { toast } from "sonner";
import { adminListUsers, tagsApi, type LeadTagApi } from "@/lib/vpsApi";
import { useAuth } from "@/hooks/useAuth";

interface Attendant {
  id: string;
  name: string;
  initials: string;
}

interface ChatHeaderProps {
  lead: Lead;
  onClose: () => void;
  onTransfer?: (lead: Lead, toAttendantId: string, toAttendantName: string, reason: string) => void;
  onFinishAttendance?: (lead: Lead) => void;
  leadTagIds?: string[];
  onToggleTag?: (leadId: string, tagId: string) => void;
}

export function ChatHeader({ lead, onClose, onTransfer, onFinishAttendance, leadTagIds = [], onToggleTag }: ChatHeaderProps) {
  const { user: currentUser } = useAuth();
  const [showTransfer, setShowTransfer] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAtt, setSelectedAtt] = useState<Attendant | null>(null);
  const [reason, setReason] = useState("");
  const [allTags, setAllTags] = useState<LeadTagApi[]>([]);

  useEffect(() => {
    tagsApi.list().then(({ data }) => { if (data) setAllTags(data); });
  }, []);

  useEffect(() => {
    if (!showTransfer) return;
    setLoading(true);
    adminListUsers().then(({ data, error }) => {
      if (data && Array.isArray(data)) {
        const list: Attendant[] = data
          .filter((u) => u.active && u.id !== currentUser?.id)
          .map((u) => ({
            id: u.id,
            name: u.name,
            initials: u.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
          }));
        setAttendants(list);
      } else if (error) {
        toast.error("Erro ao carregar atendentes");
      }
      setLoading(false);
    });
  }, [showTransfer, currentUser?.id]);

  const handleConfirmTransfer = () => {
    if (!selectedAtt) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Informe o motivo da transferência");
      return;
    }
    onTransfer?.(lead, selectedAtt.id, selectedAtt.name, trimmed);
    setShowTransfer(false);
    setSelectedAtt(null);
    setReason("");
    toast.success(`Atendimento transferido para ${selectedAtt.name}`, {
      description: `${lead.name} foi transferido com sucesso`,
    });
  };

  const handleClose = () => {
    setShowTransfer(false);
    setSelectedAtt(null);
    setReason("");
  };

  return (
    <div className="h-16 flex items-center justify-between px-4 border-b border-border bg-card shrink-0 relative">
      <div className="flex items-center gap-3">
        <LeadAvatar initials={lead.initials} avatarUrl={lead.avatarUrl} avatarColor={lead.avatarColor || "bg-primary/20"} size="md" />
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{lead.name}</p>
            {leadTagIds.length > 0 && (
              <div className="flex items-center gap-1">
                {allTags.filter((t) => leadTagIds.includes(t.id)).map((tag) => (
                  <span key={tag.id} className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-semibold text-white" style={{ backgroundColor: tag.color }}>
                    {tag.icon} {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-success flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
            Online
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => { setShowTagMenu(!showTagMenu); setShowTransfer(false); }}
          className={`p-2 rounded-lg transition-colors ${showTagMenu ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}
          title="Tags"
        >
          <Tags className="h-4 w-4" />
        </button>
        <button
          onClick={() => { setShowTransfer(!showTransfer); setShowTagMenu(false); handleClose(); }}
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
        {lead.status === "active" && onFinishAttendance && (
          <button
            onClick={() => {
              if (confirm(`Finalizar atendimento de ${lead.name}? Uma pesquisa de satisfação será enviada.`)) {
                onFinishAttendance(lead);
              }
            }}
            className="p-2 rounded-lg hover:bg-green-500/10 transition-colors text-green-600"
            title="Finalizar atendimento"
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
        )}
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground ml-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      {showTransfer && (
        <div className="absolute top-full right-4 mt-1 w-72 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          {!selectedAtt ? (
            <>
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
                      onClick={() => setSelectedAtt(att)}
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
            </>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
                <button
                  onClick={() => { setSelectedAtt(null); setReason(""); }}
                  className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <div>
                  <p className="text-xs font-semibold text-foreground">Transferir para {selectedAtt.name}</p>
                  <p className="text-[11px] text-muted-foreground">Informe o motivo da transferência</p>
                </div>
              </div>
              <div className="p-3 space-y-3">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 500))}
                  placeholder="Ex: Paciente precisa de avaliação ortodôntica..."
                  className="w-full h-20 px-3 py-2 rounded-lg bg-muted border-0 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{reason.trim().length}/500</span>
                  <button
                    onClick={handleConfirmTransfer}
                    disabled={!reason.trim()}
                    className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Transferir
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {showTagMenu && (
        <div className="absolute top-full right-4 mt-1 w-56 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-xs font-semibold text-foreground">Tags do Lead</p>
            <p className="text-[11px] text-muted-foreground">Clique para adicionar/remover</p>
          </div>
          <div className="py-1 max-h-48 overflow-y-auto">
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma tag criada. Vá em Configurações.</p>
            ) : (
              allTags.map((tag) => {
                const active = leadTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => onToggleTag?.(lead.id, tag.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                  >
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: tag.color }}>
                      {tag.icon} {tag.name}
                    </span>
                    <span className="flex-1" />
                    {active && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
