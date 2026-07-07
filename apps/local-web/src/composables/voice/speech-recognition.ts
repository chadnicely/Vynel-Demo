// The browser command STT — the Web Speech API (Chrome/Edge → Google's
// recognizer). This is the accurate half of the hybrid: the daemon's local
// Moonshine model only ever hears the wake phrase; once the Jarvis view owns
// the session, commands are transcribed HERE with interim results + Google's
// own endpointing (a non-continuous recognition finalizes on a natural pause).
//
// lib.dom ships no SpeechRecognition types, so the minimal surface we use is
// declared locally — no runtime dependency, no @types package.

interface WebSpeechAlternative {
  readonly transcript: string;
}

interface WebSpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: WebSpeechAlternative;
}

interface WebSpeechResultList {
  readonly length: number;
  readonly [index: number]: WebSpeechResult;
}

interface WebSpeechResultEvent {
  readonly results: WebSpeechResultList;
}

interface WebSpeechErrorEvent {
  readonly error: string;
}

interface WebSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: WebSpeechResultEvent) => void) | null;
  onerror: ((event: WebSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type WebSpeechRecognitionConstructor = new () => WebSpeechRecognition;

function resolveRecognitionConstructor(): WebSpeechRecognitionConstructor | null {
  const speechWindow = window as unknown as {
    SpeechRecognition?: WebSpeechRecognitionConstructor;
    webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

/** False in browsers without Web Speech (e.g. Firefox) — the overlay explains
 *  instead of silently failing to hear. */
export function isWebSpeechAvailable(): boolean {
  return resolveRecognitionConstructor() !== null;
}

export interface CommandRecognizer {
  /**
   * Listen for ONE command. Interim transcripts stream to `onInterim` for the
   * live caption; resolves with the final transcript, or null when the capture
   * ended without speech (silence / aborted). Rejects only on a mic-permission
   * failure — that needs a user-visible explanation, not a retry.
   */
  capture(onInterim: (transcript: string) => void): Promise<string | null>;
  /** Cancel an in-flight capture (its promise resolves null). */
  abort(): void;
}

export function createCommandRecognizer(lang = "en-US"): CommandRecognizer {
  const RecognitionConstructor = resolveRecognitionConstructor();
  if (RecognitionConstructor === null) {
    throw new Error(
      "Web Speech recognition is not available in this browser — use Chrome or Edge for the voice overlay.",
    );
  }

  let active: WebSpeechRecognition | null = null;

  return {
    capture(onInterim: (transcript: string) => void): Promise<string | null> {
      // A fresh instance per capture — Chrome's recognizer is unreliable when
      // restarted on the same object after stop/error.
      const recognition = new RecognitionConstructor();
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;
      active = recognition;

      return new Promise<string | null>((resolve, reject) => {
        let finalTranscript = "";
        let permissionError: Error | null = null;

        recognition.onresult = (event) => {
          let transcript = "";
          for (let i = 0; i < event.results.length; i += 1) {
            const result = event.results[i]!;
            transcript += result[0]?.transcript ?? "";
            if (result.isFinal) finalTranscript = transcript;
          }
          if (transcript) onInterim(transcript);
        };
        recognition.onerror = (event) => {
          // 'no-speech'/'aborted' are normal capture outcomes (resolved null via
          // onend); a denied mic is the one failure the user must act on.
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            permissionError = new Error(
              "Microphone access was denied — allow the mic for this site to use voice.",
            );
          }
        };
        recognition.onend = () => {
          if (active === recognition) active = null;
          if (permissionError) reject(permissionError);
          else resolve(finalTranscript.trim() || null);
        };
        recognition.start();
      });
    },
    abort(): void {
      active?.abort();
      active = null;
    },
  };
}
