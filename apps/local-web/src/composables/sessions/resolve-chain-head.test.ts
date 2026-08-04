// The B6 chain-head resolution: an opened id resolves to its entry's NEWEST
// segment — the fix for the mid-watch compaction swap (the old accepted
// freeze), and the superseded flag drives the "conversation continued" note.

import { describe, expect, it } from "vitest";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { resolveChainHead } from "./resolve-chain-head.js";

function makeEntry(
  overrides: Partial<SessionsOverviewEntry> = {},
): SessionsOverviewEntry {
  return {
    sessionId: "seg-new",
    scope: "spawned",
    workspaceId: null,
    workspaceName: null,
    title: "Research helper",
    model: null,
    contextTokens: null,
    contextWindow: 200_000,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    segments: [
      {
        sessionId: "seg-old",
        title: "Research helper",
        startedAt: "2026-08-04T09:00:00.000Z",
        lastMessageAt: "2026-08-04T09:30:00.000Z",
        contextTokens: 180_000,
        continuedFromSessionId: null,
        isCurrent: false,
      },
      {
        sessionId: "seg-new",
        title: "Research helper",
        startedAt: "2026-08-04T09:30:00.000Z",
        lastMessageAt: "2026-08-04T10:00:00.000Z",
        contextTokens: 12_000,
        continuedFromSessionId: "seg-old",
        isCurrent: true,
      },
    ],
    ...overrides,
  };
}

describe("resolveChainHead", () => {
  it("the head id resolves to itself, not superseded", () => {
    const resolved = resolveChainHead([makeEntry()], "seg-new");
    expect(resolved).toMatchObject({ headId: "seg-new", isSuperseded: false });
    expect(resolved!.entry.title).toBe("Research helper");
  });

  it("an earlier segment resolves to the NEWEST head, superseded", () => {
    const resolved = resolveChainHead([makeEntry()], "seg-old");
    expect(resolved).toMatchObject({ headId: "seg-new", isSuperseded: true });
  });

  it("an id no entry carries returns null — callers keep the id they hold", () => {
    expect(resolveChainHead([makeEntry()], "seg-foreign")).toBeNull();
    expect(resolveChainHead([], "seg-new")).toBeNull();
  });

  it("resolution picks the entry that carries the id, not the first entry", () => {
    const other = makeEntry({
      sessionId: "other-head",
      title: "Email drafter",
      segments: [
        {
          sessionId: "other-head",
          title: "Email drafter",
          startedAt: "2026-08-04T08:00:00.000Z",
          lastMessageAt: "2026-08-04T08:10:00.000Z",
          contextTokens: null,
          continuedFromSessionId: null,
          isCurrent: true,
        },
      ],
    });
    const resolved = resolveChainHead([other, makeEntry()], "seg-old");
    expect(resolved!.entry.title).toBe("Research helper");
    expect(resolved!.headId).toBe("seg-new");
  });
});
