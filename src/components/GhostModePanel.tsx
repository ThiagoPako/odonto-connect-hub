import { useState, useEffect, useRef } from "react";
import { Eye, EyeOff, X, Clock, CheckCheck, AlertTriangle } from "lucide-react";
import { mockMessages, mockLeadsActive, type ChatMessage, type Lead } from "@/data/chatMockData";

interface GhostConversation {
  lead: Lead;
  attendantName: string;
  attendantInitials: string;
  messages: ChatMessage[];
  startedAt: Date;
}

const ghostConversations: GhostConversation[] = [
  {
    lead: mockLeadsActive[0],
    attendantName: "Ana Ribeiro",
    attendantInitials: "AR",
    messages: mockMessages["l5"] || [],
    startedAt: new Date(Date.now() - 30 * 60 * 1000),
  },
  {
    lead: mockLeadsActive[1],
    attendantName: "Carla Mendes",
    attendantInitials: "CM",
    messages: mockMessages["l6"] || [],
    startedAt: new Date(Date.now() - 10 * 60 * 1000),
  },
];

export function GhostModePanel() {
  const [isActive, setIsActive] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<GhostConversation | null>(null);

  if (!isActive) {
    return (
      <button
        onClick={() => setIsActive(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-card border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 hover:shadow-md transition-all group"
      >
        <Eye className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        <span>Modo Ghost</span>
      </button>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-primary/20 shadow-lg overflow-hidden">
      {/* Ghost Mode Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary/5 to-dental-cyan/5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <EyeOff className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Modo Ghost</span>
          <span className="text-[10px] uppercase tracking-wider font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            Invisível
          </span>
        </div>
        <button
          onClick={() => {
            setIsActive(false);
            setSelectedConversation(null);
          }}
          className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex" style={{ height: 420 }}>
        {/* Conversation List */}
        <div className="w-[280px] border-r border-border overflow-y-auto">
          <div className="px-3 py-2">
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
              Conversas Ativas ({ghostConversations.length})
            </p>
          </div>
          {ghostConversations.map((conv) => (
            <GhostConversationItem
              key={conv.lead.id}
              conversation={conv}
              isSelected={selectedConversation?.lead.id === conv.lead.id}
              onSelect={() => setSelectedConversation(conv)}
            />
          ))}
        </div>

        {/* Conversation Preview */}
        <div className="flex-1 flex flex-col">
          {selectedConversation ? (
            <GhostConversationPreview conversation={selectedConversation} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <EyeOff className="h-10 w-10 text-muted-foreground/20 mx-auto" />
                <p className="text-xs text-muted-foreground">
                  Selecione uma conversa para espiar
                </p>
                <p className="text-[10px] text-muted-foreground/60">
                  Ninguém saberá que você está aqui
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GhostConversationItem({
  conversation,
  isSelected,
  onSelect,
}: {
  conversation: GhostConversation;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const lastMsg = conversation.messages[conversation.messages.length - 1];
  const isFromLead = lastMsg?.sender === "lead";

  useEffect(() => {
    const interval = setInterval(() => {
      if (lastMsg) {
        setElapsed(Math.floor((Date.now() - lastMsg.timestamp.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lastMsg]);

  const minutes = Math.floor(elapsed / 60);
  const isIdle = minutes >= 5;

  return (
    <div
      onClick={onSelect}
      className={`px-3 py-3 cursor-pointer transition-colors border-b border-border/50 ${
        isSelected ? "bg-primary/5" : "hover:bg-muted/50"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className={`h-7 w-7 rounded-full ${conversation.lead.avatarColor || "bg-primary/20"} flex items-center justify-center text-[10px] font-bold text-primary-foreground`}>
            {conversation.lead.initials}
          </div>
          <span className="text-xs font-medium text-foreground">{conversation.lead.name}</span>
        </div>
        {isIdle && (
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        )}
      </div>

      <div className="flex items-center gap-1.5 ml-9">
        <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center text-[8px] font-bold text-primary">
          {conversation.attendantInitials}
        </div>
        <span className="text-[11px] text-muted-foreground">{conversation.attendantName}</span>
      </div>

      <div className="mt-1.5 ml-9 flex items-center gap-1">
        {isFromLead ? (
          <span className="text-[10px] text-dental-cyan font-medium">Paciente:</span>
        ) : (
          <span className="text-[10px] text-primary font-medium">Atendente:</span>
        )}
        <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
          {lastMsg?.content}
        </span>
      </div>

      <div className="mt-1 ml-9 flex items-center gap-1">
        <Clock className={`h-3 w-3 ${isIdle ? "text-destructive" : "text-muted-foreground/50"}`} />
        <span className={`text-[10px] font-mono ${isIdle ? "text-destructive font-medium" : "text-muted-foreground/50"}`}>
          {minutes > 0 ? `${minutes}min sem resposta` : "Respondido agora"}
        </span>
      </div>
    </div>
  );
}

function GhostConversationPreview({ conversation }: { conversation: GhostConversation }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages]);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <div className={`h-8 w-8 rounded-full ${conversation.lead.avatarColor || "bg-primary/20"} flex items-center justify-center text-xs font-bold text-primary-foreground`}>
            {conversation.lead.initials}
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">{conversation.lead.name}</p>
            <p className="text-[10px] text-muted-foreground">
              Atendido por <span className="text-primary font-medium">{conversation.attendantName}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <EyeOff className="h-3.5 w-3.5 text-primary/50" />
          <span className="text-[10px] text-primary/50 font-medium">Apenas leitura</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-background/30">
        {conversation.messages.map((msg) => {
          const isLead = msg.sender === "lead";
          return (
            <div key={msg.id} className={`flex ${isLead ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[75%] rounded-xl px-3 py-2 ${
                  isLead
                    ? "bg-card border border-border rounded-bl-sm"
                    : "bg-primary/10 border border-primary/20 rounded-br-sm"
                }`}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${isLead ? "text-dental-cyan" : "text-primary"}`}>
                    {isLead ? "Paciente" : conversation.attendantName}
                  </span>
                </div>
                <p className="text-xs text-foreground leading-relaxed">{msg.content}</p>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <span className="text-[9px] text-muted-foreground">{formatTime(msg.timestamp)}</span>
                  {!isLead && <CheckCheck className="h-2.5 w-2.5 text-primary/40" />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Ghost footer */}
      <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-center gap-2">
        <EyeOff className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="text-[11px] text-muted-foreground/60">
          Você está observando esta conversa em modo invisível
        </span>
      </div>
    </>
  );
}
