import { useId, useState } from "react";
import type { Lead, ChatMessage } from "@/data/chatMockData";
import { Phone, Video, X, ArrowRightLeft, Loader2, ArrowLeft, Check, CheckCircle2, Download, Kanban, ChevronLeft, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

function formatPhoneDisplay(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 13 && d.startsWith("55")) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `+${d}`;
}

function getDisplayName(lead: { name?: string; phone?: string }): string {
  const n = (lead.name || "").trim();
  // Reject empty, very short, generic, or purely numeric placeholders
  if (!n || n.length < 2 || n.toLowerCase() === "whatsapp" || /^[\d\s+()-]+$/.test(n)) {
    return lead.phone ? formatPhoneDisplay(lead.phone) : "Contato";
  }
  return n;
}

interface Attendant {
  id: string;
  name: string;
  initials: string;
}

type PresenceDisplay = "online" | "offline" | "typing" | "recording";

// CRM stages available for quick-marking from chat
const CRM_QUICK_STAGES = [
  { id: "orcamento", label: "Orçamento", color: "#3b82f6", description: "Marcar que quer orçamento" },
  { id: "followup", label: "Follow-up", color: "#f59e0b", description: "Precisa de acompanhamento" },
  { id: "orcamento_enviado", label: "Orçamento Enviado", color: "#8b5cf6", description: "Orçamento já foi enviado" },
  { id: "orcamento_aprovado", label: "Orçamento Aprovado", color: "#22c55e", description: "Orçamento foi aprovado" },
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
  const panelIdBase = useId();
  const stagePanelId = `${panelIdBase}-fase`;
  const transferPanelId = `${panelIdBase}-transferir`;
  const reasonCountId = `${panelIdBase}-motivo-contador`;

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
      toast.success(`Paciente marcado como "${stageInfo?.label}" no CRM`);
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

  const currentStageInfo = CRM_QUICK_STAGES.find((s) => s.id === currentStage);
  const iconBtn = "size-11 md:size-9 items-center justify-center rounded-md transition-colors disabled:opacity-50";

  return (
    <>
      <div className="min-h-16 py-2 flex items-center justify-between gap-2 px-2 md:px-5 border-b border-border bg-card shrink-0 relative z-30 isolate">
        <div className="flex items-center gap-2 md:gap-3.5 min-w-0 flex-1 animate-fade-in">
          <button
            type="button"
            onClick={onClose}
            aria-label="Voltar para a lista"
            className={`inline-flex md:hidden -ml-1 shrink-0 ${iconBtn} text-muted-foreground hover:bg-muted hover:text-foreground`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="relative shrink-0">
            <LeadAvatar initials={lead.initials} avatarUrl={lead.avatarUrl} avatarColor={lead.avatarColor || "bg-primary/20"} size="md" />
            {(presence === "online" || presence === "typing" || presence === "recording") && (
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate min-w-0">{getDisplayName(lead)}</p>
              {currentStageInfo && (
                <span className="inline-flex shrink-0 max-w-[40vw] min-h-6 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs font-medium text-foreground">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: currentStageInfo.color }} />
                  <span className="truncate">{currentStageInfo.label}</span>
                </span>
              )}
            </div>
            {lead.phone && <p className="text-xs text-muted-foreground font-mono truncate">{formatPhoneDisplay(lead.phone)}</p>}
            {presence === "typing" ? (
              <div className="flex items-center gap-1.5 min-h-4">
                <div className="flex items-center gap-[3px]" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-[5px] h-[5px] rounded-full bg-primary/70"
                      style={{ animation: `typingBounce 1s ease-in-out ${i * 0.2}s infinite` }}
                    />
                  ))}
                </div>
                <span className="text-xs text-primary font-medium">digitando…</span>
              </div>
            ) : presence === "recording" ? (
              <div className="flex items-center gap-1.5 min-h-4">
                <div className="flex items-end gap-[2px] h-3.5" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-[2.5px] rounded-full bg-destructive/70"
                      style={{ animation: `soundwave 0.8s ease-in-out ${i * 0.12}s infinite alternate` }}
                    />
                  ))}
                </div>
                <span className="text-xs text-destructive font-medium">gravando áudio…</span>
              </div>
            ) : presence === "online" ? (
              <p className="text-xs text-success flex items-center gap-1.5 font-medium">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/60"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                Online
              </p>
            ) : lastSeen ? (
              <p className="text-xs text-muted-foreground truncate">
                Visto por último {formatLastSeen(lastSeen)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleDownloadPdf}
            className={`hidden md:inline-flex ${iconBtn} text-muted-foreground hover:bg-muted hover:text-foreground`}
            aria-label="Baixar conversa (PDF)"
            title="Baixar conversa (PDF)"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setShowStageMenu(!showStageMenu); setShowTransfer(false); }}
            className={`hidden md:inline-flex ${iconBtn} ${showStageMenu ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            aria-label="Fase no CRM"
            aria-expanded={showStageMenu}
            aria-controls={stagePanelId}
            title="Fase no CRM"
          >
            <Kanban className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleOpenTransfer}
            className={`hidden md:inline-flex ${iconBtn} ${showTransfer ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            aria-label="Transferir atendimento"
            aria-expanded={showTransfer}
            aria-controls={transferPanelId}
            title="Transferir atendimento"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={`inline-flex ${iconBtn} text-muted-foreground hover:bg-success/10 hover:text-success`}
            aria-label="Ligar via WhatsApp"
            aria-busy={calling}
            title="Ligar via WhatsApp"
            onClick={() => handleCall(false)}
            disabled={calling}
          >
            <Phone className={`h-4 w-4 ${calling ? "animate-pulse" : ""}`} />
          </button>
          <button
            type="button"
            className={`hidden md:inline-flex ${iconBtn} text-muted-foreground hover:bg-primary/10 hover:text-primary`}
            aria-label="Chamada de vídeo via WhatsApp"
            aria-busy={calling}
            title="Chamada de vídeo via WhatsApp"
            onClick={() => handleCall(true)}
            disabled={calling}
          >
            <Video className={`h-4 w-4 ${calling ? "animate-pulse" : ""}`} />
          </button>
          {lead.status === "active" && onFinishAttendance && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFinishDialog(true)}
              aria-label="Finalizar atendimento"
              title="Finalizar atendimento"
              className="h-11 min-w-11 md:h-9 md:min-w-9 gap-1.5 px-2 sm:px-3 bg-transparent text-success hover:text-success border-success/40 hover:bg-success/10"
            >
              <CheckCircle2 />
              <span className="hidden sm:inline">Finalizar</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Mais ações"
                className={`inline-flex md:hidden ${iconBtn} text-muted-foreground hover:bg-muted hover:text-foreground`}
              >
                <MoreVertical className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuItem className="h-11 md:h-9" onSelect={() => { handleDownloadPdf(); }}>
                <Download />
                Baixar conversa (PDF)
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11 md:h-9" onSelect={() => { setShowStageMenu(!showStageMenu); setShowTransfer(false); }}>
                <Kanban />
                Fase no CRM
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11 md:h-9" onSelect={handleOpenTransfer}>
                <ArrowRightLeft />
                Transferir atendimento
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11 md:h-9" disabled={calling} onSelect={() => { handleCall(true); }}>
                <Video />
                Chamada de vídeo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar conversa"
            title="Fechar conversa"
            className={`hidden md:inline-flex ml-1 ${iconBtn} text-muted-foreground hover:bg-muted hover:text-foreground`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {showTransfer && (
          <div id={transferPanelId} className="absolute top-full left-2 right-2 sm:left-auto sm:right-4 mt-1 sm:w-72 bg-card border border-border rounded-xl shadow-lg z-[80] overflow-hidden">
            {!selectedAtt ? (
              <>
                <div className="px-3 py-2 border-b border-border/50">
                  <p className="text-xs font-semibold text-foreground">Transferir para</p>
                  <p className="text-xs text-muted-foreground">Selecione o atendente</p>
                </div>
                <div className="py-1 max-h-48 overflow-y-auto">
                  {loading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                      <span className="sr-only">Carregando atendentes</span>
                    </div>
                  ) : attendants.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Nenhum atendente disponível</p>
                  ) : (
                    attendants.map((att) => (
                      <button
                        type="button"
                        key={att.id}
                        onClick={() => setSelectedAtt(att)}
                        className="w-full min-h-11 md:min-h-9 flex items-center gap-3 px-3 py-2 hover:bg-muted transition-colors text-left"
                      >
                        <div aria-hidden="true" className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
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
                <div className="px-3 py-1 md:py-2 border-b border-border/50 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setSelectedAtt(null); setReason(""); }}
                    aria-label="Voltar para a lista de atendentes"
                    className="-ml-2 inline-flex size-11 md:size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">Transferir para {selectedAtt.name}</p>
                    <p className="text-xs text-muted-foreground">Informe o motivo da transferência</p>
                  </div>
                </div>
                <div className="p-3 space-y-3">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 500))}
                    placeholder="Ex: Paciente precisa de avaliação ortodôntica..."
                    aria-label="Motivo da transferência"
                    aria-describedby={reasonCountId}
                    className="w-full h-20 px-3 py-2 rounded-lg bg-muted border-0 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span id={reasonCountId} className="text-xs text-muted-foreground tabular-nums">{reason.trim().length}/500</span>
                    <button
                      type="button"
                      onClick={handleConfirmTransfer}
                      disabled={!reason.trim()}
                      className="h-11 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div id={stagePanelId} className="absolute top-full left-2 right-2 sm:left-auto sm:right-4 mt-1 sm:w-72 bg-card border border-border rounded-xl shadow-lg z-[80] overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-foreground">Fase do paciente no CRM</p>
                <p className="text-xs text-muted-foreground">Marcar sem finalizar o atendimento</p>
              </div>
              {updatingStage && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="sr-only" role="status">Atualizando fase…</span>
                </>
              )}
            </div>
            <div className="py-1">
              {CRM_QUICK_STAGES.map((stage) => {
                const isActive = currentStage === stage.id;
                return (
                  <button
                    type="button"
                    key={stage.id}
                    onClick={() => handleSetStage(stage.id)}
                    disabled={updatingStage}
                    aria-pressed={isActive}
                    className="w-full min-h-11 md:min-h-9 flex items-center gap-3 px-3 py-2 hover:bg-muted transition-colors text-left disabled:opacity-50"
                  >
                    <span aria-hidden="true" className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{stage.label}</p>
                      <p className="text-xs text-muted-foreground">{stage.description}</p>
                    </div>
                    {isActive && <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />}
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
