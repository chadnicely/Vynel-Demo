import { describe, expect, it } from "vitest";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import {
  applyTraceStreamEvent,
  createLiveTraceState,
  mergeTraceEntries,
} from "./fold-trace-stream.js";

function fold(events: ChatTurnEvent[]) {
  return events.reduce(applyTraceStreamEvent, createLiveTraceState());
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

describe("applyTraceStreamEvent", () => {
  it("materializes the task, grows the reply chunk-by-chunk, and tracks tool calls", () => {
    const state = fold([
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

    expect(state.entries.map((entry) => [entry.id, entry.role, entry.body])).toEqual([
      ["task-1", "user", "create a readme"],
      ["m1", "assistant", "Writing it now."],
    ]);
    expect(state.entries[1]!.toolCalls).toHaveLength(1);
    expect(state.entries[1]!.toolCalls[0]).toMatchObject({ id: "t1", status: "completed" });
  });

  it("shows the approval pill while a card is pending, clears it on the decision", () => {
    let state = fold([
      { kind: "approval-requested", approvalRequestId: "a1", toolName: "Write" } as never,
    ]);
    expect(state.pendingApprovalToolName).toBe("Write");

    state = applyTraceStreamEvent(state, {
      kind: "approval-resolved",
      approvalRequestId: "a1",
      decision: { kind: "approved" },
    } as never);
    expect(state.pendingApprovalToolName).toBeNull();
  });
});

describe("mergeTraceEntries", () => {
  it("settled rows win by id; overlay-only rows append", () => {
    const settled = [
      { id: "task-1", role: "user", sourceKind: null, sourceLabel: null, body: "settled task", toolCalls: [] },
    ];
    const overlay = [
      { id: "task-1", role: "user", sourceKind: null, sourceLabel: null, body: "overlay task", toolCalls: [] },
      { id: "m1", role: "assistant", sourceKind: null, sourceLabel: null, body: "streaming…", toolCalls: [] },
    ];
    const merged = mergeTraceEntries(settled, overlay);
    expect(merged.map((entry) => [entry.id, entry.body])).toEqual([
      ["task-1", "settled task"],
      ["m1", "streaming…"],
    ]);
  });
});

describe("applyTraceStreamEvent — spawned subagent activity", () => {
  it("folds agent-* events into agentActivity keyed by the Agent call, never into entries", () => {
    const state = fold([
      {
        kind: "agent-tool-started",
        parentToolUseId: "tu_agent_1",
        toolUseId: "tu_sub_read",
        toolName: "Read",
        toolInput: { file_path: "a.md" },
        startedAt: "2026-07-19T10:00:00.000Z",
      },
      {
        kind: "agent-text-chunk",
        parentToolUseId: "tu_agent_1",
        textDelta: "found it",
      },
      {
        kind: "agent-tool-completed",
        parentToolUseId: "tu_agent_1",
        toolUseId: "tu_sub_read",
        toolOutput: "file body",
        isError: false,
        completedAt: "2026-07-19T10:00:02.000Z",
      },
    ]);

    expect(state.entries).toEqual([]); // the agent never minted a panel entry
    const activity = state.agentActivity["tu_agent_1"]!;
    expect(activity.text).toBe("found it");
    expect(activity.toolCalls).toEqual([
      {
        toolUseId: "tu_sub_read",
        toolName: "Read",
        toolInput: { file_path: "a.md" },
        toolOutput: "file body",
        status: "completed",
        startedAt: "2026-07-19T10:00:00.000Z",
        completedAt: "2026-07-19T10:00:02.000Z",
      },
    ]);
  });
});
