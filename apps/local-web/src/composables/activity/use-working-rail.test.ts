// The rail builder on the REAL wire: every frame below is the shape its
// producer emits after the feed's null-defaulting (`session-activity-feed.ts`
// `begin`) — `primarySessionId` on every global and voice turn, `scopeKind:
// 'voice'` for the spoken thread. The frames no producer can emit any more
// (a global turn naming no primary) are gone from here on purpose: the old
// fixture pinned exactly that shape and stayed green through the regression
// (audit R2-A). The per-producer roster lives in `rail-identity-census.test.ts`.

import { describe, expect, it } from "vitest";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import { buildRailEntities, resolveRailChip } from "./use-working-rail.js";

const GLOBAL_PRIMARY = "global-primary-1";
const VOICE_PRIMARY = "voice-primary-1";

function frame(overrides: Partial<SessionTurnActivity>): SessionTurnActivity {
  return {
    turnId: `turn-${Math.random().toString(36).slice(2, 8)}`,
    scopeKind: "global",
    workspaceId: null,
    sessionId: null,
    origin: "web",
    startedAt: "2026-08-20T10:00:00.000Z",
    primarySessionId: null,
    jobId: null,
    threadId: null,
    partialSessionId: null,
    taskLabel: null,
    personaName: null,
    ...overrides,
  };
}

// streams/global-root-turn.ts — the user's own global turn.
const ownGlobalTurn = frame({ origin: "web", primarySessionId: GLOBAL_PRIMARY });
// sessions/run-global-root-turn.ts — a channel's background root turn.
const telegramTurn = frame({ origin: "telegram", primarySessionId: GLOBAL_PRIMARY });
// streams/global-root-turn.ts — the spoken thread.
const voiceTurn = frame({
  scopeKind: "voice",
  origin: "voice",
  sessionId: "voice-segment-1",
  primarySessionId: VOICE_PRIMARY,
});
// streams/chat-turn.ts — a room's own web turn (names no primary).
const roomTurn = frame({
  scopeKind: "workspace",
  workspaceId: "w1",
  sessionId: "room-segment-1",
  origin: "web",
});
// streams/session-turn.ts — a direct send into a spawned session.
const spawnedDirectSend = frame({
  origin: "web",
  sessionId: "seg-1",
  primarySessionId: "p1",
});
// packages/session delegation/run-task-job.ts — a delegated run on a spawned session.
const spawnedDelegatedRun = frame({
  origin: "delegation",
  jobId: "job-1",
  partialSessionId: "t1",
  primarySessionId: "p1",
  taskLabel: "Reconcile July",
  personaName: "July run",
});

const context = (globalPrimarySessionId: string | null = GLOBAL_PRIMARY) => ({
  approvalWorkspaceIds: new Set(["w1"]),
  globalPrimarySessionId,
});

describe("resolveRailChip — identity, never absence", () => {
  it("the brain is the turn on the GLOBAL primary, whoever drove it", () => {
    expect(resolveRailChip(ownGlobalTurn, GLOBAL_PRIMARY)).toEqual({ kind: "brain" });
    expect(resolveRailChip(telegramTurn, GLOBAL_PRIMARY)).toEqual({ kind: "brain" });
  });

  it("the spoken thread is its own chip — never a session, never the brain", () => {
    expect(resolveRailChip(voiceTurn, GLOBAL_PRIMARY)).toEqual({ kind: "voice" });
    expect(resolveRailChip(voiceTurn, null)).toEqual({ kind: "voice" });
  });

  it("a turn naming ANOTHER primary under global is that session's", () => {
    expect(resolveRailChip(spawnedDirectSend, GLOBAL_PRIMARY)).toEqual({
      kind: "session",
      primarySessionId: "p1",
    });
    expect(resolveRailChip(spawnedDelegatedRun, GLOBAL_PRIMARY)).toEqual({
      kind: "session",
      primarySessionId: "p1",
    });
  });

  it("a room's own turn is the room's; a colleague under the room is its own session", () => {
    expect(resolveRailChip(roomTurn, GLOBAL_PRIMARY)).toEqual({
      kind: "workspace",
      workspaceId: "w1",
    });
    const colleagueInRoom = frame({
      scopeKind: "workspace",
      workspaceId: "w1",
      origin: "delegation",
      primarySessionId: "agent-1",
      personaName: "Noah",
    });
    // Needs no global id — a workspace-scoped primary is never the brain's.
    expect(resolveRailChip(colleagueInRoom, null)).toEqual({
      kind: "session",
      primarySessionId: "agent-1",
    });
  });

  it("until the global primary is known, a global-family primary turn is NOT placed — no guess", () => {
    expect(resolveRailChip(ownGlobalTurn, null)).toBeNull();
    expect(resolveRailChip(spawnedDirectSend, null)).toBeNull();
  });
});

describe("buildRailEntities", () => {
  it("one icon per entity — sessions, workspaces, colleagues, the brain, the voice thread; working beats queued", () => {
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
        frame({ scopeKind: "workspace", workspaceId: "w1", origin: "delegation" }),
        // The same spawned run on the feed — merges into its poll-built icon.
        spawnedDelegatedRun,
        // The brain's background turn (a Telegram reply) and the user's own
        // global turn are ONE brain icon.
        telegramTurn,
        ownGlobalTurn,
        voiceTurn,
      ],
      context(),
    );

    expect(entities.map((entity) => [entity.kind, entity.key, entity.isWorking])).toEqual([
      ["session", "session:p1", true],
      ["workspace", "ws:w1", true],
      ["session", "session:p2", true],
      ["brain", "brain", true],
      ["voice", "voice", true],
    ]);
    expect(entities.find((entity) => entity.key === "session:p2")!.isColleague).toBe(true);
    expect(entities.find((entity) => entity.key === "ws:w1")!.hasAttention).toBe(true);
    expect(entities.find((entity) => entity.key === "brain")!.label).toBe("Claude");
    expect(entities.find((entity) => entity.key === "voice")!.label).toBe("Voice chat");
  });

  it("a feed-only spawned turn rails as a session chip carrying its identity (the component names it from the overview)", () => {
    const [entity] = buildRailEntities([], [spawnedDirectSend], context());
    expect(entity).toMatchObject({
      kind: "session",
      key: "session:p1",
      primarySessionId: "p1",
      label: "",
      segmentId: "seg-1",
    });
  });

  it("a resolved label and segment fill a blank one, never the reverse", () => {
    const [entity] = buildRailEntities(
      [],
      [
        frame({ origin: "web", primarySessionId: "p1" }),
        frame({ origin: "delegation", primarySessionId: "p1", sessionId: "seg-1", personaName: "July run" }),
      ],
      context(),
    );
    expect(entity).toMatchObject({ label: "July run", segmentId: "seg-1" });
  });

  it("an idle roster renders an empty rail — strictly what's active now", () => {
    expect(buildRailEntities([], [], context())).toEqual([]);
  });
});
