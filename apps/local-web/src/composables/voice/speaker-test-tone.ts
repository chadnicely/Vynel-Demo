// A short chime for the Devices screen's Test button.
//
// Deliberately self-contained: the spoken player fetches `/voice/synthesize`,
// which proxies to the voice DAEMON — so using it here made "is this the right
// speaker?" depend on the daemon running, a model being downloaded, and a
// network round trip. A speaker test should answer one question only: does
// sound come out of THIS device.

const SAMPLE_RATE = 44_100;
const SECONDS = 0.6;
/** Two notes a fifth apart — a chime rather than a beep, and easy to place in
 *  a room without being startling. */
const NOTES_HZ = [660, 990];
/** Long enough to kill the click at each edge, short enough to stay a chime. */
const FADE_SECONDS = 0.04;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/** A 16-bit mono PCM WAV of the chime. Built by hand because the alternative —
 *  an AudioContext — cannot be routed to a chosen speaker on every browser we
 *  ship to, while an audio element can (setSinkId). */
export function createSpeakerTestWav(): Blob {
  const frames = Math.floor(SAMPLE_RATE * SECONDS);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  writeAscii(view, 8, "WAVEfmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, frames * 2, true);

  const fadeFrames = Math.floor(SAMPLE_RATE * FADE_SECONDS);
  for (let frame = 0; frame < frames; frame += 1) {
    const seconds = frame / SAMPLE_RATE;
    const note = NOTES_HZ[seconds < SECONDS / 2 ? 0 : 1]!;
    const inFade = Math.min(1, frame / fadeFrames);
    const outFade = Math.min(1, (frames - frame) / fadeFrames);
    const amplitude = 0.28 * inFade * outFade;
    const sample = Math.sin(2 * Math.PI * note * seconds) * amplitude;
    view.setInt16(44 + frame * 2, Math.round(sample * 32_767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Play the chime through `deviceId` (undefined = the system default).
 *  Resolves when it has finished, or immediately if it could not play — a
 *  failed test must never hang the button. */
export async function playSpeakerTest(deviceId: string | undefined): Promise<void> {
  const url = URL.createObjectURL(createSpeakerTestWav());
  try {
    const audio = new Audio(url);
    if (deviceId !== undefined) {
      const sinkable = audio as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      // Chromium-only, and it rejects a stale id — either way the default
      // speaker still plays, which is what the user hears today anyway.
      if (typeof sinkable.setSinkId === "function") {
        await sinkable.setSinkId(deviceId).catch(() => undefined);
      }
    }
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
