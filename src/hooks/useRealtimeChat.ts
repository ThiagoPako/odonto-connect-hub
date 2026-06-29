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
type ConnectedHandler = (data: { tenantId?: string | null } | null) => void;

async function getActiveTenantId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();
    if (data?.tenant_id) return data.tenant_id;

    // Fallback pelo VPS: quando o profile não vem pelo client Supabase/RLS,
    // ainda assim precisamos enviar tenantId no SSE para receber broadcasts.
    const token = await getAccessToken();
    if (!token) return null;
    const res = await fetch(`${VPS_API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const me = await res.json().catch(() => null);
    return me?.tenant_id || null;
  } catch {
    return null;
  }
}

interface RealtimeChatOptions {
  enabled?: boolean;
  onMessage: MessageHandler;
  onPresence?: PresenceHandler;
  onQueueAssigned?: QueueAssignHandler;
  onMessageStatus?: MessageStatusHandler;
  onLeadRecoveryReturn?: LeadRecoveryHandler;
  onConnected?: ConnectedHandler;
}

/** Realtime chat hook — VPS SSE backed. */
export function useRealtimeChat(options: RealtimeChatOptions) {
  const enabled = options.enabled ?? true;

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

  const connectedRef = useRef<ConnectedHandler | undefined>(options.onConnected);
  connectedRef.current = options.onConnected;

  useEffect(() => {
    if (!enabled) return;

    let eventSource: EventSource | null = null;
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryAttempt = 0;

    const parse = <T,>(event: MessageEvent<string>): T | null => {
      try { return JSON.parse(event.data) as T; } catch { return null; }
    };

    const closeCurrent = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      if (retryTimer) window.clearTimeout(retryTimer);
      const delay = Math.min(30_000, 1_000 * Math.pow(2, retryAttempt++));
      retryTimer = window.setTimeout(() => void connect(true), delay);
    };

    const connect = async (forceRefresh = false) => {
      if (cancelled) return;
      closeCurrent();

      const [token, tenantId] = await Promise.all([getAccessToken(forceRefresh), getActiveTenantId()]);
      if (cancelled) return;

      const url = new URL(`${VPS_API_BASE}/events`);
      if (token) url.searchParams.set("token", token);
      if (tenantId) url.searchParams.set("tenantId", tenantId);
      eventSource = new EventSource(url.toString());

      eventSource.addEventListener("connected", (event) => {
        retryAttempt = 0;
        const data = parse<{ tenantId?: string | null }>(event as MessageEvent<string>);
        console.log("📡 Chat realtime connected", data?.tenantId ? `(tenant: ${data.tenantId})` : "(sem tenant)");
        connectedRef.current?.(data);
        if (tenantId && data && !data.tenantId) {
          console.warn("📡 Chat realtime connected without tenant; forcing fresh reconnect");
          scheduleReconnect();
        }
      });
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
      eventSource.onerror = () => {
        console.warn("📡 Chat realtime disconnected; reconnecting with fresh token");
        closeCurrent();
        scheduleReconnect();
      };
    };

    void connect(false);

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      eventSource?.close();
    };
  }, [enabled]);
}
