import type { ChatMessage } from "@/data/chatMockData";
import { useEffect, useRef, useState } from "react";
import { CheckCheck, MapPin, Phone, Mail, Globe, Building2, BarChart3, Reply, SmilePlus, ExternalLink, List } from "lucide-react";

interface ConversationViewProps {
  messages: ChatMessage[];
  leadName: string;
  onReaction?: (messageId: string, emoji: string) => void;
  onReply?: (msg: ChatMessage) => void;
}

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function ConversationView({ messages, leadName, onReaction, onReply }: ConversationViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const renderFormattedText = (text: string) => {
    // WhatsApp-style formatting
    let html = text
      .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/~([^~]+)~/g, '<del>$1</del>')
      .replace(/```([^`]+)```/g, '<code class="bg-background/20 px-1.5 py-0.5 rounded text-[13px] font-mono">$1</code>');
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const renderLinkPreview = (msg: ChatMessage) => {
    if (!msg.linkPreview) return null;
    const lp = msg.linkPreview;
    return (
      <div className="mt-2 rounded-lg border border-border/50 overflow-hidden bg-background/30">
        {lp.image && <div className="h-28 bg-muted flex items-center justify-center text-muted-foreground text-xs">🖼️ Preview</div>}
        <div className="p-2.5">
          <p className="text-xs font-semibold leading-tight">{lp.title}</p>
          {lp.description && <p className="text-[11px] opacity-70 mt-0.5 line-clamp-2">{lp.description}</p>}
          <div className="flex items-center gap-1 mt-1 text-[10px] opacity-50">
            <ExternalLink className="h-3 w-3" />
            <span className="truncate">{lp.url}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderLocation = (msg: ChatMessage) => {
    if (!msg.location) return null;
    const loc = msg.location;
    return (
      <div className="rounded-lg overflow-hidden">
        <div className="h-32 bg-muted flex items-center justify-center relative">
          <MapPin className="h-8 w-8 text-destructive" />
          <div className="absolute bottom-1 right-1 text-[9px] bg-background/80 px-1.5 py-0.5 rounded">
            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
          </div>
        </div>
        <div className="p-2.5">
          {loc.name && <p className="text-xs font-semibold">{loc.name}</p>}
          {loc.address && <p className="text-[11px] opacity-70 mt-0.5">{loc.address}</p>}
        </div>
      </div>
    );
  };

  const renderContact = (msg: ChatMessage) => {
    if (!msg.contact) return null;
    const ct = msg.contact;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
            {ct.fullName.split(" ").map(n => n[0]).join("").slice(0, 2)}
          </div>
          <div>
            <p className="text-sm font-semibold">{ct.fullName}</p>
            {ct.company && <p className="text-[11px] opacity-70 flex items-center gap-1"><Building2 className="h-3 w-3" />{ct.company}</p>}
          </div>
        </div>
        <div className="space-y-1 text-[11px]">
          <p className="flex items-center gap-1.5 opacity-80"><Phone className="h-3 w-3" />{ct.phone}</p>
          {ct.email && <p className="flex items-center gap-1.5 opacity-80"><Mail className="h-3 w-3" />{ct.email}</p>}
          {ct.url && <p className="flex items-center gap-1.5 opacity-80"><Globe className="h-3 w-3" />{ct.url}</p>}
        </div>
      </div>
    );
  };

  const renderPoll = (msg: ChatMessage) => {
    if (!msg.poll) return null;
    const poll = msg.poll;
    const totalVotes = poll.options.reduce((s, o) => s + o.votes, 0);
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium opacity-70">
          <BarChart3 className="h-3.5 w-3.5" /> Enquete
        </div>
        <p className="text-sm font-semibold">{poll.question}</p>
        <div className="space-y-1.5">
          {poll.options.map((opt, i) => {
            const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
            return (
              <div key={i} className="relative rounded-lg overflow-hidden bg-background/20 border border-border/30">
                <div className="absolute inset-0 bg-primary/10 transition-all" style={{ width: `${pct}%` }} />
                <div className="relative px-3 py-2 flex items-center justify-between">
                  <span className="text-xs">{opt.text}</span>
                  <span className="text-[10px] font-medium opacity-60">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] opacity-50">{totalVotes} voto{totalVotes !== 1 ? "s" : ""}</p>
      </div>
    );
  };

  const renderList = (msg: ChatMessage) => {
    if (!msg.list) return null;
    const list = msg.list;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium opacity-70">
          <List className="h-3.5 w-3.5" /> Lista
        </div>
        <p className="text-sm font-semibold">{list.title}</p>
        <div className="space-y-1">
          {list.sections.map((section, si) =>
            section.rows.map((row, ri) => (
              <div key={`${si}-${ri}`} className="px-3 py-2 rounded-lg bg-background/20 border border-border/30">
                <p className="text-xs font-medium">{row.title}</p>
                {row.description && <p className="text-[10px] opacity-60">{row.description}</p>}
              </div>
            ))
          )}
        </div>
        <div className="text-center">
          <span className="text-xs text-primary font-medium">{list.buttonText}</span>
        </div>
      </div>
    );
  };

  const renderSticker = (msg: ChatMessage) => (
    <div className="text-5xl">{msg.stickerUrl || msg.content}</div>
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-background/50">
      {/* Date divider */}
      <div className="flex items-center justify-center">
        <span className="text-[11px] text-muted-foreground bg-muted px-3 py-1 rounded-full">
          Hoje
        </span>
      </div>

      {messages.map((msg) => {
        const isLead = msg.sender === "lead";
        return (
          <div key={msg.id} className={`flex ${isLead ? "justify-start" : "justify-end"} group`}>
            <div className="relative max-w-[70%]">
              {/* Reply preview */}
              {msg.replyTo && (
                <div className={`rounded-t-2xl px-4 py-2 text-[11px] border-l-2 border-primary bg-muted/50 ${isLead ? "rounded-tr-2xl" : "rounded-tl-2xl"}`}>
                  <p className="font-medium text-primary">{msg.replyTo.sender}</p>
                  <p className="opacity-70 truncate">{msg.replyTo.content}</p>
                </div>
              )}

              <div
                className={`rounded-2xl px-4 py-2.5 ${
                  msg.replyTo ? "rounded-t-none" : ""
                } ${
                  msg.type === "sticker"
                    ? "bg-transparent p-0"
                    : isLead
                      ? "bg-card border border-border rounded-bl-md"
                      : "bg-primary text-primary-foreground rounded-br-md"
                }`}
              >
                {/* Content by type */}
                {msg.type === "audio" && (
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex items-center gap-[2px]">
                      {Array.from({ length: 16 }, (_, i) => (
                        <div
                          key={i}
                          className={`rounded-full ${isLead ? "bg-muted-foreground/40" : "bg-primary-foreground/40"}`}
                          style={{ width: 2, height: 4 + Math.random() * 12 }}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] opacity-70">0:{String(msg.duration || 0).padStart(2, "0")}</span>
                  </div>
                )}

                {msg.type === "location" && renderLocation(msg)}
                {msg.type === "contact" && renderContact(msg)}
                {msg.type === "poll" && renderPoll(msg)}
                {msg.type === "sticker" && renderSticker(msg)}
                {msg.type === "list" && renderList(msg)}

                {msg.type === "image" && (
                  <div className="rounded-lg bg-muted/30 h-40 flex items-center justify-center text-3xl mb-1">🖼️</div>
                )}
                {msg.type === "video" && (
                  <div className="rounded-lg bg-muted/30 h-40 flex items-center justify-center text-3xl mb-1">🎬</div>
                )}
                {msg.type === "document" && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-background/20 mb-1">
                    <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center text-lg">📄</div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{msg.fileName || "Documento"}</p>
                      <p className="text-[10px] opacity-60">{msg.mimeType || "application/pdf"}</p>
                    </div>
                  </div>
                )}

                {(msg.type === "text" || (msg.content && !["location", "contact", "poll", "sticker", "list"].includes(msg.type))) && msg.content && (
                  <p className="text-sm leading-relaxed">{renderFormattedText(msg.content)}</p>
                )}

                {msg.type !== "sticker" && renderLinkPreview(msg)}

                {/* Timestamp */}
                {msg.type !== "sticker" && (
                  <div className={`flex items-center justify-end gap-1 mt-1 ${isLead ? "text-muted-foreground" : "text-primary-foreground/60"}`}>
                    <span className="text-[10px]">{formatTime(msg.timestamp)}</span>
                    {!isLead && <CheckCheck className="h-3 w-3" />}
                  </div>
                )}
              </div>

              {/* Reactions */}
              {msg.reactions && msg.reactions.length > 0 && (
                <div className={`flex gap-1 mt-0.5 ${isLead ? "justify-start" : "justify-end"}`}>
                  {msg.reactions.map((r, i) => (
                    <span key={i} className="text-sm bg-muted rounded-full px-1.5 py-0.5 border border-border">
                      {r.emoji} {r.count > 1 && <span className="text-[10px]">{r.count}</span>}
                    </span>
                  ))}
                </div>
              )}

              {/* Message actions (hover) */}
              <div className={`absolute top-0 ${isLead ? "-right-16" : "-left-16"} hidden group-hover:flex items-center gap-0.5 bg-card border border-border rounded-lg shadow-sm p-0.5`}>
                <button
                  onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Reagir"
                >
                  <SmilePlus className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onReply?.(msg)}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Responder"
                >
                  <Reply className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Reaction picker */}
              {showReactionPicker === msg.id && (
                <div className={`absolute ${isLead ? "left-0" : "right-0"} -top-10 flex items-center gap-0.5 bg-card border border-border rounded-full shadow-lg px-2 py-1 z-10`}>
                  {REACTION_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => { onReaction?.(msg.id, emoji); setShowReactionPicker(null); }}
                      className="text-lg hover:scale-125 transition-transform p-0.5"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
