import type { ChatMessage } from "@/data/chatMockData";
import { useEffect, useRef } from "react";
import { Check, CheckCheck } from "lucide-react";

interface ConversationViewProps {
  messages: ChatMessage[];
  leadName: string;
}

export function ConversationView({ messages, leadName }: ConversationViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

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
          <div key={msg.id} className={`flex ${isLead ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                isLead
                  ? "bg-card border border-border rounded-bl-md"
                  : "bg-primary text-primary-foreground rounded-br-md"
              }`}
            >
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

              <p className="text-sm leading-relaxed">{msg.content}</p>

              <div className={`flex items-center justify-end gap-1 mt-1 ${isLead ? "text-muted-foreground" : "text-primary-foreground/60"}`}>
                <span className="text-[10px]">{formatTime(msg.timestamp)}</span>
                {!isLead && <CheckCheck className="h-3 w-3" />}
              </div>
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
