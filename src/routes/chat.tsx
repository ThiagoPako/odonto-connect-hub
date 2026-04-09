import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { LeadListItem } from "@/components/chat/LeadListItem";
import { ConversationView } from "@/components/chat/ConversationView";
import { MessageInput } from "@/components/chat/MessageInput";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Users, MessageSquare, Inbox } from "lucide-react";
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
  const { lead: leadSearch } = Route.useSearch();
  const [activeTab, setActiveTab] = useState<"queue" | "mine">("queue");
  const [queue, setQueue] = useState<Lead[]>(mockLeadsQueue);
  const [myLeads, setMyLeads] = useState<Lead[]>(mockLeadsActive);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(mockMessages);

  // Auto-select lead from search param
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

  const [replyingTo, setReplyingTo] = useState<ReplyData | null>(null);

  const handleSendMessage = (content: string, type: MessageType, extra?: Partial<ChatMessage>) => {
    if (!selectedLead) return;
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

  const currentMessages = selectedLead ? messages[selectedLead.id] || [] : [];
  const currentList = activeTab === "queue" ? queue : myLeads;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Chat" />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Lead List */}
        <div className="w-[360px] flex flex-col border-r border-border bg-card shrink-0">
          {/* Tabs */}
          <div className="flex border-b border-border shrink-0">
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
                />
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Conversation */}
        <div className="flex-1 flex flex-col bg-background">
          {selectedLead ? (
            <>
              <ChatHeader lead={selectedLead} onClose={() => setSelectedLead(null)} />
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
