import { useSyncExternalStore } from "react";

let unreadCount = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setChatUnreadCount(count: number) {
  unreadCount = count;
  emit();
}

export function incrementChatUnread(by = 1) {
  unreadCount += by;
  emit();
}

export function useChatUnreadCount(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => unreadCount,
    () => 0,
  );
}
