// Play a spoken reply IN THE BROWSER — the reliable audio path. The daemon's own
// speaker can't play while the overlay window holds the audio device (Windows
// device contention), so when an overlay is the active surface, IT plays the
// voice: fetch the daemon's Kokoro synthesis (one voice, `/voice/synthesize`
// proxies to the daemon) and play the WAV. Bonus: the browser's echo cancellation
// covers its own output, so the Web Speech mic never hears the reply.

export interface SpokenAudioPlayer {
  /** Synthesize + play `text`; resolves when playback finished (or was cancelled). */
  play(text: string): Promise<void>;
  /** Stop playback and drop anything in flight. */
  cancel(): void;
}

export function createSpokenAudioPlayer(): SpokenAudioPlayer {
  let cancelled = false;
  let playing: HTMLAudioElement | null = null;
  let abort: AbortController | null = null;

  return {
    async play(text: string): Promise<void> {
      cancelled = false;
      abort = new AbortController();
      let wav: Blob;
      try {
        const response = await fetch("/voice/synthesize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: abort.signal,
        });
        if (!response.ok) return; // daemon down / synth failed — stay silent, don't throw
        wav = await response.blob();
      } catch {
        return; // aborted or unreachable — the caption already showed the words
      }
      if (cancelled) return;

      const url = URL.createObjectURL(wav);
      try {
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          playing = audio;
          audio.onended = () => resolve();
          audio.onerror = () => resolve(); // an unplayable blob must not hang the turn
          audio.play().catch(() => resolve());
        });
      } finally {
        playing = null;
        URL.revokeObjectURL(url);
      }
    },
    cancel(): void {
      cancelled = true;
      abort?.abort();
      playing?.pause();
      playing = null;
    },
  };
}
