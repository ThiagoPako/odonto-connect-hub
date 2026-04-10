import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { LeadListItem } from "@/components/chat/LeadListItem";
import { ConversationView } from "@/components/chat/ConversationView";
import { MessageInput } from "@/components/chat/MessageInput";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Users, MessageSquare, Inbox, Filter, Tags, UserPlus, Wifi, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewChatFromContactDialog } from "@/components/chat/NewChatFromContactDialog";
import { SatisfactionSurveyDialog } from "@/components/chat/SatisfactionSurveyDialog";
import type { Contato } from "@/lib/vpsApi";
import type { AttendanceQueue } from "@/data/queueData";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeChat, type IncomingMessage } from "@/hooks/useRealtimeChat";
import { whatsappApi, transferApi, sessionsApi, tagsApi, queuesApi, messagesApi, queueLeadsApi, type LeadTagApi, type ChatMessageApi } from "@/lib/vpsApi";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { playNotificationSound } from "@/lib/notificationSound";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/browserNotification";
import { setChatUnreadCount } from "@/lib/chatUnreadStore";
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
  const [syncingPhotos, setSyncingPhotos] = useState(false);
  const [availableQueues, setAvailableQueues] = useState<AttendanceQueue[]>([]);
  const [availableTags, setAvailableTags] = useState<LeadTagApi[]>([]);
  const [leadTagAssignments, setLeadTagAssignments] = useState<Record<string, string[]>>({});
  const [surveyLead, setSurveyLead] = useState<Lead | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState<Record<string, boolean>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, { status: "online" | "offline" | "typing" | "recording"; lastSeen: Date | null }>>({});

  // Refs for stable closure access in SSE callback
  const queueRef = useRef(queue);
  const myLeadsRef = useRef(myLeads);
  const selectedLeadRef = useRef(selectedLead);
  const lastSentPresenceRef = useRef<{ leadId: string | null; status: "composing" | "recording" | "paused"; timestamp: number }>({
    leadId: null,
    status: "paused",
    timestamp: 0,
  });
  queueRef.current = queue;
  myLeadsRef.current = myLeads;
  selectedLeadRef.current = selectedLead;

  // Load queues, tags, assignments and unread counts from VPS
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

    // Load leads from queue/active from backend
    queueLeadsApi.list().then(({ data }) => {
      if (!data) return;
      const toLead = (r: any): Lead => ({
        id: r.id,
        name: r.name || r.phone,
        initials: (r.name || r.phone || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase(),
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
      });
      if (data.queue?.length) setQueue(data.queue.map(toLead));
      if (data.active?.length) setMyLeads(data.active.map(toLead));
    });

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
      fileUrl: msg.mediaUrl || undefined,
      fileName: msg.fileName || undefined,
      mimeType: msg.mimeType || undefined,
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
                lastMessage: msg.content && !["🖼️ Imagem","🎬 Vídeo","📎"].some(p => msg.content.startsWith(p)) ? msg.content : ({ image: "📷 Foto", video: "🎬 Vídeo", audio: "🎤 Áudio", document: "📄 Documento", sticker: "🏷️ Sticker" } as Record<string, string>)[msg.type] || msg.content || "",
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
          lastMessage: msg.content && !["🖼️ Imagem","🎬 Vídeo","📎"].some(p => msg.content.startsWith(p)) ? msg.content : ({ image: "📷 Foto", video: "🎬 Vídeo", audio: "🎤 Áudio", document: "📄 Documento", sticker: "🏷️ Sticker" } as Record<string, string>)[msg.type] || msg.content || "",
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

    // Add message immediately — no artificial delay
    addMessage();

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
      }, 10000);
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
    setMessages((prev) => {
      let changed = false;
      const next: Record<string, ChatMessage[]> = {};
      for (const leadId of Object.keys(prev)) {
        const msgs = prev[leadId];
        const updated = msgs.map((m) => {
          if (m.id !== update.messageId) return m;
          if (update.status === "failed") {
            changed = true;
            return { ...m, status: update.status as MessageStatus };
          }
          const currentPri = statusPriority[m.status || "sent"] ?? 1;
          const newPri = statusPriority[update.status] ?? 1;
          if (newPri > currentPri) {
            changed = true;
            return { ...m, status: update.status as MessageStatus };
          }
          return m;
        });
        next[leadId] = updated;
      }
      return changed ? next : prev;
    });
  }, []);

  const handleAttendantPresenceChange = useCallback((status: "composing" | "recording" | "paused") => {
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

    whatsappApi.sendPresence(instanceName, activeLead.phone, status).catch((err: any) => {
      console.error("Failed to send presence:", err);
    });
  }, [connectedInstances]);

  useRealtimeChat({ onMessage: handleIncomingMessage, onPresence: handlePresenceUpdate, onQueueAssigned: handleQueueAssigned, onMessageStatus: handleMessageStatusUpdate });

  useEffect(() => {
    const currentLead = selectedLead;
    const instanceName = connectedInstances[0]?.instanceName;
    return () => {
      if (!currentLead?.phone || !instanceName) return;
      whatsappApi.sendPresence(instanceName, currentLead.phone, "paused").catch(() => {});
    };
  }, [selectedLead?.id, connectedInstances[0]?.instanceName]);

  // Request browser notification permission on first visit
  useEffect(() => { requestNotificationPermission(); }, []);

  // Auto-fetch WhatsApp avatar when opening a conversation
  useEffect(() => {
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
  }, [selectedLead?.id]);

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
    whatsappApi.subscribePresence(instanceName, phone).then(({ data }) => {
      if (data?.presence) {
        applyPresence(leadId, data.presence);
      }
      // Retry after 2s — Evolution API often needs time to report real status after subscribe
      setTimeout(() => {
        whatsappApi.subscribePresence(instanceName, phone).then(({ data: data2 }) => {
          if (data2?.presence) {
            applyPresence(leadId, data2.presence);
          }
        }).catch(() => {});
      }, 2000);
    }).catch(() => {});
  }, [applyPresence]);

  // Subscribe presence for all active leads (myLeads)
  useEffect(() => {
    const instanceName = connectedInstances[0]?.instanceName;
    if (!instanceName || myLeads.length === 0) return;

    // Stagger subscriptions to avoid hammering the API
    myLeads.forEach((lead, i) => {
      if (!lead.phone) return;
      setTimeout(() => {
        fetchPresence(lead.id, lead.phone, instanceName);
      }, i * 500);
    });
  }, [myLeads.map(l => l.id).join(","), connectedInstances[0]?.instanceName, fetchPresence]);

  // Also subscribe for selected lead immediately (covers queue leads)
  useEffect(() => {
    if (!selectedLead?.phone) return;
    const instanceName = connectedInstances[0]?.instanceName;
    if (!instanceName) return;
    fetchPresence(selectedLead.id, selectedLead.phone, instanceName);
  }, [selectedLead?.id, selectedLead?.phone, connectedInstances[0]?.instanceName, fetchPresence]);

  // Refresh presence for selected lead every 30s
  useEffect(() => {
    if (!selectedLead?.phone) return;
    const instanceName = connectedInstances[0]?.instanceName;
    if (!instanceName) return;
    const interval = setInterval(() => {
      fetchPresence(selectedLead.id, selectedLead.phone, instanceName);
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedLead?.id, selectedLead?.phone, connectedInstances[0]?.instanceName, fetchPresence]);

  // ─── Load initial message history from VPS when selecting a lead ───
  const historyLoadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedLead) return;
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
        fileUrl: m.media_url || undefined,
        mimeType: m.mime_type || undefined,
      }));

      setMessages((prev) => {
        const existing = prev[selectedLead.id] || [];
        // Merge: prepend history, skip duplicates
        const existingIds = new Set(existing.map((m) => m.id));
        const newMsgs = apiMessages.filter((m) => !existingIds.has(m.id));
        return { ...prev, [selectedLead.id]: [...newMsgs, ...existing] };
      });

      setHistoryHasMore((prev) => ({ ...prev, [selectedLead.id]: data.hasMore }));
    });

    // Mark messages as read on server and reset local unread count
    messagesApi.markRead(selectedLead.id).catch(() => {});
    const resetUnread = (l: Lead): Lead =>
      l.id === selectedLead.id ? { ...l, unreadCount: 0 } : l;
    setQueue((prev) => prev.map(resetUnread));
    setMyLeads((prev) => prev.map(resetUnread));

    // Send read receipt to WhatsApp (blue ticks for patient)
    const instanceName = connectedInstances[0]?.instanceName;
    if (instanceName && selectedLead.phone) {
      // Collect last N unread message IDs from lead
      const leadMsgs = messages[selectedLead.id] || [];
      const unreadIds = leadMsgs
        .filter((m) => m.sender === "lead" && m.status !== "read")
        .slice(-20)
        .map((m) => m.id)
        .filter((id) => !id.startsWith("sys-") && !id.startsWith("msg-"));
      if (unreadIds.length > 0) {
        whatsappApi.markWhatsAppRead(instanceName, selectedLead.phone, unreadIds).catch(() => {});
      }
    }
  }, [selectedLead?.id]);

  // ─── Infinite scroll: load older messages ───
  const handleLoadMore = useCallback(async () => {
    if (!selectedLead) return;
    const currentMsgs = messages[selectedLead.id] || [];
    if (currentMsgs.length === 0) return;

    setHistoryLoading(true);
    const oldestMsg = currentMsgs[0];
    const oldestTimestamp = new Date(oldestMsg.timestamp).toISOString();

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
          fileUrl: m.media_url || undefined,
          mimeType: m.mime_type || undefined,
        }));

        setMessages((prev) => {
          const existing = prev[selectedLead.id] || [];
          const existingIds = new Set(existing.map((m) => m.id));
          const newMsgs = apiMessages.filter((m) => !existingIds.has(m.id));
          return { ...prev, [selectedLead.id]: [...newMsgs, ...existing] };
        });

        setHistoryHasMore((prev) => ({ ...prev, [selectedLead.id]: data.hasMore }));
      } else {
        setHistoryHasMore((prev) => ({ ...prev, [selectedLead.id]: false }));
      }
    } catch {
      // Silently fail — user can retry by scrolling up again
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedLead?.id, messages]);

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
      replyTo: replyingTo || undefined,
      ...extra,
    };

    setMessages((prev) => ({
      ...prev,
      [selectedLead.id]: [...(prev[selectedLead.id] || []), newMsg],
    }));
    setReplyingTo(null);

    const connected = connectedInstances[0];
    if (!connected) {
      setMessages((prev) => ({
        ...prev,
        [selectedLead.id]: (prev[selectedLead.id] || []).map((m) =>
          m.id === msgId ? { ...m, status: "sent" as const } : m
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
      const replyMessageId = replyingTo?.messageId;
      let evolutionMsgId: string | null = null;

      if (type === "text") {
        let result;
        if (replyMessageId) {
          const cleanNumber = selectedLead.phone.replace(/\D/g, "");
          result = await whatsappApi.sendText(connected.instanceName, selectedLead.phone, content, {
            key: { remoteJid: `${cleanNumber}@s.whatsapp.net`, id: replyMessageId },
          });
        } else {
          result = await whatsappApi.sendText(connected.instanceName, selectedLead.phone, content);
        }
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "image" || type === "video" || type === "document" || type === "audio") {
        const mediaFile = (extra as any)?._mediaFile as File | undefined;
        const mediaBase64 = (extra as any)?._mediaBase64 as string | undefined;

        if (type === "audio" && mediaBase64) {
          const result = await whatsappApi.sendMedia(connected.instanceName, selectedLead.phone, type, {
            base64: mediaBase64,
            fileName: extra?.fileName,
            caption: undefined,
            mimeType: extra?.mimeType,
          });
          if (result.error) throw new Error(result.error);
          evolutionMsgId = (result.data as any)?.key?.id || null;
        } else if (mediaFile) {
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
          if (!jobId) throw new Error("Upload de mídia não retornou jobId");

          const startedAt = Date.now();
          while (Date.now() - startedAt < 120000) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const statusResult = await whatsappApi.getMediaSendStatus(jobId);
            if (statusResult.error) throw new Error(statusResult.error);

            const job = statusResult.data as any;
            if (job?.status === "sent") {
              evolutionMsgId = job?.result?.key?.id || null;
              break;
            }
            if (job?.status === "failed") {
              throw new Error(job?.error || "Falha ao enviar mídia");
            }
          }

          if (!evolutionMsgId) {
            throw new Error("Tempo limite ao aguardar confirmação do envio da mídia");
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
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "contact" && extra?.contact) {
        const result = await whatsappApi.sendContact(connected.instanceName, selectedLead.phone, {
          fullName: extra.contact.fullName,
          phone: extra.contact.phone,
          email: extra.contact.email,
          company: extra.contact.company,
          url: extra.contact.url,
        });
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "poll" && extra?.poll) {
        const opts = extra.poll.options.map((o: any) => (typeof o === "string" ? o : o.text));
        const result = await whatsappApi.sendPoll(connected.instanceName, selectedLead.phone, extra.poll.question, opts);
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "sticker") {
        const stickerData = (extra as any)?.stickerUrl || content;
        const result = await whatsappApi.sendSticker(connected.instanceName, selectedLead.phone, stickerData);
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "list" && extra?.list) {
        const result = await whatsappApi.sendList(connected.instanceName, selectedLead.phone, {
          title: extra.list.title,
          buttonText: extra.list.buttonText || "Ver opções",
          sections: extra.list.sections,
        });
        evolutionMsgId = (result?.data as any)?.key?.id || null;
      } else if (type === "reaction") {
        const reactionData = extra as any;
        if (reactionData?.targetMessageId && reactionData?.emoji) {
          await whatsappApi.sendReaction(
            connected.instanceName,
            selectedLead.phone,
            reactionData.targetMessageId,
            reactionData.emoji
          );
        }
      }

      updateStatus("sent");

      if (evolutionMsgId) {
        setMessages((prev) => ({
          ...prev,
          [selectedLead.id]: (prev[selectedLead.id] || []).map((m) => {
            if (m.id !== msgId && m.id !== evolutionMsgId) return m;
            const currentPri = statusPriority[m.status || "sending"] ?? 0;
            const newId = evolutionMsgId!;
            return currentPri >= (statusPriority["sent"] ?? 1)
              ? { ...m, id: newId }
              : { ...m, id: newId, status: "sent" as MessageStatus };
          }),
        }));
      }

      messagesApi.save({
        id: evolutionMsgId || msgId,
        leadId: selectedLead.id,
        content,
        type,
        status: "sent",
        fileName: extra?.fileName,
        mimeType: extra?.mimeType,
        replyTo: replyingTo,
        instance: connected.instanceName,
        phone: selectedLead.phone,
      }).catch((err) => console.error("Failed to persist message:", err));
    } catch (err: any) {
      toast.error("Erro ao enviar: " + (err?.message || "Falha no envio"));
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

  const handleFinishAttendance = (lead: Lead, farewellMessage?: string) => {
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
    // Update local UI
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
    // Send reaction via Evolution API
    const connected = connectedInstances[0];
    if (connected && selectedLead.phone) {
      whatsappApi.sendReaction(connected.instanceName, selectedLead.phone, messageId, emoji)
        .catch((err: any) => console.error("Failed to send reaction:", err));
    }
  };

  const handleReply = (msg: ChatMessage) => {
    setReplyingTo({
      messageId: msg.id,
      content: msg.content || (msg.type === "image" ? "📷 Imagem" : msg.type === "location" ? "📍 Localização" : msg.type),
      sender: msg.sender === "lead" ? selectedLead?.name || "Lead" : "Você",
    });
  };

  const handleFileDrop = useCallback((files: File[]) => {
    if (!selectedLead) return;
    const MAX_SIZE = 16 * 1024 * 1024;
    for (const file of files) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name} é muito grande`, { description: "Máximo: 16MB" });
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
    const text = msg.content || `[${msg.type}]`;
    navigator.clipboard.writeText(text).then(() => {
      toast.success("Mensagem copiada para encaminhar");
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
  const currentList = filterTag ? filteredByQueue.filter((l) => (leadTagAssignments[l.id] || []).includes(filterTag)) : filteredByQueue;

  const handleSyncPhotos = useCallback(async () => {
    const instanceName = connectedInstances[0]?.instanceName;
    if (!instanceName) {
      toast.error("Nenhuma instância WhatsApp conectada");
      return;
    }
    setSyncingPhotos(true);
    toast.info("Sincronizando fotos de perfil...");
    try {
      const { data, error } = await whatsappApi.syncProfilePictures(instanceName);
      if (error) {
        toast.error("Erro ao sincronizar: " + error);
      } else {
        toast.success(`Fotos sincronizadas: ${data?.updated || 0} atualizadas de ${data?.total || 0}`);
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
      toast.error("Falha na sincronização: " + (err.message || "erro desconhecido"));
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
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              title="Sincronizar fotos de perfil"
              onClick={handleSyncPhotos}
              disabled={syncingPhotos}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${syncingPhotos ? "animate-spin" : ""}`} />
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
                  presence={presenceMap[lead.id]?.status}
                />
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Conversation */}
        <div className="flex-1 flex flex-col bg-background">
          {selectedLead ? (
            <>
              <ChatHeader lead={selectedLead} onClose={() => setSelectedLead(null)} onTransfer={handleTransfer} onFinishAttendance={handleFinishAttendance} onReturnToQueue={handleReturnToQueue} leadTagIds={leadTagAssignments[selectedLead.id] || []} onToggleTag={handleToggleTag} messages={currentMessages} presence={presenceMap[selectedLead.id]?.status ?? "offline"} lastSeen={presenceMap[selectedLead.id]?.lastSeen ?? null} />
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
                  onPresenceChange={handleAttendantPresenceChange}
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
