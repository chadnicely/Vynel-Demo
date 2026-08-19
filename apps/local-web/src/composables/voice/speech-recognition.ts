// The browser command STT — the Web Speech API (Chrome/Edge → Google's
// recognizer). This is the accurate half of the hybrid: the daemon's local
// Moonshine model only ever hears the wake phrase; once the Jarvis view owns
// the session, commands are transcribed HERE with interim results + Google's
// own endpointing (a non-continuous recognition finalizes on a natural pause).
//
// ECHO, WHO COVERS WHAT (voice-realtime VR2 — the mic stays open while the
// browser plays the reply): the recognizer owns its own microphone capture and
// exposes NO audio constraints — there is no getUserMedia of ours to set
// `echoCancellation: true` on — so acoustic echo cancellation against the
// browser's own playback is the browser's capture pipeline's to apply (the
// belt). What that lets through — a speaker near the mic, a leaky AEC — is
// caught by the shared spoken-echo filter in voice-command-session.ts (the
// braces): a transcript that sits inside the reply being played is our own
// voice, never the user.
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
  /** Finalize the current speech and end (fires a final result then onend). */
  stop(): void;
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

// How long a pause counts as "done speaking" before the transcript is finalized.
// The balance point (live-tuned with Chad): long enough that a think-and-continue
// pause doesn't cut the command, short enough that every exchange doesn't drag —
// 5000 felt broken, anything under 3000 clipped mid-thought speech.
const DEFAULT_ENDPOINT_SILENCE_MS = 3000;

export function createCommandRecognizer(
  lang = "en-US",
  endpointSilenceMs = DEFAULT_ENDPOINT_SILENCE_MS,
): CommandRecognizer {
  const RecognitionConstructor = resolveRecognitionConstructor();
  if (RecognitionConstructor === null) {
    throw new Error(
      "Web Speech recognition is not available in this browser — use Chrome or Edge for the voice overlay.",
    );
  }

  // The current capture's abort hook — abort() calls it so it can flip the
  // capture's own `aborted` flag (which lives in the promise closure).
  let cancelActive: (() => void) | null = null;

  return {
    capture(onInterim: (transcript: string) => void): Promise<string | null> {
      return new Promise<string | null>((resolve, reject) => {
        // Text finalized across sub-sessions — the recognizer auto-ends on its
        // own endpointing; we fold each session's result in and keep listening
        // until WE decide the user is done (endpointSilenceMs of true silence).
        let committed = "";
        let permissionError: Error | null = null;
        let aborted = false;
        let finalizing = false; // our endpoint fired — stop for good
        let recognition: WebSpeechRecognition | null = null;
        let endpointTimer: ReturnType<typeof setTimeout> | null = null;

        const clearEndpoint = (): void => {
          if (endpointTimer !== null) {
            clearTimeout(endpointTimer);
            endpointTimer = null;
          }
        };
        // Reset on every result so a mid-sentence pause keeps listening; when the
        // user is truly silent this long, stop and resolve.
        const restartEndpoint = (): void => {
          clearEndpoint();
          endpointTimer = setTimeout(() => {
            endpointTimer = null;
            finalizing = true;
            try {
              recognition?.stop();
            } catch {
              /* already stopped — onend handles it */
            }
          }, endpointSilenceMs);
        };

        const finish = (): void => {
          clearEndpoint();
          cancelActive = null;
          if (permissionError) reject(permissionError);
          else resolve(committed.trim() || null);
        };

        const startSession = (): void => {
          // A fresh instance per sub-session — Chrome is unreliable restarting the
          // same object after end.
          const rec = new RecognitionConstructor();
          rec.lang = lang;
          rec.interimResults = true;
          rec.continuous = true;
          rec.maxAlternatives = 1;
          recognition = rec;
          let sessionText = "";

          rec.onresult = (event) => {
            let full = "";
            for (let i = 0; i < event.results.length; i += 1) {
              full += event.results[i]?.[0]?.transcript ?? "";
            }
            sessionText = full;
            const combined = `${committed} ${full}`.trim();
            if (combined) onInterim(combined);
            restartEndpoint();
          };
          rec.onerror = (event) => {
            if (event.error === "not-allowed" || event.error === "service-not-allowed") {
              permissionError = new Error(
                "Microphone access was denied — allow the mic for this site to use voice.",
              );
            }
          };
          rec.onend = () => {
            if (sessionText) committed = `${committed} ${sessionText}`.trim();
            // Keep listening across the recognizer's own auto-ends until the user
            // is really done — UNLESS we're finalizing, aborted, errored, or no
            // speech was ever heard (plain silence → resolve null).
            if (finalizing || aborted || permissionError || committed === "") {
              finish();
              return;
            }
            startSession();
          };
          rec.start();
        };

        cancelActive = () => {
          aborted = true;
          clearEndpoint();
          try {
            recognition?.abort();
          } catch {
            /* onend resolves */
          }
        };
        startSession();
      });
    },
    abort(): void {
      cancelActive?.();
      cancelActive = null;
    },
  };
}
