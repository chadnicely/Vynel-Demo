// The overlay-visibility matrix (origin × navigation target × id arrival).
// This logic lived inline in GlobalChatView/WorkspaceView and compared against
// the continuing-conversation query — the source of the mid-turn overlay
// flicker; the resolver is pure so the whole matrix is testable.

import { describe, expect, it } from "vitest";
import { createActiveTurnView } from "./active-turn-view.js";
import { resolveVisibleActiveTurn } from "./visible-active-turn.js";

const view = createActiveTurnView();

describe("resolveVisibleActiveTurn", () => {
  it("returns null when no turn is in flight", () => {
    expect(
      resolveVisibleActiveTurn({
        view: null,
        turnSessionId: null,
        startedContinuous: true,
        target: "continuous",
      }),
    ).toBeNull();
  });

  it("the continuous thread keeps its own turn, whatever the ids resolve to mid-turn", () => {
    // The flicker fix: no comparison against a refetching query value.
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: "s1",
        startedContinuous: true,
        target: "continuous",
      }),
    ).toBe(view);
    // First-ever conversation: id not assigned yet.
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: null,
        startedContinuous: true,
        target: "continuous",
      }),
    ).toBe(view);
  });

  it("the continuous thread never shows a turn started from a history-picked session", () => {
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: "picked",
        startedContinuous: false,
        target: "continuous",
      }),
    ).toBeNull();
  });

  it("a fresh view owns only a fresh-started turn in its pre-id window", () => {
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: null,
        startedContinuous: false,
        target: "fresh",
      }),
    ).toBe(view);
    // Resetting to fresh mid-turn hides a running continuous/picked turn.
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: null,
        startedContinuous: true,
        target: "fresh",
      }),
    ).toBeNull();
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: "s1",
        startedContinuous: false,
        target: "fresh",
      }),
    ).toBeNull();
  });

  it("a picked session shows exactly its own turn", () => {
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: "s1",
        startedContinuous: false,
        target: { sessionId: "s1" },
      }),
    ).toBe(view);
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: "s1",
        startedContinuous: false,
        target: { sessionId: "other" },
      }),
    ).toBeNull();
    // A pre-id fresh turn does not bleed onto a history session the user
    // opens during the startup window.
    expect(
      resolveVisibleActiveTurn({
        view,
        turnSessionId: null,
        startedContinuous: false,
        target: { sessionId: "s1" },
      }),
    ).toBeNull();
  });
});
