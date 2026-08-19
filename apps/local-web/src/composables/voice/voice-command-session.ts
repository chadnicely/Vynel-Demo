import { SpokenEchoFilter, stripSpokenMarkup, type SpokenLine } from "@vynel/voice";
import { DEFAULT_VOICE_TURN_WATCHDOG_MS } from "@vynel/contracts/voice/turn-watchdog";
import { createTurnWatchdog, type TurnWatchdog } from "./turn-watchdog.js";
import type {
  VoiceCommandSession,
  VoiceCommandSessionDeps,
  VoiceCommandSessionOptions,
} from "./voice-command-session-types.js";

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

/** One brain turn in flight, with what the barge-in needs to stop it. */
interface RunningTurn {
  readonly command: string;
  sessionId: string | null;
  spokenText: string;
  /** The honesty line once the watchdog fired ("" before). */
  notice: string;
  /** The reply as ONE remembered line in the echo filter (from its first sentence). */
  echoLine: SpokenLine | null;
  /** A barge-in (or end) landed — drop whatever it still produces. */
  isCut: boolean;
  /** Every line queued on the player this turn — it settles after the last. */
  readonly playbacks: Promise<void>[];
  readonly watchdog: TurnWatchdog;
  readonly abort: AbortController;
  settled: Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const FAILED_TURN_LINE = "Sorry, I ran into a problem with that.";
// Spoken once when a turn has produced nothing for the whole watchdog window
// (round-2 R2-G): a person at a microphone needs to hear the turn is alive.
// The turn keeps streaming and its answer is spoken when it lands.
const STILL_WORKING_LINE = "Still working on it — I'll say the answer when it lands.";
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
  const turnWatchdogMs = options.turnWatchdogMs ?? DEFAULT_VOICE_TURN_WATCHDOG_MS;
  const echoFilter = new SpokenEchoFilter();
  let ended = false;
  let turn: RunningTurn | null = null;
  let interim = "";
  let idleDeadline = Date.now() + idleTimeoutMs;

  function publish(): void {
    if (ended) return;
    const run = turn;
    if (run === null || run.isCut) {
      deps.onView({ state: "listening", transcript: interim, spokenText: "", notice: "" });
    } else if (run.spokenText === "") {
      const { command: transcript, notice } = run;
      deps.onView({ state: "thinking", transcript, spokenText: "", notice });
    } else {
      const { command: transcript, spokenText } = run;
      deps.onView({ state: "speaking", transcript, spokenText, notice: "" });
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
    run.watchdog.disarm();
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

  /** Queue one line of OUR voice on the player — not awaited, the player
   *  pipelines it behind what plays — remembered from the first sample as one
   *  growing line per turn; the turn settles only after it played. */
  function voiceLine(run: RunningTurn, text: string): void {
    if (run.echoLine === null) run.echoLine = echoFilter.remember(text);
    else run.echoLine.append(text);
    run.playbacks.push(deps.playSpoken(text));
  }

  /** A sentence of the reply: the first one is the acknowledgment, so the
   *  watchdog stands down. */
  function speakSentence(run: RunningTurn, sentence: string): void {
    run.watchdog.disarm();
    voiceLine(run, sentence);
  }

  /** The watchdog fired — said once, like a reply sentence (on the player,
   *  echo-remembered) and shown as the caption; the orb stays thinking because
   *  it is a status, not the reply, which is still spoken when it lands. */
  function sayStillWorking(run: RunningTurn): void {
    run.notice = STILL_WORKING_LINE;
    publish();
    voiceLine(run, STILL_WORKING_LINE);
  }

  function sayFailure(run: RunningTurn): void {
    run.spokenText = FAILED_TURN_LINE;
    publish();
    speakSentence(run, FAILED_TURN_LINE);
  }

  async function driveTurn(run: RunningTurn): Promise<void> {
    publish();
    run.watchdog.arm();
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
          speakSentence(run, sentence);
        } else {
          if (event.kind === "failed") sayFailure(run);
          break;
        }
      }
    } catch (error) {
      // An abort is this session's own doing (a barge-in, `end()`) and says
      // nothing; anything else is a real break the owner has to be able to see.
      if (!ended && !run.isCut) {
        deps.onTurnError?.(error);
        sayFailure(run);
      }
    } finally {
      run.watchdog.disarm();
      // The turn settles once its last line played (or was cut) — the idle
      // window counts from the end of speech, not the end of the stream, and
      // the reply stays an echo candidate for the return window past it. A
      // line can still join while the last one plays (an external line handed
      // over mid-settle), so wait until nothing new was queued.
      for (let settled = 0; settled < run.playbacks.length; ) {
        settled = run.playbacks.length;
        await Promise.all(run.playbacks);
      }
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
      notice: "",
      echoLine: null,
      isCut: false,
      playbacks: [],
      watchdog: createTurnWatchdog({ ms: turnWatchdogMs, onFire: () => sayStillWorking(run) }),
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
      deps.onView({ state: "ended", transcript: "", spokenText: "", notice: "" });
    }
  }

  const done = listen();

  return {
    done,
    get currentSessionId() {
      return turn?.sessionId ?? null;
    },
    speakExternal(text: string): boolean {
      const run = turn;
      if (ended || run === null || run.isCut) return false;
      voiceLine(run, text);
      return true;
    },
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
