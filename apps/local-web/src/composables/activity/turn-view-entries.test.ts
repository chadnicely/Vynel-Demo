// The B2 selector — ported intent from the deleted `applyTraceStreamEvent`
// suite: the SAME behavioral guarantees, now expressed as the chat fold
// (`applyChatTurnEvent`) projected through `liveEntriesFromTurnView`. What the
// old fold DROPPED (thinking, lifecycle, errors) is asserted present.

import { describe, expect, it } from "vitest";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import {
  applyChatTurnEvent,
  createActiveTurnView,
} from "../chat/active-turn-view.js";
import {
  liveEntriesFromTurnView,
  pendingApprovalToolNameOf,
} from "./turn-view-entries.js";

function foldView(events: ChatTurnEvent[]) {
  return events.reduce(applyChatTurnEvent, createActiveTurnView());
}

const toolCall = (id: string, status: string) =>
  ({
    id,
    parentMessageId: "m1",
    toolUseId: `use-${id}`,
    toolName: "Write",
    status,
    approvalStatus: null,
    isErrorResult: false,
    startedAt: "2026-07-06T00:00:00.000Z",
    completedAt: null,
  }) as never;

describe("liveEntriesFromTurnView", () => {
  it("materializes the task, grows the reply chunk-by-chunk, and tracks tool calls", () => {
    const view = foldView([
      {
        kind: "user-message-persisted",
        message: {
          id: "task-1",
          role: "user",
          body: "create a readme",
          sourceKind: "global-root",
        },
      } as never,
      { kind: "text-chunk", messageId: "m1", textDelta: "Writing " } as never,
      { kind: "tool-call-started", toolCall: toolCall("t1", "started") } as never,
      { kind: "text-chunk", messageId: "m1", textDelta: "it now." } as never,
      { kind: "tool-call-completed", toolCall: toolCall("t1", "completed") } as never,
    ]);

    const entries = liveEntriesFromTurnView(view);
    expect(entries.map((entry) => [entry.id, entry.role, entry.body])).toEqual([
      ["task-1", "user", "create a readme"],
      ["m1", "assistant", "Writing it now."],
    ]);
    expect(entries[1]!.toolCalls).toHaveLength(1);
    expect(entries[1]!.toolCalls[0]).toMatchObject({ id: "t1", status: "completed" });
  });

  it("a TOOL-ONLY segment still becomes an entry (no text ever streamed)", () => {
    const view = foldView([
      { kind: "tool-call-started", toolCall: toolCall("t1", "started") } as never,
    ]);
    const entries = liveEntriesFromTurnView(view);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("m1");
    expect(entries[0]!.body).toBe("");
    expect(entries[0]!.toolCalls).toHaveLength(1);
  });

  it("carries THINKING — the exact signal the old panel fold dropped", () => {
    const view = foldView([
      { kind: "thinking-chunk", messageId: "m1", thinkingDelta: "Let me plan " } as never,
      { kind: "thinking-chunk", messageId: "m1", thinkingDelta: "this out." } as never,
      { kind: "text-chunk", messageId: "m1", textDelta: "Here we go." } as never,
    ]);
    const entries = liveEntriesFromTurnView(view);
    expect(entries[0]!.thinking).toBe("Let me plan this out.");
    expect(entries[0]!.body).toBe("Here we go.");
  });

  it("session lifecycle + errors survive the fold — the panel can SAY a failed turn", () => {
    const view = foldView([
      { kind: "text-chunk", messageId: "m1", textDelta: "partial" } as never,
      {
        kind: "session-errored",
        errorCode: "provider_crash",
        errorMessage: "the SDK died",
        isRecoverable: false,
      } as never,
    ]);
    expect(view.status).toBe("errored");
    expect(view.error).toEqual({
      code: "provider_crash",
      message: "the SDK died",
      isRecoverable: false,
    });
  });
});

describe("pendingApprovalToolNameOf", () => {
  it("shows the approval pill while a card is pending, clears it on the decision", () => {
    let view = foldView([
      {
        kind: "approval-requested",
        approvalRequestId: "a1",
        parentMessageId: "m1",
        toolName: "Write",
        toolInput: {},
        requestedAt: "2026-07-06T00:00:00.000Z",
      } as never,
    ]);
    expect(pendingApprovalToolNameOf(view)).toBe("Write");

    view = applyChatTurnEvent(view, {
      kind: "approval-resolved",
      approvalRequestId: "a1",
      decision: { kind: "approved" },
    } as never);
    expect(pendingApprovalToolNameOf(view)).toBeNull();
  });
});

describe("agent activity (parity with the old fold's agent-* handling)", () => {
  it("folds agent-* events into agentActivity keyed by the Agent call, never into entries", () => {
    const view = foldView([
      {
        kind: "agent-text-chunk",
        parentToolUseId: "agent-use-1",
        textDelta: "scanning files",
      } as never,
      {
        kind: "agent-tool-started",
        parentToolUseId: "agent-use-1",
        toolUseId: "sub-1",
        toolName: "Read",
        toolInput: {},
        startedAt: "2026-07-06T00:00:00.000Z",
      } as never,
    ]);
    expect(liveEntriesFromTurnView(view)).toEqual([]);
    expect(view.agentActivity["agent-use-1"]).toMatchObject({
      text: "scanning files",
    });
    expect(view.agentActivity["agent-use-1"]!.toolCalls).toHaveLength(1);
  });
});
