/** Standard DTMF frequency pairs (Hz) for local key feedback. */
const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

export const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;

let ctx: AudioContext | null = null;

/**
 * Short local key tone so staff hear the press (the far end gets the real
 * DTMF from Twilio). Silent no-op where Web Audio is unavailable (tests).
 */
export function playDtmfTone(key: string, ms = 120): void {
  const pair = DTMF[key];
  if (!pair) return;
  try {
    const AC: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) return;
    ctx = ctx ?? new AC();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    const stop = ctx.currentTime + ms / 1000;
    for (const f of pair) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start();
      osc.stop(stop);
    }
  } catch {
    /* audio feedback is best-effort */
  }
}
