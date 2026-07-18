// The activity store's server-turn fold: feed events in, scope liveness out.

import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";
import { useActivityStore } from "./activity-store.js";

function started(
  turnId: string,
  overrides: Partial<Extract<SessionActivityEvent, { kind: "turn-started" }>> = {},
): SessionActivityEvent {
  return {
    kind: "turn-started",
    turnId,
    scopeKind: "global",
    workspaceId: null,
    sessionId: null,
    origin: "web",
    startedAt: "2026-07-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("activity store — server turns", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("folds turn-started / turn-updated / turn-ended", () => {
    const store = useActivityStore();
    store.applyServerActivity(started("t1", { origin: "telegram" }));
    expect(store.hasGlobalServerTurn).toBe(true);
    expect(store.globalServerTurnOrigin).toBe("telegram");
    expect(store.isTurnRunning).toBe(true);

    store.applyServerActivity({
      kind: "turn-updated",
      turnId: "t1",
      sessionId: "sess-1",
    });
    expect(store.serverTurns["t1"]?.sessionId).toBe("sess-1");

    store.applyServerActivity({
      kind: "turn-ended",
      turnId: "t1",
      sessionId: "sess-1",
    });
    expect(store.hasGlobalServerTurn).toBe(false);
    expect(store.isTurnRunning).toBe(false);
  });

  it("scopes workspace turns to their workspace", () => {
    const store = useActivityStore();
    store.applyServerActivity(
      started("t2", {
        scopeKind: "workspace",
        workspaceId: "ws-1",
        origin: "schedule",
      }),
    );
    expect(store.hasServerTurnInWorkspace("ws-1")).toBe(true);
    expect(store.hasServerTurnInWorkspace("ws-2")).toBe(false);
    expect(store.hasGlobalServerTurn).toBe(false);
  });

  it("ignores updates/ends for unseen turns and resets on feed drop", () => {
    const store = useActivityStore();
    store.applyServerActivity({
      kind: "turn-updated",
      turnId: "ghost",
      sessionId: "sess-9",
    });
    store.applyServerActivity({
      kind: "turn-ended",
      turnId: "ghost",
      sessionId: null,
    });
    expect(store.serverTurns).toEqual({});

    store.applyServerActivity(started("t3"));
    store.resetServerTurns();
    expect(store.serverTurns).toEqual({});
    expect(store.isTurnRunning).toBe(false);
  });

  it("local turn counting still drives the presence flag", () => {
    const store = useActivityStore();
    store.turnStarted();
    expect(store.isTurnRunning).toBe(true);
    store.turnEnded();
    expect(store.isTurnRunning).toBe(false);
  });
});
