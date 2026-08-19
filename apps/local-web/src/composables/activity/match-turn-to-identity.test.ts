// The ONE predicate every feed reader keys on. What it pins is the wire
// contract: identity travels as `scopeKind` + `primarySessionId`, and nothing
// is inferred from an absence.

import { describe, expect, it } from "vitest";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import {
  isTurnInGlobalArea,
  matchTurnToIdentity,
} from "./match-turn-to-identity.js";

function makeTurn(
  overrides: Partial<SessionTurnActivity> = {},
): SessionTurnActivity {
  return {
    turnId: "turn-1",
    scopeKind: "global",
    workspaceId: null,
    sessionId: null,
    origin: "web",
    startedAt: "2026-08-19T10:00:00.000Z",
    primarySessionId: null,
    ...overrides,
  };
}

// The frames as slice C stamps them.
const globalTurn = makeTurn({
  scopeKind: "global",
  sessionId: "global-segment-1",
  primarySessionId: "global-primary-1",
});
const voiceTurn = makeTurn({
  scopeKind: "voice",
  origin: "voice",
  sessionId: "voice-segment-1",
  primarySessionId: "voice-primary-1",
});
const roomTurn = makeTurn({
  scopeKind: "workspace",
  workspaceId: "ws-1",
  sessionId: "room-segment-1",
});
const spawnedInRoomTurn = makeTurn({
  scopeKind: "workspace",
  workspaceId: "ws-1",
  sessionId: "spawned-segment-1",
  primarySessionId: "spawned-primary-9",
});

describe("matchTurnToIdentity", () => {
  it("`primary` matches ONE continuing conversation, by id", () => {
    const identity = { kind: "primary", primarySessionId: "global-primary-1" } as const;
    expect(matchTurnToIdentity(globalTurn, identity)).toBe(true);
    expect(matchTurnToIdentity(voiceTurn, identity)).toBe(false);
    expect(matchTurnToIdentity(spawnedInRoomTurn, identity)).toBe(false);
  });

  it("`voice` is the spoken thread — one per user, and never a global turn", () => {
    expect(matchTurnToIdentity(voiceTurn, { kind: "voice" })).toBe(true);
    expect(matchTurnToIdentity(globalTurn, { kind: "voice" })).toBe(false);
  });

  it("`workspace` is the ROOM's own thread — not a session spawned inside it", () => {
    const identity = { kind: "workspace", workspaceId: "ws-1" } as const;
    expect(matchTurnToIdentity(roomTurn, identity)).toBe(true);
    expect(matchTurnToIdentity(spawnedInRoomTurn, identity)).toBe(false);
    expect(
      matchTurnToIdentity(roomTurn, { kind: "workspace", workspaceId: "ws-2" }),
    ).toBe(false);
  });

  // The distinction the arc exists to make: `global` is a FAMILY. It answers
  // "is anything alive over there", never "which session do I render".
  it("`global` is the AREA — it holds spawned runs, and excludes voice", () => {
    expect(matchTurnToIdentity(globalTurn, { kind: "global" })).toBe(true);
    expect(
      matchTurnToIdentity(
        makeTurn({ scopeKind: "global", origin: "delegation", primarySessionId: "spawned-primary-9" }),
        { kind: "global" },
      ),
    ).toBe(true);
    expect(matchTurnToIdentity(voiceTurn, { kind: "global" })).toBe(false);
  });
});

describe("isTurnInGlobalArea", () => {
  it("covers the assistant thread AND the spoken thread under it", () => {
    expect(isTurnInGlobalArea(globalTurn)).toBe(true);
    expect(isTurnInGlobalArea(voiceTurn)).toBe(true);
    expect(isTurnInGlobalArea(roomTurn)).toBe(false);
  });
});
