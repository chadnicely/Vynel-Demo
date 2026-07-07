// The overlay's spoken reply — browser speechSynthesis, sentence by sentence.
// The session machine feeds it complete sentences (SpokenSentenceBuffer), so
// the first audio starts while the brain is still streaming. The daemon's
// Kokoro voice remains the no-browser fallback path; a Kokoro-streamed voice
// for the overlay is a later quality improve behind this same interface.

export interface SentenceSpeaker {
  /** Speak one sentence; resolves when it finished (or was cancelled). */
  speak(text: string): Promise<void>;
  /** Stop mid-sentence and drop anything queued. */
  cancel(): void;
}

/** True when the browser can speak at all. */
export function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Prefer a Google en-US voice (Chrome ships them alongside the OS ones — the
// closest match to the "Google STT" half); otherwise let the browser default.
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.name.includes("Google") && voice.lang.startsWith("en")) ??
    voices.find((voice) => voice.default) ??
    null
  );
}

export function createSentenceSpeaker(): SentenceSpeaker {
  let cancelled = false;

  // Chrome fills getVoices() asynchronously — an early call kicks the load off
  // so the first spoken sentence usually gets the preferred voice already.
  window.speechSynthesis.getVoices();

  return {
    speak(text: string): Promise<void> {
      cancelled = false;
      return new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = pickVoice();
        if (voice) utterance.voice = voice;
        // Cancellation surfaces as an error event — both terminals resolve so
        // the session loop always continues; there is nothing to act on here.
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        if (cancelled) {
          resolve();
          return;
        }
        window.speechSynthesis.speak(utterance);
      });
    },
    cancel(): void {
      cancelled = true;
      window.speechSynthesis.cancel();
    },
  };
}
