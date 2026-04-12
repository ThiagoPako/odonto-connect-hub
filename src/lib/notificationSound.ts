/**
 * Notification sound using Web Audio API — no external files needed.
 * Plays a short pleasant "ding" tone.
 */

const SOUND_ENABLED_KEY = "odonto_notification_sound";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const val = localStorage.getItem(SOUND_ENABLED_KEY);
  return val !== "false"; // enabled by default
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
}

export function playNotificationSound() {
  if (!isSoundEnabled()) return;

  try {
    const ctx = getAudioContext();

    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // First tone (higher pitch)
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

    // Second tone (slightly higher, delayed)
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
  } catch {
    // Silently fail if audio not available
  }
}

/**
 * Urgent recovery sound — triple ascending ding for high-priority lead returns
 */
export function playRecoverySound() {
  if (!isSoundEnabled()) return;

  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // Three ascending urgent tones
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

    // Repeat after short pause for urgency
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
