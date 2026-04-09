export interface Lead {
  id: string;
  name: string;
  initials: string;
  phone: string;
  lastMessage: string;
  lastMessageTime: Date;
  unreadCount: number;
  status: "waiting" | "active" | "closed" | "finished";
  assignedTo?: string;
  avatarColor?: string;
  avatarUrl?: string | null;
  queueId?: string;
  queueName?: string;
  queueColor?: string;
}

export type MessageType =
  | "text"
  | "audio"
  | "image"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "poll"
  | "reaction"
  | "list";

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactData {
  fullName: string;
  phone: string;
  email?: string;
  company?: string;
  url?: string;
}

export interface PollData {
  question: string;
  options: { text: string; votes: number }[];
  allowMultiple?: boolean;
}

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
}

export interface ReactionData {
  emoji: string;
  count: number;
}

export interface ReplyData {
  messageId: string;
  content: string;
  sender: string;
}

export interface MentionData {
  userId: string;
  displayName: string;
}

export interface ListData {
  title: string;
  buttonText: string;
  sections: {
    title: string;
    rows: { id: string; title: string; description?: string }[];
  }[];
}

export interface ChatMessage {
  id: string;
  leadId: string;
  content: string;
  sender: "lead" | "attendant";
  type: MessageType;
  timestamp: Date;
  status?: MessageStatus;
  duration?: number;
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  location?: LocationData;
  contact?: ContactData;
  poll?: PollData;
  linkPreview?: LinkPreview;
  reactions?: ReactionData[];
  replyTo?: ReplyData;
  mentions?: MentionData[];
  stickerUrl?: string;
  list?: ListData;
  formatting?: "bold" | "italic" | "strikethrough" | "monospace";
}

export const mockLeadsQueue: Lead[] = [];
export const mockLeadsActive: Lead[] = [];
export const mockMessages: Record<string, ChatMessage[]> = {};
