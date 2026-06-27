import { useEffect, useRef } from "react";
import { getAccessToken, VPS_API_BASE } from "@/lib/vpsApi";
import { supabase } from "@/integrations/supabase/client";

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
  sender?: string;
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

export interface LeadRecoveryReturn {
  leadId: string;
  leadName: string;
  phone: string;
  previousStage: string;
}

type MessageHandler = (msg: IncomingMessage) => void;
type PresenceHandler = (update: PresenceUpdate) => void;
type QueueAssignHandler = (assignment: QueueAssignment) => void;
type MessageStatusHandler = (update: MessageStatusUpdate) => void;
type LeadRecoveryHandler = (data: LeadRecoveryReturn) => void;

async function getActiveTenantId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();
    return data?.tenant_id || null;
  } catch {
    return null;
  }
}

interface RealtimeChatOptions {
  onMessage: MessageHandler;
  onPresence?: PresenceHandler;
  onQueueAssigned?: QueueAssignHandler;
  onMessageStatus?: MessageStatusHandler;
  onLeadRecoveryReturn?: LeadRecoveryHandler;
}

/** Realtime chat hook — VPS SSE backed. */
export function useRealtimeChat(options: RealtimeChatOptions) {
  const messageRef = useRef<MessageHandler>(options.onMessage);
  messageRef.current = options.onMessage;

  const presenceRef = useRef<PresenceHandler | undefined>(options.onPresence);
  presenceRef.current = options.onPresence;

  const queueAssignedRef = useRef<QueueAssignHandler | undefined>(options.onQueueAssigned);
  queueAssignedRef.current = options.onQueueAssigned;

  const messageStatusRef = useRef<MessageStatusHandler | undefined>(options.onMessageStatus);
  messageStatusRef.current = options.onMessageStatus;

  const leadRecoveryRef = useRef<LeadRecoveryHandler | undefined>(options.onLeadRecoveryReturn);
  leadRecoveryRef.current = options.onLeadRecoveryReturn;

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let cancelled = false;

    const parse = <T,>(event: MessageEvent<string>): T | null => {
      try { return JSON.parse(event.data) as T; } catch { return null; }
    };

    Promise.all([getAccessToken(), getActiveTenantId()]).then(([token, tenantId]) => {
      if (cancelled) return;
      const url = new URL(`${VPS_API_BASE}/events`);
      if (token) url.searchParams.set("token", token);
      if (tenantId) url.searchParams.set("tenantId", tenantId);
      eventSource = new EventSource(url.toString());

      eventSource.addEventListener("connected", () => console.log("📡 Chat realtime connected"));
      eventSource.addEventListener("new_message", (event) => {
        const data = parse<IncomingMessage>(event as MessageEvent<string>);
        if (data) messageRef.current(data);
      });
      eventSource.addEventListener("presence_update", (event) => {
        const data = parse<PresenceUpdate>(event as MessageEvent<string>);
        if (data) presenceRef.current?.(data);
      });
      eventSource.addEventListener("queue_assigned", (event) => {
        const data = parse<QueueAssignment>(event as MessageEvent<string>);
        if (data) queueAssignedRef.current?.(data);
      });
      eventSource.addEventListener("message_status_update", (event) => {
        const data = parse<MessageStatusUpdate>(event as MessageEvent<string>);
        if (data) messageStatusRef.current?.(data);
      });
      eventSource.addEventListener("lead_returned_from_recovery", (event) => {
        const data = parse<LeadRecoveryReturn>(event as MessageEvent<string>);
        if (data) leadRecoveryRef.current?.(data);
      });
      eventSource.onerror = () => console.warn("📡 Chat realtime disconnected/reconnecting");
    });

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, []);
}
