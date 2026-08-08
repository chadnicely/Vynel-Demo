import { describe, expect, it } from "vitest";
import { buildRailEntities } from "./use-working-rail.js";

describe("buildRailEntities", () => {
  it("one icon per entity — sessions, workspaces, colleagues, the brain; working beats queued; the user's own web turn never rails", () => {
    const entities = buildRailEntities(
      [
        {
          partialSessionId: "t1",
          workspaceId: null,
          workspaceName: "Invoices",
          targetPrimarySessionId: "p1",
          sessionName: "July run",
          targetSessionId: "seg-1",
          status: "claimed",
          jobKind: "task",
        },
        // A second task on the SAME session — still one icon (Q4).
        {
          partialSessionId: "t2",
          workspaceId: null,
          workspaceName: "Invoices",
          targetPrimarySessionId: "p1",
          sessionName: "July run",
          targetSessionId: "seg-1",
          status: "pending",
          jobKind: "task",
        },
        {
          partialSessionId: "t3",
          workspaceId: "w1",
          workspaceName: "Invoices",
          targetPrimarySessionId: null,
          status: "pending",
          jobKind: "task",
        },
        {
          partialSessionId: "t4",
          workspaceId: null,
          workspaceName: "Noah",
          targetPrimarySessionId: "p2",
          sessionName: "Noah",
          targetSessionId: "seg-2",
          status: "claimed",
          jobKind: "agent-run",
        },
      ],
      [
        // The feed marks w1 as actually WORKING (the queued job alone wouldn't).
        { scopeKind: "workspace", origin: "delegation", workspaceId: "w1" },
        // The brain's own background turn — a channel reply rails (spec edge).
        { scopeKind: "global", origin: "telegram" },
        // The user's OWN web turn is the thread they're looking at — never rails.
        { scopeKind: "global", origin: "web" },
      ],
      new Set(["w1"]),
    );

    expect(entities.map((entity) => [entity.kind, entity.key, entity.isWorking])).toEqual([
      ["session", "session:p1", true],
      ["workspace", "ws:w1", true],
      ["session", "session:p2", true],
      ["brain", "brain", true],
    ]);
    expect(entities.find((entity) => entity.key === "session:p2")!.isColleague).toBe(true);
    expect(entities.find((entity) => entity.key === "ws:w1")!.hasAttention).toBe(true);
  });

  it("an idle roster renders an empty rail — strictly what's active now", () => {
    expect(buildRailEntities([], [], new Set())).toEqual([]);
  });
});
