/**
 * Sync notification preferences with VPS server
 */
import { VPS_API_BASE, getAuthHeaders } from "@/lib/vpsApi";
import {
  isSoundEnabled, setSoundEnabled,
  isRecoverySoundEnabled, setRecoverySoundEnabled,
  getSoundType, setSoundType,
  getVolume, setVolume,
  type SoundType,
} from "@/lib/notificationSound";
import { isPushEnabled, setPushEnabled } from "@/lib/browserNotification";

export interface NotificationPreferences {
  sound_enabled: boolean;
  sound_type: SoundType;
  sound_volume: number;
  recovery_sound_enabled: boolean;
  push_enabled: boolean;
}

/** Fetch prefs from server, merge into localStorage, return merged values */
export async function fetchPreferences(): Promise<NotificationPreferences> {
  try {
    const res = await fetch(`${VPS_API_BASE}/user/preferences`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();

    // Apply server values to localStorage
    setSoundEnabled(data.sound_enabled);
    setSoundType(data.sound_type || "ding");
    setVolume(data.sound_volume ?? 70);
    setRecoverySoundEnabled(data.recovery_sound_enabled);
    setPushEnabled(data.push_enabled);

    return {
      sound_enabled: data.sound_enabled,
      sound_type: data.sound_type || "ding",
      sound_volume: data.sound_volume ?? 70,
      recovery_sound_enabled: data.recovery_sound_enabled,
      push_enabled: data.push_enabled,
    };
  } catch {
    // Fallback to localStorage values
    return {
      sound_enabled: isSoundEnabled(),
      sound_type: getSoundType(),
      sound_volume: getVolume(),
      recovery_sound_enabled: isRecoverySoundEnabled(),
      push_enabled: isPushEnabled(),
    };
  }
}

/** Save prefs to server (fire-and-forget) */
export function savePreferences(prefs: NotificationPreferences): void {
  fetch(`${VPS_API_BASE}/user/preferences`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(prefs),
  }).catch(() => {
    // Silently fail — localStorage already has the values
  });
}
