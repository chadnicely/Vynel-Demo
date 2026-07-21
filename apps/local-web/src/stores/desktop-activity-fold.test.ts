import { describe, expect, it } from "vitest";
import {
  applyDesktopActivityEvent,
  emptyDesktopActivity,
  isDesktopOverlayVisible,
  IDLE_HIDE_MS,
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

  it("settles a step in place and stamps lastActivityAtMs", () => {
    const state = fold([
      desktopStep("a"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "a", status: "completed" },
    ]);
    expect(state.steps[0]?.status).toBe("completed");
    expect(state.lastActivityAtMs).toBe(T0);
  });

  it("keeps the whole sequence up to the cap (50) — the log is scrollable", () => {
    const many = Array.from({ length: 60 }, (_, i) => desktopStep(`s${i}`));
    const state = fold(many);
    expect(state.steps).toHaveLength(50);
    // Newest kept (oldest evicted).
    expect(state.steps.at(-1)?.toolUseId).toBe("s59");
    expect(state.steps[0]?.toolUseId).toBe("s10");
  });

  it("at the cap, evicts a SETTLED step before any running one", () => {
    // 50 running steps, settle the oldest, then one more running step arrives →
    // the settled one is evicted, never a running step (which would orphan its
    // later settle and could hide the overlay mid-operation).
    const fifty = Array.from({ length: 50 }, (_, i) => desktopStep(`s${i}`));
    const state = fold([
      ...fifty,
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "s0", status: "completed" },
      desktopStep("s50"),
    ]);
    expect(state.steps).toHaveLength(50);
    expect(state.steps.some((step) => step.toolUseId === "s0")).toBe(false); // settled one evicted
    expect(state.steps.every((step) => step.status === "running")).toBe(true);
    expect(state.steps.at(-1)?.toolUseId).toBe("s50");
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

describe("isDesktopOverlayVisible — continuous while active", () => {
  it("visible while a desktop step runs or an approval waits", () => {
    expect(isDesktopOverlayVisible(fold([desktopStep("a")]), T0)).toBe(true);
    const bell = fold([
      { kind: "turn-approval-requested", turnId: "t1", approvalRequestId: "ap", toolName: "mcp__desktop__act_on_app" },
    ]);
    expect(isDesktopOverlayVisible(bell, T0)).toBe(true);
  });

  it("stays up across a multi-step sequence — no flicker between steps", () => {
    // Step A settles at T0; step B starts 15s later (>the OLD 8s linger, which
    // would have hidden then re-shown). With the idle-hide window it stays up.
    let state = fold([
      desktopStep("a"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "a", status: "completed" },
    ]);
    // 15s later, still visible (within the 20s idle window).
    expect(isDesktopOverlayVisible(state, T0 + 15_000)).toBe(true);
    // A new step at T0+15s refreshes the activity stamp.
    state = applyDesktopActivityEvent(state, desktopStep("b"), T0 + 15_000);
    expect(isDesktopOverlayVisible(state, T0 + 15_000)).toBe(true); // running
  });

  it("hides IDLE_HIDE_MS after the last desktop activity", () => {
    const settled = fold([
      desktopStep("a"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "a", status: "completed" },
    ]);
    expect(isDesktopOverlayVisible(settled, T0 + IDLE_HIDE_MS - 1)).toBe(true);
    expect(isDesktopOverlayVisible(settled, T0 + IDLE_HIDE_MS)).toBe(false);
  });

  it("hidden when nothing desktop-related ever happened", () => {
    expect(isDesktopOverlayVisible(emptyDesktopActivity(), T0)).toBe(false);
  });
});
