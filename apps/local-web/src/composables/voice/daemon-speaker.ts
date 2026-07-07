import type { SentenceSpeaker } from "./speech-synthesis.js";

// The overlay's preferred voice: the daemon's own TTS (Kokoro) — one voice
// whether the daemon answers natively or the overlay session speaks. Each
// sentence is synthesized by POST /voice/synthesize (WAV) and played with an
// Audio element. A failure BEFORE anything was heard (daemon down, synth
// error, undecodable blob) falls back to the injected speaker
// (speechSynthesis) for THAT sentence, so a reply never goes silent — but
// never after partial playback, which would double-speak it.

export function createDaemonSpeaker(fallback: SentenceSpeaker): SentenceSpeaker {
  let cancelled = false;
  let playing: HTMLAudioElement | null = null;
  let abort: AbortController | null = null;
  // cancel() must settle an in-flight playback promise — pause() fires none of
  // the audio events, and a stranded await here would hang the whole session.
  let settlePlayback: (() => void) | null = null;

  return {
    async speak(text: string): Promise<void> {
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
        if (!response.ok) throw new Error(`synthesize failed (${response.status})`);
        wav = await response.blob();
      } catch {
        if (cancelled) return;
        return fallback.speak(text);
      }
      if (cancelled) return;

      const url = URL.createObjectURL(wav);
      let failedBeforeStart = false;
      try {
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          playing = audio;
          settlePlayback = resolve;
          const failPlayback = () => {
            failedBeforeStart = !cancelled && audio.currentTime === 0;
            resolve();
          };
          audio.onended = () => resolve();
          audio.onerror = failPlayback;
          audio.play().catch(failPlayback);
        });
      } finally {
        settlePlayback = null;
        playing = null;
        URL.revokeObjectURL(url);
      }
      if (failedBeforeStart) return fallback.speak(text);
    },
    cancel(): void {
      cancelled = true;
      abort?.abort();
      playing?.pause();
      playing = null;
      settlePlayback?.();
      settlePlayback = null;
      fallback.cancel();
    },
  };
}
