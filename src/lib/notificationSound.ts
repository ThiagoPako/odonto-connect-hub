/**
 * Notification sound using Web Audio API — no external files needed.
 * Supports multiple sound styles: ding, beep, chime.
 */

const SOUND_ENABLED_KEY = "odonto_notification_sound";
const RECOVERY_SOUND_KEY = "odonto_recovery_sound";
const SOUND_TYPE_KEY = "odonto_sound_type";
const SOUND_VOLUME_KEY = "odonto_sound_volume";

export type SoundType = "ding" | "beep" | "chime";

export const SOUND_OPTIONS: { value: SoundType; label: string }[] = [
  { value: "ding", label: "Ding" },
  { value: "beep", label: "Beep" },
  { value: "chime", label: "Chime" },
];

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = getVolume();
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

function getMasterGain(): GainNode {
  getAudioContext();
  return masterGain!;
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const val = localStorage.getItem(SOUND_ENABLED_KEY);
  return val !== "false";
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
}

export function isRecoverySoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const val = localStorage.getItem(RECOVERY_SOUND_KEY);
  return val !== "false";
}

export function setRecoverySoundEnabled(enabled: boolean): void {
  localStorage.setItem(RECOVERY_SOUND_KEY, String(enabled));
}

export function getSoundType(): SoundType {
  if (typeof window === "undefined") return "ding";
  const val = localStorage.getItem(SOUND_TYPE_KEY);
  if (val === "beep" || val === "chime") return val;
  return "ding";
}

export function setSoundType(type: SoundType): void {
  localStorage.setItem(SOUND_TYPE_KEY, type);
}

/** Volume 0-100, stored as percentage */
export function getVolume(): number {
  if (typeof window === "undefined") return 70;
  const val = localStorage.getItem(SOUND_VOLUME_KEY);
  if (val === null) return 70;
  const n = parseInt(val, 10);
  return isNaN(n) ? 70 : Math.max(0, Math.min(100, n));
}

export function setVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(100, volume));
  localStorage.setItem(SOUND_VOLUME_KEY, String(clamped));
  // Update live master gain if already created
  if (masterGain) {
    masterGain.gain.value = clamped / 100;
  }
}

function playDing(ctx: AudioContext) {
  const now = ctx.currentTime;
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(880, now);
  gain1.gain.setValueAtTime(0.15, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.3);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(1174.66, now + 0.12);
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.setValueAtTime(0.12, now + 0.12);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.12);
  osc2.stop(now + 0.45);
}

function playBeep(ctx: AudioContext) {
  const now = ctx.currentTime;
  // Short punchy square-wave beep
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(1000, now);
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.15);

  // Second beep slightly higher
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "square";
  osc2.frequency.setValueAtTime(1200, now + 0.18);
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.setValueAtTime(0.1, now + 0.18);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.33);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.18);
  osc2.stop(now + 0.33);
}

function playChime(ctx: AudioContext) {
  const now = ctx.currentTime;
  // Soft melodic three-note chime (C5-E5-G5)
  const notes = [
    { freq: 523.25, start: 0, vol: 0.12 },
    { freq: 659.25, start: 0.15, vol: 0.1 },
    { freq: 783.99, start: 0.3, vol: 0.08 },
  ];

  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(note.freq, now + note.start);
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(note.vol, now + note.start);
    gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + note.start);
    osc.stop(now + note.start + 0.4);
  }
}

const soundPlayers: Record<SoundType, (ctx: AudioContext) => void> = {
  ding: playDing,
  beep: playBeep,
  chime: playChime,
};

export function playNotificationSound() {
  if (!isSoundEnabled()) return;

  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();
    soundPlayers[getSoundType()](ctx);
  } catch {
    // Silently fail if audio not available
  }
}

/** Preview a specific sound type without checking enabled state */
export function previewSound(type: SoundType) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();
    soundPlayers[type](ctx);
  } catch {
    // Silently fail
  }
}

/**
 * Urgent recovery sound — triple ascending ding for high-priority lead returns
 */
export function playRecoverySound() {
  if (!isRecoverySoundEnabled()) return;

  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    const now = ctx.currentTime;
    const notes = [
      { freq: 880, start: 0, end: 0.2 },
      { freq: 1108.73, start: 0.15, end: 0.35 },
      { freq: 1318.51, start: 0.3, end: 0.55 },
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, now + note.start);
      gain.gain.setValueAtTime(0.2, now + note.start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.end);
    }

    setTimeout(() => {
      try {
        const now2 = ctx.currentTime;
        for (const note of notes) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(note.freq, now2 + note.start);
          gain.gain.setValueAtTime(0.18, now2 + note.start);
          gain.gain.exponentialRampToValueAtTime(0.001, now2 + note.end);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now2 + note.start);
          osc.stop(now2 + note.end);
        }
      } catch { /* ignore */ }
    }, 700);
  } catch {
    // Silently fail if audio not available
  }
}
