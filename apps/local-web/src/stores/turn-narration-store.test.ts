import { describe, expect, it } from "vitest";
import {
  applyTurnNarrationEvent,
  type TurnNarrationStep,
} from "./turn-narration-store.js";

describe("applyTurnNarrationEvent", () => {
  const started = {
    kind: "turn-tool-started" as const,
    turnId: "t1",
    toolUseId: "u1",
    toolName: "Read",
    toolInput: { file_path: "march-statement.pdf" },
  };

  it("tracks the current step per turn and marks its settle", () => {
    let steps: Record<string, TurnNarrationStep> = {};
    steps = applyTurnNarrationEvent(steps, started);
    expect(steps.t1).toMatchObject({ toolName: "Read", isRunning: true });

    steps = applyTurnNarrationEvent(steps, {
      kind: "turn-tool-settled",
      turnId: "t1",
      toolUseId: "u1",
      status: "completed",
    });
    // The settled step LINGERS as the narration line (no flicker between steps).
    expect(steps.t1).toMatchObject({ toolName: "Read", isRunning: false });
  });

  it("a newer step replaces the lingering one; a stale settle is ignored", () => {
    let steps: Record<string, TurnNarrationStep> = {};
    steps = applyTurnNarrationEvent(steps, started);
    steps = applyTurnNarrationEvent(steps, {
      ...started,
      toolUseId: "u2",
      toolName: "Grep",
    });
    expect(steps.t1?.toolName).toBe("Grep");
    const before = steps;
    steps = applyTurnNarrationEvent(steps, {
      kind: "turn-tool-settled",
      turnId: "t1",
      toolUseId: "u1", // the old step — no longer current
      status: "completed",
    });
    expect(steps).toBe(before);
  });

  it("turn-ended clears the turn; unrelated events return the same reference", () => {
    let steps: Record<string, TurnNarrationStep> = {};
    steps = applyTurnNarrationEvent(steps, started);
    steps = applyTurnNarrationEvent(steps, {
      kind: "turn-ended",
      turnId: "t1",
      sessionId: null,
    });
    expect(steps.t1).toBeUndefined();
    const before = steps;
    expect(
      applyTurnNarrationEvent(before, {
        kind: "turn-ended",
        turnId: "unknown",
        sessionId: null,
      }),
    ).toBe(before);
  });
});
