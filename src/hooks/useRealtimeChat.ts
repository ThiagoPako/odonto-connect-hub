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
  mediaUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
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

export interface MessageStatusUpdate {
  messageId: string;
  phone: string;
  status: "sent" | "delivered" | "read" | "failed";
  instance: string;
}

type MessageHandler = (msg: IncomingMessage) => void;
type PresenceHandler = (update: PresenceUpdate) => void;
type QueueAssignHandler = (assignment: QueueAssignment) => void;
type MessageStatusHandler = (update: MessageStatusUpdate) => void;

interface RealtimeChatOptions {
  onMessage: MessageHandler;
  onPresence?: PresenceHandler;
  onQueueAssigned?: QueueAssignHandler;
  onMessageStatus?: MessageStatusHandler;
}

export function useRealtimeChat(options: RealtimeChatOptions) {
  const messageRef = useRef<MessageHandler>(options.onMessage);
  messageRef.current = options.onMessage;

  const presenceRef = useRef<PresenceHandler | undefined>(options.onPresence);
  presenceRef.current = options.onPresence;

  const queueAssignRef = useRef<QueueAssignHandler | undefined>(options.onQueueAssigned);
  queueAssignRef.current = options.onQueueAssigned;

  const messageStatusRef = useRef<MessageStatusHandler | undefined>(options.onMessageStatus);
  messageStatusRef.current = options.onMessageStatus;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;
    let retries = 0;
    let keepaliveInterval: ReturnType<typeof setInterval>;

    function connect() {
      es = new EventSource(`${VPS_API_BASE}/events`);

      es.addEventListener("connected", () => {
        retries = 0;
        console.log("📡 SSE connected");
      });

      // Keepalive: if no event received in 45s, force reconnect
      let lastEvent = Date.now();
      const onAnyEvent = () => { lastEvent = Date.now(); };
      es.addEventListener("connected", onAnyEvent);
      es.addEventListener("new_message", onAnyEvent);
      es.addEventListener("presence_update", onAnyEvent);
      es.addEventListener("queue_assigned", onAnyEvent);
      es.addEventListener("message_status_update", onAnyEvent);
      es.addEventListener("ping", onAnyEvent);

      clearInterval(keepaliveInterval);
      keepaliveInterval = setInterval(() => {
        if (Date.now() - lastEvent > 45000 && es) {
          console.log("📡 SSE stale — forcing reconnect");
          es.close();
          connect();
        }
      }, 15000);

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

      es.addEventListener("queue_assigned", (e) => {
        try {
          const data: QueueAssignment = JSON.parse(e.data);
          queueAssignRef.current?.(data);
        } catch (err) {
          console.error("SSE queue_assigned parse error:", err);
        }
      });

      es.addEventListener("message_status_update", (e) => {
        try {
          const data: MessageStatusUpdate = JSON.parse(e.data);
          messageStatusRef.current?.(data);
        } catch (err) {
          console.error("SSE message_status_update parse error:", err);
        }
      });

      es.onerror = () => {
        es?.close();
        clearInterval(keepaliveInterval);
        retries++;
        const delay = Math.min(1000 * retries, 10000);
        console.log(`📡 SSE reconnecting in ${delay}ms...`);
        retryTimeout = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimeout);
      clearInterval(keepaliveInterval);
    };
  }, []);
}
