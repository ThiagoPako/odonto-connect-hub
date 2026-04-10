import { useState, useEffect } from "react";
import type { Lead, ChatMessage } from "@/data/chatMockData";
import { Phone, Video, MoreVertical, X, ArrowRightLeft, Loader2, ArrowLeft, Tags, Check, CheckCircle2, Download } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";
import { toast } from "sonner";
import { adminListUsers, tagsApi, whatsappApi, type LeadTagApi } from "@/lib/vpsApi";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { useAuth } from "@/hooks/useAuth";
import { FinishAttendanceDialog } from "./FinishAttendanceDialog";
import { exportChatToPdf } from "@/lib/chatPdfExport";

function formatLastSeen(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

interface Attendant {
  id: string;
  name: string;
  initials: string;
}

type PresenceDisplay = "online" | "offline" | "typing" | "recording";

interface ChatHeaderProps {
  lead: Lead;
  onClose: () => void;
  onTransfer?: (lead: Lead, toAttendantId: string, toAttendantName: string, reason: string) => void;
  onFinishAttendance?: (lead: Lead, farewellMessage?: string) => void;
  onReturnToQueue?: (lead: Lead) => void;
  leadTagIds?: string[];
  onToggleTag?: (leadId: string, tagId: string) => void;
  messages?: ChatMessage[];
  presence?: PresenceDisplay;
  lastSeen?: Date | null;
}

export function ChatHeader({ lead, onClose, onTransfer, onFinishAttendance, onReturnToQueue, leadTagIds = [], onToggleTag, messages = [], presence = "offline", lastSeen }: ChatHeaderProps) {
  const { user: currentUser } = useAuth();
  const { connected: connectedInstances } = useWhatsAppInstances();
  const [calling, setCalling] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
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

  const handleDownloadPdf = () => {
    if (messages.length === 0) {
      toast.error("Nenhuma mensagem para exportar");
      return;
    }
    exportChatToPdf(messages, lead.name, lead.phone);
    toast.success("Exportação iniciada", { description: "Use Ctrl+P para salvar como PDF" });
  };

  const handleCall = async (isVideo: boolean) => {
    if (!lead.phone) {
      toast.error("Contato sem número de telefone");
      return;
    }
    const cleanNumber = lead.phone.replace(/\D/g, "");
    
    // Try Evolution API call first
    const instance = connectedInstances[0]?.instanceName;
    if (instance) {
      setCalling(true);
      toast.info(isVideo ? "Iniciando chamada de vídeo..." : "Iniciando ligação...");
      try {
        const { error } = await whatsappApi.offerCall(instance, cleanNumber, isVideo);
        if (error) {
          // Fallback: open WhatsApp directly
          window.open(`https://wa.me/${cleanNumber}`, "_blank");
          toast.info("Abrindo WhatsApp para ligar manualmente");
        } else {
          toast.success(isVideo ? "Chamada de vídeo iniciada!" : "Ligação iniciada!");
        }
      } catch (err: any) {
        // Fallback: open WhatsApp directly
        window.open(`https://wa.me/${cleanNumber}`, "_blank");
        toast.info("Abrindo WhatsApp para ligar manualmente");
      } finally {
        setCalling(false);
      }
    } else {
      // No instance connected — open WhatsApp directly
      window.open(`https://wa.me/${cleanNumber}`, "_blank");
      toast.info("Abrindo WhatsApp para ligar");
    }
  };

  return (
    <>
      <div className="h-[68px] flex items-center justify-between px-5 border-b border-border/50 bg-card/80 backdrop-blur-sm shrink-0 relative shadow-sm">
        <div className="flex items-center gap-3.5 animate-fade-in">
          <div className="relative">
            <LeadAvatar initials={lead.initials} avatarUrl={lead.avatarUrl} avatarColor={lead.avatarColor || "bg-primary/20"} size="md" />
            {(presence === "online" || presence === "typing" || presence === "recording") && (
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card shadow-sm bg-success" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{lead.name}</p>
              {leadTagIds.length > 0 && (
                <div className="flex items-center gap-1">
                  {allTags.filter((t) => leadTagIds.includes(t.id)).map((tag) => (
                    <span key={tag.id} className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-semibold text-white shadow-sm" style={{ backgroundColor: tag.color }}>
                      {tag.icon} {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {presence === "typing" ? (
              <div className="flex items-center gap-1.5 h-4">
                <div className="flex items-center gap-[3px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-[5px] h-[5px] rounded-full bg-primary/70"
                      style={{ animation: `typingBounce 1s ease-in-out ${i * 0.2}s infinite` }}
                    />
                  ))}
                </div>
                <span className="text-xs text-primary font-medium">digitando...</span>
              </div>
            ) : presence === "recording" ? (
              <div className="flex items-center gap-1.5 h-4">
                <div className="flex items-end gap-[2px] h-3.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-[2.5px] rounded-full bg-destructive/70"
                      style={{ animation: `soundwave 0.8s ease-in-out ${i * 0.12}s infinite alternate` }}
                    />
                  ))}
                </div>
                <span className="text-xs text-destructive font-medium">gravando áudio...</span>
              </div>
            ) : presence === "online" ? (
              <p className="text-xs text-success flex items-center gap-1.5 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/60"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                Online
              </p>
            ) : lastSeen ? (
              <p className="text-xs text-muted-foreground">
                Visto por último {formatLastSeen(lastSeen)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            onClick={handleDownloadPdf}
            className="p-2.5 rounded-xl hover:bg-muted transition-all text-muted-foreground hover:text-foreground"
            title="Baixar conversa em PDF"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setShowTagMenu(!showTagMenu); setShowTransfer(false); }}
            className={`p-2.5 rounded-xl transition-all ${showTagMenu ? "bg-primary/10 text-primary shadow-sm" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}
            title="Tags"
          >
            <Tags className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setShowTransfer(!showTransfer); setShowTagMenu(false); handleClose(); }}
            className={`p-2.5 rounded-xl transition-all ${showTransfer ? "bg-primary/10 text-primary shadow-sm" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}
            title="Transferir atendimento"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </button>
          <button
            className="p-2.5 rounded-xl hover:bg-success/10 transition-all text-muted-foreground hover:text-success disabled:opacity-50"
            aria-label="Ligar"
            title="Ligar via WhatsApp"
            onClick={() => handleCall(false)}
            disabled={calling}
          >
            <Phone className={`h-4 w-4 ${calling ? "animate-pulse" : ""}`} />
          </button>
          <button
            className="p-2.5 rounded-xl hover:bg-primary/10 transition-all text-muted-foreground hover:text-primary disabled:opacity-50"
            aria-label="Chamada de vídeo"
            title="Chamada de vídeo via WhatsApp"
            onClick={() => handleCall(true)}
            disabled={calling}
          >
            <Video className={`h-4 w-4 ${calling ? "animate-pulse" : ""}`} />
          </button>
          {lead.status === "active" && onFinishAttendance && (
            <button
              onClick={() => setShowFinishDialog(true)}
              className="p-2.5 rounded-xl hover:bg-success/10 transition-all text-success hover:shadow-sm"
              title="Finalizar atendimento"
            >
              <CheckCircle2 className="h-4 w-4" />
            </button>
          )}
          <button onClick={onClose} className="p-2.5 rounded-xl hover:bg-muted transition-all text-muted-foreground hover:text-foreground ml-1">
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

      <FinishAttendanceDialog
        lead={lead}
        open={showFinishDialog}
        onClose={() => setShowFinishDialog(false)}
        onFinish={(l, msg) => {
          setShowFinishDialog(false);
          onFinishAttendance?.(l, msg);
        }}
        onReturnToQueue={(l) => {
          setShowFinishDialog(false);
          onReturnToQueue?.(l);
        }}
      />
    </>
  );
}
