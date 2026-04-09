import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { LeadListItem } from "@/components/chat/LeadListItem";
import { ConversationView } from "@/components/chat/ConversationView";
import { MessageInput } from "@/components/chat/MessageInput";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Users, MessageSquare, Inbox, Filter, Tags, UserPlus, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewChatFromContactDialog } from "@/components/chat/NewChatFromContactDialog";
import { SatisfactionSurveyDialog } from "@/components/chat/SatisfactionSurveyDialog";
import type { Contato } from "@/lib/vpsApi";
import type { AttendanceQueue } from "@/data/queueData";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeChat, type IncomingMessage } from "@/hooks/useRealtimeChat";
import { whatsappApi, transferApi, sessionsApi, tagsApi, queuesApi, type LeadTagApi } from "@/lib/vpsApi";
import { sendTextMessage } from "@/lib/evolutionApi";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { playNotificationSound } from "@/lib/notificationSound";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/browserNotification";
import { setChatUnreadCount } from "@/lib/chatUnreadStore";
import {
  type Lead,
  type ChatMessage,
  type MessageType,
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

export const Route = createFileRoute("/chat")({
  ssr: false,
  validateSearch: zodValidator(chatSearchSchema),
  component: ChatPage,
});

function ChatPage() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { lead: leadSearch } = Route.useSearch();
  const { connected: connectedInstances } = useWhatsAppInstances();
  const [activeTab, setActiveTab] = useState<"queue" | "mine">("queue");
  const [queue, setQueue] = useState<Lead[]>([]);
  const [myLeads, setMyLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [filterQueue, setFilterQueue] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "finished">("all");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [isLeadTyping, setIsLeadTyping] = useState(false);
  const [availableQueues, setAvailableQueues] = useState<AttendanceQueue[]>([]);
  const [availableTags, setAvailableTags] = useState<LeadTagApi[]>([]);
  const [leadTagAssignments, setLeadTagAssignments] = useState<Record<string, string[]>>({});
  const [surveyLead, setSurveyLead] = useState<Lead | null>(null);

  // Refs for stable closure access in SSE callback
  const queueRef = useRef(queue);
  const myLeadsRef = useRef(myLeads);
  const selectedLeadRef = useRef(selectedLead);
  queueRef.current = queue;
  myLeadsRef.current = myLeads;
  selectedLeadRef.current = selectedLead;

  // Load queues, tags and assignments from VPS
  useEffect(() => {
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
    tagsApi.list().then(({ data }) => { if (data) setAvailableTags(data); });
    tagsApi.assignments().then(({ data }) => { if (data) setLeadTagAssignments(data); });
  }, []);

  const handleToggleTag = useCallback((leadId: string, tagId: string) => {
    setLeadTagAssignments((prev) => {
      const current = prev[leadId] || [];
      const updated = current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId];
      return { ...prev, [leadId]: updated };
    });
    tagsApi.toggle(leadId, tagId);
  }, []);

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

    const chatMsg: ChatMessage = {
      id: msg.id,
      leadId: msg.leadId || msg.phone,
      content: msg.content,
      sender: "lead",
      type: (msg.type as MessageType) || "text",
      timestamp: new Date(msg.timestamp),
      status: "delivered",
    };

    // Use refs to avoid stale closure
    const allLeads = [...queueRef.current, ...myLeadsRef.current];
    const existingLead = allLeads.find(
      (l) => l.id === msg.leadId || l.phone.replace(/\D/g, "").endsWith(msg.phone.slice(-11))
    );

    const currentSelected = selectedLeadRef.current;
    const isViewing = existingLead && currentSelected?.id === existingLead.id;

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
                lastMessage: msg.content || `[${msg.type}]`,
                lastMessageTime: new Date(msg.timestamp),
                unreadCount: currentSelected?.id === existingLead.id ? lead.unreadCount : lead.unreadCount + 1,
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
          lastMessage: msg.content || `[${msg.type}]`,
          lastMessageTime: new Date(msg.timestamp),
          unreadCount: 1,
          status: "waiting",
          avatarColor: "bg-chart-1",
          queueId: incomingMsg.queueId,
          queueName: incomingMsg.queueName,
          queueColor: incomingMsg.queueColor,
        };
        setQueue((prev) => [newLead, ...prev]);
        setMessages((prev) => ({
          ...prev,
          [newLead.id]: [chatMsg],
        }));
        sessionsApi.start({
          leadId: newLead.id,
          leadName: newLead.name,
          leadPhone: newLead.phone,
          queueId: incomingMsg.queueId,
          queueName: incomingMsg.queueName,
        });
      }
    };

    // Show typing indicator briefly before message for active conversation
    if (isViewing) {
      setIsLeadTyping(true);
      setTimeout(() => {
        setIsLeadTyping(false);
        addMessage();
      }, 800 + Math.random() * 600);
    } else {
      addMessage();
    }

    // Play sound + show toast + browser push notification
    playNotificationSound();
    const name = msg.leadName || msg.pushName;
    const body = msg.content?.slice(0, 80) || `[${msg.type}]`;
    toast.info(`💬 ${name}`, {
      description: body,
      duration: 5000,
      action: {
        label: "Abrir",
        onClick: () => navigate({ to: "/chat", search: { lead: name } }),
      },
    });
    showBrowserNotification(`💬 ${name}`, body, name);
  }, []);

  useRealtimeChat(handleIncomingMessage);

  // Request browser notification permission on first visit
  useEffect(() => { requestNotificationPermission(); }, []);

  // Auto-fetch WhatsApp avatar when opening a conversation
  useEffect(() => {
    if (!selectedLead?.phone) return;
    if (selectedLead.avatarUrl) return; // already has photo

    const cleanPhone = selectedLead.phone.replace(/\D/g, "");
    whatsappApi.fetchProfilePicture("default", cleanPhone, selectedLead.id).then(({ data }) => {
      const url = data?.profilePictureUrl;
      if (!url) return;

      const updateAvatar = (l: Lead): Lead =>
        l.id === selectedLead.id ? { ...l, avatarUrl: url } : l;

      setQueue((prev) => prev.map(updateAvatar));
      setMyLeads((prev) => prev.map(updateAvatar));
      setSelectedLead((prev) => prev && prev.id === selectedLead.id ? { ...prev, avatarUrl: url } : prev);
    });
  }, [selectedLead?.id]);
  // Sync global unread count for sidebar badge
  useEffect(() => {
    const total = [...queue, ...myLeads].reduce((sum, l) => sum + l.unreadCount, 0);
    setChatUnreadCount(total);
  }, [queue, myLeads]);


  useEffect(() => {
    if (!leadSearch) return;
    const allLeads = [...myLeads, ...queue];
    const match = allLeads.find(
      (l) => l.name.toLowerCase() === leadSearch.toLowerCase()
    );
    if (match) {
      if (match.status === "waiting") {
        // Auto-assign from queue
        setQueue((prev) => prev.filter((l) => l.id !== match.id));
        const assigned: Lead = { ...match, status: "active", assignedTo: "current", unreadCount: 0 };
        setMyLeads((prev) => [assigned, ...prev]);
        setSelectedLead(assigned);
        setActiveTab("mine");
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
    }
  }, [leadSearch]);

  const handleAssign = (lead: Lead) => {
    setQueue((prev) => prev.filter((l) => l.id !== lead.id));
    const assignedLead: Lead = { ...lead, status: "active", assignedTo: "current", unreadCount: 0 };
    setMyLeads((prev) => [assignedLead, ...prev]);
    setSelectedLead(assignedLead);
    setActiveTab("mine");

    // Track session assignment
    sessionsApi.assign({ leadId: lead.id }).then(({ data }) => {
      if (data?.waitTime) {
        console.log(`⏱️ Wait time for ${lead.name}: ${data.waitTime}s`);
      }
    });

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
              content: "── Atendimento retomado ──",
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

    // Track first response time
    if (selectedLead.status === "active" && !firstResponseTracked.has(selectedLead.id)) {
      sessionsApi.firstResponse({ leadId: selectedLead.id });
      setFirstResponseTracked((prev) => new Set(prev).add(selectedLead.id));
    }

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      leadId: selectedLead.id,
      content,
      sender: "attendant",
      type,
      timestamp: new Date(),
      replyTo: replyingTo || undefined,
      ...extra,
    };
    setMessages((prev) => ({
      ...prev,
      [selectedLead.id]: [...(prev[selectedLead.id] || []), newMsg],
    }));
    setReplyingTo(null);

    // Send via WhatsApp (Evolution API) — use cached connected instances
    if (type === "text" && selectedLead.phone) {
      try {
        const connected = connectedInstances[0];
        if (connected) {
          await sendTextMessage(connected.instanceName, selectedLead.phone, content);
        } else {
          toast.error("Nenhuma instância WhatsApp conectada");
        }
      } catch (err: any) {
        toast.error("Erro ao enviar pelo WhatsApp: " + (err?.message || ""));
      }
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

  const handleFinishAttendance = (lead: Lead, farewellMessage?: string) => {
    // Send farewell message via WhatsApp if provided
    if (farewellMessage) {
      handleSendMessage(farewellMessage, "text");
    }

    sessionsApi.close({
      leadId: lead.id,
      leadPhone: lead.phone,
      instance: "default",
    }).then(({ data, error }) => {
      if (error) {
        toast.error("Erro ao finalizar atendimento");
        return;
      }
      const durationMin = data?.duration ? Math.floor(data.duration / 60) : 0;
      toast.success(`Atendimento finalizado`, {
        description: `${lead.name} — Duração: ${durationMin}min`,
      });
    });

    // Add system message BEFORE removing lead
    setMessages((prev) => {
      const updated = {
        ...prev,
        [lead.id]: [
          ...(prev[lead.id] || []),
          {
            id: `sys-close-${Date.now()}`,
            leadId: lead.id,
            content: "✅ Atendimento finalizado.",
            sender: "attendant" as const,
            type: "text" as const,
            timestamp: new Date(),
          },
        ],
      };
      conversationArchiveRef.current[lead.id] = updated[lead.id];
      return updated;
    });

    // Keep lead in myLeads with "finished" status (like WhatsApp Web — history stays)
    setMyLeads((prev) =>
      prev.map((l) => l.id === lead.id ? { ...l, status: "finished" as const } : l)
    );

    // Open satisfaction survey dialog
    setSurveyLead(lead);
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
      sendTextMessage(instanceName, lead.phone, surveyMsg).catch(() => {
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
            content: `📊 Pesquisa de satisfação enviada (${stars} ${labels[rating - 1]})`,
            sender: "attendant" as const,
            type: "text" as const,
            timestamp: new Date(),
          },
        ],
      };
      conversationArchiveRef.current[lead.id] = updated[lead.id];
      return updated;
    });

    toast.success("Pesquisa de satisfação enviada!", {
      description: `${lead.name} — ${stars}`,
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
          content: "🔄 Paciente retornado à fila de espera.",
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
    setMessages((prev) => {
      const msgs = prev[selectedLead.id] || [];
      return {
        ...prev,
        [selectedLead.id]: msgs.map((m) =>
          m.id === messageId
            ? { ...m, reactions: [...(m.reactions || []), { emoji, count: 1 }] }
            : m
        ),
      };
    });
  };

  const handleReply = (msg: ChatMessage) => {
    setReplyingTo({
      messageId: msg.id,
      content: msg.content || (msg.type === "image" ? "📷 Imagem" : msg.type === "location" ? "📍 Localização" : msg.type),
      sender: msg.sender === "lead" ? selectedLead?.name || "Lead" : "Você",
    });
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
  const currentList = filterTag ? filteredByQueue.filter((l) => (leadTagAssignments[l.id] || []).includes(filterTag)) : filteredByQueue;

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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <DashboardHeader title="Chat" />

      {/* WhatsApp Connection Status Bar */}
      {connectedInstances.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs font-medium animate-fade-in">
          <Wifi className="h-3.5 w-3.5" />
          Nenhuma instância WhatsApp conectada — mensagens não serão enviadas.
        </div>
      )}
      {connectedInstances.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-success/5 border-b border-success/10 text-success text-[11px] font-medium">
          <Wifi className="h-3 w-3" />
          {connectedInstances.length === 1
            ? `Conectado: ${connectedInstances[0].instanceName}`
            : `${connectedInstances.length} instâncias conectadas`}
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Lead List */}
        <div className="w-[360px] flex flex-col border-r border-border bg-card shrink-0">
          {/* New Chat + Tabs */}
          <div className="flex items-center border-b border-border shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 ml-1"
              title="Novo chat com contato"
              onClick={() => setNewChatOpen(true)}
            >
              <UserPlus className="h-4 w-4 text-primary" />
            </Button>
            <button
              onClick={() => setActiveTab("queue")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "queue"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Inbox className="h-4 w-4" />
              Fila de Espera
              {queue.length > 0 && (
                <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {queue.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("mine")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "mine"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              Meus Atendimentos
              {myLeads.length > 0 && (
                <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {myLeads.length}
                </span>
              )}
            </button>
          </div>

          {/* Status Filter (mine tab only) */}
          {activeTab === "mine" && myLeads.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
              {(["all", "active", "finished"] as const).map((s) => {
                const labels = { all: "Todos", active: "Ativos", finished: "Finalizados" };
                const count = s === "all" ? myLeads.length : myLeads.filter((l) => l.status === s).length;
                return (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      filterStatus === s
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {labels[s]} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Queue Filter */}
          {availableQueues.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0 overflow-x-auto">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <button
                onClick={() => setFilterQueue(null)}
                className={`px-2 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 ${
                  !filterQueue ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Todas
              </button>
              {availableQueues.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setFilterQueue(filterQueue === q.id ? null : q.id)}
                  className={`px-2 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 ${
                    filterQueue === q.id ? "text-white" : "text-muted-foreground hover:opacity-80"
                  }`}
                  style={filterQueue === q.id ? { backgroundColor: q.color } : { backgroundColor: q.color + "20", color: q.color }}
                >
                  {q.icon} {q.name}
                </button>
              ))}
            </div>
          )}

          {/* Tag Filter */}
          {availableTags.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border shrink-0 overflow-x-auto">
              <Tags className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {availableTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setFilterTag(filterTag === tag.id ? null : tag.id)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors shrink-0 ${
                    filterTag === tag.id ? "text-white" : "text-muted-foreground hover:opacity-80"
                  }`}
                  style={filterTag === tag.id ? { backgroundColor: tag.color } : { backgroundColor: tag.color + "20", color: tag.color }}
                >
                  {tag.icon} {tag.name}
                </button>
              ))}
            </div>
          )}
          {/* Lead List */}
          <div className="flex-1 overflow-y-auto">
            {currentList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <Users className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {activeTab === "queue"
                    ? "Nenhum lead na fila de espera"
                    : "Nenhum atendimento ativo"}
                </p>
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
                  tagIds={leadTagAssignments[lead.id] || []}
                  allTags={availableTags}
                />
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Conversation */}
        <div className="flex-1 flex flex-col bg-background">
          {selectedLead ? (
            <>
              <ChatHeader lead={selectedLead} onClose={() => setSelectedLead(null)} onTransfer={handleTransfer} onFinishAttendance={handleFinishAttendance} onReturnToQueue={handleReturnToQueue} leadTagIds={leadTagAssignments[selectedLead.id] || []} onToggleTag={handleToggleTag} messages={currentMessages} />
              <ConversationView
                messages={currentMessages}
                leadName={selectedLead.name}
                isTyping={isLeadTyping}
                onReaction={handleReaction}
                onReply={handleReply}
              />
              {selectedLead.status === "finished" ? (
                <div className="px-4 py-3 border-t border-border/50 bg-muted/30 flex items-center justify-center gap-3">
                  <p className="text-sm text-muted-foreground">Atendimento finalizado</p>
                  <button
                    onClick={() => {
                      setMyLeads((prev) =>
                        prev.map((l) => l.id === selectedLead.id ? { ...l, status: "active" as const } : l)
                      );
                      setSelectedLead({ ...selectedLead, status: "active" });
                      toast.success("Atendimento reaberto");
                    }}
                    className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    Reabrir atendimento
                  </button>
                </div>
              ) : (
                <MessageInput
                  onSendMessage={handleSendMessage}
                  disabled={selectedLead.status === "waiting"}
                  replyingTo={replyingTo}
                  onCancelReply={() => setReplyingTo(null)}
                  attendantName={currentUser?.name}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center chat-bg-pattern">
              <div className="text-center space-y-4 animate-fade-in">
                <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mx-auto shadow-sm border border-primary/10">
                  <MessageSquare className="h-10 w-10 text-primary/30" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-foreground/60 text-sm font-medium">
                    Selecione um atendimento
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Escolha uma conversa ao lado ou inicie um novo chat
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
    </div>
  );
}
