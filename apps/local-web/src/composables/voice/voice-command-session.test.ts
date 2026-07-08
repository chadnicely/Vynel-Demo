import { describe, expect, it, vi } from "vitest";
import {
  startVoiceCommandSession,
  type VoiceCommandSessionDeps,
  type VoiceCommandSessionView,
  type VoiceTurnEvent,
} from "./voice-command-session.js";

// The session NEVER speaks — the daemon does, via the speak tool. So the
// assertion surface is the VIEW: what the orb shows. `spoke` events (the tool's
// text) surface as the 'speaking' caption; the session's own audio is nil.

// Scripted capture: the Nth listen attempt "hears" the Nth entry (null =
// silence), optionally after `captureDelayMs`. After the script runs out it
// hangs until aborted, like a quiet room.
function buildDeps(
  captures: Array<string | null>,
  brain: (utterance: string) => AsyncIterable<VoiceTurnEvent>,
  captureDelayMs = 0,
) {
  const queue = [...captures];
  const views: VoiceCommandSessionView[] = [];
  const played: string[] = [];
  let hangingResolve: ((value: string | null) => void) | null = null;

  const deps: VoiceCommandSessionDeps = {
    captureCommand: () => {
      if (queue.length > 0) {
        const value = queue.shift()!;
        if (captureDelayMs === 0) return Promise.resolve(value);
        return new Promise((resolve) => {
          setTimeout(() => resolve(value), captureDelayMs);
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
    runBrainTurn: brain,
    playSpoken: (text) => {
      played.push(text);
      return Promise.resolve();
    },
    cancelSpoken: () => {},
    onView: (view) => {
      views.push(view);
    },
  };
  return { deps, views, played };
}

/** The captions shown while 'speaking' — what the daemon is saying, per the view. */
const captions = (views: VoiceCommandSessionView[]): string[] =>
  views.filter((view) => view.state === "speaking").map((view) => view.spokenText);

async function* brainSpeaking(...texts: string[]): AsyncIterable<VoiceTurnEvent> {
  for (const text of texts) yield { kind: "spoke", text };
  yield { kind: "completed" };
}

async function* brainFailing(): AsyncIterable<VoiceTurnEvent> {
  yield { kind: "failed", message: "boom" };
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
        20,
      );
      const session = startVoiceCommandSession(deps, {
        initialCommand: "what is the time",
        idleTimeoutMs: 30,
      });
      await vi.advanceTimersByTimeAsync(2000);
      await session.done;

      // Two turns ran → the daemon's line surfaced as a caption each time.
      expect(captions(views)).toEqual(["Here you go.", "Here you go."]);
      expect(views.at(-1)?.state).toBe("ended");
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces each speak tool call as the caption", async () => {
    const { deps, views } = buildDeps(["what's up"], () =>
      brainSpeaking("It's 26 degrees and clear."),
    );
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(captions(views)).toContain("It's 26 degrees and clear.");
    session.end();
    await session.done;
  });

  it("strips markdown from a speak caption (never shows ** )", async () => {
    const { deps, views } = buildDeps(["weather"], () =>
      brainSpeaking("I checked **London**: **26°C**, clear."),
    );
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
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
    const views: VoiceCommandSessionView[] = [];
    const deps: VoiceCommandSessionDeps = {
      captureCommand: (onInterim) => {
        onInterim("what is");
        onInterim("what is the time");
        return Promise.resolve("what is the time");
      },
      abortCapture: () => {},
      runBrainTurn: () => brainSpeaking("Noon."),
      playSpoken: () => Promise.resolve(),
      cancelSpoken: () => {},
      onView: (view) => {
        views.push(view);
      },
    };
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    const interim = views.filter((view) => view.state === "listening" && view.transcript);
    expect(interim.map((view) => view.transcript)).toContain("what is the time");
    session.end();
    await session.done;
  });

  it("shows the failure line on screen when the brain turn fails", async () => {
    const { deps, views } = buildDeps(["break it"], () => brainFailing());
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(captions(views)).toContain("Sorry, I ran into a problem with that.");
    session.end();
    await session.done;
  });

  it("plays each spoken reply in the browser", async () => {
    const { deps, played } = buildDeps(["weather"], () => brainSpeaking("It's clear."));
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(played).toEqual(["It's clear."]);
    session.end();
    await session.done;
  });

  it("holds the mic closed until playback finishes (echo defense via awaited play)", async () => {
    const captureStarts: number[] = [];
    let releasePlayback: () => void = () => {};
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
      playSpoken: () =>
        new Promise<void>((resolve) => {
          releasePlayback = () => resolve(); // playback in flight until released
        }),
      cancelSpoken: () => {},
      onView: () => {},
    };
    const session = startVoiceCommandSession(deps, {
      initialCommand: "hi",
      idleTimeoutMs: 60_000,
    });
    // The turn is 'speaking' → play is awaited → the mic must NOT reopen yet.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(captureStarts).toHaveLength(0);

    releasePlayback(); // playback finished
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(captureStarts.length).toBeGreaterThan(0); // now the mic reopened
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
