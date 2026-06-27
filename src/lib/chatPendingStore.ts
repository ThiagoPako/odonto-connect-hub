import type { IncomingMessage } from "@/hooks/useRealtimeChat";

const STORAGE_KEY = "odonto_chat_pending_messages";
const MAX_PENDING_MESSAGES = 50;

interface LeadMatchTarget {
  id: string;
  phone?: string;
  name?: string;
}

function normalizePhone(value?: string | null): string {
  return (value || "").replace(/\D/g, "");
}

function readPendingMessages(): IncomingMessage[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingMessages(messages: IncomingMessage[]) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_PENDING_MESSAGES)));
  } catch {
    // Session storage can be unavailable in private/restricted modes.
  }
}

function matchesLead(message: IncomingMessage, target: LeadMatchTarget): boolean {
  if (message.leadId && message.leadId === target.id) return true;

  const messagePhone = normalizePhone(message.phone);
  const targetPhone = normalizePhone(target.phone);
  if (messagePhone && targetPhone) {
    const messageSuffix = messagePhone.slice(-11);
    const targetSuffix = targetPhone.slice(-11);
    if (messagePhone === targetPhone || messageSuffix === targetSuffix) return true;
  }

  const targetName = (target.name || "").trim().toLowerCase();
  if (!targetName) return false;

  return [message.leadName, message.pushName]
    .filter(Boolean)
    .some((name) => name.trim().toLowerCase() === targetName);
}

export function rememberPendingChatMessage(message: IncomingMessage) {
  const pending = readPendingMessages();
  const withoutDuplicate = pending.filter((item) => item.id !== message.id);
  writePendingMessages([...withoutDuplicate, message]);
}

export function takePendingChatMessagesForLead(target: LeadMatchTarget): IncomingMessage[] {
  const pending = readPendingMessages();
  if (pending.length === 0) return [];

  const matched: IncomingMessage[] = [];
  const remaining: IncomingMessage[] = [];

  for (const message of pending) {
    if (matchesLead(message, target)) matched.push(message);
    else remaining.push(message);
  }

  writePendingMessages(remaining);
  return matched.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}