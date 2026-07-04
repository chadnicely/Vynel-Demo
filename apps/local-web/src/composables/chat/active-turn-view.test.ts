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
  it("accumulates text and thinking deltas separately", () => {
    const view = fold([
      { kind: "thinking-chunk", messageId: "m1", thinkingDelta: "Let me " },
      { kind: "thinking-chunk", messageId: "m1", thinkingDelta: "check." },
      { kind: "text-chunk", messageId: "m1", textDelta: "On it. " },
      { kind: "text-chunk", messageId: "m1", textDelta: "Reading now." },
    ]);

    expect(view.thinking).toBe("Let me check.");
    expect(view.text).toBe("On it. Reading now.");
    expect(view.isThinkingLive).toBe(false);
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

    expect(view.toolCalls).toHaveLength(1);
    expect(view.toolCalls[0]!.status).toBe("completed");
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
});
