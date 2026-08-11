import { describe, expect, it } from "vitest";
import {
  applyDesktopActivityEvent,
  emptyDesktopActivity,
  isControllingDesktop,
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

const PLAN_TOOL = "mcp__desktop__propose_desktop_plan";
const planInput = {
  goal: "Open Chrome and search the latest song on YouTube",
  steps: ["Focus Chrome", "Open youtube.com", "Search"],
  apps: [{ app: "Google Chrome", tier: "full" }],
};

function planStep(toolUseId: string, toolInput: unknown = planInput) {
  return {
    kind: "turn-tool-started" as const,
    turnId: "t1",
    toolUseId,
    toolName: PLAN_TOOL,
    toolInput,
  };
}

describe("the active plan — looking vs controlling", () => {
  it("stays LOOKING while only reading the desktop", () => {
    const state = fold([
      desktopStep("a"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "a", status: "completed" },
    ]);
    expect(isControllingDesktop(state)).toBe(false);
    expect(state.activePlan).toBeNull();
  });

  it("becomes CONTROLLING once a proposed plan completes (approved + armed)", () => {
    const state = fold([
      planStep("p1"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "p1", status: "completed" },
    ]);
    expect(isControllingDesktop(state)).toBe(true);
    expect(state.activePlan).toEqual({ goal: planInput.goal, steps: planInput.steps });
  });

  it("a DENIED plan never takes control", () => {
    // A denied card means the tool never ran, so nothing was armed — the
    // overlay must not claim Claude is driving.
    for (const status of ["denied", "failed", "cancelled"] as const) {
      const state = fold([
        planStep("p1"),
        { kind: "turn-tool-settled", turnId: "t1", toolUseId: "p1", status },
      ]);
      expect(isControllingDesktop(state)).toBe(false);
    }
  });

  it("ignores an unparseable plan input rather than showing a half plan", () => {
    const state = fold([
      planStep("p1", { goal: "g", steps: [], apps: [] }),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "p1", status: "completed" },
    ]);
    expect(state.activePlan).toBeNull();
  });

  it("a re-proposed plan replaces the shown one", () => {
    const second = { ...planInput, goal: "Reply in Discord", steps: ["Open", "Send"] };
    const state = fold([
      planStep("p1"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "p1", status: "completed" },
      planStep("p2", second),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "p2", status: "completed" },
    ]);
    expect(state.activePlan?.goal).toBe("Reply in Discord");
  });

  it("control ends with the turn", () => {
    const state = fold([
      planStep("p1"),
      { kind: "turn-tool-settled", turnId: "t1", toolUseId: "p1", status: "completed" },
      { kind: "turn-ended", turnId: "t1", sessionId: null },
    ]);
    expect(isControllingDesktop(state)).toBe(false);
    expect(state).toEqual(emptyDesktopActivity());
  });
});

describe("applyDesktopActivityEvent", () => {
  it("tracks only desktop steps — other tools leave the state untouched", () => {
    const untouched = fold([
      { kind: "turn-tool-started", turnId: "t1", toolUseId: "a", toolName: "Read" },
      { kind: "turn-tool-started", turnId: "t1", toolUseId: "b", toolName: "mcp__vynel__list_workspaces" },
    ]);
    expect(untouched).toEqual(emptyDesktopActivity());

    const tracked = fold([desktopStep("a")]);
    // origin/partialSessionId are null here BY DESIGN: a step frame alone never
    // says who is driving, and only a `turn-started` teaches that. Stop keys on
    // it, so "unknown" must stay unknown rather than defaulting to the root.
    expect(tracked.trackedTurn).toEqual({
      turnId: "t1",
      scopeKind: "global",
      origin: null,
      partialSessionId: null,
    });
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

// Desktop autopilot (2026-08-11): desktop work no longer rides only the global
// root. A spawned session drives it in the background, and that turn is stopped
// through a DIFFERENT route — so the fold must learn who is driving, and must
// stay honest when it doesn't know.
describe("applyDesktopActivityEvent — who is driving (Stop targeting)", () => {
  function turnStarted(overrides: Record<string, unknown> = {}) {
    return {
      kind: "turn-started",
      turnId: "t1",
      scopeKind: "global",
      workspaceId: null,
      sessionId: null,
      origin: "web",
      startedAt: new Date().toISOString(),
      ...overrides,
    } as never;
  }

  it("learns a DELEGATED turn's stop handle from turn-started", () => {
    const state = fold([
      turnStarted({ origin: "delegation", partialSessionId: "ps-9" }),
      desktopStep("a"),
    ]);
    expect(state.trackedTurn).toMatchObject({
      turnId: "t1",
      origin: "delegation",
      partialSessionId: "ps-9",
    });
  });

  it("keeps a root turn's origin so Stop uses the root interrupt", () => {
    const state = fold([turnStarted({ origin: "web" }), desktopStep("a")]);
    expect(state.trackedTurn).toMatchObject({ origin: "web", partialSessionId: null });
  });

  it("turn-started ALONE never reveals the overlay — only a desktop step does", () => {
    const state = fold([turnStarted({ origin: "delegation", partialSessionId: "ps-9" })]);
    expect(state.steps).toHaveLength(0);
    expect(isDesktopOverlayVisible(state, Date.now())).toBe(false);
  });

  it("keeps following the turn doing DESKTOP work when another turn starts", () => {
    const state = fold([
      turnStarted({ origin: "delegation", partialSessionId: "ps-9" }),
      desktopStep("a"),
      turnStarted({ turnId: "t2", origin: "web" }),
    ]);
    expect(state.trackedTurn).toMatchObject({ turnId: "t1", origin: "delegation" });
  });
});

// The three symptoms Kafi hit live (2026-08-11), all one root cause: an earlier
// version set `trackedTurn` straight from `turn-started` and ignored later ones,
// so the fold latched onto the FIRST turn it ever saw — and `turn-started` fires
// for every turn, including the many that never touch the desktop.
describe("following the right turn (the live overlay bugs)", () => {
  function turnStarted(overrides: Record<string, unknown> = {}) {
    return {
      kind: "turn-started",
      turnId: "t1",
      scopeKind: "global",
      workspaceId: null,
      sessionId: null,
      origin: "web",
      startedAt: new Date().toISOString(),
      ...overrides,
    } as never;
  }
  const stepOn = (turnId: string, toolUseId: string) =>
    ({
      kind: "turn-tool-started" as const,
      turnId,
      toolUseId,
      toolName: "mcp__desktop__snapshot_app",
      toolInput: { app: "Discord" },
    }) as never;

  // BUG B: Stop sat disabled. A plain chat turn started first, the fold latched
  // onto it, and the real desktop step then arrived under a different turnId
  // with origin null — which is exactly what disables the button.
  it("resolves origin for the desktop turn even when an unrelated turn started first", () => {
    const state = fold([
      turnStarted({ turnId: "chat-turn", origin: "web" }),
      turnStarted({ turnId: "desk-turn", origin: "delegation", partialSessionId: "ps-7" }),
      stepOn("desk-turn", "a"),
    ]);
    expect(state.trackedTurn).toMatchObject({
      turnId: "desk-turn",
      origin: "delegation",
      partialSessionId: "ps-7",
    });
  });

  // BUG C: a NEW desktop task showed the PREVIOUS task's steps and plan.
  it("starts clean when a different turn takes over the desktop", () => {
    const first = fold([
      turnStarted({ turnId: "old", origin: "web" }),
      stepOn("old", "a"),
      { kind: "turn-tool-settled", turnId: "old", toolUseId: "a", status: "completed" } as never,
    ]);
    expect(first.steps).toHaveLength(1);

    const second = applyDesktopActivityEvent(first, stepOn("new", "b"), T0);
    expect(second.trackedTurn?.turnId).toBe("new");
    expect(second.steps).toHaveLength(1);
    expect(second.steps[0]?.toolUseId).toBe("b");
    expect(second.activePlan).toBeNull();
  });

  // BUG A: Stop in the CHAT ended the turn, but the overlay stayed up because
  // the tracked turn was a stale one that never received a turn-ended.
  it("hides when the turn actually doing desktop work ends", () => {
    const state = fold([
      turnStarted({ turnId: "chat-turn", origin: "web" }),
      turnStarted({ turnId: "desk-turn", origin: "web" }),
      stepOn("desk-turn", "a"),
    ]);
    expect(isDesktopOverlayVisible(state, T0)).toBe(true);

    const ended = applyDesktopActivityEvent(
      state,
      { kind: "turn-ended", turnId: "desk-turn", sessionId: null },
      T0,
    );
    expect(ended.trackedTurn).toBeNull();
    expect(isDesktopOverlayVisible(ended, T0)).toBe(false);
  });

  it("a turn-started alone still never reveals the overlay", () => {
    const state = fold([turnStarted({ turnId: "chat-turn" }), turnStarted({ turnId: "other" })]);
    expect(isDesktopOverlayVisible(state, T0)).toBe(false);
    expect(state.trackedTurn).toBeNull();
  });

  it("bounds the remembered-turn lookup — every turn publishes turn-started", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      turnStarted({ turnId: `t-${index}`, origin: "web" }),
    );
    const state = fold(many);
    expect(Object.keys(state.knownTurns).length).toBeLessThanOrEqual(24);
    // The most recent survive — those are the ones a step could still name.
    expect(state.knownTurns["t-59"]).toBeDefined();
  });
});
