// The demo routine's PRE-RECORDED voice. The live voice path synthesizes while
// the user waits — the exact latency the filmed routine exists to avoid — so
// this bank fetches every line's WAV AHEAD of the take and plays straight from
// memory. Preparing is allowed to be slow; playing is not.
//
// It speaks in whatever voice Settings → Voice selected — a cloud provider
// where one is picked, the local model otherwise (see the door below).

export interface DemoAudioBank {
  /** Record every line not already held. True = the whole list is ready.
   *  `onProgress` fires after each line, so a screen can say how far it is
   *  instead of sitting on a spinner for a minute. */
  prepare(
    texts: readonly string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<boolean>;
  /** Seconds this line plays for, or null while unrecorded. */
  durationOf(text: string): number | null;
  isReady(texts: readonly string[]): boolean;
  /** Play one recorded line; resolves when it finishes (or immediately when
   *  the line is missing or the browser refuses — a silent beat, never a
   *  wedged routine). */
  play(text: string): Promise<void>;
  /** Cut whatever is playing. */
  stop(): void;
}

interface RecordedLine {
  readonly wav: Blob;
  readonly seconds: number;
}

// WHICH VOICE (Chad, 2026-08-28): the take must be spoken in the voice the
// user actually picked in Settings → Voice. When that is a cloud provider
// (ElevenLabs), the audio comes from the api's provider door; the daemon's own
// `/voice/synthesize` only ever speaks the LOCAL model and would quietly film
// a whole reel in the wrong voice.
//
// The provider door answers 409 when local is the chosen source, so the first
// line settles which door this session uses and the rest go straight there —
// no 409 per line, and a provider that falls over mid-run drops back to local
// rather than leaving the take silent.
import { announceSpokenSentence } from "../composables/voice/spoken-audio-player.js";

type VoiceDoor = "unknown" | "cloud" | "local";

const PROVIDER_URL = "/api/voice/provider-synthesize";
const LOCAL_URL = "/voice/synthesize";

async function postForWav(url: string, text: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    return null;
  }
}

/** Read the WAV's play length off an audio element — the runtime badge and the
 *  routine's pacing both come from real audio, never a words-per-minute guess. */
async function measureSeconds(wav: Blob): Promise<number> {
  const url = URL.createObjectURL(wav);
  try {
    return await new Promise<number>((resolve) => {
      const probe = new Audio(url);
      probe.onloadedmetadata = () =>
        resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
      probe.onerror = () => resolve(0);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createDemoAudioBank(): DemoAudioBank {
  const recorded = new Map<string, RecordedLine>();
  let playing: HTMLAudioElement | null = null;
  let resolvePlaying: (() => void) | null = null;
  let door: VoiceDoor = "unknown";

  async function fetchWav(text: string): Promise<Blob | null> {
    if (door !== "local") {
      const cloud = await postForWav(PROVIDER_URL, text);
      if (cloud !== null && cloud.ok) {
        door = "cloud";
        return await cloud.blob();
      }
      // 409 = the user picked the local voice; anything else = the provider is
      // unreachable or refused. Either way local speaks the rest of the reel.
      if (door === "unknown") door = "local";
    }
    const local = await postForWav(LOCAL_URL, text);
    if (local === null || !local.ok) return null;
    return await local.blob();
  }

  return {
    async prepare(
      texts: readonly string[],
      onProgress?: (done: number, total: number) => void,
    ): Promise<boolean> {
      // Sequential on purpose: the daemon's synth is CPU-bound (the live
      // player's lookahead-of-one rule), and preparing has no deadline.
      let done = 0;
      for (const text of texts) {
        if (!recorded.has(text)) {
          const wav = await fetchWav(text);
          if (wav !== null) recorded.set(text, { wav, seconds: await measureSeconds(wav) });
        }
        done += 1;
        onProgress?.(done, texts.length);
      }
      return texts.every((text) => recorded.has(text));
    },

    durationOf(text: string): number | null {
      return recorded.get(text)?.seconds ?? null;
    },

    isReady(texts: readonly string[]): boolean {
      return texts.every((text) => recorded.has(text));
    },

    async play(text: string): Promise<void> {
      let line = recorded.get(text);
      if (line === undefined) {
        // Not recorded yet — synthesize it NOW rather than doing nothing. A
        // play button that silently no-ops reads as a broken app (Chad,
        // 2026-08-28: "the icon doesn't even work"); a second's wait does not.
        const wav = await fetchWav(text);
        if (wav === null) return;
        line = { wav, seconds: await measureSeconds(wav) };
        recorded.set(text, line);
      }
      this.stop();
      // The room mouths the line: the orb's spike and its waveform ride this
      // announcement, and a pre-recorded take makes none of its own.
      announceSpokenSentence(text);
      const url = URL.createObjectURL(line.wav);
      const audio = new Audio(url);
      try {
        await new Promise<void>((resolve) => {
          resolvePlaying = resolve;
          playing = audio;
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
      } finally {
        // Only OUR pair: an overlapping play() has already installed its own
        // audio by the time this finally runs (stop() resolves us as a
        // microtask), and nulling the newer pair would break stop() for the
        // rest of the take.
        if (playing === audio) {
          resolvePlaying = null;
          playing = null;
        }
        URL.revokeObjectURL(url);
      }
    },

    stop(): void {
      playing?.pause();
      playing = null;
      resolvePlaying?.();
      resolvePlaying = null;
    },
  };
}
