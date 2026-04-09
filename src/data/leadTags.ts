export interface LeadTag {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

const STORAGE_KEY = "odonto-lead-tags";
const LEAD_TAGS_KEY = "odonto-lead-tag-assignments";

const defaultTags: LeadTag[] = [
  { id: "tag-urgente", name: "Urgente", color: "#EF4444", icon: "🔴" },
  { id: "tag-vip", name: "VIP", color: "#F59E0B", icon: "⭐" },
  { id: "tag-retorno", name: "Retorno", color: "#3B82F6", icon: "🔄" },
  { id: "tag-novo", name: "Novo", color: "#10B981", icon: "🆕" },
  { id: "tag-orcamento", name: "Orçamento", color: "#8B5CF6", icon: "💰" },
];

export function getTags(): LeadTag[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return defaultTags;
}

export function saveTags(tags: LeadTag[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
}

// Lead <-> Tag assignments: Record<leadId, tagId[]>
export function getLeadTags(): Record<string, string[]> {
  try {
    const stored = localStorage.getItem(LEAD_TAGS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

export function saveLeadTags(assignments: Record<string, string[]>) {
  localStorage.setItem(LEAD_TAGS_KEY, JSON.stringify(assignments));
}
