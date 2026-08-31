// THE ROOM COMING ALIVE (Chad, 2026-08-30: "it should have some kind of
// transition from when it goes from blank to talking... with a sound too that
// is attention getting").
//
// A cut from black to a lit room is the moment the viewer decides whether to
// keep watching, and it was happening in one frame with no sound at all.
//
// Synthesized rather than shipped as a file: a WAV in the bundle is a licence
// to check, a download to wait on, and one more thing to lose. Three voices,
// all Web Audio:
//
//   the swell  — a filtered rise that says something is about to happen
//   the body   — a low sine that lands under it, so it has weight on a laptop
//   the bell   — two partials at the top of the rise, where the light arrives
//
// It ends before the assistant speaks: the reveal introduces the voice, it
// never talks over it.

/** How long the whole gesture runs — the reveal animation matches it. */
export const REVEAL_MS = 900;

const SWELL_FROM_HZ = 180;
const SWELL_TO_HZ = 1250;
/** The bell lands with the light, not with the start of the rise. */
const BELL_AT_S = 0.52;

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContext(): AudioContextConstructor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Play it once. Silent and harmless where there is no audio at all — a room
 *  with no sound must never be a room that fails to open. */
export function playRevealChime(volume = 0.28): void {
  const Ctor = resolveAudioContext();
  if (Ctor === null) return;
  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return;
  }

  const now = context.currentTime;
  const master = context.createGain();
  master.gain.value = volume;
  master.connect(context.destination);

  // ── the swell ──────────────────────────────────────────────────────────
  const swell = context.createOscillator();
  swell.type = "triangle";
  swell.frequency.setValueAtTime(SWELL_FROM_HZ, now);
  swell.frequency.exponentialRampToValueAtTime(SWELL_TO_HZ, now + BELL_AT_S);

  // Opening the filter with the pitch is what makes it read as arriving
  // rather than as a tone that simply got higher.
  const shape = context.createBiquadFilter();
  shape.type = "lowpass";
  shape.frequency.setValueAtTime(400, now);
  shape.frequency.exponentialRampToValueAtTime(6000, now + BELL_AT_S);
  shape.Q.value = 1.2;

  const swellGain = context.createGain();
  swellGain.gain.setValueAtTime(0.0001, now);
  swellGain.gain.exponentialRampToValueAtTime(0.5, now + BELL_AT_S);
  swellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  swell.connect(shape).connect(swellGain).connect(master);

  // ── the body ───────────────────────────────────────────────────────────
  const body = context.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(70, now);
  body.frequency.exponentialRampToValueAtTime(48, now + 0.85);
  const bodyGain = context.createGain();
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.55, now + 0.1);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
  body.connect(bodyGain).connect(master);

  // ── the bell ───────────────────────────────────────────────────────────
  // Two partials a fifth apart: one sine reads as a test tone, two read as an
  // instrument.
  const bellAt = now + BELL_AT_S;
  for (const [hz, level] of [
    [1568, 0.4],
    [2350, 0.16],
  ] as const) {
    const partial = context.createOscillator();
    partial.type = "sine";
    partial.frequency.value = hz;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, bellAt);
    gain.gain.exponentialRampToValueAtTime(level, bellAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, bellAt + 0.75);
    partial.connect(gain).connect(master);
    partial.start(bellAt);
    partial.stop(bellAt + 0.8);
  }

  swell.start(now);
  body.start(now);
  swell.stop(now + 0.95);
  body.stop(now + 0.9);

  // Let the tail ring out, then give the device its audio hardware back.
  window.setTimeout(() => void context.close().catch(() => {}), 1600);
}
