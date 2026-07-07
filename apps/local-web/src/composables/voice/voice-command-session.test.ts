import { describe, expect, it, vi } from "vitest";
import {
  startVoiceCommandSession,
  type VoiceCommandSessionDeps,
  type VoiceCommandSessionView,
  type VoiceTurnEvent,
} from "./voice-command-session.js";

// Scripted capture: the Nth listen attempt "hears" the Nth entry (null =
// silence), optionally after `captureDelayMs` (so fake-timer tests can move
// the clock like a real recognizer that takes seconds to give up). After the
// script runs out it hangs until aborted, like a quiet room.
function buildDeps(
  captures: Array<string | null>,
  brain: (utterance: string) => AsyncIterable<VoiceTurnEvent>,
  captureDelayMs = 0,
) {
  const queue = [...captures];
  const views: VoiceCommandSessionView[] = [];
  const spoken: string[] = [];
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
    speak: (text) => {
      spoken.push(text);
      return Promise.resolve();
    },
    cancelSpeech: () => {},
    onView: (view) => {
      views.push(view);
    },
  };
  return { deps, views, spoken };
}

async function* brainSaying(...deltas: string[]): AsyncIterable<VoiceTurnEvent> {
  for (const delta of deltas) yield { kind: "text", delta };
  yield { kind: "completed" };
}

async function* brainFailing(): AsyncIterable<VoiceTurnEvent> {
  yield { kind: "failed", message: "boom" };
}

describe("startVoiceCommandSession", () => {
  it("runs the wake-breath command first, then a follow-up, and ends on idle silence", async () => {
    vi.useFakeTimers();
    try {
      // Each capture takes 20ms; idle window is 30ms. The follow-up (t=20)
      // resets the deadline to t=50; the first silence lands inside the window
      // (then waits out the capture floor), the second lands past it and ends
      // the session.
      const { deps, spoken, views } = buildDeps(
        ["and a follow up", null, null],
        () => brainSaying("First sentence. ", "Second one."),
        20,
      );
      const session = startVoiceCommandSession(deps, {
        initialCommand: "what is the time",
        idleTimeoutMs: 30,
      });
      await vi.advanceTimersByTimeAsync(2000);
      await session.done;

      expect(spoken).toEqual([
        "First sentence.",
        "Second one.",
        "First sentence.",
        "Second one.",
      ]);
      expect(views.at(-1)?.state).toBe("ended");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps listening through a short silence inside the idle window", async () => {
    vi.useFakeTimers();
    try {
      const { deps, spoken } = buildDeps(
        [null, "hello there"], // one empty capture, then a real command
        () => brainSaying("Hi."),
        600, // past the silent-capture floor, so no retreat pause between them
      );
      const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(spoken).toEqual(["Hi."]);
      session.end();
      await session.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits out the silent-capture floor instead of hot-restarting recognition", async () => {
    vi.useFakeTimers();
    try {
      // Instant nulls simulate offline Chrome failing every capture at once.
      let captureCount = 0;
      const deps: VoiceCommandSessionDeps = {
        captureCommand: () => {
          captureCount += 1;
          return Promise.resolve(null);
        },
        abortCapture: () => {},
        runBrainTurn: () => brainSaying("never"),
        speak: () => Promise.resolve(),
        cancelSpeech: () => {},
        onView: () => {},
      };
      const session = startVoiceCommandSession(deps, { idleTimeoutMs: 10_000 });
      await vi.advanceTimersByTimeAsync(2_000);
      // 2s of instant failures at a 500ms floor ≈ 4-5 attempts, not hundreds.
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
      runBrainTurn: () => brainSaying("Noon."),
      speak: () => Promise.resolve(),
      cancelSpeech: () => {},
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

  it("speaks the failure line when the brain turn fails", async () => {
    const { deps, spoken } = buildDeps(["break it"], () => brainFailing());
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(spoken).toEqual(["Sorry, I ran into a problem with that."]);
    session.end();
    await session.done;
  });

  it("end() aborts the capture and settles as ended", async () => {
    const { deps, views } = buildDeps([], () => brainSaying("never"));
    const session = startVoiceCommandSession(deps, { idleTimeoutMs: 60_000 });
    await Promise.resolve();
    session.end();
    await session.done;
    expect(views.at(-1)?.state).toBe("ended");
  });
});
