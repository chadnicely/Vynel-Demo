import { describe, expect, it } from "vitest";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { buildSessionIconsByName } from "./session-icons-by-name.js";

function makeEntry(
  overrides: Partial<SessionsOverviewEntry> & Pick<SessionsOverviewEntry, "title">,
): SessionsOverviewEntry {
  return {
    sessionId: `sdk-${overrides.title}`,
    primarySessionId: null,
    scope: "spawned",
    workspaceId: null,
    workspaceName: null,
    icon: null,
    model: null,
    contextTokens: null,
    contextWindow: 200_000,
    lastMessageAt: "2026-08-26T10:00:00.000Z",
    statusFacts: {
      setStatus: null,
      statusNote: null,
      statusSetAt: null,
      lastError: null,
      pendingApprovalCount: 0,
      pendingAskCount: 0,
      latestUserMessageAt: null,
    },
    segments: [],
    ...overrides,
  };
}

describe("buildSessionIconsByName", () => {
  it("maps each child conversation's name to its curated icon, scoped to the room", () => {
    const entries = [
      makeEntry({ title: "Maintainer", icon: "build", workspaceId: "ws-1" }),
      makeEntry({ title: "Editing core builder", icon: null, workspaceId: "ws-1" }),
      makeEntry({ title: "Nova", icon: "robot", workspaceId: "ws-2", scope: "agent" }),
      // The room's own thread and the brain never wear a session icon.
      makeEntry({ title: "Acme", icon: "gear", workspaceId: "ws-1", scope: "workspace" }),
      makeEntry({ title: "Assistant", icon: "chat", scope: "global" }),
    ];

    expect(buildSessionIconsByName(entries, "ws-1")).toEqual({
      Maintainer: "build",
      "Editing core builder": null,
    });
    // The global surface hears every room's children.
    expect(buildSessionIconsByName(entries, null)).toEqual({
      Maintainer: "build",
      "Editing core builder": null,
      Nova: "robot",
    });
  });

  it("a name shared by two children resolves to the one that spoke last", () => {
    const entries = [
      makeEntry({
        title: "Research",
        icon: "search",
        sessionId: "old",
        lastMessageAt: "2026-08-20T10:00:00.000Z",
      }),
      makeEntry({
        title: "Research",
        icon: "web",
        sessionId: "new",
        lastMessageAt: "2026-08-26T10:00:00.000Z",
      }),
    ];
    expect(buildSessionIconsByName(entries, null)).toEqual({ Research: "web" });
  });
});
