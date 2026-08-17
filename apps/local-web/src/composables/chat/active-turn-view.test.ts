import { describe, expect, it } from "vitest";
import type {
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import {
  applyChatTurnEvent,
  createActiveTurnView,
} from "./active-turn-view.js";

function fold(events: ChatTurnEvent[]) {
  return events.reduce(applyChatTurnEvent, createActiveTurnView());
}

const startedCall: ChatToolCallResponse = {
  id: "tc-1",
  parentMessageId: "m1",
  toolUseId: "tu-1",
  toolName: "Read",
  toolInput: { file_path: "a.md" },
  toolOutput: null,
  status: "started",
  approvalStatus: null,
  isErrorResult: false,
  startedAt: "2026-07-05T10:00:00.000Z",
  completedAt: null,
};

describe("applyChatTurnEvent", () => {
  it("accumulates text and thinking deltas into the message's segment", () => {
    const view = fold([
      { kind: "thinking-chunk", messageId: "m1", thinkingDelta: "Let me " },
      { kind: "thinking-chunk", messageId: "m1", thinkingDelta: "check." },
      { kind: "text-chunk", messageId: "m1", textDelta: "On it. " },
      { kind: "text-chunk", messageId: "m1", textDelta: "Reading now." },
    ]);

    expect(view.segments).toHaveLength(1);
    expect(view.segments[0]!.thinking).toBe("Let me check.");
    expect(view.segments[0]!.text).toBe("On it. Reading now.");
    expect(view.isThinkingLive).toBe(false);
  });

  it("segments a multi-message turn in arrival order, tools attached to their parent", () => {
    // The settled thread renders text → tools → text as separate assistant
    // rows — the live fold must mirror that structure exactly.
    const view = fold([
      { kind: "text-chunk", messageId: "m1", textDelta: "Reading the file…" },
      { kind: "tool-call-started", toolCall: startedCall },
      { kind: "text-chunk", messageId: "m2", textDelta: "Here's the answer." },
    ]);

    expect(view.segments.map((segment) => segment.messageId)).toEqual([
      "m1",
      "m2",
    ]);
    expect(view.segments[0]!.toolCalls).toHaveLength(1);
    expect(view.segments[1]!.text).toBe("Here's the answer.");
    expect(view.segments[1]!.toolCalls).toHaveLength(0);
  });

  it("upserts tool calls by id so started → completed is one card", () => {
    const completedCall = {
      ...startedCall,
      status: "completed" as const,
      toolOutput: "# Pricing",
      completedAt: "2026-07-05T10:00:01.000Z",
    };
    const view = fold([
      { kind: "tool-call-started", toolCall: startedCall },
      { kind: "tool-call-completed", toolCall: completedCall },
    ]);

    expect(view.segments).toHaveLength(1); // a tool-only message still segments
    expect(view.segments[0]!.toolCalls).toHaveLength(1);
    expect(view.segments[0]!.toolCalls[0]!.status).toBe("completed");
  });

  it("folds a subagent's activity under its Agent card key — never into segments", () => {
    const view = fold([
      { kind: "text-chunk", messageId: "m1", textDelta: "Spawning an agent…" },
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
        toolName: "Read",
        toolOutput: "file body",
        isError: false,
        completedAt: "2026-07-19T10:00:02.000Z",
      },
    ]);

    expect(view.segments).toHaveLength(1); // the agent never minted a segment
    const activity = view.agentActivity["tu_agent_1"]!;
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

  it("tracks an approval from requested to resolved", () => {
    const view = fold([
      {
        kind: "approval-requested",
        approvalRequestId: "ap-1",
        parentMessageId: "m1",
        toolName: "Edit",
        toolInput: {},
        requestedAt: "2026-07-05T10:00:02.000Z",
      },
      {
        kind: "approval-resolved",
        approvalRequestId: "ap-1",
        decision: { kind: "approved" },
        resolvedAt: "2026-07-05T10:00:05.000Z",
      },
    ]);

    expect(view.approvals).toHaveLength(1);
    expect(view.approvals[0]!.isResolved).toBe(true);
  });

  it("records terminal states and stream end", () => {
    const completed = fold([{ kind: "session-completed", sessionId: "s1" }]);
    const interrupted = fold([
      { kind: "session-interrupted", sessionId: "s1" },
    ]);
    const errored = fold([
      {
        kind: "session-errored",
        sessionId: "s1",
        errorCode: "provider-crash",
        errorMessage: "The runtime exited unexpectedly.",
        isRecoverable: true,
      },
      { kind: "turn-stream-ended" },
    ]);

    expect(completed.status).toBe("completed");
    expect(interrupted.status).toBe("interrupted");
    expect(errored.status).toBe("errored");
    expect(errored.error?.code).toBe("provider-crash");
    expect(errored.hasEnded).toBe(true);
  });

  it("shows the boundary context swap: patching, then landed on the fresh segment (or stayed)", () => {
    const patching = fold([
      { kind: "session-completed", sessionId: "seg-a" },
      { kind: "context-patching", sessionId: "seg-a", primarySessionId: "p-1" },
    ]);
    // The turn is DONE (the composer is free) while the swap runs — the view
    // carries the patching phase for the chip/pill to say so.
    expect(patching.status).toBe("completed");
    expect(patching.contextPatch).toEqual({ phase: "patching", fromSessionId: "seg-a", toSessionId: null });

    const landed = fold([
      { kind: "session-completed", sessionId: "seg-a" },
      { kind: "context-patching", sessionId: "seg-a", primarySessionId: "p-1" },
      { kind: "context-patched", sessionId: "seg-a", primarySessionId: "p-1", toSessionId: "seg-b" },
      { kind: "turn-stream-ended" },
    ]);
    expect(landed.contextPatch).toEqual({ phase: "done", fromSessionId: "seg-a", toSessionId: "seg-b" });
    expect(landed.hasEnded).toBe(true);

    const stayed = fold([
      { kind: "session-completed", sessionId: "seg-a" },
      { kind: "context-patching", sessionId: "seg-a", primarySessionId: "p-1" },
      { kind: "context-patched", sessionId: "seg-a", primarySessionId: "p-1", toSessionId: null },
    ]);
    expect(stayed.contextPatch?.phase).toBe("done");
    expect(stayed.contextPatch?.toSessionId).toBeNull();
    // No swap announced → nothing to show.
    expect(fold([{ kind: "session-completed", sessionId: "seg-a" }]).contextPatch).toBeNull();
  });
});
