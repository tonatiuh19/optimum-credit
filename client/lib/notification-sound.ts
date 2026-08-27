/**
 * Short notification chime (real-state pattern) — synthesized, no assets.
 * Unlocks on first user gesture so browser autoplay policy does not drop SMS chimes.
 */

const STORAGE_KEY = "ofg.notification_sound_muted";
const CHIME_DEBOUNCE_MS = 1800;

let sharedCtx: AudioContext | null = null;
let lastChimeAt = 0;
let pendingChime = false;
let unlockInstalled = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  durationSec: number,
  type: OscillatorType,
  peakGain: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    startAt + Math.max(0.05, durationSec),
  );
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

function emitChimeTones() {
  const ctx = getCtx();
  if (!ctx || ctx.state !== "running") return;
  lastChimeAt = Date.now();
  const t = ctx.currentTime;
  playTone(ctx, 1046.5, t, 0.18, "triangle", 0.18);
  playTone(ctx, 1318.51, t + 0.07, 0.22, "triangle", 0.16);
  playTone(ctx, 1567.98, t + 0.09, 0.28, "sine", 0.08);
}

function tryResumeAndPlayPending() {
  const ctx = getCtx();
  if (!ctx) return;
  void ctx.resume().then(() => {
    if (ctx.state === "running" && pendingChime && !isNotificationSoundMuted()) {
      pendingChime = false;
      emitChimeTones();
    }
  });
}

/** Call once in admin shell — first click/key unlocks AudioContext and replays a queued chime. */
export function installNotificationSoundUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;

  const unlock = () => {
    tryResumeAndPlayPending();
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  };

  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
}

export function isNotificationSoundMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNotificationSoundMuted(muted: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ofg:notification-sound-mute", { detail: { muted } }),
      );
    }
  } catch {
    /* noop */
  }
}

/** Play once; debounced so duplicate Ably subscribers do not double-chime. */
export function playNotificationChime() {
  if (isNotificationSoundMuted()) return;
  const now = Date.now();
  if (now - lastChimeAt < CHIME_DEBOUNCE_MS) return;

  const ctx = getCtx();
  if (!ctx) return;

  if (ctx.state !== "running") {
    pendingChime = true;
    tryResumeAndPlayPending();
    return;
  }

  emitChimeTones();
}

/** User-initiated preview (profile toggle) — skips debounce, still respects mute. */
export function previewNotificationChime() {
  if (isNotificationSoundMuted()) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state !== "running") {
    pendingChime = true;
    tryResumeAndPlayPending();
    return;
  }
  emitChimeTones();
}
