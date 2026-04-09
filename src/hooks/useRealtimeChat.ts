import { useEffect, useRef, useCallback } from "react";
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
}

type MessageHandler = (msg: IncomingMessage) => void;

export function useRealtimeChat(onMessage: MessageHandler) {
  const handlerRef = useRef<MessageHandler>(onMessage);
  handlerRef.current = onMessage;

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
          handlerRef.current(data);
        } catch (err) {
          console.error("SSE parse error:", err);
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
