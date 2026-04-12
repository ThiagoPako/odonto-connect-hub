import { consciousnessLevels, type ConsciousnessLevel } from "./crmMockData";

export interface LeadTag {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

const STORAGE_KEY = "odonto-lead-tags";
const LEAD_TAGS_KEY = "odonto-lead-tag-assignments";

// Tags agora são baseadas nos níveis de consciência
const defaultTags: LeadTag[] = consciousnessLevels.map((level) => ({
  id: `tag-${level.id}`,
  name: level.label,
  color: level.color,
  icon: level.icon,
}));

export function getTags(): LeadTag[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate: if old tags, replace with consciousness levels
      if (parsed.length > 0 && parsed[0].id === "tag-urgente") {
        saveTags(defaultTags);
        return defaultTags;
      }
      return parsed;
    }
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

// Helper: get consciousness level from tag id
export function getConsciousnessFromTagId(tagId: string): ConsciousnessLevel | undefined {
  const levelId = tagId.replace("tag-", "");
  return consciousnessLevels.find((l) => l.id === levelId)?.id;
}
