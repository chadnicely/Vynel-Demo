// Which in-flight turn belongs to a conversation — the one fact the status
// ladder can't read off the durable overview row. (The ladder itself is
// pinned in `@vynel/contracts/chat/session-status`.)

import { describe, expect, it } from "vitest";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import { liveTurnStartedAtForEntry } from "./use-session-statuses.js";

const STARTED_AT = "2026-08-17T10:00:00.000Z";

function makeEntry(
  overrides: Partial<SessionsOverviewEntry> = {},
): SessionsOverviewEntry {
  return {
    sessionId: "sdk-new",
    scope: "spawned",
    workspaceId: null,
    workspaceName: null,
    title: "Research",
    model: null,
    contextTokens: null,
    contextWindow: 200_000,
    lastMessageAt: STARTED_AT,
    statusFacts: {
      setStatus: null,
      statusNote: null,
      statusSetAt: null,
      lastError: null,
      pendingApprovalCount: 0,
      latestUserMessageAt: null,
    },
    segments: [
      {
        sessionId: "sdk-old",
        title: "Research",
        startedAt: STARTED_AT,
        lastMessageAt: STARTED_AT,
        contextTokens: null,
        continuedFromSessionId: null,
        isCurrent: false,
      },
      {
        sessionId: "sdk-new",
        title: "Continued conversation",
        startedAt: STARTED_AT,
        lastMessageAt: STARTED_AT,
        contextTokens: null,
        continuedFromSessionId: "sdk-old",
        isCurrent: true,
      },
    ],
    ...overrides,
  };
}

function makeTurn(
  overrides: Partial<SessionTurnActivity> = {},
): SessionTurnActivity {
  return {
    turnId: "turn-1",
    userId: "u-1",
    scopeKind: "global",
    workspaceId: null,
    sessionId: null,
    origin: "web",
    startedAt: STARTED_AT,
    primarySessionId: null,
    jobId: null,
    threadId: null,
    partialSessionId: null,
    ...overrides,
  } as SessionTurnActivity;
}

describe("liveTurnStartedAtForEntry", () => {
  it("is null when nothing is running", () => {
    expect(liveTurnStartedAtForEntry(makeEntry(), {})).toBeNull();
  });

  it("matches a turn on ANY segment of the chain — a swap must not go dark", () => {
    // The turn runs on the superseded segment (a mid-turn swap moment).
    const turns = { "turn-1": makeTurn({ sessionId: "sdk-old" }) };
    expect(liveTurnStartedAtForEntry(makeEntry(), turns)).toBe(STARTED_AT);
  });

  it("ignores another conversation's turn", () => {
    const turns = { "turn-1": makeTurn({ sessionId: "sdk-elsewhere" }) };
    expect(liveTurnStartedAtForEntry(makeEntry(), turns)).toBeNull();
  });

  it("a WORKSPACE entry also owns its room's turn before the session resolves", () => {
    const entry = makeEntry({ scope: "workspace", workspaceId: "ws-1" });
    const turns = {
      "turn-1": makeTurn({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        sessionId: null,
      }),
    };
    expect(liveTurnStartedAtForEntry(entry, turns)).toBe(STARTED_AT);
  });

  it("a spawned (workspace-less) entry never borrows a room's turn", () => {
    const turns = {
      "turn-1": makeTurn({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        sessionId: "sdk-someone-else",
      }),
    };
    expect(liveTurnStartedAtForEntry(makeEntry(), turns)).toBeNull();
  });
});
