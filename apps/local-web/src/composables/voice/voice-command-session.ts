import { SpokenSentenceBuffer } from "@vynel/voice";

// The browser half of the hybrid voice loop — the command session the daemon
// hands off to on wake. Mirrors the daemon's VoiceSessionDriver shape, browser
// idioms: Web Speech STT captures a command (with a live interim transcript),
// the brain answers over the `/root/turn` SSE stream, complete sentences are
// spoken as they form, then it listens for a follow-up. Silence past the idle
// window ends the session (the overlay closes and the daemon takes the mic
// back). Recognition never runs while speaking — the browser echo defense.
//
// Everything is injected so the whole flow is unit-tested with fakes — no Web
// Speech, no network, no speakers.

export type VoiceTurnEvent =
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly message: string };

export type VoiceCommandSessionState =
  | "listening"
  | "thinking"
  | "speaking"
  | "ended";

export interface VoiceCommandSessionView {
  readonly state: VoiceCommandSessionState;
  /** The live interim transcript while listening; the command while answering. */
  readonly transcript: string;
  /** The sentence currently being spoken ('' otherwise). */
  readonly spokenText: string;
}

export interface VoiceCommandSessionDeps {
  /** One command capture — final transcript, or null on silence/abort. */
  captureCommand(onInterim: (transcript: string) => void): Promise<string | null>;
  /** Cancel an in-flight capture (its promise resolves null). */
  abortCapture(): void;
  runBrainTurn(
    utterance: string,
    signal: AbortSignal,
  ): AsyncIterable<VoiceTurnEvent>;
  /** Speak one sentence; resolves when playback finished. */
  speak(text: string): Promise<void>;
  cancelSpeech(): void;
  onView(view: VoiceCommandSessionView): void;
}

export interface VoiceCommandSessionOptions {
  /** A command captured in the same breath as the wake phrase — run it first. */
  readonly initialCommand?: string;
  /** Silence (ms) while listening before the session ends. */
  readonly idleTimeoutMs?: number;
}

export interface VoiceCommandSession {
  /** Resolves once the session ended (idle silence, `end()`, or a mic failure). */
  readonly done: Promise<void>;
  end(): void;
}

const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const FAILED_TURN_LINE = "Sorry, I ran into a problem with that.";
// A silent capture normally burns a few seconds before the recognizer gives
// up — but a fast-failing one (offline Chrome errors instantly) would spin
// new recognitions back-to-back for the whole idle window without this floor.
const MIN_SILENT_CAPTURE_MS = 500;

export function startVoiceCommandSession(
  deps: VoiceCommandSessionDeps,
  options: VoiceCommandSessionOptions = {},
): VoiceCommandSession {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const turnAbort = new AbortController();
  let ended = false;

  const setView = (view: VoiceCommandSessionView): void => {
    if (!ended || view.state === "ended") deps.onView(view);
  };

  async function speakSentence(command: string, sentence: string): Promise<void> {
    if (ended) return;
    setView({ state: "speaking", transcript: command, spokenText: sentence });
    await deps.speak(sentence);
  }

  async function runTurn(command: string): Promise<void> {
    setView({ state: "thinking", transcript: command, spokenText: "" });
    const buffer = new SpokenSentenceBuffer();
    try {
      for await (const event of deps.runBrainTurn(command, turnAbort.signal)) {
        if (ended) return;
        if (event.kind === "text") {
          for (const sentence of buffer.push(event.delta))
            await speakSentence(command, sentence);
        } else {
          for (const sentence of buffer.flush())
            await speakSentence(command, sentence);
          if (event.kind === "failed")
            await speakSentence(command, FAILED_TURN_LINE);
          return;
        }
      }
    } catch {
      if (ended) return;
      for (const sentence of buffer.flush()) await speakSentence(command, sentence);
      await speakSentence(command, FAILED_TURN_LINE);
    }
  }

  async function run(): Promise<void> {
    try {
      if (options.initialCommand) await runTurn(options.initialCommand);

      // One capture attempt covers only a few seconds of silence (the
      // recognizer gives up early), so silence accumulates across attempts
      // until the idle window is spent; any real command resets it.
      let idleDeadline = Date.now() + idleTimeoutMs;
      while (!ended) {
        setView({ state: "listening", transcript: "", spokenText: "" });
        const captureStartedAt = Date.now();
        const command = await deps.captureCommand((transcript) =>
          setView({ state: "listening", transcript, spokenText: "" }),
        );
        if (ended) return;
        if (command) {
          await runTurn(command);
          idleDeadline = Date.now() + idleTimeoutMs;
          continue;
        }
        if (Date.now() >= idleDeadline) return;
        const captureLastedMs = Date.now() - captureStartedAt;
        if (captureLastedMs < MIN_SILENT_CAPTURE_MS) {
          await new Promise((resolve) =>
            setTimeout(resolve, MIN_SILENT_CAPTURE_MS - captureLastedMs),
          );
        }
      }
    } finally {
      ended = true;
      setView({ state: "ended", transcript: "", spokenText: "" });
    }
  }

  const done = run();

  return {
    done,
    end(): void {
      if (ended) return;
      ended = true;
      turnAbort.abort();
      deps.abortCapture();
      deps.cancelSpeech();
    },
  };
}
