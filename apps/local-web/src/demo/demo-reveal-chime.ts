// THE ROOM COMING ALIVE (Chad, 2026-08-30). The cut from black to a lit room
// is the moment a viewer decides whether to keep watching, and it happened in
// one frame with no sound at all.
//
// The first attempt was a swell and a bell, and he was right that it was weak.
// A trailer hit is not a louder tone — it is four things a tone does not have:
//
//   THE RISER    filtered noise climbing for a second. Noise, not pitch, is
//                what reads as air moving, and it is the run-up that makes the
//                hit land rather than merely start.
//   THE CRACK    a few milliseconds of bright transient AT the impact. This is
//                the difference between a thump and a HIT.
//   THE BOOM     a sub falling 66Hz -> 26Hz through a soft clipper. The
//                clipping is the point: it puts harmonics up where a laptop
//                speaker actually lives, so the weight survives playback on a
//                machine that cannot reproduce 26Hz at all.
//   THE TAIL     a real convolution reverb from a generated impulse. Space is
//                what separates a film sound from a UI beep, and it is the one
//                thing a longer release cannot fake.
//
// Synthesized rather than shipped: a WAV in the bundle is a licence to check,
// a download to wait on, and one more thing to lose.
//
// Picked from a bench of five (trailer hit, braaam, power-on, swell, breath)
// — this is the trailer hit at the larger of two sizes.

/** How long the gesture runs on screen. The tail rings on beneath the first
 *  spoken line, which is how film sounds and is far too quiet by then to
 *  fight the voice. */
export const REVEAL_MS = 1100;

/** Where the impact lands. Everything before it is the run-up. */
const IMPACT_S = 0.85;
/** How long the hall rings. */
const TAIL_S = 3.4;

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContext(): AudioContextConstructor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Noise, in stereo where the context offers two channels — a mono riser sits
 *  in the middle of the head and sounds small. */
function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const channels = Math.min(2, context.destination.channelCount || 1);
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(channels, frames, context.sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** A hall, built rather than downloaded: noise under an exponential decay is
 *  the standard cheap impulse and is indistinguishable at this length. */
function impulseResponse(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = noiseBuffer(context, seconds);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (data[i] ?? 0) * (1 - i / data.length) ** 2.6;
    }
  }
  return buffer;
}

/** Soft clipping — see THE BOOM above. */
function softClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const points = 1024;
  const curve = new Float32Array(new ArrayBuffer(points * 4));
  for (let i = 0; i < points; i += 1) {
    const x = (i * 2) / points - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/** Play it once. Silent and harmless where there is no audio at all — a room
 *  with no sound must never be a room that fails to open. */
export function playRevealChime(volume = 0.9): void {
  const Ctor = resolveAudioContext();
  if (Ctor === null) return;
  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return;
  }

  const now = context.currentTime;
  const impactAt = now + IMPACT_S;

  // A limiter across the whole thing: this is loud on purpose and must never
  // crackle on the machine it is filmed on.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  limiter.connect(context.destination);

  const master = context.createGain();
  master.gain.value = volume;
  master.connect(limiter);

  const hall = context.createConvolver();
  hall.buffer = impulseResponse(context, TAIL_S);
  const wet = context.createGain();
  wet.gain.value = 0.62;
  hall.connect(wet).connect(master);

  const send = (node: AudioNode, amount: number): void => {
    const tap = context.createGain();
    tap.gain.value = amount;
    node.connect(tap).connect(hall);
  };

  // ── THE RISER ──────────────────────────────────────────────────────────
  const riser = context.createBufferSource();
  riser.buffer = noiseBuffer(context, IMPACT_S + 0.1);
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(200, now);
  band.frequency.exponentialRampToValueAtTime(9000, impactAt);
  const riserGain = context.createGain();
  riserGain.gain.setValueAtTime(0.0001, now);
  riserGain.gain.exponentialRampToValueAtTime(0.7, now + IMPACT_S * 0.92);
  // Cut hard AT the impact: the sliver of silence before a hit is what makes
  // the hit feel big.
  riserGain.gain.exponentialRampToValueAtTime(0.0001, impactAt + 0.05);
  riser.connect(band).connect(riserGain).connect(master);
  send(riserGain, 0.35);

  // ── THE CRACK ──────────────────────────────────────────────────────────
  const crack = context.createBufferSource();
  crack.buffer = noiseBuffer(context, 0.14);
  const crackShape = context.createBiquadFilter();
  crackShape.type = "highpass";
  crackShape.frequency.value = 1600;
  const crackGain = context.createGain();
  crackGain.gain.setValueAtTime(0.0001, impactAt);
  crackGain.gain.exponentialRampToValueAtTime(0.85, impactAt + 0.004);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, impactAt + 0.13);
  crack.connect(crackShape).connect(crackGain).connect(master);
  send(crackGain, 0.6);

  // ── THE BOOM ───────────────────────────────────────────────────────────
  const drive = context.createWaveShaper();
  drive.curve = softClipCurve(22);
  drive.oversample = "4x";
  const boomGain = context.createGain();
  boomGain.gain.setValueAtTime(0.0001, impactAt);
  boomGain.gain.exponentialRampToValueAtTime(1, impactAt + 0.02);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, impactAt + 2.6);
  drive.connect(boomGain).connect(master);
  send(boomGain, 0.45);

  for (const [from, to, level] of [
    [66, 26, 1],
    // A fifth above, quieter: it gives the sub a pitch on speakers that cannot
    // reproduce the fundamental.
    [99, 39, 0.45],
  ] as const) {
    const sub = context.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(from, impactAt);
    sub.frequency.exponentialRampToValueAtTime(to, impactAt + 0.8);
    const gain = context.createGain();
    gain.gain.value = level;
    sub.connect(gain).connect(drive);
    sub.start(impactAt);
    sub.stop(impactAt + 2.7);
  }

  // ── THE SHIMMER ────────────────────────────────────────────────────────
  // The top of the mix opening with the light.
  for (const [hz, level] of [
    [1568, 0.26],
    [2350, 0.13],
    [3136, 0.07],
  ] as const) {
    const partial = context.createOscillator();
    partial.type = "sine";
    partial.frequency.value = hz;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, impactAt);
    gain.gain.exponentialRampToValueAtTime(level, impactAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, impactAt + 1.8);
    partial.connect(gain).connect(master);
    send(gain, 0.85);
    partial.start(impactAt);
    partial.stop(impactAt + 1.9);
  }

  riser.start(now);
  crack.start(impactAt);

  // Let the hall ring out, then give the device its audio hardware back.
  window.setTimeout(
    () => void context.close().catch(() => {}),
    (IMPACT_S + TAIL_S + 1) * 1000,
  );
}
