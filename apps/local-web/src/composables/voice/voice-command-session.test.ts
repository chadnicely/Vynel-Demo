import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE_TURN_WATCHDOG_MS } from "@vynel/contracts/voice/turn-watchdog";
import { startVoiceCommandSession } from "./voice-command-session.js";
import type {
  VoiceCommandSessionDeps,
  VoiceCommandSessionView,
  VoiceTurnEvent,
} from "./voice-command-session-types.js";

// The session speaks the thread's streamed text in the browser, a sentence at
// a time, and listens THROUGH it: the assertion surface is the VIEW (what the
// orb shows), what was PLAYED, and what was INTERRUPTED.

const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

/** Scripted capture: the Nth listen "hears" the Nth entry (null = silence),
 *  optionally after `captureDelayMs`; a function entry drives interims and
 *  then resolves. After the script runs out it hangs until aborted, like a
 *  quiet room. Playback holds when `holdPlayback` until released (cancel
 *  releases everything, like the real player). */
type CaptureScript = string | null | ((onInterim: (t: string) => void) => Promise<string | null>);

function buildDeps(
  captures: CaptureScript[],
  brain: (utterance: string, signal: AbortSignal) => AsyncIterable<VoiceTurnEvent>,
  options: { captureDelayMs?: number; holdPlayback?: boolean } = {},
) {
  const queue = [...captures];
  const views: VoiceCommandSessionView[] = [];
  const played: string[] = [];
  const interrupted: string[] = [];
  const brainCalls: string[] = [];
  const turnErrors: unknown[] = [];
  const releases: Array<() => void> = [];
  let cancelCount = 0;
  let hangingResolve: ((value: string | null) => void) | null = null;

  const deps: VoiceCommandSessionDeps = {
    captureCommand: (onInterim) => {
      if (queue.length > 0) {
        const entry = queue.shift()!;
        if (typeof entry === "function") return entry(onInterim);
        if (!options.captureDelayMs) return Promise.resolve(entry);
        return new Promise((resolve) => {
          setTimeout(() => resolve(entry), options.captureDelayMs);
        });
      }
      return new Promise((resolve) => {
        hangingResolve = resolve;
      });
    },
    abortCapture: () => {
      hangingResolve?.(null);
      hangingResolve = null;
    },
    runBrainTurn: (utterance, signal) => {
      brainCalls.push(utterance);
      return brain(utterance, signal);
    },
    playSpoken: (text) => {
      played.push(text);
      if (!options.holdPlayback) return Promise.resolve();
      return new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    },
    cancelSpoken: () => {
      cancelCount += 1;
      releases.splice(0).forEach((release) => release());
    },
    interruptTurn: async (sessionId) => {
      interrupted.push(sessionId);
    },
    onView: (view) => {
      views.push(view);
    },
    onTurnError: (error) => {
      turnErrors.push(error);
    },
  };
  return {
    deps,
    views,
    played,
    interrupted,
    brainCalls,
    turnErrors,
    releasePlayback: () => releases.shift()?.(),
    cancelCount: () => cancelCount,
  };
}

/** The captions shown while 'speaking' — the reply so far, per the view. */
const captions = (views: VoiceCommandSessionView[]): string[] =>
  views.filter((view) => view.state === "speaking").map((view) => view.spokenText);

async function* brainSpeaking(...texts: string[]): AsyncIterable<VoiceTurnEvent> {
  yield { kind: "session", sessionId: "voice-seg-1" };
  for (const text of texts) yield { kind: "spoke", text };
  yield { kind: "completed" };
}

async function* brainFailing(): AsyncIterable<VoiceTurnEvent> {
  yield { kind: "failed", message: "boom" };
}

/** The transport itself dies mid-turn — a throw, not a `failed` frame. */
async function* brainBreaking(): AsyncIterable<VoiceTurnEvent> {
  yield { kind: "session", sessionId: "voice-seg-1" };
  throw new Error("stream broke");
}

/** A brain that names its session, speaks one line, then stays open until
 *  aborted (a long turn still generating). */
function brainHanging(line: string) {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* brain(_utterance: string, signal: AbortSignal): AsyncIterable<VoiceTurnEvent> {
    yield { kind: "session", sessionId: "voice-seg-1" };
    yield { kind: "spoke", text: line };
    await Promise.race([
      released,
      new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
    ]);
    if (signal.aborted) return;
    yield { kind: "spoke", text: "A line after the long pause." };
    yield { kind: "completed" };
  }
  return { brain, release };
}

describe("startVoiceCommandSession", () => {
  it("runs the wake-breath command first, then a follow-up, and ends on idle silence", async () => {
    vi.useFakeTimers();
    try {
      // Each capture takes 20ms; idle window 30ms. The follow-up (t=20) resets
      // the deadline to t=50; the first silence lands inside, the second past it.
      const { deps, views } = buildDeps(
        ["and a follow up", null, null],
        () => brainSpeaking("Here you go."),
        { captureDelayMs: 20 },
      );
      const session = startVoiceCommandSession(deps, {
        initialCommand: "what is the time",
        idleTimeoutMs: 30,
      });
      await vi.advanceTimersByTimeAsync(2000);
      await session.done;

      // Two turns ran → the spoken line surfaced as a caption each time.
      expect(captions(views)).toEqual(["Here you go.", "Here you go."]);
      expect(views.at(-1)?.state).toBe("ended");
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays NO canned ack — the first thing heard is the reply's first sentence, spoken before the stream ends", async () => {
    const hanging = brainHanging("Checking your calendar now.");
    const { deps, played, views } = buildDeps(["what's on today"], hanging.brain);
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await settle();
    // The stream is still open (the brain is "thinking" past its first line)
    // and the first sentence already played — nothing canned before it.
    expect(played).toEqual(["Checking your calendar now."]);
    expect(captions(views)).toContain("Checking your calendar now.");
    hanging.release();
    await settle();
    expect(played).toEqual(["Checking your calendar now.", "A line after the long pause."]);
    session.end();
    await session.done;
  });

  it("grows the caption a sentence at a time and pipelines playback (no await between sentences)", async () => {
    const { deps, played, views } = buildDeps(
      ["tell me more"],
      () => brainSpeaking("One.", "Two.", "Three."),
      { holdPlayback: true },
    );
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await settle();
    // All three sentences were handed to the player while the FIRST still
    // plays — the player's queue pipelines them.
    expect(played).toEqual(["One.", "Two.", "Three."]);
    expect(captions(views)).toEqual(["One.", "One. Two.", "One. Two. Three."]);
    session.end();
    await session.done;
  });

  it("keeps the mic open while speaking (listening through the reply)", async () => {
    const captureStarts: number[] = [];
    let hangResolve: ((value: string | null) => void) | null = null;
    const deps: VoiceCommandSessionDeps = {
      captureCommand: () => {
        captureStarts.push(Date.now());
        return new Promise((resolve) => {
          hangResolve = resolve;
        });
      },
      abortCapture: () => {
        hangResolve?.(null);
        hangResolve = null;
      },
      runBrainTurn: () => brainSpeaking("playing"),
      playSpoken: () => new Promise<void>(() => {}), // playback in flight, never ends on its own
      cancelSpoken: () => {},
      interruptTurn: async () => {},
      onView: () => {},
    };
    const session = startVoiceCommandSession(deps, {
      initialCommand: "hi",
      idleTimeoutMs: 60_000,
    });
    await settle();
    // Speaking, and the recognizer is ALREADY capturing.
    expect(captureStarts.length).toBeGreaterThan(0);
    session.end();
    // end() cancels playback in the real player; here the hanging play never
    // settles, so the session's done would wait on it — release by aborting.
    await Promise.race([session.done, settle(20)]);
  });

  it("barge-in: a real interim cuts playback + interrupts the turn by id; its final runs as the next turn", async () => {
    const hanging = brainHanging("It's 26 degrees and clear.");
    const harness = buildDeps(
      [
        "weather",
        async (onInterim) => {
          await settle(); // the reply is playing by now
          onInterim("what about");
          await settle();
          return "what about tomorrow";
        },
      ],
      (utterance, signal) =>
        utterance === "weather" ? hanging.brain(utterance, signal) : brainSpeaking("Rain."),
      { holdPlayback: true },
    );
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    await settle(40);

    expect(harness.cancelCount()).toBeGreaterThanOrEqual(1); // playback cut
    expect(harness.interrupted).toEqual(["voice-seg-1"]); // the server turn, by identity
    expect(harness.brainCalls).toEqual(["weather", "what about tomorrow"]); // the new turn ran
    // The cut turn's later line never played; the new reply did.
    expect(harness.played).toEqual(["It's 26 degrees and clear.", "Rain."]);
    const listeningAfterCut = harness.views.find(
      (view) => view.state === "listening" && view.transcript === "what about",
    );
    expect(listeningAfterCut).toBeDefined();
    session.end();
    await session.done;
  });

  it("ignores an echo of its own line while speaking — no cut, no interrupt, no new turn", async () => {
    const hanging = brainHanging("It's 26 degrees and clear.");
    const harness = buildDeps(
      [
        "weather",
        async (onInterim) => {
          await settle();
          onInterim("it's 26 degrees"); // the speaker→mic return of our own line
          await settle();
          return "it's 26 degrees and clear";
        },
      ],
      hanging.brain,
      { holdPlayback: true },
    );
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    await settle(40);
    expect(harness.cancelCount()).toBe(0);
    expect(harness.interrupted).toEqual([]);
    expect(harness.brainCalls).toEqual(["weather"]);
    expect(harness.views.some((view) => view.state === "listening" && view.transcript !== "")).toBe(
      false,
    );
    session.end();
    await session.done;
  });

  it("a barge-in word buried in a LONG reply still cuts — the echo memory is not the whole answer", async () => {
    const harness = buildDeps(
      [
        "deploy status",
        async (onInterim) => {
          await settle();
          onInterim("stop"); // we said "I can stop the deployment" three sentences back
          await settle();
          return "stop";
        },
      ],
      (utterance) =>
        utterance === "deploy status"
          ? brainSpeaking(
              "I can stop the deployment if you want me to.",
              "The build is green and the tests all passed.",
              "Nothing else is waiting on you right now.",
              "Your next meeting starts in about twenty minutes.",
            )
          : brainSpeaking("Stopped."),
      { holdPlayback: true },
    );
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    await settle(40);

    expect(harness.cancelCount()).toBeGreaterThanOrEqual(1);
    expect(harness.interrupted).toEqual(["voice-seg-1"]);
    expect(harness.brainCalls).toEqual(["deploy status", "stop"]);
    expect(harness.turnErrors).toEqual([]); // an abort is our own doing, not a break
    session.end();
    await session.done;
  });

  it("a tiny fragment while speaking never cuts (the first syllable of our own line coming back)", async () => {
    const hanging = brainHanging("It's 26 degrees and clear.");
    const harness = buildDeps(
      [
        "weather",
        async (onInterim) => {
          await settle();
          onInterim("it"); // too short to be evidence of anything
          await settle();
          return null;
        },
      ],
      hanging.brain,
      { holdPlayback: true },
    );
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    await settle(40);
    expect(harness.cancelCount()).toBe(0);
    expect(harness.interrupted).toEqual([]);
    session.end();
    await session.done;
  });

  it("end() mid-reply cuts playback, interrupts the turn by id, and settles as ended", async () => {
    const hanging = brainHanging("A long answer begins.");
    const harness = buildDeps(["go ahead"], hanging.brain, { holdPlayback: true });
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    await settle();
    expect(harness.played).toEqual(["A long answer begins."]);
    session.end();
    await session.done;
    expect(harness.interrupted).toEqual(["voice-seg-1"]);
    expect(harness.cancelCount()).toBeGreaterThanOrEqual(1);
    expect(harness.views.at(-1)?.state).toBe("ended");
  });

  it("never ends on idle while a turn is in flight", async () => {
    vi.useFakeTimers();
    try {
      const hanging = brainHanging("Still working.");
      const { deps, views } = buildDeps([null, null, null, null], hanging.brain, {
        captureDelayMs: 600,
      });
      const session = startVoiceCommandSession(deps, {
        initialCommand: "do a long thing",
        idleTimeoutMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(3_000);
      // Well past the idle window, yet the turn is in flight — still alive.
      expect(views.at(-1)?.state).not.toBe("ended");
      session.end();
      await vi.runOnlyPendingTimersAsync();
      await session.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("strips markdown from a spoken caption (never shows ** )", async () => {
    const { deps, views } = buildDeps(["weather"], () =>
      brainSpeaking("I checked **London**: **26°C**, clear."),
    );
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await settle();
    expect(captions(views)).toContain("I checked London: 26°C, clear.");
    session.end();
    await session.done;
  });

  it("waits out the silent-capture floor instead of hot-restarting recognition", async () => {
    vi.useFakeTimers();
    try {
      let captureCount = 0;
      const deps: VoiceCommandSessionDeps = {
        captureCommand: () => {
          captureCount += 1;
          return Promise.resolve(null);
        },
        abortCapture: () => {},
        runBrainTurn: () => brainSpeaking("never"),
        playSpoken: () => Promise.resolve(),
        cancelSpoken: () => {},
        interruptTurn: async () => {},
        onView: () => {},
      };
      const session = startVoiceCommandSession(deps, { idleTimeoutMs: 10_000 });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(captureCount).toBeLessThanOrEqual(5);
      session.end();
      await vi.runOnlyPendingTimersAsync();
      await session.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams the live interim transcript into the view while listening", async () => {
    const { deps, views } = buildDeps(
      [
        (onInterim) => {
          onInterim("what is");
          onInterim("what is the time");
          return Promise.resolve("what is the time");
        },
      ],
      () => brainSpeaking("Noon."),
    );
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await settle();
    const interim = views.filter((view) => view.state === "listening" && view.transcript);
    expect(interim.map((view) => view.transcript)).toContain("what is the time");
    session.end();
    await session.done;
  });

  it("shows AND speaks the failure line when the brain turn fails", async () => {
    const { deps, views, played } = buildDeps(["break it"], () => brainFailing());
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await settle();
    expect(captions(views)).toContain("Sorry, I ran into a problem with that.");
    expect(played).toEqual(["Sorry, I ran into a problem with that."]);
    session.end();
    await session.done;
  });

  it("surfaces the CAUSE when the turn's stream breaks, not just the spoken apology", async () => {
    const harness = buildDeps(["what's up"], () => brainBreaking());
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    await settle(20);

    expect(harness.played).toEqual(["Sorry, I ran into a problem with that."]);
    expect((harness.turnErrors[0] as Error).message).toBe("stream broke");
    session.end();
    await session.done;
  });

  it("a turn stopped from elsewhere ends quietly — no apology spoken, back to listening", async () => {
    async function* stoppedBrain(): AsyncIterable<VoiceTurnEvent> {
      yield { kind: "spoke", text: "Halfway." };
      yield { kind: "interrupted" };
    }
    const { deps, played, views } = buildDeps(["news"], () => stoppedBrain());
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await settle();
    expect(played).toEqual(["Halfway."]);
    expect(captions(views)).not.toContain("Sorry, I ran into a problem with that.");
    expect(views.at(-1)?.state).toBe("listening");
    session.end();
    await session.done;
  });

  it("a silent turn ends in silence — nothing canned is played", async () => {
    async function* silentBrain(): AsyncIterable<VoiceTurnEvent> {
      yield { kind: "completed" };
    }
    const { deps, played } = buildDeps(["weather"], () => silentBrain());
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await settle();
    expect(played).toEqual([]);
    session.end();
    await session.done;
  });

  it("end() aborts the capture and settles as ended", async () => {
    const { deps, views } = buildDeps([], () => brainSpeaking("never"));
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await Promise.resolve();
    session.end();
    await session.done;
    expect(views.at(-1)?.state).toBe("ended");
  });
});

// ---------------------------------------------------------------------------
// The overlay-leg turn watchdog (round-2 R2-G): a turn that has produced
// NOTHING for the whole window says one honesty line and keeps streaming;
// anything spoken, a barge-in, an interrupt or the turn's end disarms it.
// Driven on fake timers; the window is the wake's `turnWatchdogMs`.

const STILL_WORKING = "Still working on it — I'll say the answer when it lands.";

/** A brain that names its session and then stays SILENT until released (a
 *  long tool call), then speaks its answer; aborting it ends it quietly. */
function brainSilentUntilReleased(answer = "Here is the late answer.") {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* brain(_utterance: string, signal: AbortSignal): AsyncIterable<VoiceTurnEvent> {
    yield { kind: "session", sessionId: "voice-seg-1" };
    await Promise.race([
      released,
      new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
    ]);
    if (signal.aborted) return;
    yield { kind: "spoke", text: answer };
    yield { kind: "completed" };
  }
  return { brain, release };
}

describe("startVoiceCommandSession — the turn watchdog", () => {
  it("says the honesty line ONCE when a turn stays silent past the window, then still speaks the late answer", async () => {
    vi.useFakeTimers();
    try {
      const silent = brainSilentUntilReleased();
      const { deps, played, views } = buildDeps(["do a long thing"], silent.brain);
      const session = startVoiceCommandSession(deps, {
        idleTimeoutMs: 600_000,
        turnWatchdogMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(played).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(played).toEqual([STILL_WORKING]);
      // Once. The orb stays "thinking" — the line is a status, not the reply —
      // but the caption carries it: a person reading the stage sees what they heard.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(played).toEqual([STILL_WORKING]);
      expect(views.at(-1)).toEqual({
        state: "thinking",
        transcript: "do a long thing",
        spokenText: "",
        notice: STILL_WORKING,
      });
      expect(captions(views)).toEqual([]);

      silent.release();
      await vi.advanceTimersByTimeAsync(10);
      expect(played).toEqual([STILL_WORKING, "Here is the late answer."]);
      // The reply replaces the status — never appended to it.
      expect(captions(views)).toEqual(["Here is the late answer."]);
      expect(views.at(-1)?.notice).toBe("");
      session.end();
      await vi.runOnlyPendingTimersAsync();
      await session.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("never fires once the turn has spoken — the first sentence is the acknowledgment", async () => {
    vi.useFakeTimers();
    try {
      const hanging = brainHanging("On it.");
      const { deps, played } = buildDeps(["weather"], hanging.brain);
      const session = startVoiceCommandSession(deps, {
        idleTimeoutMs: 600_000,
        turnWatchdogMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(played).toEqual(["On it."]);
      session.end();
      await vi.runOnlyPendingTimersAsync();
      await session.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("is cleared when the turn ends — a silent turn that completes, or is interrupted, says nothing later", async () => {
    vi.useFakeTimers();
    try {
      async function* silentThenDone(): AsyncIterable<VoiceTurnEvent> {
        yield { kind: "completed" };
      }
      async function* silentThenInterrupted(): AsyncIterable<VoiceTurnEvent> {
        yield { kind: "session", sessionId: "voice-seg-1" };
        yield { kind: "interrupted" };
      }
      const { deps, played } = buildDeps(
        ["first", "second"],
        (utterance) => (utterance === "first" ? silentThenDone() : silentThenInterrupted()),
      );
      const session = startVoiceCommandSession(deps, {
        idleTimeoutMs: 600_000,
        turnWatchdogMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(played).toEqual([]);
      session.end();
      await vi.runOnlyPendingTimersAsync();
      await session.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("is cleared by end() and by a barge-in — the cut turn never speaks the line", async () => {
    vi.useFakeTimers();
    try {
      // end() mid-wait.
      const first = brainSilentUntilReleased();
      const ended = buildDeps(["slow one"], first.brain);
      const endedSession = startVoiceCommandSession(ended.deps, {
        idleTimeoutMs: 600_000,
        turnWatchdogMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(500);
      endedSession.end();
      await vi.advanceTimersByTimeAsync(5_000);
      await endedSession.done;
      expect(ended.played).toEqual([]);

      // A barge-in mid-wait: the cut turn's watchdog dies with it; the new turn
      // speaks at once, so its own watchdog never fires either.
      const second = brainSilentUntilReleased();
      const barged = buildDeps(
        [
          "slow one",
          async (onInterim) => {
            await settle();
            onInterim("never mind that");
            await settle();
            return "never mind that";
          },
        ],
        (utterance, signal) =>
          utterance === "slow one" ? second.brain(utterance, signal) : brainSpeaking("Okay."),
      );
      const bargedSession = startVoiceCommandSession(barged.deps, {
        idleTimeoutMs: 600_000,
        turnWatchdogMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(barged.interrupted).toEqual(["voice-seg-1"]);
      expect(barged.played).toEqual(["Okay."]);
      bargedSession.end();
      await vi.runOnlyPendingTimersAsync();
      await bargedSession.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a barge-in during the honesty line still cuts it and interrupts the turn by id", async () => {
    vi.useFakeTimers();
    try {
      const silent = brainSilentUntilReleased();
      let interimAt: (() => void) | null = null;
      const harness = buildDeps(
        [
          "slow one",
          async (onInterim) => {
            await new Promise<void>((resolve) => {
              interimAt = resolve;
            });
            onInterim("actually stop");
            await settle();
            return "actually stop";
          },
        ],
        (utterance, signal) =>
          utterance === "slow one" ? silent.brain(utterance, signal) : brainSpeaking("Stopped."),
        { holdPlayback: true },
      );
      const session = startVoiceCommandSession(harness.deps, {
        idleTimeoutMs: 600_000,
        turnWatchdogMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(harness.played).toEqual([STILL_WORKING]); // playing, held
      interimAt!();
      await vi.advanceTimersByTimeAsync(50);
      expect(harness.cancelCount()).toBeGreaterThanOrEqual(1);
      expect(harness.interrupted).toEqual(["voice-seg-1"]);
      expect(harness.played).toEqual([STILL_WORKING, "Stopped."]);
      session.end();
      await vi.runOnlyPendingTimersAsync();
      await session.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a session without a wake uses the daemon's default window; 0 disables it", async () => {
    vi.useFakeTimers();
    try {
      const silent = brainSilentUntilReleased();
      const { deps, played } = buildDeps(["slow one"], silent.brain);
      const session = startVoiceCommandSession(deps, { idleTimeoutMs: 600_000 });
      await vi.advanceTimersByTimeAsync(DEFAULT_VOICE_TURN_WATCHDOG_MS - 1);
      expect(played).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(played).toEqual([STILL_WORKING]);
      session.end();
      await vi.runOnlyPendingTimersAsync();
      await session.done;

      const disabled = brainSilentUntilReleased();
      const off = buildDeps(["slow one"], disabled.brain);
      const offSession = startVoiceCommandSession(off.deps, {
        idleTimeoutMs: 600_000,
        turnWatchdogMs: 0,
      });
      await vi.advanceTimersByTimeAsync(DEFAULT_VOICE_TURN_WATCHDOG_MS * 2);
      expect(off.played).toEqual([]);
      offSession.end();
      await vi.runOnlyPendingTimersAsync();
      await offSession.done;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startVoiceCommandSession — currentSessionId", () => {
  it("names the turn in flight's chat session while it runs (through playback) and null around it", async () => {
    const hanging = brainHanging("First.");
    const harness = buildDeps(["go ahead"], hanging.brain, { holdPlayback: true });
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    expect(session.currentSessionId).toBeNull();
    await settle();
    expect(session.currentSessionId).toBe("voice-seg-1");
    hanging.release();
    await settle();
    // The stream is done but the sentences are still playing — still our turn.
    expect(session.currentSessionId).toBe("voice-seg-1");
    harness.releasePlayback();
    harness.releasePlayback();
    await settle();
    expect(session.currentSessionId).toBeNull();
    session.end();
    await session.done;
    expect(session.currentSessionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// speakExternal — another producer's line (a schedule's `speak`) handed to the
// session mid-turn rides the session's own player and echo filter: in order
// behind the reply, never over it, and its echo is never a barge-in. With no
// turn in flight the session declines and the caller plays it itself.

describe("startVoiceCommandSession — speakExternal", () => {
  it("mid-turn: queues the line behind the reply on the same player and remembers it as our voice", async () => {
    const hanging = brainHanging("It's 26 degrees and clear.");
    const harness = buildDeps(
      [
        "weather",
        async (onInterim) => {
          await settle();
          onInterim("your build is green"); // the external line coming back off the speaker
          await settle();
          return "your build is green";
        },
      ],
      hanging.brain,
      { holdPlayback: true },
    );
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    await settle();
    expect(session.speakExternal("Your build is green.")).toBe(true);
    await settle(40);
    // One queue, in order — and the echo of the external line cut nothing.
    expect(harness.played).toEqual(["It's 26 degrees and clear.", "Your build is green."]);
    expect(harness.cancelCount()).toBe(0);
    expect(harness.interrupted).toEqual([]);
    expect(harness.brainCalls).toEqual(["weather"]);
    // Not the reply: the caption never shows it.
    expect(captions(harness.views)).toEqual(["It's 26 degrees and clear."]);
    session.end();
    await session.done;
  });

  it("the turn settles only after the external line played — its echo stays covered", async () => {
    const hanging = brainHanging("First.");
    const harness = buildDeps(["go ahead"], hanging.brain, { holdPlayback: true });
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    await settle();
    hanging.release();
    await settle();
    // The stream is done; the reply's sentences are still playing when the
    // line joins — the turn must wait for it too, not settle underneath it.
    expect(session.speakExternal("Lunch in five.")).toBe(true);
    harness.releasePlayback(); // "First."
    harness.releasePlayback(); // "A line after the long pause."
    await settle();
    expect(session.currentSessionId).toBe("voice-seg-1");
    harness.releasePlayback(); // "Lunch in five."
    await settle();
    expect(session.currentSessionId).toBeNull();
    session.end();
    await session.done;
  });

  it("does not stand the watchdog down — a silent turn still says the honesty line", async () => {
    vi.useFakeTimers();
    try {
      const silent = brainSilentUntilReleased();
      const { deps, played } = buildDeps(["do a long thing"], silent.brain);
      const session = startVoiceCommandSession(deps, {
        idleTimeoutMs: 600_000,
        turnWatchdogMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(session.speakExternal("Your build is green.")).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
      expect(played).toEqual(["Your build is green.", STILL_WORKING]);
      session.end();
      await vi.runOnlyPendingTimersAsync();
      await session.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("declines with no turn in flight, after a barge-in cut the turn, and once ended", async () => {
    const hanging = brainHanging("Reading.");
    let midCut: boolean | null = null;
    const harness = buildDeps(
      [
        "news",
        async (onInterim) => {
          await settle();
          onInterim("never mind"); // the barge-in lands here, synchronously
          midCut = session.speakExternal("Mid-cut.");
          return "never mind";
        },
      ],
      (utterance, signal) =>
        utterance === "news" ? hanging.brain(utterance, signal) : brainSpeaking("Okay."),
      { holdPlayback: true },
    );
    const session = startVoiceCommandSession(harness.deps, { idleTimeoutMs: 60_000 });
    // Listening, no turn yet.
    expect(session.speakExternal("Too early.")).toBe(false);
    await settle(40);
    expect(harness.interrupted).toEqual(["voice-seg-1"]);
    // The cut turn was handing the room to the next one — not ours to queue on.
    expect(midCut).toBe(false);
    session.end();
    await session.done;
    expect(session.speakExternal("Too late.")).toBe(false);
    expect(harness.played).toEqual(["Reading.", "Okay."]);
  });
});
