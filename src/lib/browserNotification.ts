/**
 * Browser Push Notifications — request permission and show native notifications
 */

import { registerPushSubscription } from './pushSubscription';

const PERMISSION_KEY = "odonto_push_enabled";

export function isPushEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PERMISSION_KEY) !== "false";
}

export function setPushEnabled(enabled: boolean): void {
  localStorage.setItem(PERMISSION_KEY, String(enabled));
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") {
    // Auto-register push subscription when permission already granted
    registerPushSubscription().catch(() => {});
    return true;
  }
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  if (result === "granted") {
    // Register push subscription after granting permission
    registerPushSubscription().catch(() => {});
  }
  return result === "granted";
}

/** leadId: id do lead (crm_leads.id). Nunca nome nem telefone: vão para a URL (LGPD). */
export function showBrowserNotification(title: string, body: string, leadId?: string) {
  if (!isPushEnabled()) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.hasFocus()) return;

  const notification = new Notification(title, {
    body,
    icon: "/favicon.ico",
    tag: "odonto-chat",
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
    if (leadId) {
      window.location.href = `/chat?lead=${encodeURIComponent(leadId)}`;
    }
  };
}
