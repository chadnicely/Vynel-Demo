import { SpokenSentenceBuffer } from "@vynel/voice";
import { voiceLatencyTracer } from "./voice-latency-trace.js";

// Play spoken replies IN THE BROWSER — the reliable audio path. The daemon's own
// speaker can't play while the overlay window holds the audio device (Windows
// device contention), so when an overlay is the active surface, IT plays the
// voice: fetch the daemon's Kokoro synthesis (one voice, `/voice/synthesize`
// proxies to the daemon) and play the WAV.
//
// ONE QUEUE, PIPELINED: every `play()` call queues its sentences behind whatever
// is already playing, and the NEXT queued sentence's WAV is fetched while the
// current one plays — so a reply streamed sentence by sentence (voice-realtime
// VR1/VR4) starts sounding after ONE sentence's synthesis and keeps up with
// generation, and a second `play()` never waits for the first to finish its
// synthesis. `cancel()` is the barge-in: it stops the current playback and
// drops everything queued. Sentence-sizing also keeps each request under the
// daemon's /synthesize cap.

export interface SpokenAudioPlayer {
  /** Queue `text` (split into sentences) behind what is playing; resolves when
   *  its last sentence finished playing (or everything was cancelled). */
  play(text: string): Promise<void>;
  /** Stop playback and drop every queued sentence. */
  cancel(): void;
}

/** Split a spoken line into orderly sentences (shared boundary rules — never
 *  splits a decimal, always flushes a trailing fragment). */
export function toSpokenSentences(text: string): string[] {
  const buffer = new SpokenSentenceBuffer();
  return [...buffer.push(text), ...buffer.flush()];
}

/** The I/O a sentence pipeline drives — fakes in tests, fetch + Audio in the browser. */
export interface SentencePipelineIo<Wav> {
  /** Synthesize one sentence; null = skip it (the caption already showed the words). */
  fetchWav(text: string, signal: AbortSignal): Promise<Wav | null>;
  /** Play one WAV; resolves when it ended — or when `stopPlayback` cut it.
   *  `text` is the sentence the WAV speaks, so a playback refusal can name
   *  what was never heard. */
  playWav(wav: Wav, text: string): Promise<void>;
  /** Cut the in-flight playback (its `playWav` must resolve). */
  stopPlayback(): void;
  /** One sentence is STARTING to play — not to synthesize. The Display's orb
   *  spikes on it, so it has to ride the audio, never the queue. */
  onSentenceStart?(text: string): void;
}

export interface SentencePipeline {
  /** Queue sentences in order; resolves once the last one played or was cancelled. */
  enqueue(sentences: readonly string[]): Promise<void>;
  /** Drop the queue, abort in-flight synthesis, cut playback. */
  cancel(): void;
}

interface QueuedSentence<Wav> {
  readonly text: string;
  /** The cancel generation it was queued under — a later generation means a
   *  `cancel()` landed while its WAV was in flight, and it must not play. */
  readonly generation: number;
  wav: Promise<Wav | null> | null;
  settle(): void;
}

/** The pipeline core — pure over its I/O. ONE drain loop serves every
 *  `enqueue()`: it prefetches sentence N+1 while N plays, across call
 *  boundaries, and a `cancel()` mid-await never wedges it (the next enqueue
 *  finds the same loop still running). */
export function createSentencePipeline<Wav>(
  io: SentencePipelineIo<Wav>,
): SentencePipeline {
  let queue: QueuedSentence<Wav>[] = [];
  let generation = 0;
  let abort = new AbortController();
  let draining = false;

  /** `null` = no audio for this sentence. A rejecting fetch is a bug in the io,
   *  but it must read as silence, never as a queue that never settles. */
  const synthesize = (text: string): Promise<Wav | null> =>
    io.fetchWav(text, abort.signal).catch(() => null);

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const current = queue[0]!;
        current.wav ??= synthesize(current.text);
        const next = queue[1];
        if (next !== undefined) next.wav ??= synthesize(next.text);
        const wav = await current.wav;
        // A cancel while the WAV was in flight already settled + dropped it.
        if (current.generation !== generation) continue;
        // A REJECTING playWav must never unwind the loop: every queued sentence
        // is a promise someone awaits (the voice session's turn ends on them),
        // so a throw here would strand the whole reply unsettled. One silent
        // sentence is the cost — the caption already showed the words.
        if (wav !== null) {
          io.onSentenceStart?.(current.text);
          await io.playWav(wav, current.text).catch(() => undefined);
        }
        if (queue[0] === current) {
          queue.shift();
          current.settle();
        }
      }
    } finally {
      draining = false;
      // The loop only ever exits on an EMPTY queue — anything still here means
      // it unwound, and each of those promises has a caller awaiting it.
      const stranded = queue;
      queue = [];
      for (const item of stranded) item.settle();
    }
  }

  return {
    enqueue(sentences: readonly string[]): Promise<void> {
      if (sentences.length === 0) return Promise.resolve();
      const settled = sentences.map(
        (text) =>
          new Promise<void>((resolve) => {
            const item: QueuedSentence<Wav> = {
              text,
              generation,
              wav: null,
              settle: resolve,
            };
            queue.push(item);
            // Lookahead of ONE: a sentence that lands right behind the playing
            // one starts synthesizing now (the drain loop is parked in that
            // playback), anything further back waits its turn — the daemon's
            // synth is CPU-bound, so we never flood it with a whole reply.
            if (queue.length <= 2) item.wav = synthesize(text);
          }),
      );
      void drain();
      return Promise.all(settled).then(() => undefined);
    },
    cancel(): void {
      generation += 1;
      abort.abort();
      abort = new AbortController();
      io.stopPlayback();
      const dropped = queue;
      queue = [];
      for (const item of dropped) item.settle();
    },
  };
}

// Watchers of "the browser is speaking this sentence now". Module-level
// because the player is created deep inside the voice session while the
// surface that reacts to it (the Display's orb) lives somewhere else
// entirely — and one machine has one pair of speakers either way.
const sentenceStartObservers = new Set<(text: string) => void>();

/** Watch each spoken sentence as it STARTS playing. Returns the unsubscribe —
 *  a caller that drops it keeps bumping a surface that is already gone. */
export function observeSpokenSentenceStart(
  observe: (text: string) => void,
): () => void {
  sentenceStartObservers.add(observe);
  return () => {
    sentenceStartObservers.delete(observe);
  };
}

/** Tell those watchers a sentence just started, for audio this player did not
 *  make. The filmed demo plays PRE-RECORDED lines from its own bank, and
 *  without this the orb sat still through a whole take — the room has to mouth
 *  the words whoever synthesized them (Chad, 2026-08-28: "no wave form"). */
export function announceSpokenSentence(text: string): void {
  for (const observe of [...sentenceStartObservers]) observe(text);
}

/** Options for the browser player. */
export interface SpokenAudioPlayerOptions {
  /** The daemon has no speaking model loaded (503 from /voice/synthesize) —
   *  every sentence will be silent until one is downloaded. Reported so the
   *  surface can SAY that instead of just going quiet. Only 503: a transient
   *  500, an abort or an unreachable daemon must not paint a persistent
   *  'no voice model' message. */
  onVoiceUnavailable?: () => void;
  /** The browser REFUSED to start this sentence (autoplay policy — the window
   *  never had a user gesture): zero audio came out, so the line is safe to
   *  hand elsewhere. Only the refusal: a playback cut mid-line (pause on
   *  barge-in rejects `play()` with AbortError) or a broken blob must not
   *  re-speak words that partially sounded. */
  onPlaybackRefused?: (text: string) => void;
}

export function createSpokenAudioPlayer(
  options: SpokenAudioPlayerOptions = {},
): SpokenAudioPlayer {
  let playing: HTMLAudioElement | null = null;
  // The in-flight playback's resolver — stopPlayback() must settle it: pause()
  // fires neither onended nor onerror, so without this a cancel mid-playback
  // would hang play() forever (and with it the session loop awaiting it — the
  // deaf-daemon class: done never settles, /session/end never posts).
  let resolvePlaying: (() => void) | null = null;

  async function fetchWav(
    text: string,
    signal: AbortSignal,
  ): Promise<Blob | null> {
    try {
      const response = await fetch("/voice/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      });
      if (response.status === 503) {
        // The daemon is up but has no voice loaded — a fixable, persistent state.
        options.onVoiceUnavailable?.();
        return null;
      }
      if (!response.ok) return null; // daemon down / synth failed — stay silent, don't throw
      const wav = await response.blob();
      // The first synthesized WAV of the exchange — mark it the moment the
      // bytes are all here, not when it gets its turn at the speaker.
      voiceLatencyTracer.markFirstTts();
      return wav;
    } catch {
      return null; // aborted or unreachable — the caption already showed the words
    }
  }

  async function playWav(wav: Blob, text: string): Promise<void> {
    const url = URL.createObjectURL(wav);
    try {
      await new Promise<void>((resolve) => {
        resolvePlaying = resolve;
        const audio = new Audio(url);
        playing = audio;
        // 'playing' is the first moment sound is actually leaving the
        // machine — the trace's last mark, and the one the user feels.
        audio.onplaying = () => voiceLatencyTracer.markFirstAudible();
        audio.onended = () => resolve();
        audio.onerror = () => resolve(); // an unplayable blob must not hang the turn
        audio.play().catch((error: unknown) => {
          // NotAllowedError = autoplay policy refused; nothing was ever heard.
          // Every other rejection (AbortError from a barge-in's pause, a codec
          // failure) stays silence, exactly as before.
          if ((error as { name?: string } | null)?.name === "NotAllowedError") {
            options.onPlaybackRefused?.(text);
          }
          resolve();
        });
      });
    } finally {
      resolvePlaying = null;
      playing = null;
      URL.revokeObjectURL(url);
    }
  }

  function stopPlayback(): void {
    playing?.pause();
    playing = null;
    resolvePlaying?.();
    resolvePlaying = null;
  }

  const pipeline = createSentencePipeline<Blob>({
    fetchWav,
    playWav,
    stopPlayback,
    onSentenceStart: (text) => {
      for (const observe of [...sentenceStartObservers]) observe(text);
    },
  });

  return {
    play: (text) => pipeline.enqueue(toSpokenSentences(text)),
    cancel: () => pipeline.cancel(),
  };
}
