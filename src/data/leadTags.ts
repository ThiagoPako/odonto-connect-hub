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

/* ─────────── Tags de Origem (campanhas) ─────────── */

const ORIGIN_COLORS: Record<string, { color: string; icon: string }> = {
  meta_ads:      { color: "#1877F2", icon: "📘" },
  google_ads:    { color: "#4285F4", icon: "🔍" },
  tiktok:        { color: "#000000", icon: "🎵" },
  instagram:     { color: "#DD2A7B", icon: "📸" },
  youtube:       { color: "#FF0000", icon: "▶️" },
  linkedin:      { color: "#0A66C2", icon: "💼" },
  email:         { color: "#8B5CF6", icon: "✉️" },
  whatsapp:      { color: "#25D366", icon: "💬" },
  site_organico: { color: "#10B981", icon: "🌐" },
  indicacao:     { color: "#F59E0B", icon: "🤝" },
};

/** Garante que existem tags de "Origem: <Canal>" e "Campanha: <Nome>"; retorna ids. */
export function ensureCampaignTags(canalId: string, canalLabel: string, campaignName: string): string[] {
  const tags = getTags();
  const ids: string[] = [];

  // Origem (canal)
  const originTagId = `tag-origin-${canalId}`;
  if (!tags.find((t) => t.id === originTagId)) {
    const meta = ORIGIN_COLORS[canalId] ?? { color: "#64748B", icon: "🏷️" };
    tags.push({ id: originTagId, name: `Origem: ${canalLabel}`, color: meta.color, icon: meta.icon });
  }
  ids.push(originTagId);

  // Campanha (nome) — slug determinístico
  const campSlug = campaignName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const campTagId = `tag-camp-${campSlug}`;
  if (!tags.find((t) => t.id === campTagId)) {
    tags.push({ id: campTagId, name: `Campanha: ${campaignName}`, color: "#6366F1", icon: "📣" });
  }
  ids.push(campTagId);

  saveTags(tags);
  return ids;
}

/** Aplica tags ao lead (idempotente). */
export function applyTagsToLead(leadId: string, tagIds: string[]) {
  const assignments = getLeadTags();
  const current = new Set(assignments[leadId] ?? []);
  tagIds.forEach((id) => current.add(id));
  assignments[leadId] = Array.from(current);
  saveLeadTags(assignments);
}
