import { SpokenEchoFilter, stripSpokenMarkup, type SpokenLine } from "@vynel/voice";

// The browser half of the hybrid voice loop — the command session the daemon
// hands off to on wake. Web Speech STT captures what the user says (with a live
// interim transcript), the brain runs the turn on the voice tier, and the
// thread's streamed text is spoken IN THE BROWSER sentence by sentence as it
// arrives (voice-realtime VR1). The mic never closes: it listens THROUGH the
// reply, so the user can talk over it (VR2) — a real utterance cuts playback,
// interrupts the server turn by identity, and runs as the next turn. Silence
// past the idle window, counted only between turns, ends the session.
//
// Two things keep the assistant from answering its own voice:
//   - the BELT — the browser's acoustic echo cancellation: Chromium cancels the
//     audio IT renders (this player's output) out of the microphone capture.
//     Web Speech exposes no constraint knob (no getUserMedia of ours to set
//     `echoCancellation: true` on — see speech-recognition.ts), so the belt is
//     the browser's to wear, not ours to fasten.
//   - the BRACES — the shared spoken-echo filter (@vynel/voice, the call leg's
//     policy): each reply is remembered as ONE line while it plays and for a
//     short return window after; a transcript that sits inside it is our own
//     voice coming back through a speaker, never the user — not shown, not
//     acted on. The accepted cost (same as the call leg): a user genuinely
//     parroting our line inside the window is swallowed too.
//
// Everything is injected so the whole flow is unit-tested with fakes — no Web
// Speech, no network.

export type VoiceTurnEvent =
  // The turn's session identity — the interrupt target for a barge-in.
  | { readonly kind: "session"; readonly sessionId: string }
  // One spoken sentence of the reply (streamed text, or a speak-tool relay).
  | { readonly kind: "spoke"; readonly text: string }
  | { readonly kind: "completed" }
  // Stopped from elsewhere mid-reply — a quiet end, not a failure.
  | { readonly kind: "interrupted" }
  | { readonly kind: "failed"; readonly message: string };

export type VoiceCommandSessionState =
  | "listening"
  | "thinking"
  | "speaking"
  | "ended";

export interface VoiceCommandSessionView {
  /** The phase — the mic is open in every one but `ended`. */
  readonly state: VoiceCommandSessionState;
  /** The live interim transcript while the user talks; the command while answering. */
  readonly transcript: string;
  /** The reply spoken so far this turn, growing a sentence at a time. */
  readonly spokenText: string;
}

export interface VoiceCommandSessionDeps {
  /** One capture — the final transcript, or null on silence/abort. */
  captureCommand(onInterim: (transcript: string) => void): Promise<string | null>;
  /** Cancel an in-flight capture (its promise resolves null). */
  abortCapture(): void;
  /** Run the brain turn; yields the session id, each sentence, and a terminal. */
  runBrainTurn(
    utterance: string,
    signal: AbortSignal,
  ): AsyncIterable<VoiceTurnEvent>;
  /** Queue one sentence on the browser player (pipelined behind what plays);
   *  resolves when it finished playing — or was cancelled. */
  playSpoken(text: string): Promise<void>;
  /** Cut playback and drop every queued sentence (barge-in, end). */
  cancelSpoken(): void;
  /** Stop the running server turn BY IDENTITY (best-effort). */
  interruptTurn(sessionId: string): Promise<void>;
  onView(view: VoiceCommandSessionView): void;
}

export interface VoiceCommandSessionOptions {
  /** A command captured in the same breath as the wake phrase — run it first. */
  readonly initialCommand?: string;
  /** Silence (ms) between turns before the session ends. */
  readonly idleTimeoutMs?: number;
}

export interface VoiceCommandSession {
  /** Resolves once the session ended (idle silence, `end()`, or a mic failure). */
  readonly done: Promise<void>;
  end(): void;
}

/** One brain turn in flight, with what the barge-in needs to stop it. */
interface RunningTurn {
  readonly command: string;
  sessionId: string | null;
  spokenText: string;
  /** The reply as ONE remembered line in the echo filter (from its first sentence). */
  echoLine: SpokenLine | null;
  /** A barge-in (or end) landed — drop whatever it still produces. */
  isCut: boolean;
  readonly abort: AbortController;
  settled: Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const FAILED_TURN_LINE = "Sorry, I ran into a problem with that.";
// A silent capture normally burns a few seconds before the recognizer gives
// up — but a fast-failing one (offline Chrome errors instantly) would spin
// new recognitions back-to-back for the whole idle window without this floor.
const MIN_SILENT_CAPTURE_MS = 500;

/** Does the transcript carry anything worth acting on? A stray fragment must
 *  never cut the reply or run a turn — and the floor matches the echo filter's
 *  own ("one or two characters carry no echo evidence"), so the first tiny
 *  fragment of our own line coming back ("it" of "It's…") cannot slip past
 *  the filter as a real utterance. */
function hasSpokenWords(transcript: string): boolean {
  return (transcript.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3;
}

export function startVoiceCommandSession(
  deps: VoiceCommandSessionDeps,
  options: VoiceCommandSessionOptions = {},
): VoiceCommandSession {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const echoFilter = new SpokenEchoFilter();
  let ended = false;
  let turn: RunningTurn | null = null;
  let interim = "";
  let idleDeadline = Date.now() + idleTimeoutMs;

  function publish(): void {
    if (ended) return;
    const run = turn;
    if (run === null || run.isCut) {
      deps.onView({ state: "listening", transcript: interim, spokenText: "" });
    } else if (run.spokenText === "") {
      deps.onView({ state: "thinking", transcript: run.command, spokenText: "" });
    } else {
      deps.onView({ state: "speaking", transcript: run.command, spokenText: run.spokenText });
    }
  }

  /** The user spoke — not silence, not our own voice coming back. The ONE
   *  trigger for a new turn and for a barge-in alike. */
  function isUserUtterance(transcript: string): boolean {
    return hasSpokenWords(transcript) && !echoFilter.isEcho(transcript);
  }

  /** The barge-in: cut playback, stop reading, stop the server turn by id.
   *  Without an id yet (cut before the first frame) the local abort is all we
   *  can do — the server turn ends on its own and the next one queues behind it. */
  function cutTurn(run: RunningTurn): void {
    if (run.isCut) return;
    run.isCut = true;
    deps.cancelSpoken();
    run.abort.abort();
    if (run.sessionId !== null) void deps.interruptTurn(run.sessionId).catch(() => undefined);
  }

  function onInterim(transcript: string): void {
    const run = turn;
    if (run === null || run.isCut) {
      interim = transcript;
      publish();
      return;
    }
    // Talking over the reply: only a real utterance cuts it — an echo of our
    // own line (or a stray fragment) is neither shown nor acted on.
    if (!isUserUtterance(transcript)) return;
    interim = transcript;
    cutTurn(run);
    publish();
  }

  function speakSentence(run: RunningTurn, sentence: string): Promise<void> {
    // Remembered from the first sample, as one growing line per reply.
    if (run.echoLine === null) run.echoLine = echoFilter.remember(sentence);
    else run.echoLine.append(sentence);
    return deps.playSpoken(sentence);
  }

  function sayFailure(run: RunningTurn): Promise<void> {
    run.spokenText = FAILED_TURN_LINE;
    publish();
    return speakSentence(run, FAILED_TURN_LINE);
  }

  async function driveTurn(run: RunningTurn): Promise<void> {
    const playbacks: Promise<void>[] = [];
    publish();
    try {
      for await (const event of deps.runBrainTurn(run.command, run.abort.signal)) {
        if (ended || run.isCut) break;
        if (event.kind === "session") {
          run.sessionId = event.sessionId;
        } else if (event.kind === "spoke") {
          const sentence = stripSpokenMarkup(event.text);
          if (sentence === "") continue;
          run.spokenText = run.spokenText === "" ? sentence : `${run.spokenText} ${sentence}`;
          publish();
          // Not awaited: the player pipelines it behind the sentence playing,
          // so the read keeps pace with generation.
          playbacks.push(speakSentence(run, sentence));
        } else {
          if (event.kind === "failed") playbacks.push(sayFailure(run));
          break;
        }
      }
    } catch {
      if (!ended && !run.isCut) playbacks.push(sayFailure(run));
    } finally {
      // The turn settles once its last sentence played (or was cut) — the idle
      // window counts from the end of speech, not the end of the stream, and
      // the reply stays an echo candidate for the return window past it.
      await Promise.all(playbacks);
      run.echoLine?.end();
      if (turn === run) turn = null;
      idleDeadline = Date.now() + idleTimeoutMs;
      publish();
    }
  }

  function startTurn(command: string): void {
    const run: RunningTurn = {
      command,
      sessionId: null,
      spokenText: "",
      echoLine: null,
      isCut: false,
      abort: new AbortController(),
      settled: Promise.resolve(),
    };
    turn = run;
    run.settled = driveTurn(run);
  }

  async function listen(): Promise<void> {
    try {
      if (options.initialCommand) startTurn(options.initialCommand);
      // One capture attempt covers only a few seconds of silence (the
      // recognizer gives up early), so captures cycle back-to-back — through
      // the reply too — and silence accumulates across them until the idle
      // window is spent; any real utterance resets it.
      while (!ended) {
        interim = "";
        publish();
        const captureStartedAt = Date.now();
        const heard = await deps.captureCommand(onInterim);
        if (ended) return;
        if (heard !== null && isUserUtterance(heard)) {
          const previous = turn;
          if (previous !== null) {
            cutTurn(previous);
            await previous.settled;
            if (ended) return;
          }
          startTurn(heard);
          continue;
        }
        if (turn === null && Date.now() >= idleDeadline) return;
        const captureLastedMs = Date.now() - captureStartedAt;
        if (captureLastedMs < MIN_SILENT_CAPTURE_MS) {
          await new Promise((resolve) =>
            setTimeout(resolve, MIN_SILENT_CAPTURE_MS - captureLastedMs),
          );
        }
      }
    } finally {
      ended = true;
      const run = turn;
      if (run !== null) cutTurn(run);
      deps.cancelSpoken();
      await run?.settled;
      deps.onView({ state: "ended", transcript: "", spokenText: "" });
    }
  }

  const done = listen();

  return {
    done,
    end(): void {
      if (ended) return;
      ended = true;
      // Closing mid-reply stops the turn on the server too (by its own id —
      // never the global head); its partial reply stays in the transcript.
      const run = turn;
      if (run !== null) cutTurn(run);
      deps.abortCapture();
      deps.cancelSpoken();
    },
  };
}
