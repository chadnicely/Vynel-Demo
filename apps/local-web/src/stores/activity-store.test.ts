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
      outcome: "ended",
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
      outcome: "ended",
    });
    expect(store.serverTurns).toEqual({});

    store.applyServerActivity(started("t3"));
    store.resetServerTurns();
    expect(store.serverTurns).toEqual({});
    expect(store.isTurnRunning).toBe(false);
  });

  it("turn-step narration never removes a live turn (only turn-ended does)", () => {
    const store = useActivityStore();
    store.applyServerActivity(started("t4"));
    store.applyServerActivity({
      kind: "turn-tool-started",
      turnId: "t4",
      toolUseId: "toolu_1",
      toolName: "mcp__desktop__snapshot_app",
    });
    store.applyServerActivity({
      kind: "turn-tool-settled",
      turnId: "t4",
      toolUseId: "toolu_1",
      status: "completed",
    });
    store.applyServerActivity({
      kind: "turn-approval-requested",
      turnId: "t4",
      approvalRequestId: "ap-1",
      toolName: "mcp__desktop__act_on_app",
    });
    expect(store.serverTurns["t4"]).toBeDefined();
    expect(store.isTurnRunning).toBe(true);

    store.applyServerActivity({ kind: "turn-ended", turnId: "t4", sessionId: null, outcome: "ended" });
    expect(store.serverTurns["t4"]).toBeUndefined();
  });

  it("local turn counting still drives the presence flag", () => {
    const store = useActivityStore();
    store.turnStarted();
    expect(store.isTurnRunning).toBe(true);
    store.turnEnded();
    expect(store.isTurnRunning).toBe(false);
  });

  it("serverTurnForSession resolves the running turn on one session", () => {
    const store = useActivityStore();
    store.applyServerActivity(
      started("t5", { scopeKind: "workspace", workspaceId: "ws-1", sessionId: "sess-5" }),
    );
    expect(store.serverTurnForSession("sess-5")?.turnId).toBe("t5");
    expect(store.serverTurnForSession("sess-other")).toBeNull();

    store.applyServerActivity({ kind: "turn-ended", turnId: "t5", sessionId: "sess-5", outcome: "ended" });
    expect(store.serverTurnForSession("sess-5")).toBeNull();
  });

  // The continuous thread's fallback before the primary's first turn is
  // bridged: the turn running on THIS identity — never a neighbour's.
  it("runningPrimarySessionIdFor binds a room to its OWN thread, never a session spawned in it", () => {
    const store = useActivityStore();
    expect(store.runningPrimarySessionIdFor({ kind: "workspace", workspaceId: "ws-1" })).toBeNull();

    // A spawned session's turn in the workspace (stamps its identity) — not the room's.
    store.applyServerActivity(
      started("t-spawned", {
        scopeKind: "workspace",
        workspaceId: "ws-1",
        sessionId: "spawned-1",
        primarySessionId: "identity-1",
      }),
    );
    expect(store.runningPrimarySessionIdFor({ kind: "workspace", workspaceId: "ws-1" })).toBeNull();

    // The room's own turn — its session id is known only after session-created.
    store.applyServerActivity(
      started("t-primary", { scopeKind: "workspace", workspaceId: "ws-1", sessionId: null }),
    );
    expect(store.runningPrimarySessionIdFor({ kind: "workspace", workspaceId: "ws-1" })).toBeNull();
    store.applyServerActivity({ kind: "turn-updated", turnId: "t-primary", sessionId: "sess-first" });
    expect(store.runningPrimarySessionIdFor({ kind: "workspace", workspaceId: "ws-1" })).toBe("sess-first");
    expect(store.runningPrimarySessionIdFor({ kind: "workspace", workspaceId: "ws-2" })).toBeNull();
  });

  // The agent-3 / agent-5 repro, made permanent. A voice-first user has NO
  // global head, so the Global chat fell through to this reader — which handed
  // back the spoken segment and rendered the private thread as the assistant's.
  it("a running VOICE turn is never the global thread", () => {
    const store = useActivityStore();
    store.applyServerActivity(
      started("t-voice", {
        scopeKind: "voice",
        origin: "voice",
        sessionId: "voice-segment-1",
        primarySessionId: "voice-primary-1",
      }),
    );
    expect(
      store.runningPrimarySessionIdFor({ kind: "primary", primarySessionId: "global-primary-1" }),
    ).toBeNull();
    // …and the global AREA does not claim it as a thread either.
    expect(store.runningPrimarySessionIdFor({ kind: "global" })).toBeNull();
    // The area IS alive, though: the presence dot covers speech (voice is a
    // child of global), which is what it has always shown.
    expect(store.hasGlobalServerTurn).toBe(true);
    expect(store.globalServerTurnOrigin).toBe("voice");

    // The global thread's own turn, matched by the id /root/continuing returns.
    store.applyServerActivity(
      started("t-root", { sessionId: "global-segment-1", primarySessionId: "global-primary-1" }),
    );
    expect(
      store.runningPrimarySessionIdFor({ kind: "primary", primarySessionId: "global-primary-1" }),
    ).toBe("global-segment-1");
    // A DELEGATED run announcing in the global scope on its own identity is
    // still not the assistant's thread.
    expect(
      store.runningPrimarySessionIdFor({ kind: "primary", primarySessionId: "spawned-primary-9" }),
    ).toBeNull();
  });

  it("globalServerTurnOrigin names the OLDEST live turn in the area, not whichever arrived last", () => {
    const store = useActivityStore();
    store.applyServerActivity(
      started("t-web", { sessionId: "g-1", startedAt: "2026-07-19T10:00:00.000Z" }),
    );
    store.applyServerActivity(
      started("t-voice", {
        scopeKind: "voice",
        origin: "voice",
        sessionId: "v-1",
        startedAt: "2026-07-19T10:00:05.000Z",
      }),
    );
    expect(store.globalServerTurnOrigin).toBe("web");
  });
});
