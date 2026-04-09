import type { ChatMessage } from "@/data/chatMockData";
import { useEffect, useRef, useState, useCallback } from "react";
import { CheckCheck, Check, MapPin, Phone, Mail, Globe, Building2, BarChart3, Reply, SmilePlus, ExternalLink, List, ChevronDown, Forward, Trash2, Search, Loader2 } from "lucide-react";
import { TypingIndicator } from "./TypingIndicator";

interface ConversationViewProps {
  messages: ChatMessage[];
  leadName: string;
  isTyping?: boolean;
  onReaction?: (messageId: string, emoji: string) => void;
  onReply?: (msg: ChatMessage) => void;
  onForward?: (msg: ChatMessage) => void;
  onDelete?: (msg: ChatMessage) => void;
  /** Called when user scrolls near top — should prepend older messages */
  onLoadMore?: () => Promise<void>;
  /** Whether there are older messages to load */
  hasMore?: boolean;
  /** Whether older messages are currently loading */
  loadingMore?: boolean;
  /** Called when files are dropped onto the chat area */
  onFileDrop?: (files: File[]) => void;
}

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// ─── Date helpers ───────────────────────────────────────────
function formatDateDivider(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  if (isSameDay(date, today)) return "Hoje";
  if (isSameDay(date, yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function shouldShowDateDivider(messages: ChatMessage[], idx: number): boolean {
  if (idx === 0) return true;
  const curr = new Date(messages[idx].timestamp);
  const prev = new Date(messages[idx - 1].timestamp);
  return curr.toDateString() !== prev.toDateString();
}

// ─── Time grouping (5-min blocks) ───────────────────────────
function shouldShowTimestamp(messages: ChatMessage[], idx: number): boolean {
  if (idx === messages.length - 1) return true;
  const curr = messages[idx];
  const next = messages[idx + 1];
  if (curr.sender !== next.sender) return true;
  const diff = new Date(next.timestamp).getTime() - new Date(curr.timestamp).getTime();
  return diff > 5 * 60 * 1000; // 5 min gap
}

export function ConversationView({ messages, leadName, isTyping, onReaction, onReply, onForward, onDelete, onLoadMore, hasMore = false, loadingMore = false, onFileDrop }: ConversationViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const isNearBottomRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const isNearBottomRef = useRef(true);
  const loadMoreTriggeredRef = useRef(false);

  // Smart scroll — only auto-scroll if user is near the bottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, isTyping, scrollToBottom]);

  // Initial scroll (instant)
  useEffect(() => {
    scrollToBottom("instant");
  }, []);

  // Reset load-more trigger when loadingMore finishes
  useEffect(() => {
    if (!loadingMore) {
      loadMoreTriggeredRef.current = false;
    }
  }, [loadingMore]);

  // Track scroll position for show/hide button AND infinite scroll
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < 150;
    isNearBottomRef.current = near;
    setShowScrollButton(!near);

    // Infinite scroll: trigger when near top
    if (el.scrollTop < 100 && hasMore && !loadingMore && !loadMoreTriggeredRef.current && onLoadMore) {
      loadMoreTriggeredRef.current = true;
      const prevScrollHeight = el.scrollHeight;
      onLoadMore().then(() => {
        // Preserve scroll position after prepending older messages
        requestAnimationFrame(() => {
          if (containerRef.current) {
            const newScrollHeight = containerRef.current.scrollHeight;
            containerRef.current.scrollTop = newScrollHeight - prevScrollHeight;
          }
        });
      });
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // Search results
  const searchResults = searchQuery.trim()
    ? messages.filter((m) => m.content?.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  const jumpToMessage = (msgId: string) => {
    setHighlightedMsgId(msgId);
    const el = document.getElementById(`msg-${msgId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlightedMsgId(null), 2000);
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const renderFormattedText = (text: string) => {
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
      <div className="mt-2 rounded-xl border border-border/30 overflow-hidden bg-background/20 backdrop-blur-sm">
        {lp.image && <div className="h-28 bg-muted/50 flex items-center justify-center text-muted-foreground text-xs">🖼️ Preview</div>}
        <div className="p-2.5">
          <p className="text-xs font-semibold leading-tight">{lp.title}</p>
          {lp.description && <p className="text-[11px] opacity-70 mt-0.5 line-clamp-2">{lp.description}</p>}
          <div className="flex items-center gap-1 mt-1.5 text-[10px] opacity-50">
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
      <div className="rounded-xl overflow-hidden">
        <div className="h-32 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center relative">
          <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center animate-pop-in">
            <MapPin className="h-6 w-6 text-destructive" />
          </div>
          <div className="absolute bottom-1.5 right-1.5 text-[9px] bg-background/90 backdrop-blur-sm px-2 py-1 rounded-lg font-mono">
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
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-sm font-bold text-primary shadow-sm">
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
      <div className="space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium opacity-70">
          <BarChart3 className="h-3.5 w-3.5" /> Enquete
        </div>
        <p className="text-sm font-semibold">{poll.question}</p>
        <div className="space-y-1.5">
          {poll.options.map((opt, i) => {
            const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
            return (
              <div key={i} className="relative rounded-xl overflow-hidden bg-background/20 border border-border/20 transition-all hover:border-border/40">
                <div className="absolute inset-0 bg-primary/10 transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
                <div className="relative px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-medium">{opt.text}</span>
                  <span className="text-[10px] font-bold opacity-60">{pct}%</span>
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
      <div className="space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium opacity-70">
          <List className="h-3.5 w-3.5" /> Lista
        </div>
        <p className="text-sm font-semibold">{list.title}</p>
        <div className="space-y-1">
          {list.sections.map((section, si) =>
            section.rows.map((row, ri) => (
              <div key={`${si}-${ri}`} className="px-3 py-2 rounded-xl bg-background/20 border border-border/20 transition-all hover:bg-background/30">
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
    <div className="text-5xl animate-pop-in">{msg.stickerUrl || msg.content}</div>
  );

  // Message status indicator
  const renderStatus = (msg: ChatMessage) => {
    if (msg.sender === "lead") return null;
    // System messages don't get status
    if (msg.id.startsWith("sys-")) return null;

    const status = (msg as any).status as string | undefined;
    if (status === "read") {
      return <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" />;
    }
    if (status === "delivered") {
      return <CheckCheck className="h-3.5 w-3.5" />;
    }
    // Default: sent
    return <Check className="h-3.5 w-3.5" />;
  };

  // Group consecutive messages by same sender
  const isFirstInGroup = (i: number) => i === 0 || messages[i].sender !== messages[i - 1].sender;
  const isLastInGroup = (i: number) => i === messages.length - 1 || messages[i].sender !== messages[i + 1].sender;

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      {/* Message search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-4 py-2 bg-card border-b border-border shrink-0 animate-fade-in">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar na conversa..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <span className="text-[11px] text-muted-foreground shrink-0">
            {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""}
          </span>
          <button onClick={() => { setSearchOpen(false); setSearchQuery(""); }} className="p-1 rounded hover:bg-muted">
            <span className="text-xs text-muted-foreground">✕</span>
          </button>
        </div>
      )}

      {/* Search results strip */}
      {searchOpen && searchResults.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-1.5 bg-muted/30 border-b border-border overflow-x-auto shrink-0">
          {searchResults.slice(0, 10).map((m) => (
            <button
              key={m.id}
              onClick={() => jumpToMessage(m.id)}
              className="px-2 py-1 rounded-lg bg-card border border-border/50 text-[11px] text-foreground truncate max-w-[200px] hover:bg-primary/10 transition-colors shrink-0"
            >
              {m.content?.slice(0, 40)}
            </button>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-1 chat-bg-pattern"
      >
        {/* Infinite scroll: loading older messages indicator */}
        {loadingMore && (
          <div className="flex items-center justify-center py-3 animate-fade-in">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Carregando mensagens anteriores...</span>
          </div>
        )}
        {hasMore && !loadingMore && (
          <div className="flex items-center justify-center py-2">
            <button
              onClick={() => onLoadMore?.()}
              className="text-xs text-primary hover:underline font-medium"
            >
              ↑ Carregar mensagens anteriores
            </button>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isLead = msg.sender === "lead";
          const first = isFirstInGroup(idx);
          const last = isLastInGroup(idx);
          const showTime = shouldShowTimestamp(messages, idx);
          const showDate = shouldShowDateDivider(messages, idx);

          // Dynamic border radius based on grouping
          const bubbleRadius = isLead
            ? `${first ? "1rem" : "0.375rem"} 1rem 1rem ${last ? "0.25rem" : "0.375rem"}`
            : `1rem ${first ? "1rem" : "0.375rem"} ${last ? "0.25rem" : "0.375rem"} 1rem`;

          return (
            <div key={msg.id}>
              {/* Date divider */}
              {showDate && (
                <div className="flex items-center justify-center my-4 animate-fade-in">
                  <span className="text-[11px] text-muted-foreground bg-card/80 backdrop-blur-sm px-4 py-1.5 rounded-full shadow-sm border border-border/30 font-medium">
                    {formatDateDivider(new Date(msg.timestamp))}
                  </span>
                </div>
              )}

              <div
                id={`msg-${msg.id}`}
                className={`flex ${isLead ? "justify-start" : "justify-end"} group ${
                  isLead ? "animate-chat-bubble-left" : "animate-chat-bubble-right"
                } ${first ? "mt-3" : "mt-0.5"} ${highlightedMsgId === msg.id ? "ring-2 ring-primary/40 rounded-2xl" : ""}`}
                style={{ animationDelay: `${Math.min(idx * 30, 200)}ms`, animationFillMode: "both" }}
              >
                <div className="relative max-w-[70%]">
                  {/* Reply preview */}
                  {msg.replyTo && (
                    <div className="rounded-t-2xl px-4 py-2 text-[11px] border-l-2 border-primary/70 bg-primary/5 backdrop-blur-sm animate-fade-in">
                      <p className="font-semibold text-primary text-[10px]">{msg.replyTo.sender}</p>
                      <p className="opacity-70 truncate">{msg.replyTo.content}</p>
                    </div>
                  )}

                  <div
                    className={`relative px-4 py-2.5 transition-all duration-200 ${
                      msg.replyTo ? "rounded-t-none" : ""
                    } ${
                      msg.type === "sticker"
                        ? "bg-transparent p-0"
                        : isLead
                          ? "bg-card border border-border/50 msg-bubble-lead shadow-sm"
                          : "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground msg-bubble-agent shadow-md"
                    } ${last && isLead ? "msg-tail-left" : ""} ${last && !isLead ? "msg-tail-right" : ""}`}
                    style={msg.type !== "sticker" ? { borderRadius: bubbleRadius } : undefined}
                  >
                    {/* Content by type */}
                    {msg.type === "audio" && (
                      <div className="flex items-center gap-2.5 mb-1">
                        <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                          <div className="w-0 h-0 border-l-[8px] border-l-primary border-y-[5px] border-y-transparent ml-0.5" />
                        </div>
                        <div className="flex items-center gap-[2px] flex-1">
                          {Array.from({ length: 24 }, (_, i) => (
                            <div
                              key={i}
                              className={`rounded-full transition-all ${isLead ? "bg-muted-foreground/30" : "bg-primary-foreground/30"}`}
                              style={{
                                width: 2,
                                height: 3 + Math.sin(i * 0.8) * 8 + Math.random() * 4,
                                animationDelay: `${i * 30}ms`,
                              }}
                            />
                          ))}
                        </div>
                        <span className="text-[11px] opacity-70 font-mono">0:{String(msg.duration || 0).padStart(2, "0")}</span>
                      </div>
                    )}

                    {msg.type === "location" && renderLocation(msg)}
                    {msg.type === "contact" && renderContact(msg)}
                    {msg.type === "poll" && renderPoll(msg)}
                    {msg.type === "sticker" && renderSticker(msg)}
                    {msg.type === "list" && renderList(msg)}

                    {msg.type === "image" && (
                      <div className="rounded-xl overflow-hidden mb-1.5 max-w-[280px]">
                        {msg.fileUrl ? (
                          <img src={msg.fileUrl} alt={msg.fileName || "Imagem"} className="w-full max-h-64 object-cover rounded-xl cursor-pointer hover:opacity-90 transition-opacity" onClick={() => window.open(msg.fileUrl, "_blank")} />
                        ) : (
                          <div className="bg-gradient-to-br from-muted/40 to-muted/20 h-44 flex items-center justify-center text-3xl">🖼️</div>
                        )}
                      </div>
                    )}
                    {msg.type === "video" && (
                      <div className="rounded-xl overflow-hidden mb-1.5 max-w-[280px]">
                        {msg.fileUrl ? (
                          <video src={msg.fileUrl} controls className="w-full max-h-64 rounded-xl" preload="metadata" />
                        ) : (
                          <div className="bg-gradient-to-br from-muted/40 to-muted/20 h-44 flex items-center justify-center relative">
                            <div className="h-12 w-12 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center shadow-lg">
                              <div className="w-0 h-0 border-l-[10px] border-l-foreground border-y-[7px] border-y-transparent ml-1" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {msg.type === "audio" && (
                      <div className="mb-1.5 min-w-[200px]">
                        {msg.fileUrl ? (
                          <audio src={msg.fileUrl} controls className="w-full h-10" preload="metadata" />
                        ) : (
                          <div className="flex items-center gap-2 p-2 rounded-xl bg-background/15">
                            <span className="text-lg">🎤</span>
                            <span className="text-xs opacity-70">{msg.duration ? `${Math.floor(msg.duration / 60)}:${String(msg.duration % 60).padStart(2, "0")}` : "Áudio"}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {msg.type === "document" && (
                      <div className="flex items-center gap-3 p-2.5 rounded-xl bg-background/15 mb-1.5 border border-border/20 cursor-pointer hover:bg-background/25 transition-colors" onClick={() => msg.fileUrl && window.open(msg.fileUrl, "_blank")}>
                        <div className="h-11 w-11 rounded-xl bg-primary/20 flex items-center justify-center text-lg shrink-0 shadow-sm">📄</div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{msg.fileName || "Documento"}</p>
                          <p className="text-[10px] opacity-60 mt-0.5">{msg.mimeType || "application/pdf"}</p>
                        </div>
                      </div>
                    )}

                    {(msg.type === "text" || (msg.content && !["location", "contact", "poll", "sticker", "list", "image", "video", "audio", "document"].includes(msg.type))) && msg.content && (
                      <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{renderFormattedText(msg.content)}</p>
                    )}
                    {/* Caption for media messages */}
                    {["image", "video"].includes(msg.type) && msg.content && !msg.content.startsWith("🖼️") && !msg.content.startsWith("🎬") && (
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap mt-1">{renderFormattedText(msg.content)}</p>
                    )}

                    {msg.type !== "sticker" && renderLinkPreview(msg)}

                    {/* Timestamp + status */}
                    {msg.type !== "sticker" && showTime && (
                      <div className={`flex items-center justify-end gap-1 mt-1.5 ${isLead ? "text-muted-foreground/60" : "text-primary-foreground/50"}`}>
                        <span className="text-[10px] font-medium">{formatTime(new Date(msg.timestamp))}</span>
                        {renderStatus(msg)}
                      </div>
                    )}
                  </div>

                  {/* Reactions */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className={`flex gap-1 mt-1 ${isLead ? "justify-start ml-2" : "justify-end mr-2"}`}>
                      {msg.reactions.map((r, i) => (
                        <span key={i} className="text-sm bg-card rounded-full px-2 py-0.5 border border-border/50 shadow-sm animate-pop-in hover:scale-110 transition-transform cursor-default">
                          {r.emoji} {r.count > 1 && <span className="text-[10px] font-medium text-muted-foreground">{r.count}</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Message actions (hover) */}
                  <div className={`absolute top-1/2 -translate-y-1/2 ${isLead ? "-right-20" : "-left-20"} hidden group-hover:flex items-center gap-0.5 bg-card/90 backdrop-blur-sm border border-border/50 rounded-xl shadow-lg p-0.5 animate-pop-in`}>
                    <button
                      onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Reagir"
                    >
                      <SmilePlus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onReply?.(msg)}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Responder"
                    >
                      <Reply className="h-3.5 w-3.5" />
                    </button>
                    {onForward && (
                      <button
                        onClick={() => onForward(msg)}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Encaminhar"
                      >
                        <Forward className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {onDelete && msg.sender === "attendant" && (
                      <button
                        onClick={() => onDelete(msg)}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Apagar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Reaction picker */}
                  {showReactionPicker === msg.id && (
                    <div className={`absolute ${isLead ? "left-0" : "right-0"} -top-11 flex items-center gap-0.5 bg-card/95 backdrop-blur-md border border-border/50 rounded-2xl shadow-xl px-2 py-1.5 z-10 animate-pop-in`}>
                      {REACTION_EMOJIS.map((emoji, i) => (
                        <button
                          key={emoji}
                          onClick={() => { onReaction?.(msg.id, emoji); setShowReactionPicker(null); }}
                          className="text-lg hover:scale-[1.3] transition-all p-0.5 hover:bg-muted/50 rounded-lg"
                          style={{ animationDelay: `${i * 40}ms` }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isTyping && <TypingIndicator name={leadName} />}

        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom FAB */}
      {showScrollButton && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 right-4 h-10 w-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center hover:bg-muted transition-all animate-fade-in z-10"
        >
          <ChevronDown className="h-5 w-5 text-foreground" />
        </button>
      )}

      {/* Search toggle */}
      {!searchOpen && (
        <button
          onClick={() => setSearchOpen(true)}
          className="absolute top-3 right-3 h-8 w-8 rounded-full bg-card/80 backdrop-blur-sm border border-border/50 shadow-sm flex items-center justify-center hover:bg-muted transition-all z-10 opacity-0 hover:opacity-100 focus:opacity-100"
          title="Buscar na conversa"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
