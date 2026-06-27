import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useRealtimeChat, type IncomingMessage } from "@/hooks/useRealtimeChat";
import { playNotificationSound } from "@/lib/notificationSound";
import { showBrowserNotification } from "@/lib/browserNotification";
import { incrementChatUnread } from "@/lib/chatUnreadStore";
import { rememberPendingChatMessage } from "@/lib/chatPendingStore";
import { queueLeadsApi } from "@/lib/vpsApi";

interface QueueLeadNotificationRow {
  id?: string;
  name?: string;
  phone?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
}

function leadKey(row: Pick<QueueLeadNotificationRow, "id" | "phone" | "name">): string {
  return row.id || row.phone?.replace(/\D/g, "") || row.name || "unknown";
}

/**
 * Global chat notifier — runs on every authenticated page so the user is
 * alerted about new WhatsApp messages even when the /chat route is closed.
 *
 * To avoid duplicate alerts when the chat page is already open and focused
 * (it has its own SSE subscription that also fires notifications), we skip
 * here in that exact situation.
 */
export function useGlobalChatNotifier() {
  const location = useLocation();
  const navigate = useNavigate();
  const seenLeadTimesRef = useRef<Record<string, number>>({});
  const queuePollInitializedRef = useRef(false);

  const notify = (name: string, body: string, lead: string) => {
    playNotificationSound();
    incrementChatUnread(1);
    toast.info(`💬 ${name}`, {
      description: body,
      duration: 5000,
      action: {
        label: "Abrir",
        onClick: () => navigate({ to: "/chat", search: { lead } as never }),
      },
    });
    showBrowserNotification(`💬 ${name}`, body, name);
  };

  useRealtimeChat({
    onMessage: (msg: IncomingMessage) => {
      if (msg.sender === "agent") return; // ignore our own outgoing messages

      rememberPendingChatMessage(msg);
      seenLeadTimesRef.current[leadKey({ id: msg.leadId || undefined, phone: msg.phone, name: msg.leadName || msg.pushName })] = new Date(msg.timestamp).getTime();

      const chatOpenAndFocused =
        typeof document !== "undefined" &&
        location.pathname === "/chat" &&
        document.hasFocus();

      if (chatOpenAndFocused) return;

      const name = msg.leadName || msg.pushName || msg.phone;
      const body = msg.content?.slice(0, 80) || `[${msg.type}]`;
      notify(name, body, msg.leadId || msg.phone || name);
    },
  });

  // Fallback: if the SSE connection or browser EventSource misses an event, the
  // persisted waiting queue still acts as source of truth and triggers an alert.
  useEffect(() => {
    let cancelled = false;

    const pollQueue = async () => {
      const { data } = await queueLeadsApi.list();
      if (cancelled || !data) return;

      const rows = [...((data.queue || []) as QueueLeadNotificationRow[]), ...((data.active || []) as QueueLeadNotificationRow[])];

      for (const row of rows) {
        if (!row.lastMessageTime) continue;
        const key = leadKey(row);
        const time = new Date(row.lastMessageTime).getTime();
        if (!Number.isFinite(time)) continue;

        const previous = seenLeadTimesRef.current[key] || 0;
        seenLeadTimesRef.current[key] = Math.max(previous, time);

        if (!queuePollInitializedRef.current) continue;
        if (time <= previous || (row.unreadCount || 0) <= 0) continue;
        if (location.pathname === "/chat" && typeof document !== "undefined" && document.hasFocus()) continue;

        const name = row.name || row.phone || "WhatsApp";
        const body = row.lastMessage?.slice(0, 80) || "Nova mensagem";
        notify(name, body, row.id || row.phone || name);
      }

      queuePollInitializedRef.current = true;
    };

    void pollQueue();
    const interval = window.setInterval(() => void pollQueue(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [location.pathname, navigate]);
}
