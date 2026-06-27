import { useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useRealtimeChat, type IncomingMessage } from "@/hooks/useRealtimeChat";
import { playNotificationSound } from "@/lib/notificationSound";
import { showBrowserNotification } from "@/lib/browserNotification";
import { incrementChatUnread } from "@/lib/chatUnreadStore";
import { rememberPendingChatMessage } from "@/lib/chatPendingStore";

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

  useRealtimeChat({
    onMessage: (msg: IncomingMessage) => {
      if (msg.sender === "agent") return; // ignore our own outgoing messages

      rememberPendingChatMessage(msg);

      const chatOpenAndFocused =
        typeof document !== "undefined" &&
        location.pathname === "/chat" &&
        document.hasFocus();

      if (chatOpenAndFocused) return;

      const name = msg.leadName || msg.pushName || msg.phone;
      const body = msg.content?.slice(0, 80) || `[${msg.type}]`;

      playNotificationSound();
      incrementChatUnread(1);
      toast.info(`💬 ${name}`, {
        description: body,
        duration: 5000,
        action: {
          label: "Abrir",
          onClick: () => navigate({ to: "/chat", search: { lead: msg.leadId || msg.phone || name } as never }),
        },
      });
      showBrowserNotification(`💬 ${name}`, body, name);
    },
  });
}
