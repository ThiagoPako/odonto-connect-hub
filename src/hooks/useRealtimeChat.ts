import { useEffect, useRef } from "react";
import { VPS_API_BASE } from "@/lib/vpsApi";

export interface IncomingMessage {
  id: string;
  phone: string;
  pushName: string;
  leadId: string | null;
  leadName: string;
  content: string;
  type: string;
  timestamp: string;
  instance: string;
  queueId?: string;
  queueName?: string;
  queueColor?: string;
}

export type PresenceStatus = "available" | "composing" | "recording" | "paused" | "unavailable";

export interface PresenceUpdate {
  phone: string;
  leadId?: string;
  status: PresenceStatus;
  instance: string;
}

export interface QueueAssignment {
  leadId: string;
  leadName: string;
  phone: string;
  queueId: string;
  queueName: string;
  queueColor?: string;
  timestamp: string;
}

type MessageHandler = (msg: IncomingMessage) => void;
type PresenceHandler = (update: PresenceUpdate) => void;
type QueueAssignHandler = (assignment: QueueAssignment) => void;

interface RealtimeChatOptions {
  onMessage: MessageHandler;
  onPresence?: PresenceHandler;
  onQueueAssigned?: QueueAssignHandler;
}

export function useRealtimeChat(options: RealtimeChatOptions) {
  const messageRef = useRef<MessageHandler>(options.onMessage);
  messageRef.current = options.onMessage;

  const presenceRef = useRef<PresenceHandler | undefined>(options.onPresence);
  presenceRef.current = options.onPresence;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;
    let retries = 0;

    function connect() {
      es = new EventSource(`${VPS_API_BASE}/events`);

      es.addEventListener("connected", () => {
        retries = 0;
        console.log("📡 SSE connected");
      });

      es.addEventListener("new_message", (e) => {
        try {
          const data: IncomingMessage = JSON.parse(e.data);
          messageRef.current(data);
        } catch (err) {
          console.error("SSE parse error:", err);
        }
      });

      es.addEventListener("presence_update", (e) => {
        try {
          const data: PresenceUpdate = JSON.parse(e.data);
          presenceRef.current?.(data);
        } catch (err) {
          console.error("SSE presence parse error:", err);
        }
      });

      es.onerror = () => {
        es?.close();
        retries++;
        const delay = Math.min(2000 * retries, 30000);
        console.log(`📡 SSE reconnecting in ${delay}ms...`);
        retryTimeout = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, []);
}
