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
  /** Fill the bank from what earlier sessions recorded, WITHOUT recording
   *  anything. The cache used to be read only inside `prepare`, so on a fresh
   *  page every take read as unrecorded and the queue showed "Ready (0)" over a
   *  disk full of perfectly good audio (Chad, 2026-08-29). Resolves true when
   *  something was restored, so the store knows to re-read the stages. */
  hydrate(texts: readonly string[]): Promise<boolean>;
  /** Stop a recording pass where it stands (Chad, 2026-08-29: "have it where
   *  they can cancel — maybe it's the wrong voice"). Lines already recorded are
   *  KEPT: they are correct for the voice that made them, and re-recording them
   *  after a cancel would punish changing your mind. */
  cancelPrepare(): void;
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
import { readCachedLines, writeCachedLine } from "./demo-audio-cache.js";

type VoiceDoor = "unknown" | "cloud" | "local";

/** Which voice the bank holds. Recorded lines are cached by TEXT, so without
 *  this a voice change left the old audio in place and a take played half in
 *  one voice and half in the other (Chad, 2026-08-28: "its doing 2 voices").
 *  Reading it costs one request per recording pass, not per line. */
async function readVoiceSignature(): Promise<string> {
  try {
    const response = await fetch("/api/users/me/preferences");
    if (!response.ok) return "unknown";
    const p = (await response.json()) as {
      voiceTtsSource?: unknown;
      voiceTtsModelId?: unknown;
      voiceSpeakerId?: unknown;
      voiceTtsProviderVoiceId?: unknown;
    };
    return [
      p.voiceTtsSource,
      p.voiceTtsModelId,
      p.voiceSpeakerId,
      p.voiceTtsProviderVoiceId,
    ].join("|");
  } catch {
    return "unknown";
  }
}

const PROVIDER_URL = "/api/voice/provider-synthesize";
const LOCAL_URL = "/voice/synthesize";

async function postForWav(
  url: string,
  text: string,
  signal?: AbortSignal,
): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch {
    return null; // aborted or unreachable — both mean "no audio this time"
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
  /** The voice every line in `recorded` was spoken in. */
  let bankVoice: string | null = null;
  /** Live while a recording pass runs; aborting it cuts the current line. */
  let preparing: AbortController | null = null;
  let playing: HTMLAudioElement | null = null;
  let resolvePlaying: (() => void) | null = null;
  let door: VoiceDoor = "unknown";

  async function fetchWav(text: string, signal?: AbortSignal): Promise<Blob | null> {
    if (door !== "local") {
      const cloud = await postForWav(PROVIDER_URL, text, signal);
      if (cloud !== null && cloud.ok) {
        door = "cloud";
        return await cloud.blob();
      }
      // 409 = the user picked the local voice; anything else = the provider is
      // unreachable or refused. Either way local speaks the rest of the reel.
      if (door === "unknown") door = "local";
    }
    const local = await postForWav(LOCAL_URL, text, signal);
    if (local === null || !local.ok) return null;
    return await local.blob();
  }

  return {
    async prepare(
      texts: readonly string[],
      onProgress?: (done: number, total: number) => void,
    ): Promise<boolean> {
      // A voice change makes every recorded line stale: the bank keys on text
      // alone, so keeping them would play one take in two voices.
      preparing?.abort();
      const run = new AbortController();
      preparing = run;

      const voice = await readVoiceSignature();
      if (bankVoice !== null && bankVoice !== voice) recorded.clear();
      bankVoice = voice;

      // Lines this voice already spoke in an earlier session. The loop below
      // then finds them present and records only what is genuinely missing.
      for (const [text, line] of await readCachedLines(voice, texts)) {
        if (!recorded.has(text)) recorded.set(text, line);
      }

      // Sequential, and it stays that way. Recording four lines at once was
      // tried on 2026-08-28 and made it WORSE: the daemon's Kokoro is one
      // CPU-bound model, so concurrent requests thrash rather than share — a
      // single line measured 1.2s idle and 36s with four lanes running.
      let done = 0;
      for (const text of texts) {
        if (run.signal.aborted) return false;
        if (!recorded.has(text)) {
          const wav = await fetchWav(text, run.signal);
          if (wav !== null) {
            const line = { wav, seconds: await measureSeconds(wav) };
            recorded.set(text, line);
            // Survives the next reload; a failure here only costs a re-record.
            void writeCachedLine(voice, text, line);
          }
        }
        done += 1;
        onProgress?.(done, texts.length);
      }
      preparing = null;
      return texts.every((text) => recorded.has(text));
    },

    async hydrate(texts: readonly string[]): Promise<boolean> {
      // Nothing to restore means nothing to ask: without this, every store
      // creation fetched the voice signature — including screens with no takes
      // at all (caught by display-view's "no requests on mount" pin).
      if (texts.length === 0) return false;
      const voice = await readVoiceSignature();
      if (bankVoice !== null && bankVoice !== voice) recorded.clear();
      bankVoice = voice;
      let restored = 0;
      for (const [text, line] of await readCachedLines(voice, texts)) {
        if (!recorded.has(text)) {
          recorded.set(text, line);
          restored += 1;
        }
      }
      return restored > 0;
    },

    cancelPrepare(): void {
      preparing?.abort();
      preparing = null;
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
