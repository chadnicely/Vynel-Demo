// Pins the ONE status derivation (deriveView): the precedence order, the
// set-state supersession rule, and the failed-turn problem detection.

import { describe, it, expect } from "vitest";
import type { WorkspaceStatusReport } from "@vynel/contracts/workspaces/workspace-status";
import { deriveView } from "./use-workspace-status.js";

const T0 = new Date("2026-08-14T10:00:00Z").getTime();

function report(overrides: Partial<WorkspaceStatusReport> = {}): WorkspaceStatusReport {
  return {
    workspaceId: "ws-1",
    setStatus: null,
    statusNote: null,
    statusSetAt: null,
    latestTurn: null,
    tasksTotal: 0,
    tasksDone: 0,
    ...overrides,
  };
}

describe("deriveView", () => {
  it("nothing at all = not_running", () => {
    expect(deriveView(null, null, false).status).toBe("not_running");
    expect(deriveView(report(), null, false).status).toBe("not_running");
  });

  it("an in-flight turn = running", () => {
    expect(deriveView(report(), T0, false).status).toBe("running");
  });

  it("a report-side open turn counts as running (boot window before the feed)", () => {
    const view = deriveView(
      report({
        latestTurn: { startedAt: new Date(T0).toISOString(), endedAt: null, endedReason: null },
      }),
      null,
      false,
    );
    expect(view.status).toBe("running");
  });

  it("a pending approval/ask = needs_input, even while running", () => {
    expect(deriveView(report(), T0, true).status).toBe("needs_input");
  });

  it("a FAILED latest turn = problem; a newer live turn clears it", () => {
    const failed = report({
      latestTurn: {
        startedAt: new Date(T0).toISOString(),
        endedAt: new Date(T0 + 1000).toISOString(),
        endedReason: "failed",
      },
    });
    expect(deriveView(failed, null, false).status).toBe("problem");
    // The user intervened — a new turn runs; the stale failure no longer paints red.
    expect(deriveView(failed, T0 + 60_000, false).status).toBe("running");
  });

  it("an ORPHANED latest turn (process died mid-run) = problem", () => {
    const orphaned = report({
      latestTurn: {
        startedAt: new Date(T0).toISOString(),
        endedAt: new Date(T0 + 1000).toISOString(),
        endedReason: "orphaned",
      },
    });
    expect(deriveView(orphaned, null, false).status).toBe("problem");
  });

  it("set completed DURING the turn stands after it ends, with its note", () => {
    const view = deriveView(
      report({
        setStatus: "completed",
        statusNote: "All 5 tasks shipped",
        statusSetAt: new Date(T0 + 5000).toISOString(),
        latestTurn: {
          startedAt: new Date(T0).toISOString(),
          endedAt: new Date(T0 + 8000).toISOString(),
          endedReason: "ended",
        },
        tasksTotal: 5,
        tasksDone: 5,
      }),
      null,
      false,
    );
    expect(view.status).toBe("completed");
    expect(view.note).toBe("All 5 tasks shipped");
    expect(view.tasksDone).toBe(5);
  });

  it("the NEXT message supersedes a set state (turn starts after setAt)", () => {
    const superseded = report({
      setStatus: "completed",
      statusSetAt: new Date(T0 + 5000).toISOString(),
      latestTurn: {
        startedAt: new Date(T0 + 60_000).toISOString(),
        endedAt: null,
        endedReason: null,
      },
    });
    expect(deriveView(superseded, T0 + 60_000, false).status).toBe("running");
    expect(deriveView(superseded, T0 + 60_000, false).note).toBeNull();
  });

  it("a completed set mid-turn shows running WITHOUT the note until the turn ends", () => {
    // The note travels only when the set state is what actually shows — a
    // completed-note under a "working" kicker would misattribute.
    const midTurn = report({
      setStatus: "completed",
      statusNote: "All done",
      statusSetAt: new Date(T0 + 5000).toISOString(),
      latestTurn: {
        startedAt: new Date(T0).toISOString(),
        endedAt: null,
        endedReason: null,
      },
    });
    const view = deriveView(midTurn, T0, false);
    expect(view.status).toBe("running");
    expect(view.note).toBeNull();
  });

  it("set problem outranks running; set needs_input outranks running", () => {
    const stuck = report({
      setStatus: "problem",
      statusSetAt: new Date(T0 + 5000).toISOString(),
      latestTurn: {
        startedAt: new Date(T0).toISOString(),
        endedAt: null,
        endedReason: null,
      },
    });
    expect(deriveView(stuck, T0, false).status).toBe("problem");

    const concluded = report({
      setStatus: "needs_input",
      statusSetAt: new Date(T0 + 5000).toISOString(),
      latestTurn: {
        startedAt: new Date(T0).toISOString(),
        endedAt: null,
        endedReason: null,
      },
    });
    expect(deriveView(concluded, T0, false).status).toBe("needs_input");
  });
});
