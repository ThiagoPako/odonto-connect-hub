import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { LeadListItem } from "@/components/chat/LeadListItem";
import { ConversationView } from "@/components/chat/ConversationView";
import { MessageInput } from "@/components/chat/MessageInput";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Users, MessageSquare, UserPlus, WifiOff, RefreshCw, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { canAccessRoute } from "@/lib/routeAccess";
import { NewChatFromContactDialog } from "@/components/chat/NewChatFromContactDialog";
import { SatisfactionSurveyDialog } from "@/components/chat/SatisfactionSurveyDialog";
import { ImportMessagesDialog } from "@/components/contatos/ImportMessagesDialog";
import { ImportWhatsAppDialog } from "@/components/contatos/ImportWhatsAppDialog";
import type { Contato } from "@/lib/vpsApi";
import type { AttendanceQueue } from "@/data/queueData";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeChat, type IncomingMessage } from "@/hooks/useRealtimeChat";
import { whatsappApi, transferApi, sessionsApi, queuesApi, messagesApi, queueLeadsApi, mediaApi, crmApi, contatosApi, getCachedTenantId, resolveMediaUrl, type ChatMessageApi } from "@/lib/vpsApi";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { playNotificationSound, playRecoverySound } from "@/lib/notificationSound";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/browserNotification";
import { setChatUnreadCount } from "@/lib/chatUnreadStore";
import { takePendingChatMessagesForLead } from "@/lib/chatPendingStore";
import {
  type Lead,
  type ChatMessage,
  type MessageType,
  type MessageStatus,
  type LocationData,
  type ContactData,
  type PollData,
  type ReplyData,
} from "@/data/chatMockData";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

const chatSearchSchema = z.object({
  lead: fallback(z.string(), "").default(""),
});

function incomingToChatMessage(msg: IncomingMessage, leadId?: string): ChatMessage {
  const isFromMe = msg.sender === "attendant" || msg.sender === "agent" || msg.sender === "me";

  return {
    id: msg.id,
    leadId: leadId || msg.leadId || msg.phone,
    content: msg.content,
    sender: isFromMe ? "attendant" : "lead",
    type: (msg.type as MessageType) || "text",
    timestamp: new Date(msg.timestamp),
    status: (msg.status as MessageStatus | undefined) || (isFromMe ? "sent" : "delivered"),
    fileUrl: resolveMediaUrl(msg.mediaUrl) || undefined,
    fileName: msg.fileName || undefined,
    mimeType: msg.mimeType || undefined,
    instance: msg.instance || undefined,
  };
}

function getMessagePreview(msg: IncomingMessage): string {
  if (msg.content && !["🖼️ Imagem", "🎬 Vídeo", "📎"].some((prefix) => msg.content.startsWith(prefix))) {
    return msg.content;
  }

  return ({
    image: "📷 Foto",
    video: "🎬 Vídeo",
    audio: "🎤 Áudio",
    document: "📄 Documento",
    sticker: "🏷️ Sticker",
  } as Record<string, string>)[msg.type] || msg.content || "";
}

/** Rótulos de tipo de mensagem só para exibição (sem emoji). */
const MESSAGE_TYPE_LABEL: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  location: "Localização",
  sticker: "Figurinha",
};

/** Mostra o motivo do erro só quando ele é texto para pessoas; senão, uma frase neutra. */
function friendlySendError(message?: string): string {
  const fallbackText = "Não foi possível enviar agora. Confira se o WhatsApp está conectado em Canais e tente de novo.";
  if (!message) return fallbackText;
  const looksTechnical = message.length > 140 || /error|status|\{|undefined|null|fetch|timeout|jobId/i.test(message);
  return looksTechnical ? fallbackText : message;
}

function getEvolutionMessageId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  const readPlainId = (source: unknown): string | null => {
    if (!source || typeof source !== "object") return null;
    const record = source as Record<string, unknown>;
    const candidate = record.messageId || record.message_id || record.id;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  };
  const readId = (source: unknown): string | null => {
    if (!source || typeof source !== "object") return null;
    const key = (source as Record<string, unknown>).key;
    if (!key || typeof key !== "object") return null;
    const id = (key as Record<string, unknown>).id;
    return typeof id === "string" && id ? id : null;
  };

  return readId(value)
    || readId(value.message)
    || readId(value.data)
    || (value.data && typeof value.data === "object" ? readId((value.data as Record<string, unknown>).message) : null)
    || readId(value.response)
    || (value.response && typeof value.response === "object" ? readId((value.response as Record<string, unknown>).message) : null)
    || readPlainId(value)
    || readPlainId(value.data)
    || readPlainId(value.response);
}

function normalizeInstanceName(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .trim()
    .replace(/^[0-9a-f]{8}-/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function resolveConnectedInstance(
  connectedInstances: Array<{ instanceName: string }>,
  preferredInstanceName?: string | null,
) {
  if (preferredInstanceName) {
    const preferred = normalizeInstanceName(preferredInstanceName);
    const exact = connectedInstances.find((instance) => instance.instanceName === preferredInstanceName);
    if (exact) return exact;

    const normalized = connectedInstances.find((instance) => {
      const current = normalizeInstanceName(instance.instanceName);
      return current === preferred;
    });
    if (normalized) return normalized;
  }

  return connectedInstances.length === 1 ? connectedInstances[0] : undefined;
}

function normalizePhoneSuffix(value?: string | null): string {
  return (value || "").replace(/\D/g, "").slice(-11);
}

function isLikelySameOutgoingMessage(local: ChatMessage, remote: ChatMessage): boolean {
  if (local.sender === "lead" || remote.sender === "lead") return false;
  if (!local.id.startsWith("msg-")) return false;
  if (local.content !== remote.content) return false;
  if ((local.type || "text") !== (remote.type || "text")) return false;
  const localTime = new Date(local.timestamp).getTime();
  const remoteTime = new Date(remote.timestamp).getTime();
  if (!Number.isFinite(localTime) || !Number.isFinite(remoteTime)) return true;
  return Math.abs(localTime - remoteTime) < 5 * 60 * 1000;
}

export const Route = createFileRoute("/chat")({
  ssr: false,
  validateSearch: zodValidator(chatSearchSchema),
  component: ChatPage,
});

function ChatPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const activeTenantId = currentUser?.tenant_id || getCachedTenantId();
  const { lead: leadSearch } = Route.useSearch();
  const { connected: connectedInstances } = useWhatsAppInstances();
  const [activeTab, setActiveTab] = useState<"queue" | "mine">("queue");
  const [queue, setQueue] = useState<Lead[]>([]);
  const [myLeads, setMyLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [filterQueue, setFilterQueue] = useState<string | null>(null);
  const [filterStage, setFilterStage] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "finished">("all");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [importMessagesOpen, setImportMessagesOpen] = useState(false);
  const [importContactsOpen, setImportContactsOpen] = useState(false);
  const [isLeadTyping, setIsLeadTyping] = useState(false);
  const [syncingPhotos, setSyncingPhotos] = useState(false);
  const [availableQueues, setAvailableQueues] = useState<AttendanceQueue[]>([]);
  const [surveyLead, setSurveyLead] = useState<Lead | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState<Record<string, boolean>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, { status: "online" | "offline" | "typing" | "recording"; lastSeen: Date | null }>>({});
  const [crmStages, setCrmStages] = useState<Record<string, string>>({});

  // Refs for stable closure access in SSE callback
  const queueRef = useRef(queue);
  const myLeadsRef = useRef(myLeads);
  const selectedLeadRef = useRef(selectedLead);
  const syncedChatInstancesRef = useRef(new Set<string>());
  const pendingStatusByMessageIdRef = useRef(new Map<string, MessageStatus>());
  const lastSentPresenceRef = useRef<{ leadId: string | null; status: "composing" | "recording" | "paused"; timestamp: number }>({
    leadId: null,
    status: "paused",
    timestamp: 0,
  });
  queueRef.current = queue;
  myLeadsRef.current = myLeads;
  selectedLeadRef.current = selectedLead;

  const reloadQueueLeads = useCallback(async () => {
    // Do not load the queue until Auth has resolved the clinic tenant. Calling
    // the VPS too early returns an empty/unauthorized background response and
    // used to leave the Chat stuck on "Nenhum lead" until a hard refresh.
    if (!activeTenantId) return;

    const { data, error } = await queueLeadsApi.list();
    if (error) {
      console.warn("Falha ao carregar fila do chat:", error);
      return;
    }
    if (!data) return;

    const { data: contactsData } = await contatosApi.list();
    const contactMap = new Map(((contactsData as any[]) || []).map((c: any) => [c.telefone?.replace(/\D/g, ''), c.nome]));

    const toLead = (r: any): Lead => {
      const phone = r.phone?.replace(/\D/g, '') || "";
      const resolvedName = r.name && !r.name.includes('@') && isNaN(Number(r.name))
        ? r.name
        : contactMap.get(phone) || r.name || r.phone;

      return {
        id: r.id,
        name: resolvedName,
        initials: (resolvedName || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase(),
        phone: r.phone,
        avatarUrl: r.avatarUrl,
        lastMessage: r.lastMessage || "",
        lastMessageTime: r.lastMessageTime ? new Date(r.lastMessageTime) : new Date(),
        unreadCount: r.unreadCount || 0,
        status: r.sessionStatus === "active" ? "active" : "waiting",
        avatarColor: "bg-chart-1",
        queueId: r.queueId,
        queueName: r.queueName,
        assignedTo: r.attendantId ? "current" : undefined,
        priority: r.priority || false,
        instance: r.instance,
      };
    };

    setQueue((data.queue || []).map(toLead));
    setMyLeads((data.active || []).map(toLead));
  }, [activeTenantId]);

  // Load queues, tags, assignments and unread counts from VPS
  useEffect(() => {
    if (!activeTenantId) return;

    queuesApi.list().then(({ data }) => {
      if (data && Array.isArray(data)) {
        setAvailableQueues(data.filter((q: any) => q.active).map((q: any) => ({
          id: q.id, name: q.name, color: q.color, icon: q.icon,
          description: q.description || "", contactNumbers: q.contact_numbers || [],
          teamMembers: (q.team_member_ids || []).map((id: string) => ({ id, name: id })),
          whatsappButtonLabel: q.whatsapp_button_label || "", active: q.active,
        })));
      }
    });

    // Load CRM stages for all leads
    crmApi.kanban().then(({ data }) => {
      if (!data) return;
      const stages: Record<string, string> = {};
      for (const [stage, leads] of Object.entries(data as Record<string, any[]>)) {
        for (const lead of leads) {
          stages[lead.id] = stage;
        }
      }
      setCrmStages(stages);
    });

    void reloadQueueLeads();

    // Load unread counts from backend and apply to leads
    const fetchUnreadCounts = () => {
      if (document.hidden) return; // skip when tab not visible
      messagesApi.unreadCounts().then(({ data }) => {
        if (!data || typeof data !== 'object') return;
        const counts = data as Record<string, number>;
        const applyUnread = (leads: Lead[]): Lead[] =>
          leads.map((l) => counts[l.id] != null ? { ...l, unreadCount: counts[l.id] } : l);
        setQueue((prev) => applyUnread(prev));
        setMyLeads((prev) => applyUnread(prev));
        const total = Object.values(counts).reduce((s, c) => s + c, 0);
        setChatUnreadCount(total);
      });
    };

    fetchUnreadCounts();
    let unreadInterval = setInterval(fetchUnreadCounts, 15_000);

    // Pause/resume polling on tab visibility change
    const handleVisibility = () => {
      clearInterval(unreadInterval);
      if (!document.hidden) {
        fetchUnreadCounts(); // fetch immediately when tab becomes visible
        unreadInterval = setInterval(fetchUnreadCounts, 15_000);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(unreadInterval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeTenantId, reloadQueueLeads]);

  // Poll the source-of-truth queue while the chat is open. This is a defensive
  // fallback for missed SSE events and for webhook messages that were persisted
  // while the page was loading or the browser temporarily dropped the stream.
  useEffect(() => {
    if (!activeTenantId) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) void reloadQueueLeads();
    }, 8_000);
    return () => window.clearInterval(interval);
  }, [activeTenantId, reloadQueueLeads]);

  // Vincula automaticamente as instâncias conectadas em Canais ao Comercial/Chat.
  // Não importe histórico automaticamente aqui: a importação pesada de 30 dias
  // logo ao abrir o chat congestiona a Evolution e faz envio/recebimento parar
  // minutos depois. Histórico deve ser importado somente pelo botão manual.
  useEffect(() => {
    if (!activeTenantId) return;
    const openInstances = connectedInstances.filter((inst) => inst.connectionState === "open");
    if (openInstances.some((inst) => inst.instanceName && !syncedChatInstancesRef.current.has(inst.instanceName))) {
      openInstances.forEach((inst) => {
        if (inst.instanceName) syncedChatInstancesRef.current.add(inst.instanceName);
      });
      void reloadQueueLeads();
    }
  }, [activeTenantId, connectedInstances, reloadQueueLeads]);


  // ─── Dedup set — prevent duplicate messages ───
  const processedMsgIds = useRef(new Set<string>());

  // ─── Real-time incoming messages via SSE ───
  const handleIncomingMessage = useCallback((msg: IncomingMessage) => {
    // Idempotency: skip if already processed
    if (processedMsgIds.current.has(msg.id)) return;
    processedMsgIds.current.add(msg.id);
    // Cap dedup set size to prevent memory leak
    if (processedMsgIds.current.size > 5000) {
      const entries = Array.from(processedMsgIds.current);
      processedMsgIds.current = new Set(entries.slice(entries.length - 2500));
    }

    const isFromMe = msg.sender === "attendant" || msg.sender === "agent" || msg.sender === "me";
    const chatMsg = incomingToChatMessage(msg);

    // Use refs to avoid stale closure
    const allLeads = [...queueRef.current, ...myLeadsRef.current];
    const existingLead = allLeads.find(
      (l) => l.id === msg.leadId || l.phone.replace(/\D/g, "").endsWith(msg.phone.slice(-11))
    );

    const currentSelected = selectedLeadRef.current;
    const isViewing = existingLead && selectedLeadRef.current?.id === existingLead.id;

    if (isFromMe) {
      // If message is from me, add it to history if it's not already there
      setMessages((prev) => {
        const leadId = existingLead?.id || msg.leadId || '';
        if (!leadId) return prev;
        const existing = prev[leadId] || [];
        if (existing.some((m) => m.id === msg.id)) {
          const nextStatus = chatMsg.status || "sent";
          let changed = false;
          const updated = existing.map((message) => {
            if (message.id !== msg.id) return message;
            const currentPri = statusPriority[message.status || "sent"] ?? 1;
            const nextPri = statusPriority[nextStatus] ?? 1;
            if (nextPri <= currentPri) return message;
            changed = true;
            return { ...message, status: nextStatus };
          });
          return changed ? { ...prev, [leadId]: updated } : prev;
        }

        const optimisticIndex = existing.findIndex((message) => isLikelySameOutgoingMessage(message, chatMsg));
        if (optimisticIndex >= 0) {
          const updated = [...existing];
          const current = updated[optimisticIndex];
          const currentPri = statusPriority[current.status || "sending"] ?? 0;
          const nextPri = statusPriority[chatMsg.status || "sent"] ?? 1;
          updated[optimisticIndex] = {
            ...current,
            ...chatMsg,
            status: nextPri > currentPri ? chatMsg.status : current.status,
          };
          return { ...prev, [leadId]: updated };
        }
        return { ...prev, [leadId]: [...existing, chatMsg] };
      });
      return;
    }

    const addMessage = () => {
      if (existingLead) {
        setMessages((prev) => {
          // Double-check dedup in state
          const existing = prev[existingLead.id] || [];
          if (existing.some((m) => m.id === msg.id)) return prev;
          return {
            ...prev,
            [existingLead.id]: [...existing, chatMsg],
          };
        });

        const updateLead = (lead: Lead): Lead =>
          lead.id === existingLead.id
            ? {
                ...lead,
                lastMessage: getMessagePreview(msg),
                lastMessageTime: new Date(msg.timestamp),
                unreadCount: currentSelected?.id === existingLead.id ? lead.unreadCount : lead.unreadCount + 1,
                instance: msg.instance || lead.instance,
              }
            : lead;

        setQueue((prev) => prev.map(updateLead));
        setMyLeads((prev) => prev.map(updateLead));
      } else {
        const incomingMsg = msg as IncomingMessage & { queueId?: string; queueName?: string; queueColor?: string };
        const newLead: Lead = {
          id: msg.leadId || `rt-${msg.phone}`,
          name: msg.leadName || msg.pushName,
          initials: (msg.leadName || msg.pushName).split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
          phone: msg.phone,
          lastMessage: getMessagePreview(msg),
          lastMessageTime: new Date(msg.timestamp),
          unreadCount: 1,
          status: "waiting",
          avatarColor: "bg-chart-1",
          queueId: incomingMsg.queueId,
          queueName: incomingMsg.queueName,
          queueColor: incomingMsg.queueColor,
          instance: msg.instance,
        };
        setQueue((prev) => [newLead, ...prev]);
        setMessages((prev) => ({
          ...prev,
          [newLead.id]: [chatMsg],
        }));
      }
    };

    // Add message immediately — no artificial delay
    addMessage();

    // The backend is the source of truth for whether a WhatsApp reply belongs
    // in "Fila de Espera" or "Meus Atendimentos". Refresh after inbound SSE so
    // stale active sessions returned to queue appear immediately on screen.
    void reloadQueueLeads();

    // Play sound + show toast + browser push notification
    playNotificationSound();
    const name = msg.leadName || msg.pushName;
    const displayName = name || msg.phone || "paciente";
    const body = getMessagePreview(msg).slice(0, 80) || "Nova mensagem";
    toast.info(`Nova mensagem de ${displayName}`, {
      description: body,
      duration: 5000,
      action: {
        label: "Abrir conversa",
          onClick: () => navigate({ to: "/chat", search: { lead: msg.leadId || msg.phone || name } }),
      },
    });
    showBrowserNotification(`Nova mensagem de ${displayName}`, body, name);
  }, [navigate, reloadQueueLeads]);

  const handlePresenceUpdate = useCallback((update: import("@/hooks/useRealtimeChat").PresenceUpdate) => {
    const phone = update.phone?.replace(/\D/g, "");
    if (!phone) return;

    // Match against all known leads (queue + myLeads)
    const allLeads = [...queueRef.current, ...myLeadsRef.current];
    const matchedLead = allLeads.find((l) => {
      const lp = l.phone?.replace(/\D/g, "");
      if (!lp) return false;
      return lp === phone || lp.endsWith(phone.slice(-11)) || phone.endsWith(lp.slice(-11));
    });
    if (!matchedLead) return;

    let displayStatus: "online" | "offline" | "typing" | "recording" = "offline";
    if (update.status === "composing") displayStatus = "typing";
    else if (update.status === "recording") displayStatus = "recording";
    else if (update.status === "available" || update.status === "paused") displayStatus = "online";

    setPresenceMap((prev) => ({
      ...prev,
      [matchedLead.id]: {
        status: displayStatus,
        lastSeen: displayStatus === "offline" ? new Date() : prev[matchedLead.id]?.lastSeen ?? null,
      },
    }));

    if (displayStatus === "typing" || displayStatus === "recording") {
      setTimeout(() => {
        setPresenceMap((prev) => {
          const current = prev[matchedLead.id];
          if (current?.status === displayStatus) {
            return {
              ...prev,
              [matchedLead.id]: {
                ...current,
                status: "online",
              },
            };
          }
          return prev;
        });
      }, 4000);
    }
  }, []);

  // Handle queue assignment events from SSE
  const handleQueueAssigned = useCallback((assignment: import("@/hooks/useRealtimeChat").QueueAssignment) => {
    // Update existing lead's queue info, or it will arrive via new_message
    const updateQueue = (l: Lead): Lead =>
      l.id === assignment.leadId
        ? { ...l, queueId: assignment.queueId, queueName: assignment.queueName }
        : l;
    setQueue((prev) => prev.map(updateQueue));
    setMyLeads((prev) => prev.map(updateQueue));
  }, []);

  // Status priority: only upgrade, never downgrade
  const statusPriority: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };

  const handleMessageStatusUpdate = useCallback((update: import("@/hooks/useRealtimeChat").MessageStatusUpdate) => {
    const updatePhone = normalizePhoneSuffix(update.phone);
    const applyStatus = (message: ChatMessage, status: MessageStatus): ChatMessage => {
      if (status === "failed") return { ...message, status };
      const currentPri = statusPriority[message.status || "sent"] ?? 1;
      const newPri = statusPriority[status] ?? 1;
      return newPri > currentPri ? { ...message, status } : message;
    };
    const matchingLeadIds = new Set(
      [...queueRef.current, ...myLeadsRef.current]
        .filter((lead) => updatePhone && normalizePhoneSuffix(lead.phone) === updatePhone)
        .map((lead) => lead.id),
    );

    setMessages((prev) => {
      let changed = false;
      let matchedAnyMessage = false;
      const next: Record<string, ChatMessage[]> = {};
      for (const leadId of Object.keys(prev)) {
        const msgs = prev[leadId];
        let exactMatch = false;
        const updated = msgs.map((m) => {
          if (m.id !== update.messageId) return m;
          exactMatch = true;
          matchedAnyMessage = true;
          const nextMessage = applyStatus(m, update.status as MessageStatus);
          if (nextMessage !== m) changed = true;
          return nextMessage;
        });

        // Some Evolution builds emit ACKs with a device/protocol id that differs
        // from the id returned by sendText. When that happens, reconcile by the
        // conversation phone and upgrade the latest outgoing message instead of
        // leaving the UI frozen at one check.
        if (!exactMatch && matchingLeadIds.has(leadId) && update.status !== "failed") {
          const fallbackIndex = [...updated].reverse().findIndex((message) => {
            if (message.sender === "lead" || message.id.startsWith("sys-")) return false;
            const currentPri = statusPriority[message.status || "sent"] ?? 1;
            const newPri = statusPriority[update.status] ?? 1;
            return newPri > currentPri;
          });

          if (fallbackIndex >= 0) {
            const targetIndex = updated.length - 1 - fallbackIndex;
            updated[targetIndex] = applyStatus(updated[targetIndex], update.status as MessageStatus);
            matchedAnyMessage = true;
            changed = true;
          }
        }

        next[leadId] = updated;
      }
      if (!matchedAnyMessage) {
        pendingStatusByMessageIdRef.current.set(update.messageId, update.status as MessageStatus);
      } else {
        pendingStatusByMessageIdRef.current.delete(update.messageId);
      }
      return changed ? next : prev;
    });
  }, []);

  const handleAttendantPresenceChange = useCallback((status: "composing" | "recording" | "paused") => {
    if (!activeTenantId) return;
    const activeLead = selectedLeadRef.current;
    const instanceName = connectedInstances[0]?.instanceName;
    if (!activeLead?.phone || !instanceName) return;

    const now = Date.now();
    const last = lastSentPresenceRef.current;
    if (last.leadId === activeLead.id && last.status === status && now - last.timestamp < 1000) {
      return;
    }

    lastSentPresenceRef.current = {
      leadId: activeLead.id,
      status,
      timestamp: now,
    };

    // Não envie "composing" em loop a cada tecla. A Evolution fica presa em
    // presença/digitando e passa a atrasar webhook/envio de mensagens. Mantemos
    // somente o "paused" ao sair/parar para limpar o status no WhatsApp.
    if (status !== "paused") return;

    whatsappApi.sendPresence(instanceName, activeLead.phone, status).catch((err: any) => {
      console.error("Failed to send presence:", err);
    });
  }, [activeTenantId, connectedInstances]);

  // Handle lead returning from recovery (follow-up) with priority
  const handleLeadRecoveryReturn = useCallback((data: import("@/hooks/useRealtimeChat").LeadRecoveryReturn) => {
    const setPriority = (l: Lead): Lead =>
      l.id === data.leadId ? { ...l, priority: true } : l;
    setQueue((prev) => prev.map(setPriority));
    setMyLeads((prev) => prev.map(setPriority));
    toast.info(`${data.leadName} respondeu ao follow-up`, { description: "Voltou para o topo da fila de espera.", duration: 6000 });

    // Play special recovery sound (urgent double-ding)
    playRecoverySound();

    // Send browser push notification
    showBrowserNotification(
      "Paciente voltou à fila",
      `${data.leadName} respondeu ao follow-up e está no topo da fila.`,
      data.leadName,
    );
  }, []);

  useRealtimeChat({
    onMessage: handleIncomingMessage,
    onPresence: handlePresenceUpdate,
    onQueueAssigned: handleQueueAssigned,
    onMessageStatus: handleMessageStatusUpdate,
    onLeadRecoveryReturn: handleLeadRecoveryReturn,
    onConnected: () => void reloadQueueLeads(),
  });

  useEffect(() => {
    if (!activeTenantId) return;
    const currentLead = selectedLead;
    const instanceName = connectedInstances[0]?.instanceName;
    return () => {
      if (!currentLead?.phone || !instanceName) return;
      whatsappApi.sendPresence(instanceName, currentLead.phone, "paused").catch(() => {});
    };
  }, [activeTenantId, selectedLead?.id, connectedInstances[0]?.instanceName]);

  // Request browser notification permission on first visit
  useEffect(() => { requestNotificationPermission(); }, []);

  // Auto-fetch WhatsApp avatar when opening a conversation
  useEffect(() => {
    if (!activeTenantId) return;
    if (!selectedLead?.phone) return;
    if (selectedLead.avatarUrl) return; // already has photo

    const cleanPhone = selectedLead.phone.replace(/\D/g, "");
    const instanceName = connectedInstances[0]?.instanceName || "teste";
    whatsappApi.fetchProfilePicture(instanceName, cleanPhone, selectedLead.id).then(({ data }) => {
      const url = data?.profilePictureUrl;
      if (!url) return;

      const updateAvatar = (l: Lead): Lead =>
        l.id === selectedLead.id ? { ...l, avatarUrl: url } : l;

      setQueue((prev) => prev.map(updateAvatar));
      setMyLeads((prev) => prev.map(updateAvatar));
      setSelectedLead((prev) => prev && prev.id === selectedLead.id ? { ...prev, avatarUrl: url } : prev);
    });
  }, [activeTenantId, selectedLead?.id]);

  const applyPresence = useCallback((leadId: string, presenceStr: string) => {
    let displayStatus: "online" | "offline" | "typing" | "recording" = "offline";
    if (presenceStr === "composing") displayStatus = "typing";
    else if (presenceStr === "recording") displayStatus = "recording";
    else if (presenceStr === "available" || presenceStr === "paused") displayStatus = "online";

    setPresenceMap((prev) => ({
      ...prev,
      [leadId]: {
        status: displayStatus,
        lastSeen: displayStatus === "offline" ? new Date() : prev[leadId]?.lastSeen ?? null,
      },
    }));
    return displayStatus;
  }, []);

  const fetchPresence = useCallback((leadId: string, phone: string, instanceName: string) => {
    if (!activeTenantId) return;
    // Isolamento do módulo de mensagens: não consultar/assinar presença pela UI.
    // Esse endpoint aciona a Evolution API e pode congestionar o socket logo após
    // importações/testes. Presença continuará entrando se vier por webhook SSE.
    return;
    whatsappApi.subscribePresence(instanceName, phone).then(({ data }) => {
      if (data?.presence) {
        applyPresence(leadId, data.presence);
      }
    }).catch(() => {});
  }, [activeTenantId, applyPresence]);

  // Also subscribe for selected lead immediately (covers queue leads)
  useEffect(() => {
    if (!activeTenantId) return;
    if (!selectedLead?.phone) return;
    const instanceName = connectedInstances[0]?.instanceName;
    if (!instanceName) return;
    fetchPresence(selectedLead.id, selectedLead.phone, instanceName);
  }, [activeTenantId, selectedLead?.id, selectedLead?.phone, connectedInstances[0]?.instanceName, fetchPresence]);

  // Não faça polling de presença. O recebimento/envio de mensagens é prioridade;
  // presença é atualizada apenas via webhook SSE quando a Evolution enviar.

  // ─── Load initial message history from VPS when selecting a lead ───
  const historyLoadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedLead) return;

    const pendingMessages = takePendingChatMessagesForLead({
      id: selectedLead.id,
      phone: selectedLead.phone,
      name: selectedLead.name,
    });

    if (pendingMessages.length > 0) {
      const pendingChatMessages = pendingMessages.map((message) => incomingToChatMessage(message, selectedLead.id));
      setMessages((prev) => {
        const existing = prev[selectedLead.id] || [];
        const existingIds = new Set(existing.map((message) => message.id));
        const merged = [...existing, ...pendingChatMessages.filter((message) => !existingIds.has(message.id))]
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        return { ...prev, [selectedLead.id]: merged };
      });
    }

    if (historyLoadedRef.current.has(selectedLead.id)) return;
    historyLoadedRef.current.add(selectedLead.id);

    messagesApi.list(selectedLead.id, { limit: 50 }).then(({ data }) => {
      if (!data?.messages?.length) return;
      const apiMessages: ChatMessage[] = data.messages.map((m: ChatMessageApi) => ({
        id: m.id,
        leadId: m.lead_id,
        content: m.content,
        sender: m.sender,
        type: (m.type as MessageType) || "text",
        timestamp: new Date(m.timestamp),
        status: (m.status as any) || "delivered",
        fileName: m.file_name || undefined,
        fileUrl: resolveMediaUrl(m.media_url) || undefined,
        mimeType: m.mime_type || undefined,
        reactions: Array.isArray(m.reactions) ? m.reactions : [],
      }));

      setMessages((prev) => {
        const existing = prev[selectedLead.id] || [];
        const existingIds = new Set(existing.map((m) => m.id));
        const newMsgs = apiMessages.filter((m) => !existingIds.has(m.id));
        return { ...prev, [selectedLead.id]: [...newMsgs, ...existing] };
      });
      setHistoryHasMore((prev) => ({ ...prev, [selectedLead.id]: !!data.hasMore }));
    }).catch(() => {
      historyLoadedRef.current.delete(selectedLead.id);
    });
  }, [selectedLead?.id]);

  // ─── Polling fallback: re-fetch most recent messages for the active lead ───
  // Garante recebimento em "tempo real" mesmo quando o SSE/EventSource falha
  // (proxy buffering, perda de conexão, tenant mismatch, etc.).
  useEffect(() => {
    if (!selectedLead?.id) return;
    const leadId = selectedLead.id;
    let cancelled = false;

    const tick = async () => {
      try {
        const { data } = await messagesApi.list(leadId, { limit: 30 });
        if (cancelled || !data?.messages?.length) return;
        setMessages((prev) => {
          const existing = prev[leadId] || [];
          const apiMessages = data.messages.map((m: ChatMessageApi) => ({
              id: m.id,
              leadId: m.lead_id,
              content: m.content,
              sender: m.sender,
              type: (m.type as MessageType) || "text",
              timestamp: new Date(m.timestamp),
              status: (m.status as any) || "delivered",
              fileName: m.file_name || undefined,
              fileUrl: resolveMediaUrl(m.media_url) || undefined,
              mimeType: m.mime_type || undefined,
              reactions: Array.isArray(m.reactions) ? m.reactions : [],
            } as ChatMessage));
          const apiById = new Map(apiMessages.map((message) => [message.id, message]));
          let changed = false;
          const updatedExisting = existing.map((message) => {
            const fromApi = apiById.get(message.id);
            if (!fromApi) return message;
            const currentPri = statusPriority[message.status || "sent"] ?? 1;
            const apiPri = statusPriority[fromApi.status || "sent"] ?? 1;
            if (apiPri > currentPri || JSON.stringify(fromApi.reactions || []) !== JSON.stringify(message.reactions || [])) {
              changed = true;
              return { ...message, status: fromApi.status, reactions: fromApi.reactions };
            }
            return message;
          });
          const existingIds = new Set(existing.map((m) => m.id));
          const incoming = apiMessages.filter((m) => !existingIds.has(m.id));
          if (incoming.length === 0 && !changed) return prev;
          const merged = [...updatedExisting, ...incoming].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          return { ...prev, [leadId]: merged };
        });
      } catch {
        /* swallow — próxima iteração tenta de novo */
      }
    };

    const interval = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedLead?.id]);

  const handleLoadMore = async () => {
    if (!selectedLead || historyLoading) return;
    const currentMessages = messages[selectedLead.id] || [];
    if (currentMessages.length === 0) return;

    const oldestMsg = currentMessages[0];
    const oldestTimestamp = new Date(oldestMsg.timestamp).toISOString();
    setHistoryLoading(true);

    try {
      const { data } = await messagesApi.list(selectedLead.id, { before: oldestTimestamp, limit: 30 });
      if (data?.messages?.length) {
        const apiMessages: ChatMessage[] = data.messages.map((m: ChatMessageApi) => ({
          id: m.id,
          leadId: m.lead_id,
          content: m.content,
          sender: m.sender,
          type: (m.type as MessageType) || "text",
          timestamp: new Date(m.timestamp),
          status: (m.status as any) || "delivered",
          fileName: m.file_name || undefined,
          fileUrl: resolveMediaUrl(m.media_url) || undefined,
          mimeType: m.mime_type || undefined,
          reactions: Array.isArray(m.reactions) ? m.reactions : [],
        }));

        setMessages((prev) => {
          const existing = prev[selectedLead.id] || [];
          const existingIds = new Set(existing.map((m) => m.id));
          const newMsgs = apiMessages.filter((m) => !existingIds.has(m.id));
          return { ...prev, [selectedLead.id]: [...newMsgs, ...existing] };
        });

        setHistoryHasMore((prev) => ({ ...prev, [selectedLead.id]: !!data.hasMore }));
      } else {
        setHistoryHasMore((prev) => ({ ...prev, [selectedLead.id]: false }));
      }
    } catch {
      // Silently fail — user can retry by scrolling up again
    } finally {
      setHistoryLoading(false);
    }
  };

  // Sync global unread count for sidebar badge
  useEffect(() => {
    const total = [...queue, ...myLeads].reduce((sum, l) => sum + l.unreadCount, 0);
    setChatUnreadCount(total);
  }, [queue, myLeads]);


  useEffect(() => {
    if (!leadSearch) return;
    const allLeads = [...myLeads, ...queue];
    if (allLeads.length === 0) return; // wait for leads to load

    const normalizedSearchPhone = leadSearch.replace(/\D/g, "");
    const normalizedSearchName = leadSearch.trim().toLowerCase();

    const match = allLeads.find(
      (l) => {
        const leadPhone = l.phone.replace(/\D/g, "");
        return l.name.toLowerCase() === normalizedSearchName
          || l.id === leadSearch
          || (normalizedSearchPhone.length >= 8 && (
            leadPhone === normalizedSearchPhone
            || leadPhone.endsWith(normalizedSearchPhone.slice(-11))
            || normalizedSearchPhone.endsWith(leadPhone.slice(-11))
          ));
      }
    );
    if (match) {
      if (match.status === "waiting") {
        // Opening from a notification must not approve/assume the attendance.
        // The lead remains in the waiting queue until an attendant clicks "Assumir".
        setSelectedLead(match);
        setActiveTab("queue");
        if (!messages[match.id]) {
          setMessages((prev) => ({
            ...prev,
            [match.id]: [{
              id: `sys-${Date.now()}`,
              leadId: match.id,
              content: match.lastMessage,
              sender: "lead",
              type: "text",
              timestamp: match.lastMessageTime,
            }],
          }));
        }
      } else {
        setSelectedLead(match);
        setActiveTab("mine");
      }
      // Clear the search param after selecting
      navigate({ to: "/chat", search: { lead: "" }, replace: true });
    }
  }, [leadSearch, myLeads.length, queue.length]);

  const handleAssign = async (lead: Lead) => {
    try {
      const { data, error } = await sessionsApi.assign({ leadId: lead.id });
      if (error) throw error;

      if (data?.waitTime) {
        console.log(`⏱️ Wait time for ${lead.name}: ${data.waitTime}s`);
      }

      setQueue((prev) => prev.filter((l) => l.id !== lead.id));
      const assignedLead: Lead = { ...lead, status: "active", assignedTo: "current", unreadCount: 0 };
      setMyLeads((prev) => [assignedLead, ...prev.filter((l) => l.id !== lead.id)]);
      setSelectedLead(assignedLead);
      setActiveTab("mine");
    } catch (error) {
      toast.error("Não foi possível assumir este atendimento. Ele continuará na fila.");
      console.error("Erro ao assumir atendimento:", error);
      return;
    }

    // Restore archived messages or create initial message
    const archived = conversationArchiveRef.current[lead.id];
    if (!messages[lead.id] || messages[lead.id].length === 0) {
      if (archived && archived.length > 0) {
        // Restore previous conversation history
        setMessages((prev) => ({
          ...prev,
          [lead.id]: [
            ...archived,
            {
              id: `sys-reassign-${Date.now()}`,
              leadId: lead.id,
              content: "Atendimento retomado",
              sender: "attendant" as const,
              type: "text" as const,
              timestamp: new Date(),
            },
          ],
        }));
      } else {
        setMessages((prev) => ({
          ...prev,
          [lead.id]: [
            {
              id: `sys-${Date.now()}`,
              leadId: lead.id,
              content: lead.lastMessage,
              sender: "lead",
              type: "text",
              timestamp: lead.lastMessageTime,
            },
          ],
        }));
      }
    }
  };

  // Track first response
  const [firstResponseTracked, setFirstResponseTracked] = useState<Set<string>>(new Set());

  const [replyingTo, setReplyingTo] = useState<ReplyData | null>(null);

  const handleSendMessage = async (content: string, type: MessageType, extra?: Partial<ChatMessage>) => {
    if (!selectedLead) return;

    const capturedReplyingTo = replyingTo;

    if (selectedLead.status === "active" && !firstResponseTracked.has(selectedLead.id)) {
      sessionsApi.firstResponse({ leadId: selectedLead.id });
      setFirstResponseTracked((prev) => new Set(prev).add(selectedLead.id));
    }

    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newMsg: ChatMessage = {
      id: msgId,
      leadId: selectedLead.id,
      content,
      sender: "attendant",
      type,
      timestamp: new Date(),
      status: "sending",
      replyTo: capturedReplyingTo || undefined,
      ...extra,
    };

    setMessages((prev) => ({
      ...prev,
      [selectedLead.id]: [...(prev[selectedLead.id] || []), newMsg],
    }));
    setReplyingTo(null);

    // Resolve the WhatsApp instance through the backend only. Do not call the
    // Evolution API directly from the browser: CORS blocks it in production and
    // a browser fallback can make the UI look successful when WhatsApp rejected
    // the send.
    const leadMessages = messages[selectedLead.id] || [];
    const lastKnownInstance = [...leadMessages].reverse().find((message) => message.instance)?.instance;
    const preferredInstanceName = selectedLead.instance || lastKnownInstance;
    const connected = resolveConnectedInstance(connectedInstances, preferredInstanceName);
    
    if (!connected) {
      toast.error("Mensagem não enviada", {
        description: preferredInstanceName
          ? `O WhatsApp ${preferredInstanceName} não está conectado a este chat. Confira em Canais e envie de novo.`
          : connectedInstances.length === 0
            ? "Nenhum WhatsApp conectado. Conecte em Canais e envie de novo."
            : "Não deu para saber por qual WhatsApp responder esta conversa. Abra a conversa pela fila ou espere o paciente escrever de novo."
      });
      setMessages((prev) => ({
        ...prev,
        [selectedLead.id]: (prev[selectedLead.id] || []).map((m) =>
          m.id === msgId ? { ...m, status: "failed" as const } : m
        ),
      }));
      return;
    }

    const updateStatus = (status: MessageStatus) => {
      setMessages((prev) => ({
        ...prev,
        [selectedLead.id]: (prev[selectedLead.id] || []).map((m) => {
          if (m.id !== msgId) return m;
          if (status === "failed") return { ...m, status };
          const currentPri = statusPriority[m.status || "sending"] ?? 0;
          const newPri = statusPriority[status] ?? 1;
          return newPri > currentPri ? { ...m, status } : m;
        }),
      }));
    };

    try {
      const replyMessageId = capturedReplyingTo?.messageId;
      let evolutionMsgId: string | null = null;

      if (type === "text") {
        let result;
        if (replyMessageId) {
          let cleanNumber = selectedLead.phone.replace(/\D/g, "");
          if (!cleanNumber.startsWith("55") && (cleanNumber.length === 10 || cleanNumber.length === 11)) {
            cleanNumber = `55${cleanNumber}`;
          }
          result = await whatsappApi.sendText(connected.instanceName, selectedLead.phone, content, {
            key: { remoteJid: `${cleanNumber}@s.whatsapp.net`, id: replyMessageId },
          }, selectedLead.id);
        } else {
          result = await whatsappApi.sendText(connected.instanceName, selectedLead.phone, content, undefined, selectedLead.id);
        }
        const proxyMessageId = getEvolutionMessageId(result?.data);
        if (result?.error) {
          throw new Error(result.error);
        }
        if (!proxyMessageId) {
          throw new Error("WhatsApp não confirmou o envio da mensagem");
        }
        evolutionMsgId = proxyMessageId;
      } else if (type === "image" || type === "video" || type === "document" || type === "audio") {
        const mediaFile = (extra as any)?._mediaFile as File | undefined;
        const mediaBase64 = (extra as any)?._mediaBase64 as string | undefined;

        console.log(`📤 [CHAT] Media send: type=${type}, hasFile=${!!mediaFile}, fileSize=${mediaFile?.size}, hasBase64=${!!mediaBase64}, base64Len=${mediaBase64?.length}, instance=${connected.instanceName}, phone=${selectedLead.phone}`);

        if (type === "audio" && mediaBase64 && !mediaFile) {
          const result = await whatsappApi.sendMedia(connected.instanceName, selectedLead.phone, type, {
            base64: mediaBase64,
            fileName: extra?.fileName,
            caption: undefined,
            mimeType: extra?.mimeType,
          });
          if (result.error) throw new Error(result.error);
          evolutionMsgId = (result.data as any)?.key?.id || null;
        } else if (mediaFile) {
          console.log(`📤 [CHAT] Using sendMediaUpload path for ${type}, file: ${mediaFile.name}, size: ${mediaFile.size}`);
          const uploadResult = await whatsappApi.sendMediaUpload(
            connected.instanceName,
            selectedLead.phone,
            type,
            mediaFile,
            {
              fileName: extra?.fileName,
              caption: type !== "audio" && content && !content.startsWith("🖼️") && !content.startsWith("🎬") && !content.startsWith("📎") ? content : undefined,
              mimeType: extra?.mimeType || mediaFile.type,
            }
          );

          if (uploadResult.error) throw new Error(uploadResult.error);

          const jobId = (uploadResult.data as any)?.jobId as string | undefined;
          if (!jobId) throw new Error("O envio do arquivo não começou");

          const startedAt = Date.now();
          while (Date.now() - startedAt < 120000) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const statusResult = await whatsappApi.getMediaSendStatus(jobId);
            if (statusResult.error) throw new Error(statusResult.error);

            const job = statusResult.data as any;
            if (job?.status === "sent") {
              evolutionMsgId = job?.result?.key?.id || job?.result?.message?.key?.id || job?.result?.data?.key?.id || msgId;
              break;
            }
            if (job?.status === "failed") {
              throw new Error(job?.error || "Não foi possível enviar o arquivo");
            }
          }

          if (!evolutionMsgId) {
            throw new Error("O WhatsApp demorou demais para confirmar o arquivo");
          }
        } else if (mediaBase64) {
          const result = await whatsappApi.sendMedia(connected.instanceName, selectedLead.phone, type, {
            base64: mediaBase64,
            fileName: extra?.fileName,
            caption: type !== "audio" && content && !content.startsWith("🖼️") && !content.startsWith("🎬") && !content.startsWith("📎") ? content : undefined,
            mimeType: extra?.mimeType,
          });
          if (result.error) throw new Error(result.error);
          evolutionMsgId = (result.data as any)?.key?.id || null;
        }
      } else if (type === "location" && extra?.location) {
        const result = await whatsappApi.sendLocation(connected.instanceName, selectedLead.phone, {
          latitude: extra.location.latitude,
          longitude: extra.location.longitude,
          name: extra.location.name,
          address: extra.location.address,
        });
        if (result.error) throw new Error(result.error);
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "contact" && extra?.contact) {
        const result = await whatsappApi.sendContact(connected.instanceName, selectedLead.phone, {
          fullName: extra.contact.fullName,
          phone: extra.contact.phone,
          email: extra.contact.email,
          company: extra.contact.company,
          url: extra.contact.url,
        });
        if (result.error) throw new Error(result.error);
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "poll" && extra?.poll) {
        const opts = extra.poll.options.map((o: any) => (typeof o === "string" ? o : o.text));
        const result = await whatsappApi.sendPoll(connected.instanceName, selectedLead.phone, extra.poll.question, opts);
        if (result.error) throw new Error(result.error);
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "sticker") {
        const stickerData = (extra as any)?.stickerUrl || content;
        const result = await whatsappApi.sendSticker(connected.instanceName, selectedLead.phone, stickerData);
        if (result.error) throw new Error(result.error);
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "list" && extra?.list) {
        const result = await whatsappApi.sendList(connected.instanceName, selectedLead.phone, {
          title: extra.list.title,
          buttonText: extra.list.buttonText || "Ver opções",
          sections: extra.list.sections,
        });
        if (result.error) throw new Error(result.error);
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "reaction") {
        const reactionData = extra as any;
        if (reactionData?.targetMessageId && reactionData?.emoji) {
          const result = await whatsappApi.sendReaction(
            connected.instanceName,
            selectedLead.phone,
            reactionData.targetMessageId,
            reactionData.emoji
          );
          if (result.error) throw new Error(result.error);
        }
      }

      if (type !== "reaction" && !evolutionMsgId) {
        throw new Error("WhatsApp não confirmou o envio da mensagem");
      }

      updateStatus("sent");

      if (evolutionMsgId) {
        const pendingStatus = pendingStatusByMessageIdRef.current.get(evolutionMsgId);
        if (pendingStatus) pendingStatusByMessageIdRef.current.delete(evolutionMsgId);
        setMessages((prev) => ({
          ...prev,
          [selectedLead.id]: (prev[selectedLead.id] || []).map((m) => {
            if (m.id !== msgId && m.id !== evolutionMsgId) return m;
            const currentPri = statusPriority[m.status || "sending"] ?? 0;
            const pendingPri = pendingStatus ? (statusPriority[pendingStatus] ?? 1) : -1;
            const newId = evolutionMsgId!;
            if (pendingStatus && pendingPri > currentPri) {
              return { ...m, id: newId, status: pendingStatus };
            }
            return currentPri >= (statusPriority["sent"] ?? 1)
              ? { ...m, id: newId }
              : { ...m, id: newId, status: "sent" as MessageStatus };
          }),
        }));
      }

      // For media messages, upload file to VPS for persistent URL, or pass base64
      let persistFileUrl = extra?.fileUrl || undefined;
      const mediaFile = (extra as any)?._mediaFile as File | undefined;
      if (mediaFile && ['image', 'video', 'document', 'audio'].includes(type)) {
        try {
          const uploadResult = await mediaApi.upload(mediaFile);
          if (uploadResult.url) {
            persistFileUrl = uploadResult.url;
          }
        } catch (uploadErr) {
          console.warn('Media upload for persistence failed:', uploadErr);
        }
      }

      const saveResult = await messagesApi.save({
        id: evolutionMsgId || msgId,
        leadId: selectedLead.id,
        content,
        type,
        status: "sent",
        fileName: extra?.fileName,
        fileUrl: persistFileUrl,
        mimeType: extra?.mimeType,
        replyTo: capturedReplyingTo,
        instance: connected.instanceName,
        phone: selectedLead.phone,
      });
      if (saveResult.error) {
        console.error("Failed to persist message:", saveResult.error);
      } else if (saveResult.data?.status && saveResult.data.status !== "sent") {
        const savedStatus = saveResult.data.status as MessageStatus;
        setMessages((prev) => ({
          ...prev,
          [selectedLead.id]: (prev[selectedLead.id] || []).map((m) => {
            if (m.id !== (evolutionMsgId || msgId)) return m;
            const currentPri = statusPriority[m.status || "sent"] ?? 1;
            const savedPri = statusPriority[savedStatus] ?? 1;
            return savedPri > currentPri ? { ...m, status: savedStatus } : m;
          }),
        }));
      }
    } catch (err: any) {
      console.error("Falha no envio:", err);
      toast.error("Mensagem não enviada", { description: friendlySendError(err?.message) });
      updateStatus("failed");
    }
  };

  // Conversation history archive — persists messages even after finishing attendance
  const conversationArchiveRef = useRef<Record<string, ChatMessage[]>>({});

  // Keep archive in sync with messages
  useEffect(() => {
    for (const [leadId, msgs] of Object.entries(messages)) {
      if (msgs.length > 0) {
        conversationArchiveRef.current[leadId] = msgs;
      }
    }
  }, [messages]);

  const handleFinishAttendance = (lead: Lead, outcome?: string, options?: { farewellMessage?: string; consciousnessLevel?: string }) => {
    const farewellMessage = options?.farewellMessage;

    // Send farewell message via WhatsApp if provided
    if (farewellMessage) {
      handleSendMessage(farewellMessage, "text");
    }

    const instanceName = connectedInstances[0]?.instanceName || "teste";
    sessionsApi.close({
      leadId: lead.id,
      leadPhone: lead.phone,
      instance: instanceName,
    }).then(({ data, error }) => {
      if (error) {
        toast.error(`Não foi possível finalizar o atendimento de ${lead.name}`, {
          description: "O atendimento pode ter ficado aberto. Atualize a lista para conferir antes de finalizar de novo.",
        });
        return;
      }
      const durationMin = data?.duration ? Math.floor(data.duration / 60) : 0;

      const outcomeLabels: Record<string, string> = {
        atendido: "paciente atendido",
        followup: "movido para follow-up",
        orcamento: "enviado para orçamento",
      };
      const outcomeLabel = outcomeLabels[outcome || "atendido"] || "finalizado";

      toast.success(`Atendimento finalizado — ${outcomeLabel}`, {
        description: data?.duration
          ? `${lead.name} · ${durationMin < 1 ? "menos de 1 min" : `${durationMin} min`}`
          : lead.name,
      });
    });

    // ── Auto-move lead in CRM Kanban based on outcome ──
    const stageMap: Record<string, string> = {
      atendido: "", // remove from kanban (no stage move needed, already closed)
      followup: "followup", // → Recovery Kanban
      orcamento: "orcamento", // → Sales Kanban: Orçamento stage
    };
    const targetStage = stageMap[outcome || "atendido"];
    if (targetStage) {
      crmApi.updateStage(lead.id, targetStage, `Desfecho de atendimento: ${outcome}`).then(({ error }) => {
        if (error) {
          console.error("Erro ao mover lead no CRM:", error);
        } else {
          setCrmStages((prev) => ({ ...prev, [lead.id]: targetStage }));
          const destLabel = outcome === "followup" ? "Follow-up (Recuperação)" : "Orçamento (Funil de Vendas)";
          toast.info(`Paciente movido para "${destLabel}" no CRM`, { duration: 4000 });
        }
      });
    }

    // Update consciousness level if provided
    if (options?.consciousnessLevel) {
      crmApi.updateConsciousness(lead.id, options.consciousnessLevel).catch((err) => {
        console.error("Erro ao atualizar nível de consciência:", err);
      });
    }

    // System message
    const outcomeMessages: Record<string, string> = {
      atendido: "Atendimento finalizado · paciente atendido",
      followup: "Atendimento finalizado · movido para follow-up",
      orcamento: "Atendimento finalizado · enviado para orçamento",
    };
    const sysContent = outcomeMessages[outcome || "atendido"] || "Atendimento finalizado";

    setMessages((prev) => {
      const updated = {
        ...prev,
        [lead.id]: [
          ...(prev[lead.id] || []),
          {
            id: `sys-close-${Date.now()}`,
            leadId: lead.id,
            content: sysContent,
            sender: "attendant" as const,
            type: "text" as const,
            timestamp: new Date(),
          },
        ],
      };
      conversationArchiveRef.current[lead.id] = updated[lead.id];
      return updated;
    });

    // Remove lead from myLeads and queue — attendance is done
    setMyLeads((prev) => prev.filter((l) => l.id !== lead.id));
    setQueue((prev) => prev.filter((l) => l.id !== lead.id));

    // Deselect if this was the active lead
    if (selectedLead?.id === lead.id) {
      setSelectedLead(null);
    }

    // Open satisfaction survey dialog only for "atendido"
    if (outcome === "atendido" || !outcome) {
      setSurveyLead(lead);
    }
  };

  const handleSendSurvey = (lead: Lead, rating: number, comment: string) => {
    const stars = "⭐".repeat(rating);
    const labels = ["Péssimo", "Ruim", "Regular", "Bom", "Excelente"];
    let surveyMsg = `Olá ${lead.name}! 😊\n\nGostaríamos de saber como foi seu atendimento.\n\nSua avaliação: ${stars} (${labels[rating - 1]})\n\nPor favor, responda com uma nota de 1 a 5 para avaliar nosso atendimento.\n\n1 ⭐ Péssimo\n2 ⭐⭐ Ruim\n3 ⭐⭐⭐ Regular\n4 ⭐⭐⭐⭐ Bom\n5 ⭐⭐⭐⭐⭐ Excelente`;
    if (comment) {
      surveyMsg += `\n\n${comment}`;
    }

    // Send via WhatsApp
    if (connectedInstances.length > 0 && lead.phone) {
      const instanceName = connectedInstances[0].instanceName;
      whatsappApi.sendText(instanceName, lead.phone, surveyMsg).catch(() => {
        toast.error("Erro ao enviar pesquisa de satisfação");
      });
    }

    // Add system message to archived conversation
    setMessages((prev) => {
      const updated = {
        ...prev,
        [lead.id]: [
          ...(prev[lead.id] || []),
          {
            id: `sys-nps-${Date.now()}`,
            leadId: lead.id,
            content: `Pesquisa de satisfação enviada (${rating} de 5 · ${labels[rating - 1]})`,
            sender: "attendant" as const,
            type: "text" as const,
            timestamp: new Date(),
          },
        ],
      };
      conversationArchiveRef.current[lead.id] = updated[lead.id];
      return updated;
    });

    toast.success("Pesquisa de satisfação enviada", {
      description: `${lead.name} · ${rating} de 5`,
    });
    setSurveyLead(null);
  };

  const handleReturnToQueue = (lead: Lead) => {
    // Move from myLeads back to queue
    setMyLeads((prev) => prev.filter((l) => l.id !== lead.id));
    const queuedLead: Lead = { ...lead, status: "waiting", assignedTo: undefined, unreadCount: 0 };
    setQueue((prev) => [queuedLead, ...prev]);
    if (selectedLead?.id === lead.id) setSelectedLead(null);

    // Add system message
    setMessages((prev) => ({
      ...prev,
      [lead.id]: [
        ...(prev[lead.id] || []),
        {
          id: `sys-return-${Date.now()}`,
          leadId: lead.id,
          content: "Paciente devolvido à fila de espera",
          sender: "attendant" as const,
          type: "text" as const,
          timestamp: new Date(),
        },
      ],
    }));

    toast.info(`${lead.name} retornado à fila de espera`);
  };
  const handleReaction = (messageId: string, emoji: string) => {
    if (!selectedLead) return;
    const connected = connectedInstances[0];
    if (!connected) {
      toast.error("Reação não enviada", { description: "Nenhum WhatsApp conectado." });
      return;
    }
    if (!selectedLead.phone) {
      toast.error("Reação não enviada", { description: "Este contato não tem telefone." });
      return;
    }

    whatsappApi.sendReaction(connected.instanceName, selectedLead.phone, messageId, emoji)
      .then(({ error }) => {
        if (error) throw new Error(error);
        setMessages((prev) => ({
          ...prev,
          [selectedLead.id]: (prev[selectedLead.id] || []).map((m) =>
            m.id === messageId
              ? { ...m, reactions: [{ emoji, count: 1 }] }
              : m
          ),
        }));
      })
      .catch((err: any) => {
        console.error("Failed to send reaction:", err);
        toast.error("Reação não enviada", { description: err?.message || "Tente de novo em alguns segundos." });
      });
  };


  const handleReply = (msg: ChatMessage) => {
    setReplyingTo({
      messageId: msg.id,
      content: msg.content || (msg.type === "image" ? "📷 Imagem" : msg.type === "location" ? "📍 Localização" : msg.type),
      sender: msg.sender === "lead" ? selectedLead?.name || "Paciente" : "Você",
    });
  };

  const handleFileDrop = useCallback((files: File[]) => {
    if (!selectedLead) return;
    const MAX_SIZE = 16 * 1024 * 1024;
    for (const file of files) {
      if (file.size > MAX_SIZE) {
        toast.error(`Arquivo grande demais: ${file.name}`, { description: "O WhatsApp aceita arquivos de até 16 MB." });
        continue;
      }
      const type: MessageType = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio"
        : "document";

      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUri = reader.result as string;
        const base64 = dataUri.split(",")[1];
        const label = type === "image" ? "🖼️ Imagem" : type === "video" ? "🎬 Vídeo" : type === "audio" ? "🎤 Áudio" : `📎 ${file.name}`;
        handleSendMessage(label, type, {
          fileName: file.name,
          fileUrl: dataUri,
          mimeType: file.type,
          _mediaBase64: base64,
        } as any);
      };
      reader.readAsDataURL(file);
    }
  }, [selectedLead, handleSendMessage]);

  const handleForward = (msg: ChatMessage) => {
    const text = msg.content || `[${MESSAGE_TYPE_LABEL[msg.type] ?? "Mensagem"}]`;
    navigator.clipboard.writeText(text).then(() => {
      toast.success("Texto copiado", { description: "Cole na conversa para onde quer encaminhar." });
    }).catch(() => {
      toast.error("Não foi possível copiar o texto");
    });
  };

  const handleDeleteMessage = (msg: ChatMessage) => {
    if (!selectedLead) return;
    setMessages((prev) => ({
      ...prev,
      [selectedLead.id]: (prev[selectedLead.id] || []).map((m) =>
        m.id === msg.id ? { ...m, content: "🚫 Mensagem apagada", type: "text" as const } : m
      ),
    }));
    // Persist soft-delete to backend
    messagesApi.delete(msg.id).catch((err) => console.error("Failed to delete message:", err));

    // Delete on WhatsApp for everyone (only works for messages we sent)
    const connected = connectedInstances[0];
    if (connected && selectedLead.phone && msg.sender === "attendant") {
      whatsappApi.deleteMessage(connected.instanceName, selectedLead.phone, msg.id, true)
        .catch((err: any) => console.error("Failed to delete on WhatsApp:", err));
    }

    toast.info("Mensagem apagada");
  };

  const handleTransfer = (lead: Lead, toAttendantId: string, toAttendantName: string, reason: string) => {
    // Save to VPS database for auditing
    transferApi.create({
      leadId: lead.id,
      leadName: lead.name,
      leadPhone: lead.phone,
      toUserId: toAttendantId,
      toUserName: toAttendantName,
      reason,
      queueId: lead.queueId,
      queueName: lead.queueName,
    }).then(({ error }) => {
      if (error) console.error("Erro ao salvar log de transferência:", error);
    });

    setMyLeads((prev) => prev.filter((l) => l.id !== lead.id));
    if (selectedLead?.id === lead.id) {
      setSelectedLead(null);
    }
    setMessages((prev) => ({
      ...prev,
      [lead.id]: [
        ...(prev[lead.id] || []),
        {
          id: `sys-transfer-${Date.now()}`,
          leadId: lead.id,
          content: `Atendimento transferido para ${toAttendantName}\nMotivo: ${reason}`,
          sender: "attendant" as const,
          type: "text" as const,
          timestamp: new Date(),
        },
      ],
    }));
  };

  const currentMessages = selectedLead ? messages[selectedLead.id] || [] : [];
  const baseList = activeTab === "queue" ? queue : myLeads;
  const filteredByStatus = activeTab === "mine" && filterStatus !== "all" ? baseList.filter((l) => l.status === filterStatus) : baseList;
  const filteredByQueue = filterQueue ? filteredByStatus.filter((l) => l.queueId === filterQueue) : filteredByStatus;
  // A fila de espera precisa mostrar toda mensagem recebida do WhatsApp, mesmo
  // quando o lead ainda não tem estágio CRM carregado. O filtro de estágio é
  // útil para atendimentos assumidos, mas escondia leads recém-chegados e dava
  // a impressão de chat vazio.
  const filteredByStage = activeTab === "mine" && filterStage
    ? filteredByQueue.filter((l) => crmStages[l.id] === filterStage)
    : filteredByQueue;
  const currentList = [...filteredByStage].sort((a, b) => {
    // Priority leads (recovery) always at the top
    if (a.priority && !b.priority) return -1;
    if (!a.priority && b.priority) return 1;
    // Then by most recent message
    return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
  });

  const handleSyncPhotos = useCallback(async () => {
    const instanceName = connectedInstances[0]?.instanceName;
    if (!instanceName) {
      toast.error("Nenhum WhatsApp conectado", { description: "Conecte um número em Canais para buscar as fotos." });
      return;
    }
    setSyncingPhotos(true);
    const syncToast = toast.loading("Buscando fotos de perfil…");
    try {
      const { data, error } = await whatsappApi.syncProfilePictures(instanceName);
      if (error) {
        const friendly = /unauthorized/i.test(error)
          ? "Sessão expirada. Saia e entre novamente para sincronizar."
          : "Verifique a conexão do WhatsApp e tente de novo.";
        toast.error("Não foi possível buscar as fotos", { id: syncToast, description: friendly });
      } else {
        toast.success(`${data?.updated || 0} de ${data?.total || 0} fotos atualizadas`, { id: syncToast });
        // Reload leads to show updated avatars
        const res = await queueLeadsApi.list();
        if (res.data) {
          const mapLead = (r: any): Lead => ({
            id: r.id,
            name: r.name || r.phone,
            initials: (r.name || r.phone || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase(),
            phone: r.phone,
            avatarUrl: r.avatarUrl,
            lastMessage: r.lastMessage || "",
            lastMessageTime: r.lastMessageTime ? new Date(r.lastMessageTime) : new Date(),
            unreadCount: r.unreadCount || 0,
            status: r.sessionStatus === "active" ? "active" : r.sessionStatus === "waiting" ? "waiting" : "waiting",
            assignedTo: r.attendantName || undefined,
            queueId: r.queueId || undefined,
            queueName: r.queueName || undefined,
          });
          setQueue(res.data.queue?.map(mapLead) || []);
          setMyLeads(res.data.active?.map(mapLead) || []);
        }
      }
    } catch (err: any) {
      console.error("Falha ao buscar fotos de perfil:", err);
      toast.error("Não foi possível buscar as fotos", { id: syncToast, description: "Verifique a conexão e tente de novo." });
    } finally {
      setSyncingPhotos(false);
    }
  }, [connectedInstances]);

  const handleNewChatFromContact = (contato: Contato) => {
    // Check if lead already exists
    const allLeads = [...queue, ...myLeads];
    const existing = allLeads.find(
      (l) => l.phone.replace(/\D/g, "").endsWith((contato.telefone || "").replace(/\D/g, "").slice(-11))
    );
    if (existing) {
      setSelectedLead(existing);
      setActiveTab(existing.status === "waiting" ? "queue" : "mine");
      return;
    }

    // Create new lead in myLeads
    const newLead: Lead = {
      id: `contact-${contato.id}`,
      name: contato.nome,
      initials: contato.nome.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
      phone: contato.telefone || "",
      lastMessage: "",
      lastMessageTime: new Date(),
      unreadCount: 0,
      status: "active",
      assignedTo: "current",
      avatarColor: "bg-chart-1",
    };
    setMyLeads((prev) => [newLead, ...prev]);
    setMessages((prev) => ({ ...prev, [newLead.id]: [] }));
    setSelectedLead(newLead);
    setActiveTab("mine");
  };

  const hasActiveFilters = !!filterQueue || (activeTab === "mine" && (!!filterStage || filterStatus !== "all"));
  const canOpenChannels = canAccessRoute("/canais", currentUser?.role ?? "user", !!currentUser?.is_super_admin, currentUser?.tenant_features);
  const chipBase =
    "inline-flex items-center gap-1.5 min-h-11 md:min-h-8 px-3 rounded-full text-xs font-medium tabular-nums shrink-0 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const chipOn = "bg-primary text-primary-foreground border-primary";
  const chipOff = "bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground";
  const tabBase =
    "flex-1 min-w-0 min-h-11 flex items-center justify-center gap-1.5 px-2 text-sm transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className={selectedLead ? "hidden md:block" : undefined}>
        <DashboardHeader title="Chat" />
      </div>

      {/* WhatsApp Connection Status Bar */}
      {/* Aparece já no carregamento: se a checagem das instâncias demorar (Evolution fora do ar),
          a recepção precisa do aviso mesmo assim. */}
      {connectedInstances.length === 0 && (
        <div
          role="status"
          className={cn(
            "flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive",
            selectedLead ? "hidden md:flex" : "flex",
          )}
        >
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-[12rem]">
            <strong className="font-semibold">WhatsApp desconectado.</strong> As mensagens não serão enviadas até reconectar.
          </span>
          {canOpenChannels ? (
            <Link
              to="/canais"
              className="inline-flex min-h-11 md:min-h-8 items-center pl-7 sm:pl-0 font-semibold underline underline-offset-2"
            >
              Conectar WhatsApp
            </Link>
          ) : (
            <span className="pl-7 sm:pl-0 font-medium">Avise o administrador da clínica.</span>
          )}
        </div>
      )}
      {connectedInstances.length > 0 && (
        <div role="status" className="hidden md:flex items-center gap-2 px-4 py-1.5 border-b border-border text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-success shrink-0" aria-hidden="true" />
          <span className="truncate">
            {connectedInstances.length === 1
              ? `WhatsApp conectado: ${connectedInstances[0].instanceName}`
              : `${connectedInstances.length} números de WhatsApp conectados`}
          </span>
        </div>
      )}
      <div className="flex-1 flex min-w-0 overflow-hidden">
        {/* Left Panel - Lead List */}
        <section
          aria-label="Lista de atendimentos"
          className={cn(
            "w-full md:w-[340px] lg:w-[360px] flex-col bg-card shrink-0 md:border-r md:border-border",
            selectedLead ? "hidden md:flex" : "flex",
          )}
        >
          {/* Ações */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            <Button className="h-11 md:h-9 gap-2" onClick={() => setNewChatOpen(true)}>
              <UserPlus className="size-4" aria-hidden="true" />
              Nova conversa
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 md:size-9 ml-auto text-muted-foreground"
                  aria-label="Mais ações do WhatsApp"
                >
                  <MoreVertical className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11 md:min-h-9" onSelect={() => setImportContactsOpen(true)}>
                  <Users aria-hidden="true" />
                  Importar contatos do WhatsApp
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11 md:min-h-9" onSelect={() => setImportMessagesOpen(true)}>
                  <MessageSquare aria-hidden="true" />
                  Importar conversas do WhatsApp
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-11 md:min-h-9"
                  disabled={syncingPhotos}
                  aria-busy={syncingPhotos}
                  onSelect={() => void handleSyncPhotos()}
                >
                  <RefreshCw className={syncingPhotos ? "animate-spin" : undefined} aria-hidden="true" />
                  {syncingPhotos ? "Buscando fotos de perfil…" : "Atualizar fotos de perfil"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Abas */}
          <div className="flex items-stretch border-b border-border shrink-0">
            <button
              type="button"
              aria-pressed={activeTab === "queue"}
              onClick={() => setActiveTab("queue")}
              className={cn(
                tabBase,
                activeTab === "queue"
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-muted-foreground font-medium hover:text-foreground",
              )}
            >
              <span className="truncate">Fila de espera</span>
              {queue.length > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className="min-h-5 min-w-5 px-1.5 rounded-full bg-warning text-warning-foreground text-xs font-semibold tabular-nums inline-flex items-center justify-center shrink-0"
                  >
                    {queue.length}
                  </span>
                  <span className="sr-only">, {queue.length} aguardando</span>
                </>
              )}
            </button>
            <button
              type="button"
              aria-pressed={activeTab === "mine"}
              onClick={() => setActiveTab("mine")}
              className={cn(
                tabBase,
                activeTab === "mine"
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-muted-foreground font-medium hover:text-foreground",
              )}
            >
              <span className="truncate">Meus atendimentos</span>
              {myLeads.length > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className="min-h-5 min-w-5 px-1.5 rounded-full bg-muted text-foreground text-xs font-semibold tabular-nums inline-flex items-center justify-center shrink-0"
                  >
                    {myLeads.length}
                  </span>
                  <span className="sr-only">, {myLeads.length} em atendimento</span>
                </>
              )}
            </button>
          </div>

          {/* Status Filter (mine tab only) */}
          {activeTab === "mine" && myLeads.length > 0 && (
            <div role="group" aria-label="Filtrar por situação" className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(["all", "active", "finished"] as const).map((s) => {
                const labels = { all: "Todos", active: "Ativos", finished: "Finalizados" };
                const count = s === "all" ? myLeads.length : myLeads.filter((l) => l.status === s).length;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={filterStatus === s}
                    onClick={() => setFilterStatus(s)}
                    className={cn(chipBase, filterStatus === s ? chipOn : chipOff)}
                  >
                    {labels[s]} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Queue Filter */}
          {availableQueues.length > 0 && (
            <div role="group" aria-labelledby="filtro-fila" className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span id="filtro-fila" className="text-xs text-muted-foreground shrink-0">Fila</span>
              <button
                type="button"
                aria-pressed={!filterQueue}
                onClick={() => setFilterQueue(null)}
                className={cn(chipBase, !filterQueue ? chipOn : chipOff)}
              >
                Todas
              </button>
              {availableQueues.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  aria-pressed={filterQueue === q.id}
                  onClick={() => setFilterQueue(filterQueue === q.id ? null : q.id)}
                  className={cn(chipBase, filterQueue === q.id ? chipOn : chipOff)}
                >
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: q.color }} aria-hidden="true" />
                  {q.name}
                </button>
              ))}
            </div>
          )}

          {/* CRM Stage Filter (só filtra em "Meus atendimentos") */}
          {activeTab === "mine" && (
            <div role="group" aria-labelledby="filtro-etapa" className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span id="filtro-etapa" className="text-xs text-muted-foreground shrink-0">Etapa</span>
              {[
                { id: "lead", label: "Lead" },
                { id: "em_atendimento", label: "Em atendimento" },
                { id: "orcamento", label: "Orçamento" },
                { id: "orcamento_enviado", label: "Orçamento enviado" },
                { id: "orcamento_aprovado", label: "Aprovado" },
                { id: "followup", label: "Follow-up" },
              ].map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  aria-pressed={filterStage === stage.id}
                  onClick={() => setFilterStage(filterStage === stage.id ? null : stage.id)}
                  className={cn(chipBase, filterStage === stage.id ? chipOn : chipOff)}
                >
                  {stage.label}
                </button>
              ))}
            </div>
          )}
          {/* Lead List */}
          <div className="flex-1 overflow-y-auto">
            {currentList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-6">
                <Users className="size-10 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">
                  {hasActiveFilters
                    ? "Nenhuma conversa com esses filtros"
                    : activeTab === "queue"
                      ? "Ninguém aguardando na fila"
                      : "Você não tem atendimentos abertos"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {hasActiveFilters
                    ? "Limpe os filtros para ver todas."
                    : activeTab === "queue"
                      ? "Novas mensagens do WhatsApp aparecem aqui."
                      : "Assuma alguém da fila ou inicie uma nova conversa."}
                </p>
                {hasActiveFilters ? (
                  <Button
                    variant="outline"
                    className="h-11 md:h-9"
                    onClick={() => {
                      setFilterStage(null);
                      setFilterQueue(null);
                      setFilterStatus("all");
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  activeTab === "mine" && (
                    <Button variant="outline" className="h-11 md:h-9" onClick={() => setActiveTab("queue")}>
                      Ver fila
                    </Button>
                  )
                )}
              </div>
            ) : (
              currentList.map((lead) => (
                <LeadListItem
                  key={lead.id}
                  lead={lead}
                  isSelected={selectedLead?.id === lead.id}
                  onSelect={setSelectedLead}
                  showAssignButton={activeTab === "queue"}
                  onAssign={handleAssign}
                  presence={presenceMap[lead.id]?.status}
                  crmStage={crmStages[lead.id]}
                />
              ))
            )}
          </div>
        </section>

        {/* Right Panel - Conversation */}
        <div className={cn("flex-1 min-w-0 flex-col bg-background", selectedLead ? "flex" : "hidden md:flex")}>
          {selectedLead ? (
            <>
              <ChatHeader lead={selectedLead} onClose={() => setSelectedLead(null)} onTransfer={handleTransfer} onFinishAttendance={handleFinishAttendance} onReturnToQueue={handleReturnToQueue} messages={currentMessages} presence={presenceMap[selectedLead.id]?.status ?? "offline"} lastSeen={presenceMap[selectedLead.id]?.lastSeen ?? null} crmStage={crmStages[selectedLead.id]} onStageChange={(leadId, stage) => setCrmStages((prev) => ({ ...prev, [leadId]: stage }))} />
              <ConversationView
                messages={currentMessages}
                leadName={selectedLead.name}
                isTyping={presenceMap[selectedLead.id]?.status === "typing"}
                isRecording={presenceMap[selectedLead.id]?.status === "recording"}
                onReaction={handleReaction}
                onReply={handleReply}
                onForward={handleForward}
                onDelete={handleDeleteMessage}
                onLoadMore={handleLoadMore}
                hasMore={historyHasMore[selectedLead.id] ?? false}
                loadingMore={historyLoading}
                onFileDrop={handleFileDrop}
                unreadCount={selectedLead.unreadCount}
                onServerSearch={async (q) => {
                  const { data } = await messagesApi.search(q, selectedLead.id);
                  if (!data || !Array.isArray(data)) return [];
                  return data.map((m: any) => ({
                    id: m.id,
                    content: m.content || "",
                    sender: m.sender,
                    timestamp: m.timestamp,
                  }));
                }}
              />
              {selectedLead.status === "finished" ? (
                <div className="px-4 py-3 border-t border-border bg-muted/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <p className="text-sm text-muted-foreground">Atendimento finalizado</p>
                  <Button
                    variant="outline"
                    className="h-11 md:h-9 w-full sm:w-auto"
                    onClick={() => {
                      setMyLeads((prev) =>
                        prev.map((l) => l.id === selectedLead.id ? { ...l, status: "active" as const } : l)
                      );
                      setSelectedLead({ ...selectedLead, status: "active" });
                      toast.success("Atendimento reaberto");
                    }}
                  >
                    Reabrir atendimento
                  </Button>
                </div>
              ) : (
                <MessageInput
                  onSendMessage={handleSendMessage}
                  onPresenceChange={handleAttendantPresenceChange}
                  disabled={selectedLead.status === "waiting"}
                  notice={connectedInstances.length === 0 ? "no-whatsapp" : null}
                  onAssign={selectedLead.status === "waiting" ? () => void handleAssign(selectedLead) : undefined}
                  replyingTo={replyingTo}
                  onCancelReply={() => setReplyingTo(null)}
                  attendantName={currentUser?.name}
                  leadId={selectedLead.id}
                  crmStage={crmStages[selectedLead.id]}
                  onStageChange={(leadId, stage) => setCrmStages((prev) => ({ ...prev, [leadId]: stage }))}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center chat-bg-pattern px-6">
              <div className="text-center space-y-3">
                <MessageSquare className="size-10 text-muted-foreground mx-auto" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-foreground text-sm font-medium">
                    Selecione um atendimento
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Escolha uma conversa na lista ou inicie uma nova
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <NewChatFromContactDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onSelectContact={handleNewChatFromContact}
      />

      {surveyLead && (
        <SatisfactionSurveyDialog
          leadName={surveyLead.name}
          open={!!surveyLead}
          onClose={() => setSurveyLead(null)}
          onSend={(rating, comment) => handleSendSurvey(surveyLead, rating, comment)}
          onSkip={() => setSurveyLead(null)}
        />
      )}

      <ImportMessagesDialog 
        open={importMessagesOpen}
        onOpenChange={setImportMessagesOpen}
        onImported={reloadQueueLeads}
      />

      <ImportWhatsAppDialog
        open={importContactsOpen}
        onOpenChange={setImportContactsOpen}
        onImported={reloadQueueLeads}
      />
    </div>
  );
}
