import { useEffect, useRef } from "react";
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

interface RealtimeChatOptions {
  onMessage: MessageHandler;
  onPresence?: PresenceHandler;
  onQueueAssigned?: QueueAssignHandler;
  onMessageStatus?: MessageStatusHandler;
  onLeadRecoveryReturn?: LeadRecoveryHandler;
}

/**
 * Realtime chat hook — Supabase Realtime backed.
 *
 * Subscribes to INSERT/UPDATE on public.chat_messages (scoped to the user's tenant via RLS).
 * - INSERT with sender !== 'agent' -> onMessage (incoming WhatsApp/chat message)
 * - UPDATE on `status` column -> onMessageStatus (sent/delivered/read/failed)
 *
 * Presence / queue assignment / lead recovery events remain VPS-only for now
 * (no Supabase equivalent yet). The callbacks are accepted for API compatibility
 * but won't fire from this hook.
 */
export function useRealtimeChat(options: RealtimeChatOptions) {
  const messageRef = useRef<MessageHandler>(options.onMessage);
  messageRef.current = options.onMessage;

  const messageStatusRef = useRef<MessageStatusHandler | undefined>(options.onMessageStatus);
  messageStatusRef.current = options.onMessageStatus;

  useEffect(() => {
    const channel = supabase
      .channel("chat_messages_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (!row) return;
          // Only forward incoming (non-agent) messages to onMessage to avoid echoing our own sends.
          const sender = String(row.sender ?? "");
          if (sender === "attendant" || sender === "agent" || sender === "me") return;

          const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
          const incoming: IncomingMessage = {
            id: String(row.id ?? ""),
            phone: String(row.phone ?? ""),
            pushName: String(metadata.pushName ?? metadata.push_name ?? ""),
            leadId: row.lead_id ? String(row.lead_id) : null,
            leadName: String(metadata.leadName ?? metadata.lead_name ?? ""),
            content: String(row.content ?? ""),
            type: String(row.type ?? "text"),
            timestamp: String(row.timestamp ?? row.created_at ?? new Date().toISOString()),
            instance: String(row.instance ?? ""),
            queueId: metadata.queueId ? String(metadata.queueId) : undefined,
            queueName: metadata.queueName ? String(metadata.queueName) : undefined,
            queueColor: metadata.queueColor ? String(metadata.queueColor) : undefined,
            mediaUrl: row.media_url ? String(row.media_url) : null,
            fileName: row.file_name ? String(row.file_name) : null,
            mimeType: row.mime_type ? String(row.mime_type) : null,
          };
          try {
            messageRef.current(incoming);
          } catch (err) {
            console.error("Realtime onMessage handler error:", err);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const prev = payload.old as Record<string, unknown> | undefined;
          if (!row) return;
          // Only emit when status actually changed
          if (prev && prev.status === row.status) return;
          const status = String(row.status ?? "");
          if (!["sent", "delivered", "read", "failed"].includes(status)) return;
          try {
            messageStatusRef.current?.({
              messageId: String(row.id ?? ""),
              phone: String(row.phone ?? ""),
              status: status as MessageStatusUpdate["status"],
              instance: String(row.instance ?? ""),
            });
          } catch (err) {
            console.error("Realtime onMessageStatus handler error:", err);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("📡 Supabase chat realtime connected");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("📡 Supabase chat realtime status:", status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
