/**
 * Browser Push Notifications — request permission and show native notifications
 */

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
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function showBrowserNotification(title: string, body: string) {
  if (!isPushEnabled()) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.hasFocus()) return; // only show when tab is not focused

  const notification = new Notification(title, {
    body,
    icon: "/favicon.ico",
    tag: "odonto-chat", // replaces previous notification
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}
