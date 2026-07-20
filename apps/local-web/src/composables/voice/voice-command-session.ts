import { pickAckForRequest, stripSpokenMarkup } from "@vynel/voice";

// The browser half of the hybrid voice loop — the command session the daemon
// hands off to on wake. Web Speech STT captures a command (with a live interim
// transcript), the brain runs the turn on the fast voice model, and — this is
// the whole point — the browser NEVER speaks. Voice output happens only when the
// brain calls the `speak` tool, which plays through the daemon's speaker (the
// one voice). The session is ears + eyes: it shows the transcript and, when a
// `speak` call arrives, the words on screen. Silence past the idle window ends
// the session (the overlay closes, the daemon takes the mic back).
//
// Everything is injected so the whole flow is unit-tested with fakes — no Web
// Speech, no network.

export type VoiceTurnEvent =
  // The brain called the `speak` tool — `text` is what the daemon is saying.
  | { readonly kind: "spoke"; readonly text: string }
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
  /** What the daemon is saying (the last `speak` call this turn; '' otherwise). */
  readonly spokenText: string;
}

export interface VoiceCommandSessionDeps {
  /** One command capture — final transcript, or null on silence/abort. */
  captureCommand(onInterim: (transcript: string) => void): Promise<string | null>;
  /** Cancel an in-flight capture (its promise resolves null). */
  abortCapture(): void;
  /** Run the brain turn; yields each `speak` call + a terminal. */
  runBrainTurn(
    utterance: string,
    signal: AbortSignal,
  ): AsyncIterable<VoiceTurnEvent>;
  /** Play a spoken reply (the daemon's Kokoro voice) IN THE BROWSER — the reliable
   *  path while the overlay window holds the audio device. Awaited, so the mic
   *  reopens only after playback (and the browser's echo cancellation covers it). */
  playSpoken(text: string): Promise<void>;
  /** Stop any in-flight playback (on end()). */
  cancelSpoken(): void;
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

  async function runTurn(command: string): Promise<void> {
    setView({ state: "thinking", transcript: command, spokenText: "" });
    // The instant acknowledgment: a deterministic, keyword-contextual line
    // (no LLM — zero latency) spoken WHILE the brain turn starts, so the user
    // immediately hears the command landed instead of waiting out the model's
    // first token. Every real spoke awaits it — lines never overlap — and the
    // turn's exit awaits it too, so the mic never reopens over a playing ack.
    const ackPlayback = deps.playSpoken(pickAckForRequest(command));
    try {
      for await (const event of deps.runBrainTurn(command, turnAbort.signal)) {
        if (ended) return;
        if (event.kind === "spoke") {
          // The brain called `speak` — show the words AND play them in the browser
          // (awaited, so the mic waits for playback + browser AEC covers it).
          const spoken = stripSpokenMarkup(event.text);
          if (spoken !== "") {
            setView({ state: "speaking", transcript: command, spokenText: spoken });
            await ackPlayback;
            await deps.playSpoken(spoken);
          }
        } else {
          // A failed turn stays silent (the brain owns the mic via `speak`); show
          // the reason on screen so the user isn't left with a dead orb.
          if (event.kind === "failed")
            setView({ state: "speaking", transcript: command, spokenText: FAILED_TURN_LINE });
          return;
        }
      }
    } catch {
      if (ended) return;
      setView({ state: "speaking", transcript: command, spokenText: FAILED_TURN_LINE });
    } finally {
      await ackPlayback;
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
      deps.cancelSpoken();
    },
  };
}
