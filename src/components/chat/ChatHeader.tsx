import { useState } from "react";
import type { Lead, ChatMessage } from "@/data/chatMockData";
import { Phone, Video, X, ArrowRightLeft, Loader2, ArrowLeft, Check, CheckCircle2, Download, Kanban } from "lucide-react";
import { LeadAvatar } from "@/components/LeadAvatar";
import { toast } from "sonner";
import { adminListUsers, crmApi, whatsappApi } from "@/lib/vpsApi";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { useAuth } from "@/hooks/useAuth";
import { FinishAttendanceDialog, type FinishOutcome } from "./FinishAttendanceDialog";
import type { ConsciousnessLevel } from "@/data/crmMockData";
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

// CRM stages available for quick-marking from chat
const CRM_QUICK_STAGES = [
  { id: "orcamento", label: "Orçamento", emoji: "📋", color: "#3b82f6", description: "Marcar que quer orçamento" },
  { id: "followup", label: "Follow-up", emoji: "🔄", color: "#f59e0b", description: "Precisa de acompanhamento" },
  { id: "orcamento_enviado", label: "Orçamento Enviado", emoji: "📨", color: "#8b5cf6", description: "Orçamento já foi enviado" },
  { id: "orcamento_aprovado", label: "Orçamento Aprovado", emoji: "✅", color: "#22c55e", description: "Orçamento foi aprovado" },
];

interface ChatHeaderProps {
  lead: Lead;
  onClose: () => void;
  onTransfer?: (lead: Lead, toAttendantId: string, toAttendantName: string, reason: string) => void;
  onFinishAttendance?: (lead: Lead, outcome: FinishOutcome, options?: { farewellMessage?: string; consciousnessLevel?: ConsciousnessLevel }) => void;
  onReturnToQueue?: (lead: Lead) => void;
  messages?: ChatMessage[];
  presence?: PresenceDisplay;
  lastSeen?: Date | null;
  crmStage?: string;
  onStageChange?: (leadId: string, stage: string) => void;
}

export function ChatHeader({ lead, onClose, onTransfer, onFinishAttendance, onReturnToQueue, messages = [], presence = "offline", lastSeen, crmStage, onStageChange }: ChatHeaderProps) {
  const { user: currentUser } = useAuth();
  const { connected: connectedInstances } = useWhatsAppInstances();
  const [calling, setCalling] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showStageMenu, setShowStageMenu] = useState(false);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAtt, setSelectedAtt] = useState<Attendant | null>(null);
  const [reason, setReason] = useState("");
  const [currentStage, setCurrentStage] = useState<string | null>(crmStage || null);
  const [updatingStage, setUpdatingStage] = useState(false);

  const handleClose = () => {
    setShowTransfer(false);
    setShowStageMenu(false);
    setSelectedAtt(null);
    setReason("");
  };

  const handleConfirmTransfer = () => {
    if (selectedAtt && reason.trim()) {
      onTransfer?.(lead, selectedAtt.id, selectedAtt.name, reason.trim());
      setShowTransfer(false);
      setSelectedAtt(null);
      setReason("");
    }
  };

  const handleOpenTransfer = () => {
    setShowTransfer(!showTransfer);
    setShowStageMenu(false);
    if (!showTransfer && attendants.length === 0) {
      setLoading(true);
      adminListUsers()
        .then(({ data }) => {
          if (data) {
            setAttendants(
              data
                .filter((u: any) => u.id !== currentUser?.id)
                .map((u: any) => ({
                  id: u.id,
                  name: u.name || u.email,
                  initials: (u.name || u.email || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase(),
                }))
            );
          }
        })
        .finally(() => setLoading(false));
    }
  };

  const handleSetStage = async (stageId: string) => {
    setUpdatingStage(true);
    const { error } = await crmApi.updateStage(lead.id, stageId, `Marcado via chat`);
    if (error) {
      toast.error("Erro ao atualizar fase do lead no CRM");
    } else {
      const stageInfo = CRM_QUICK_STAGES.find((s) => s.id === stageId);
      setCurrentStage(stageId);
      onStageChange?.(lead.id, stageId);
      toast.success(`${stageInfo?.emoji} Lead marcado como "${stageInfo?.label}" no CRM`);
    }
    setUpdatingStage(false);
    setShowStageMenu(false);
  };

  const handleDownloadPdf = async () => {
    if (messages.length === 0) {
      toast.info("Nenhuma mensagem para exportar");
      return;
    }
    try {
      await exportChatToPdf(messages, lead.name, lead.phone);
      toast.success("PDF gerado com sucesso!");
    } catch {
      toast.error("Erro ao gerar PDF");
    }
  };

  const handleCall = async (video: boolean) => {
    const cleanNumber = lead.phone.replace(/\D/g, "");
    if (!cleanNumber) {
      toast.error("Número inválido para ligação");
      return;
    }
    if (connectedInstances.length > 0) {
      setCalling(true);
      try {
        const instance = connectedInstances[0].instanceName;
        const result = await whatsappApi.sendPresence(instance, cleanNumber, "composing");
        toast.info(video ? "Iniciando chamada de vídeo..." : "Iniciando ligação...", {
          description: `Via ${instance} para ${cleanNumber}`,
        });
      } catch {
        toast.error("Erro ao iniciar chamada");
      } finally {
        setTimeout(() => setCalling(false), 3000);
      }
    } else {
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
              {currentStage && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-semibold text-white shadow-sm" style={{ backgroundColor: CRM_QUICK_STAGES.find((s) => s.id === currentStage)?.color || "#6b7280" }}>
                  {CRM_QUICK_STAGES.find((s) => s.id === currentStage)?.emoji} {CRM_QUICK_STAGES.find((s) => s.id === currentStage)?.label}
                </span>
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
            onClick={() => { setShowStageMenu(!showStageMenu); setShowTransfer(false); }}
            className={`p-2.5 rounded-xl transition-all ${showStageMenu ? "bg-primary/10 text-primary shadow-sm" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}
            title="Fase do CRM"
          >
            <Kanban className="h-4 w-4" />
          </button>
          <button
            onClick={handleOpenTransfer}
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

        {showStageMenu && (
          <div className="absolute top-full right-4 mt-1 w-64 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50">
              <p className="text-xs font-semibold text-foreground">Fase do Lead no CRM</p>
              <p className="text-[11px] text-muted-foreground">Marcar sem finalizar o atendimento</p>
            </div>
            <div className="py-1">
              {CRM_QUICK_STAGES.map((stage) => {
                const isActive = currentStage === stage.id;
                return (
                  <button
                    key={stage.id}
                    onClick={() => handleSetStage(stage.id)}
                    disabled={updatingStage}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                  >
                    <span className="text-base">{stage.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{stage.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{stage.description}</p>
                    </div>
                    {isActive && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <FinishAttendanceDialog
        lead={lead}
        open={showFinishDialog}
        onClose={() => setShowFinishDialog(false)}
        onFinish={(l, outcome, options) => {
          setShowFinishDialog(false);
          onFinishAttendance?.(l, outcome, options);
        }}
        onReturnToQueue={(l) => {
          setShowFinishDialog(false);
          onReturnToQueue?.(l);
        }}
      />
    </>
  );
}
