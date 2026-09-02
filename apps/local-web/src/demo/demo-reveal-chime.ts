// THE ROOM COMING ALIVE (Chad, 2026-08-30; "I didn't hear volume!" 09-01).
//
// The sound is a trailer hit: a noise riser, a transient crack, a sub boom
// driven through a soft clipper so its weight survives a laptop speaker, and
// a convolution tail for space. Chosen off a bench of five.
//
// WHY IT RENDERS OFFLINE. A take films in a tab he never clicks — the film
// slate opens, he talks, the room answers. Chrome refuses to START a live
// Web Audio context in a tab with no user gesture, so the first build of this
// played into a suspended context: a chime, delivered to nobody. The take's
// recorded lines were audible the whole time, because an <audio> element on
// this origin is allowed to play. So the chime goes through the same door:
// rendered in an OfflineAudioContext (which needs no permission at all),
// encoded as a WAV, and played like any other recorded line.
//
// Rendered once per session, then reused — it is the same sound every time.

/** How long the gesture runs on screen. The tail rings on beneath the first
 *  spoken line, far too quiet by then to fight the voice. */
export const REVEAL_MS = 1100;

/** Where the impact lands. Everything before it is the run-up. */
const IMPACT_S = 0.85;
const TAIL_S = 2.0;
const RENDER_S = IMPACT_S + TAIL_S + 0.6;
const SAMPLE_RATE = 44100;

type OfflineCtor = new (
  channels: number,
  frames: number,
  sampleRate: number,
) => OfflineAudioContext;

function resolveOffline(): OfflineCtor | null {
  const scope = globalThis as unknown as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  return scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext ?? null;
}

function noiseBuffer(context: BaseAudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, frames, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** A hall, built rather than downloaded: noise under an exponential decay. */
function impulseResponse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = noiseBuffer(context, seconds);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (data[i] ?? 0) * (1 - i / data.length) ** 2.6;
    }
  }
  return buffer;
}

/** Soft clipping — drives the sub into harmonics a small speaker can carry. */
function softClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const points = 1024;
  const curve = new Float32Array(new ArrayBuffer(points * 4));
  for (let i = 0; i < points; i += 1) {
    const x = (i * 2) / points - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/** The trailer hit, built into any context — offline here; the graph does not
 *  care where it renders. */
function buildHit(context: BaseAudioContext, destination: AudioNode): void {
  const now = context.currentTime;
  const impactAt = now + IMPACT_S;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  limiter.connect(destination);

  const master = context.createGain();
  master.gain.value = 1;
  master.connect(limiter);

  const hall = context.createConvolver();
  hall.buffer = impulseResponse(context, TAIL_S);
  const wet = context.createGain();
  wet.gain.value = 0.42;
  hall.connect(wet).connect(master);

  const send = (node: AudioNode, amount: number): void => {
    const tap = context.createGain();
    tap.gain.value = amount;
    node.connect(tap).connect(hall);
  };

  // THE RISER.
  const riser = context.createBufferSource();
  riser.buffer = noiseBuffer(context, IMPACT_S + 0.1);
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(200, now);
  band.frequency.exponentialRampToValueAtTime(9000, impactAt);
  const riserGain = context.createGain();
  riserGain.gain.setValueAtTime(0.0001, now);
  riserGain.gain.exponentialRampToValueAtTime(0.42, now + IMPACT_S * 0.92);
  // The sliver of silence before a hit is what makes the hit feel big.
  riserGain.gain.exponentialRampToValueAtTime(0.0001, impactAt + 0.05);
  riser.connect(band).connect(riserGain).connect(master);
  send(riserGain, 0.35);

  // THE CRACK.
  const crack = context.createBufferSource();
  crack.buffer = noiseBuffer(context, 0.14);
  const crackShape = context.createBiquadFilter();
  crackShape.type = "highpass";
  crackShape.frequency.value = 1600;
  const crackGain = context.createGain();
  crackGain.gain.setValueAtTime(0.0001, impactAt);
  crackGain.gain.exponentialRampToValueAtTime(0.55, impactAt + 0.004);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, impactAt + 0.13);
  crack.connect(crackShape).connect(crackGain).connect(master);
  send(crackGain, 0.6);

  // THE BOOM.
  const drive = context.createWaveShaper();
  drive.curve = softClipCurve(22);
  drive.oversample = "4x";
  const boomGain = context.createGain();
  boomGain.gain.setValueAtTime(0.0001, impactAt);
  boomGain.gain.exponentialRampToValueAtTime(1, impactAt + 0.02);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, impactAt + 1.5);
  drive.connect(boomGain).connect(master);
  send(boomGain, 0.45);

  for (const [from, to, level] of [
    [66, 26, 1],
    // A fifth above, quieter: pitch for speakers that cannot carry 26Hz.
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
    sub.stop(impactAt + 1.6);
  }

  riser.start(now);
  crack.start(impactAt);
}

/** PCM16 WAV — the least clever encoding there is, and the one every browser
 *  plays through an <audio> element without asking questions. */
function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(
        -1,
        Math.min(1, buffer.getChannelData(channel)[frame] ?? 0),
      );
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([wav], { type: "audio/wav" });
}

/** Rendered once, kept for the session. */
let renderedUrl: string | null = null;
let rendering: Promise<string | null> | null = null;

async function renderOnce(): Promise<string | null> {
  if (renderedUrl !== null) return renderedUrl;
  if (rendering !== null) return rendering;
  const Offline = resolveOffline();
  if (Offline === null) return null;
  rendering = (async () => {
    try {
      const context = new Offline(2, Math.floor(SAMPLE_RATE * RENDER_S), SAMPLE_RATE);
      buildHit(context, context.destination);
      const rendered = await context.startRendering();
      renderedUrl = URL.createObjectURL(encodeWav(rendered));
      return renderedUrl;
    } catch {
      return null;
    } finally {
      rendering = null;
    }
  })();
  return rendering;
}

/** Warm the render ahead of the moment — staging a take is the right time. */
export function prepareRevealChime(): void {
  void renderOnce();
}

/** Play it once. Silent and harmless where there is no audio at all — a room
 *  with no sound must never be a room that fails to open. */
export function playRevealChime(volume = 0.65): void {
  void (async () => {
    try {
      const url = await renderOnce();
      if (url === null) return;
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, volume));
      await audio.play();
    } catch {
      // A machine with no audio, or a browser that refuses: the reveal is
      // still a reveal, just a silent one.
    }
  })();
}
