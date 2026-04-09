import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { LeadListItem } from "@/components/chat/LeadListItem";
import { ConversationView } from "@/components/chat/ConversationView";
import { MessageInput } from "@/components/chat/MessageInput";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Users, MessageSquare, Inbox, Filter, Tags, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewChatFromContactDialog } from "@/components/chat/NewChatFromContactDialog";
import type { Contato } from "@/lib/vpsApi";
import type { AttendanceQueue } from "@/data/queueData";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeChat, type IncomingMessage } from "@/hooks/useRealtimeChat";
import { whatsappApi, transferApi, sessionsApi, tagsApi, queuesApi, type LeadTagApi } from "@/lib/vpsApi";
import { playNotificationSound } from "@/lib/notificationSound";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/browserNotification";
import { setChatUnreadCount } from "@/lib/chatUnreadStore";
import {
  mockLeadsQueue,
  mockLeadsActive,
  mockMessages,
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
  const [activeTab, setActiveTab] = useState<"queue" | "mine">("queue");
  const [queue, setQueue] = useState<Lead[]>(mockLeadsQueue);
  const [myLeads, setMyLeads] = useState<Lead[]>(mockLeadsActive);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(mockMessages);
  const [filterQueue, setFilterQueue] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [availableQueues, setAvailableQueues] = useState<AttendanceQueue[]>([]);
  const [availableTags, setAvailableTags] = useState<LeadTagApi[]>([]);
  const [leadTagAssignments, setLeadTagAssignments] = useState<Record<string, string[]>>({});

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

  // ─── Real-time incoming messages via SSE ───
  const handleIncomingMessage = useCallback((msg: IncomingMessage) => {
    const chatMsg: ChatMessage = {
      id: msg.id,
      leadId: msg.leadId || msg.phone,
      content: msg.content,
      sender: "lead",
      type: (msg.type as MessageType) || "text",
      timestamp: new Date(msg.timestamp),
    };

    // Check if lead exists in queue or myLeads
    const allLeads = [...queue, ...myLeads];
    const existingLead = allLeads.find(
      (l) => l.id === msg.leadId || l.phone.replace(/\D/g, "").endsWith(msg.phone.slice(-11))
    );

    if (existingLead) {
      // Add message to existing conversation
      setMessages((prev) => ({
        ...prev,
        [existingLead.id]: [...(prev[existingLead.id] || []), chatMsg],
      }));

      // Update unread count & last message (unless currently viewing)
      const updateLead = (lead: Lead): Lead =>
        lead.id === existingLead.id
          ? {
              ...lead,
              lastMessage: msg.content || `[${msg.type}]`,
              lastMessageTime: new Date(msg.timestamp),
              unreadCount: selectedLead?.id === existingLead.id ? lead.unreadCount : lead.unreadCount + 1,
            }
          : lead;

      setQueue((prev) => prev.map(updateLead));
      setMyLeads((prev) => prev.map(updateLead));
    } else {
      // New lead — add to queue with queue info if available
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
      // Start attendance session (waiting)
      sessionsApi.start({
        leadId: newLead.id,
        leadName: newLead.name,
        leadPhone: newLead.phone,
        queueId: incomingMsg.queueId,
        queueName: incomingMsg.queueName,
      });
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
  }, [queue, myLeads, selectedLead]);

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

    // Create initial system message
    if (!messages[lead.id]) {
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
  };

  // Track first response
  const [firstResponseTracked, setFirstResponseTracked] = useState<Set<string>>(new Set());

  const [replyingTo, setReplyingTo] = useState<ReplyData | null>(null);

  const handleSendMessage = (content: string, type: MessageType, extra?: Partial<ChatMessage>) => {
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
  };

  const handleFinishAttendance = (lead: Lead) => {
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
        description: `${lead.name} — Duração: ${durationMin}min. Pesquisa de satisfação enviada.`,
      });
    });

    // Move lead out of active
    setMyLeads((prev) => prev.filter((l) => l.id !== lead.id));
    if (selectedLead?.id === lead.id) setSelectedLead(null);

    // Add system message
    setMessages((prev) => ({
      ...prev,
      [lead.id]: [
        ...(prev[lead.id] || []),
        {
          id: `sys-close-${Date.now()}`,
          leadId: lead.id,
          content: "✅ Atendimento finalizado. Pesquisa de satisfação enviada ao paciente.",
          sender: "attendant" as const,
          type: "text" as const,
          timestamp: new Date(),
        },
      ],
    }));
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
  const filteredByQueue = filterQueue ? baseList.filter((l) => l.queueId === filterQueue) : baseList;
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
              <ChatHeader lead={selectedLead} onClose={() => setSelectedLead(null)} onTransfer={handleTransfer} onFinishAttendance={handleFinishAttendance} leadTagIds={leadTagAssignments[selectedLead.id] || []} onToggleTag={handleToggleTag} />
              <ConversationView
                messages={currentMessages}
                leadName={selectedLead.name}
                onReaction={handleReaction}
                onReply={handleReply}
              />
              <MessageInput
                onSendMessage={handleSendMessage}
                disabled={selectedLead.status === "waiting"}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                attendantName={currentUser?.name}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="h-20 w-20 rounded-2xl bg-primary/5 flex items-center justify-center mx-auto">
                  <MessageSquare className="h-10 w-10 text-primary/30" />
                </div>
                <p className="text-muted-foreground text-sm">
                  Selecione um atendimento para iniciar
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
