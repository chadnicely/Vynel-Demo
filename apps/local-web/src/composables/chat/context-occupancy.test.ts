import { describe, expect, it } from "vitest";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import {
  findSessionOccupancy,
  formatContextTooltip,
  formatTokensCompact,
  occupancyTokens,
} from "./context-occupancy.js";

function makeEntry(
  overrides: Partial<SessionsOverviewEntry> = {},
): SessionsOverviewEntry {
  return {
    sessionId: "s-new",
    scope: "global",
    workspaceId: null,
    workspaceName: null,
    title: "Ongoing conversation",
    model: "claude-opus-4-8",
    contextTokens: 166_000,
    contextWindow: 200_000,
    lastMessageAt: "2026-07-21T10:00:00.000Z",
    segments: [
      {
        sessionId: "s-old",
        title: "Ongoing conversation",
        startedAt: "2026-07-20T10:00:00.000Z",
        lastMessageAt: "2026-07-20T18:00:00.000Z",
        contextTokens: 170_000,
        continuedFromSessionId: null,
        isCurrent: false,
      },
      {
        sessionId: "s-new",
        title: "Ongoing conversation",
        startedAt: "2026-07-20T18:00:00.000Z",
        lastMessageAt: "2026-07-21T10:00:00.000Z",
        contextTokens: 166_000,
        continuedFromSessionId: "s-old",
        isCurrent: true,
      },
    ],
    ...overrides,
  };
}

describe("occupancyTokens", () => {
  it("sums uncached input with both cache components — the real occupancy", () => {
    expect(
      occupancyTokens({
        inputTokens: 1_000,
        cacheReadInputTokens: 150_000,
        cacheCreationInputTokens: 15_000,
      }),
    ).toBe(166_000);
  });
});

describe("findSessionOccupancy", () => {
  it("matches the entry by its newest segment id", () => {
    expect(findSessionOccupancy([makeEntry()], "s-new")).toEqual({
      contextTokens: 166_000,
      contextWindow: 200_000,
    });
  });

  it("matches an older chain segment and returns ITS fork-time occupancy", () => {
    expect(findSessionOccupancy([makeEntry()], "s-old")).toEqual({
      contextTokens: 170_000,
      contextWindow: 200_000,
    });
  });

  it("returns null for an unknown or absent session", () => {
    expect(findSessionOccupancy([makeEntry()], "s-elsewhere")).toBeNull();
    expect(findSessionOccupancy([makeEntry()], null)).toBeNull();
  });
});

describe("formatTokensCompact", () => {
  it("reads like a human number at every magnitude", () => {
    expect(formatTokensCompact(950)).toBe("950");
    expect(formatTokensCompact(166_000)).toBe("166k");
    expect(formatTokensCompact(1_000_000)).toBe("1M");
    expect(formatTokensCompact(1_500_000)).toBe("1.5M");
  });
});

describe("formatContextTooltip", () => {
  it("carries the number and the continuity promise", () => {
    expect(formatContextTooltip(166_000, 200_000)).toBe(
      "~166k of 200k · continues automatically near 85%",
    );
  });
});
