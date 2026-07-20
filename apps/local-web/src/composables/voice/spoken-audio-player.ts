import { SpokenSentenceBuffer } from "@vynel/voice";

// Play a spoken reply IN THE BROWSER — the reliable audio path. The daemon's own
// speaker can't play while the overlay window holds the audio device (Windows
// device contention), so when an overlay is the active surface, IT plays the
// voice: fetch the daemon's Kokoro synthesis (one voice, `/voice/synthesize`
// proxies to the daemon) and play the WAV. Bonus: the browser's echo cancellation
// covers its own output, so the Web Speech mic never hears the reply.
//
// The line is split at sentence boundaries and PIPELINED — sentence N+1's WAV is
// fetched while sentence N plays, so first sound waits for one sentence's
// synthesis, not the whole reply's (the native daemon loop's exact behavior).
// Sentence-sizing also keeps each request under the daemon's /synthesize cap.

export interface SpokenAudioPlayer {
  /** Synthesize + play `text`; resolves when playback finished (or was cancelled). */
  play(text: string): Promise<void>;
  /** Stop playback and drop anything in flight. */
  cancel(): void;
}

/** Split a spoken line into orderly sentences (shared boundary rules — never
 *  splits a decimal, always flushes a trailing fragment). */
export function toSpokenSentences(text: string): string[] {
  const buffer = new SpokenSentenceBuffer();
  return [...buffer.push(text), ...buffer.flush()];
}

/** The pipeline: play sentences in order while prefetching the NEXT sentence's
 *  audio during the current one's playback. A failed fetch skips its sentence
 *  (the caption already showed the words); `isCancelled` stops between steps.
 *  Pure over its callbacks — unit-tested with fakes. */
export async function playSentencesPipelined<Wav>(
  sentences: readonly string[],
  fetchWav: (text: string) => Promise<Wav | null>,
  playWav: (wav: Wav) => Promise<void>,
  isCancelled: () => boolean,
): Promise<void> {
  if (sentences.length === 0) return;
  let nextWav = fetchWav(sentences[0]!);
  for (let i = 0; i < sentences.length; i += 1) {
    const wav = await nextWav;
    if (isCancelled()) return;
    if (i + 1 < sentences.length) nextWav = fetchWav(sentences[i + 1]!);
    if (wav !== null) await playWav(wav);
    if (isCancelled()) return;
  }
}

export function createSpokenAudioPlayer(): SpokenAudioPlayer {
  let cancelled = false;
  let playing: HTMLAudioElement | null = null;
  let abort: AbortController | null = null;
  // The in-flight playback's resolver — cancel() must settle it: pause() fires
  // neither onended nor onerror, so without this a cancel mid-playback would
  // hang play() forever (and with it the session loop awaiting it — the
  // deaf-daemon class: done never settles, /session/end never posts).
  let resolvePlaying: (() => void) | null = null;

  async function fetchWav(text: string, signal: AbortSignal): Promise<Blob | null> {
    try {
      const response = await fetch("/voice/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      });
      if (!response.ok) return null; // daemon down / synth failed — stay silent, don't throw
      return await response.blob();
    } catch {
      return null; // aborted or unreachable — the caption already showed the words
    }
  }

  async function playWav(wav: Blob): Promise<void> {
    const url = URL.createObjectURL(wav);
    try {
      await new Promise<void>((resolve) => {
        resolvePlaying = resolve;
        const audio = new Audio(url);
        playing = audio;
        audio.onended = () => resolve();
        audio.onerror = () => resolve(); // an unplayable blob must not hang the turn
        audio.play().catch(() => resolve());
      });
    } finally {
      resolvePlaying = null;
      playing = null;
      URL.revokeObjectURL(url);
    }
  }

  return {
    async play(text: string): Promise<void> {
      cancelled = false;
      abort = new AbortController();
      const signal = abort.signal;
      await playSentencesPipelined(
        toSpokenSentences(text),
        (sentence) => fetchWav(sentence, signal),
        playWav,
        () => cancelled,
      );
    },
    cancel(): void {
      cancelled = true;
      abort?.abort();
      playing?.pause();
      playing = null;
      resolvePlaying?.();
      resolvePlaying = null;
    },
  };
}
