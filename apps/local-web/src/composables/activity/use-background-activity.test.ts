// The B7 roster builder: delegations pair with their turns by trace key and
// group by the working identity (colleague/spawned primary, workspace
// persona); unclaimed turns (channels, schedules, interactive) stand alone;
// the durable seed fills turns the stream hasn't reported (stream wins);
// working groups sort first.

import { describe, expect, it } from "vitest";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import {
  buildBackgroundActivity,
  type BackgroundDelegationInput,
} from "./use-background-activity.js";

function makeDelegation(
  overrides: Partial<BackgroundDelegationInput> = {},
): BackgroundDelegationInput {
  return {
    partialSessionId: "trace-1",
    workspaceId: null,
    workspaceName: "Nova",
    targetPrimarySessionId: "primary-1",
    sessionName: "Nova",
    taskLabel: "Research WAL mode",
    status: "claimed",
    ...overrides,
  };
}

function makeTurn(
  overrides: Partial<SessionTurnActivity> = {},
): SessionTurnActivity {
  return {
    turnId: "turn-1",
    scopeKind: "global",
    workspaceId: null,
    sessionId: "sdk-1",
    origin: "delegation",
    startedAt: "2026-08-04T10:00:00.000Z",
    partialSessionId: "trace-1",
    ...overrides,
  };
}

const noWorkspaces = () => null;

describe("buildBackgroundActivity", () => {
  it("pairs a claimed delegation with its turn and takes the turn's identity", () => {
    const groups = buildBackgroundActivity({
      delegations: [makeDelegation()],
      serverTurns: [makeTurn()],
      seedTurns: [],
      workspaceById: noWorkspaces,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "primary-1",
      personaName: "Nova",
      sessionId: "sdk-1",
    });
    expect(groups[0]!.rows[0]).toMatchObject({
      state: "working",
      taskLabel: "Research WAL mode",
      origin: "delegation",
      startedAt: "2026-08-04T10:00:00.000Z",
      turnId: "turn-1",
    });
  });

  it("queued tasks on the same target list under the working one", () => {
    const groups = buildBackgroundActivity({
      delegations: [
        makeDelegation({ partialSessionId: "trace-2", status: "pending" }),
        makeDelegation(),
      ],
      serverTurns: [makeTurn()],
      seedTurns: [],
      workspaceById: noWorkspaces,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows.map((row) => row.state)).toEqual([
      "working",
      "queued",
    ]);
  });

  it("workspace-target tasks group under the workspace persona — the MANAGER when known", () => {
    const delegation = makeDelegation({
      targetPrimarySessionId: null,
      sessionName: null,
      workspaceId: "w1",
      workspaceName: "Acme",
      status: "pending",
    });
    const withManager = buildBackgroundActivity({
      delegations: [delegation],
      serverTurns: [],
      seedTurns: [],
      workspaceById: (id) =>
        id === "w1" ? { name: "Acme", managerName: "Noah" } : null,
    });
    expect(withManager[0]).toMatchObject({
      key: "ws:w1",
      personaName: "Noah",
      workspaceName: "Acme",
    });
    expect(withManager[0]!.rows[0]!.state).toBe("queued");

    // No manager known — the workspace name still names the persona.
    const withoutManager = buildBackgroundActivity({
      delegations: [delegation],
      serverTurns: [],
      seedTurns: [],
      workspaceById: noWorkspaces,
    });
    expect(withoutManager[0]!.personaName).toBe("Acme");
  });

  it("a turn no delegation claims stands alone — persona from the workspace manager, 'Assistant' for global", () => {
    const groups = buildBackgroundActivity({
      delegations: [],
      serverTurns: [
        makeTurn({
          turnId: "turn-tg",
          partialSessionId: null,
          origin: "telegram",
          workspaceId: "w1",
          sessionId: "sdk-ws",
        }),
        makeTurn({
          turnId: "turn-web",
          partialSessionId: null,
          origin: "web",
          sessionId: "sdk-root",
          startedAt: "2026-08-04T11:00:00.000Z",
        }),
      ],
      seedTurns: [],
      workspaceById: (id) =>
        id === "w1" ? { name: "Acme", managerName: "Noah" } : null,
    });
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      personaName: "Noah",
      workspaceName: "Acme",
      sessionId: "sdk-ws",
    });
    expect(groups[0]!.rows[0]!.origin).toBe("telegram");
    expect(groups[1]!.personaName).toBe("Assistant");
  });

  it("the durable seed fills turns the stream hasn't reported — the stream wins on overlap", () => {
    const groups = buildBackgroundActivity({
      delegations: [],
      serverTurns: [makeTurn({ personaName: "Nova (live)" })],
      seedTurns: [
        // Same turn from the seed (no enrichment) — must NOT duplicate.
        makeTurn(),
        makeTurn({ turnId: "turn-2", partialSessionId: null, sessionId: "sdk-2" }),
      ],
      workspaceById: noWorkspaces,
    });
    expect(groups).toHaveLength(2);
    const personaNames = groups.map((group) => group.personaName);
    expect(personaNames).toContain("Nova (live)");
  });

  it("working groups sort before queued-only groups", () => {
    const groups = buildBackgroundActivity({
      delegations: [
        makeDelegation({
          partialSessionId: "trace-q",
          targetPrimarySessionId: "primary-q",
          sessionName: "Sleepy",
          status: "pending",
        }),
        makeDelegation(),
      ],
      serverTurns: [makeTurn()],
      seedTurns: [],
      workspaceById: noWorkspaces,
    });
    expect(groups.map((group) => group.personaName)).toEqual([
      "Nova",
      "Sleepy",
    ]);
  });
});
