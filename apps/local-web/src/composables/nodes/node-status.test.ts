// What colour one project's dot wears. This is the densest branch on the node
// screen — four states over three inputs plus a clock — so every path and the
// active-window boundary itself are pinned here.

import { describe, expect, it } from "vitest";
import {
  resolveConversationNodeStatus,
  resolveFleetNodeStatus,
} from "./node-status.js";
import { ACTIVE_WINDOW_MS } from "./use-active-window.js";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");
const justNow = new Date(NOW - 1000).toISOString();

function statusOf(overrides: Parameters<typeof resolveFleetNodeStatus>[0]) {
  return resolveFleetNodeStatus(overrides);
}

describe("resolveFleetNodeStatus", () => {
  it("a live turn is working, whatever else is true", () => {
    expect(
      statusOf({
        liveTurn: true,
        queue: undefined,
        progress: undefined,
        nowMs: NOW,
      }),
    ).toBe("building");
  });

  it("a running queue is working even with no turn streaming", () => {
    expect(
      statusOf({
        liveTurn: false,
        queue: { openCount: 2, inProgressCount: 1, total: 3 },
        progress: { done: 1, total: 3, lastWorkedAt: justNow },
        nowMs: NOW,
      }),
    ).toBe("building");
  });

  it("every step finished and the queue clear is done", () => {
    expect(
      statusOf({
        liveTurn: false,
        queue: undefined,
        progress: { done: 4, total: 4, lastWorkedAt: justNow },
        nowMs: NOW,
      }),
    ).toBe("done");
  });

  it("a task still open keeps it waiting, not done", () => {
    expect(
      statusOf({
        liveTurn: false,
        queue: { openCount: 1, inProgressCount: 0, total: 3 },
        progress: { done: 4, total: 4, lastWorkedAt: justNow },
        nowMs: NOW,
      }),
    ).toBe("waiting");
  });

  it("worked recently but mid-build is waiting on you", () => {
    expect(
      statusOf({
        liveTurn: false,
        queue: undefined,
        progress: { done: 2, total: 5, lastWorkedAt: justNow },
        nowMs: NOW,
      }),
    ).toBe("waiting");
  });

  it("a project with no signs of work at all is idle", () => {
    expect(
      statusOf({
        liveTurn: false,
        queue: undefined,
        progress: undefined,
        nowMs: NOW,
      }),
    ).toBe("idle");
  });

  // The boundary is the whole point of the minute tick: a dormant project
  // holding a stale in-progress task must NOT glow "working" out here while
  // the sidebar files it under NOT RUNNING.
  it("falls to idle once the active window runs dry", () => {
    const staleQueue = { openCount: 1, inProgressCount: 1, total: 2 };
    const insideWindow = new Date(NOW - (ACTIVE_WINDOW_MS - 60_000)).toISOString();
    const outsideWindow = new Date(NOW - (ACTIVE_WINDOW_MS + 60_000)).toISOString();

    expect(
      statusOf({
        liveTurn: false,
        queue: staleQueue,
        progress: { done: 0, total: 2, lastWorkedAt: insideWindow },
        nowMs: NOW,
      }),
    ).toBe("building");

    expect(
      statusOf({
        liveTurn: false,
        queue: staleQueue,
        progress: { done: 0, total: 2, lastWorkedAt: outsideWindow },
        nowMs: NOW,
      }),
    ).toBe("idle");
  });

  it("a live turn outranks an expired window", () => {
    // The turn IS the sign of work — an old timestamp must not grey it out.
    expect(
      statusOf({
        liveTurn: true,
        queue: undefined,
        progress: {
          done: 0,
          total: 0,
          lastWorkedAt: new Date(NOW - ACTIVE_WINDOW_MS * 4).toISOString(),
        },
        nowMs: NOW,
      }),
    ).toBe("building");
  });
});

describe("resolveConversationNodeStatus", () => {
  // The bug this fixes (Kafi, 2026-08-15): every session node was hardcoded
  // `idle`, so a conversation visibly running tool calls still drew grey and
  // its strand never streamed.
  it("a conversation running a turn is working", () => {
    expect(
      resolveConversationNodeStatus({
        hasLiveTurn: true,
        lastMessageAt: null,
        nowMs: NOW,
      }),
    ).toBe("building");
  });

  it("spoke recently, so the ball is in your court", () => {
    expect(
      resolveConversationNodeStatus({
        hasLiveTurn: false,
        lastMessageAt: justNow,
        nowMs: NOW,
      }),
    ).toBe("waiting");
  });

  it("quiet past the hour is idle", () => {
    expect(
      resolveConversationNodeStatus({
        hasLiveTurn: false,
        lastMessageAt: new Date(NOW - (ACTIVE_WINDOW_MS + 60_000)).toISOString(),
        nowMs: NOW,
      }),
    ).toBe("idle");
  });

  it("a conversation that has never spoken is idle, not waiting", () => {
    expect(
      resolveConversationNodeStatus({
        hasLiveTurn: false,
        lastMessageAt: null,
        nowMs: NOW,
      }),
    ).toBe("idle");
  });

  it("shares the fleet's window exactly — the two levels agree on 'recent'", () => {
    const atTheEdge = new Date(NOW - (ACTIVE_WINDOW_MS - 1000)).toISOString();
    expect(
      resolveConversationNodeStatus({
        hasLiveTurn: false,
        lastMessageAt: atTheEdge,
        nowMs: NOW,
      }),
    ).toBe("waiting");
    expect(
      resolveFleetNodeStatus({
        liveTurn: false,
        queue: undefined,
        progress: { done: 1, total: 3, lastWorkedAt: atTheEdge },
        nowMs: NOW,
      }),
    ).toBe("waiting");
  });
});
