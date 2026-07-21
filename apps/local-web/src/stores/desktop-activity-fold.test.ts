import { describe, expect, it } from "vitest";
import {
  applyDesktopActivityEvent,
  emptyDesktopActivity,
  isDesktopOverlayVisible,
  OVERLAY_LINGER_MS,
  type DesktopActivityState,
} from "./desktop-activity-fold.js";

const T0 = 1_000_000;

function fold(
  events: Parameters<typeof applyDesktopActivityEvent>[1][],
  nowMs = T0,
): DesktopActivityState {
  return events.reduce(
    (state, event) => applyDesktopActivityEvent(state, event, nowMs),
    emptyDesktopActivity(),
  );
}

function desktopStep(toolUseId: string, toolName = "mcp__desktop__snapshot_app") {
  return {
    kind: "turn-tool-started" as const,
    turnId: "t1",
    toolUseId,
    toolName,
    toolInput: { app: "Discord" },
  };
}

describe("applyDesktopActivityEvent", () => {
  it("tracks only desktop steps — other tools leave the state untouched", () => {
    const untouched = fold([
      { kind: "turn-tool-started", turnId: "t1", toolUseId: "a", toolName: "Read" },
      { kind: "turn-tool-started", turnId: "t1", toolUseId: "b", toolName: "mcp__vynel__list_workspaces" },
    ]);
    expect(untouched).toEqual(emptyDesktopActivity());

    const tracked = fold([desktopStep("a")]);
    expect(tracked.trackedTurn).toEqual({ turnId: "t1", scopeKind: "global" });
    expect(tracked.steps).toHaveLength(1);
    expect(tracked.steps[0]).toMatchObject({ toolUseId: "a", status: "running" });
  });

  it("settles a step in place and stamps lastSettledAtMs", () => {
    const state = fold([
      desktopStep("a"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "a", status: "completed" },
    ]);
    expect(state.steps[0]?.status).toBe("completed");
    expect(state.lastSettledAtMs).toBe(T0);
  });

  it("caps the recent-step list (newest kept)", () => {
    const state = fold(["a", "b", "c", "d", "e"].map((id) => desktopStep(id)));
    expect(state.steps.map((step) => step.toolUseId)).toEqual(["b", "c", "d", "e"]);
  });

  it("evicts settled steps before running ones — a running step never drops mid-operation", () => {
    const state = fold([
      desktopStep("a"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "a", status: "completed" },
      desktopStep("b"),
      desktopStep("c"),
      desktopStep("d"),
      desktopStep("e"),
    ]);
    // "a" (settled) was evicted; the four running steps all survive.
    expect(state.steps.map((step) => step.toolUseId)).toEqual(["b", "c", "d", "e"]);
    expect(state.steps.every((step) => step.status === "running")).toBe(true);

    // Its settle still finds "b" — visibility keeps its linger anchor.
    const settled = applyDesktopActivityEvent(
      state,
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "b", status: "completed" },
      T0,
    );
    expect(settled.lastSettledAtMs).toBe(T0);
  });

  it("desktop approval bells add/remove pending ids; non-desktop bells are ignored", () => {
    const withBell = fold([
      { kind: "turn-approval-requested", turnId: "t1", approvalRequestId: "ap-1", toolName: "mcp__desktop__act_on_app" },
      { kind: "turn-approval-requested", turnId: "t1", approvalRequestId: "ap-2", toolName: "mcp__vynel__register_workspace" },
    ]);
    expect(withBell.pendingApprovalIds).toEqual(["ap-1"]);

    const resolved = applyDesktopActivityEvent(
      withBell,
      { kind: "turn-approval-resolved", turnId: "t1", approvalRequestId: "ap-1" },
      T0,
    );
    expect(resolved.pendingApprovalIds).toEqual([]);
  });

  it("clears everything when the TRACKED turn ends; other turns' ends are ignored", () => {
    const state = fold([desktopStep("a")]);
    const otherEnd = applyDesktopActivityEvent(
      state,
      { kind: "turn-ended", turnId: "other", sessionId: null },
      T0,
    );
    expect(otherEnd).toBe(state);

    const cleared = applyDesktopActivityEvent(
      state,
      { kind: "turn-ended", turnId: "t1", sessionId: null },
      T0,
    );
    expect(cleared).toEqual(emptyDesktopActivity());
  });
});

describe("isDesktopOverlayVisible — the burst/linger rule", () => {
  it("visible while a desktop step runs or an approval waits", () => {
    expect(isDesktopOverlayVisible(fold([desktopStep("a")]), T0)).toBe(true);
    const bell = fold([
      { kind: "turn-approval-requested", turnId: "t1", approvalRequestId: "ap", toolName: "mcp__desktop__act_on_app" },
    ]);
    expect(isDesktopOverlayVisible(bell, T0)).toBe(true);
  });

  it("lingers after the last settle, then hides", () => {
    const settled = fold([
      desktopStep("a"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "a", status: "completed" },
    ]);
    expect(isDesktopOverlayVisible(settled, T0 + OVERLAY_LINGER_MS - 1)).toBe(true);
    expect(isDesktopOverlayVisible(settled, T0 + OVERLAY_LINGER_MS)).toBe(false);
  });

  it("hidden when nothing desktop-related ever happened", () => {
    expect(isDesktopOverlayVisible(emptyDesktopActivity(), T0)).toBe(false);
  });
});
