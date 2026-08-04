import { describe, expect, it } from "vitest";
import {
  applyTurnNarrationEvent,
  RECENT_STEP_LIMIT,
  type TurnNarration,
} from "./turn-narration-store.js";

describe("applyTurnNarrationEvent", () => {
  const started = {
    kind: "turn-tool-started" as const,
    turnId: "t1",
    toolUseId: "u1",
    toolName: "Read",
    toolInput: { file_path: "march-statement.pdf" },
  };

  it("tracks the current step per turn and marks its settle — in the ring too", () => {
    let narrations: Record<string, TurnNarration> = {};
    narrations = applyTurnNarrationEvent(narrations, started);
    expect(narrations.t1?.current).toMatchObject({
      toolName: "Read",
      isRunning: true,
    });
    expect(narrations.t1?.recentSteps).toHaveLength(1);

    narrations = applyTurnNarrationEvent(narrations, {
      kind: "turn-tool-settled",
      turnId: "t1",
      toolUseId: "u1",
      status: "completed",
    });
    // The settled step LINGERS as the narration line (no flicker between steps)
    // and settles IN the ring (its tail is the current step).
    expect(narrations.t1?.current).toMatchObject({
      toolName: "Read",
      isRunning: false,
    });
    expect(narrations.t1?.recentSteps[0]).toMatchObject({ isRunning: false });
  });

  it("a newer step replaces the lingering one; a SUPERSEDED settle still settles its ring entry", () => {
    let narrations: Record<string, TurnNarration> = {};
    narrations = applyTurnNarrationEvent(narrations, started);
    narrations = applyTurnNarrationEvent(narrations, {
      ...started,
      toolUseId: "u2",
      toolName: "Grep",
    });
    expect(narrations.t1?.current.toolName).toBe("Grep");
    // The ring keeps BOTH, oldest → newest (B4: the card's partial activity).
    expect(narrations.t1?.recentSteps.map((step) => step.toolName)).toEqual([
      "Read",
      "Grep",
    ]);
    narrations = applyTurnNarrationEvent(narrations, {
      kind: "turn-tool-settled",
      turnId: "t1",
      toolUseId: "u1", // the old step — no longer current (parallel tool calls)
      status: "completed",
    });
    // The narration LINE keeps the newer step; the ring entry settles — a card
    // must never show a finished step as running.
    expect(narrations.t1?.current.toolName).toBe("Grep");
    expect(narrations.t1?.recentSteps.map((step) => [step.toolName, step.isRunning])).toEqual([
      ["Read", false],
      ["Grep", true],
    ]);
    // A settle for a step nowhere in sight IS a no-op.
    const before = narrations;
    expect(
      applyTurnNarrationEvent(before, {
        kind: "turn-tool-settled",
        turnId: "t1",
        toolUseId: "u-unknown",
        status: "completed",
      }),
    ).toBe(before);
  });

  it(`the ring caps at ${RECENT_STEP_LIMIT} — oldest steps fall off`, () => {
    let narrations: Record<string, TurnNarration> = {};
    for (let i = 0; i < RECENT_STEP_LIMIT + 2; i += 1) {
      narrations = applyTurnNarrationEvent(narrations, {
        ...started,
        toolUseId: `u${i}`,
        toolName: `Tool${i}`,
      });
    }
    const ring = narrations.t1?.recentSteps ?? [];
    expect(ring).toHaveLength(RECENT_STEP_LIMIT);
    expect(ring[0]?.toolName).toBe("Tool2");
    expect(ring[ring.length - 1]?.toolName).toBe(`Tool${RECENT_STEP_LIMIT + 1}`);
  });

  it("turn-ended clears the turn; unrelated events return the same reference", () => {
    let narrations: Record<string, TurnNarration> = {};
    narrations = applyTurnNarrationEvent(narrations, started);
    narrations = applyTurnNarrationEvent(narrations, {
      kind: "turn-ended",
      turnId: "t1",
      sessionId: null,
    });
    expect(narrations.t1).toBeUndefined();
    const before = narrations;
    expect(
      applyTurnNarrationEvent(before, {
        kind: "turn-ended",
        turnId: "unknown",
        sessionId: null,
      }),
    ).toBe(before);
  });
});
