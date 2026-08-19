import { describe, expect, it, vi } from "vitest";
import {
  startVoiceCommandSession,
  type VoiceCommandSessionDeps,
  type VoiceCommandSessionView,
  type VoiceTurnEvent,
} from "./voice-command-session.js";

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
  };
  return {
    deps,
    views,
    played,
    interrupted,
    brainCalls,
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
