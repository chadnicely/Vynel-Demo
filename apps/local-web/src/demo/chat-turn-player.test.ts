import { describe, expect, it } from "vitest";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { DemoTurnStep } from "./chat-turn-player.js";
import { playDemoTurn } from "./chat-turn-player.js";

function emit(event: ChatTurnEvent): DemoTurnStep {
  return { kind: "emit", delayMs: 0, event };
}

const textEvent = (delta: string): ChatTurnEvent => ({
  kind: "text-chunk",
  messageId: "m1",
  textDelta: delta,
});

describe("playDemoTurn", () => {
  it("emits scripted events in order and resolves done", async () => {
    const seen: ChatTurnEvent[] = [];
    const handle = playDemoTurn(
      "s1",
      [
        emit(textEvent("a")),
        emit(textEvent("b")),
        emit({ kind: "turn-stream-ended" }),
      ],
      (event) => seen.push(event),
    );

    await handle.done;

    expect(seen.map((event) => event.kind)).toEqual([
      "text-chunk",
      "text-chunk",
      "turn-stream-ended",
    ]);
  });

  it("pauses on an approval gate and walks the approved branch after the decision", async () => {
    const seen: ChatTurnEvent[] = [];
    const handle = playDemoTurn(
      "s1",
      [
        {
          kind: "approval-gate",
          delayMs: 0,
          approvalRequestId: "ap-1",
          parentMessageId: "m1",
          toolName: "Edit",
          toolInput: { file: "x" },
          approved: [emit(textEvent("approved-path"))],
          denied: [emit(textEvent("denied-path"))],
        },
        emit({ kind: "turn-stream-ended" }),
      ],
      (event) => {
        seen.push(event);
        if (event.kind === "approval-requested") {
          // Decide asynchronously, like a user clicking Approve.
          queueMicrotask(() =>
            handle.decideApproval(event.approvalRequestId, "approved"),
          );
        }
      },
    );

    await handle.done;

    expect(seen.map((event) => event.kind)).toEqual([
      "approval-requested",
      "approval-resolved",
      "text-chunk",
      "turn-stream-ended",
    ]);
    const branchText = seen.find((event) => event.kind === "text-chunk");
    expect(branchText).toMatchObject({ textDelta: "approved-path" });
  });

  it("interrupt ends the stream with session-interrupted + turn-stream-ended", async () => {
    const seen: ChatTurnEvent[] = [];
    const handle = playDemoTurn(
      "s1",
      [
        emit(textEvent("a")),
        { kind: "emit", delayMs: 5_000, event: textEvent("never") },
      ],
      (event) => seen.push(event),
    );

    // Let the first zero-delay event flush, then interrupt mid-sleep.
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.interrupt();
    await handle.done;

    expect(seen.map((event) => event.kind)).toEqual([
      "text-chunk",
      "session-interrupted",
      "turn-stream-ended",
    ]);
  });

  it("interrupt while paused on an approval also ends the stream", async () => {
    const seen: ChatTurnEvent[] = [];
    const handle = playDemoTurn(
      "s1",
      [
        {
          kind: "approval-gate",
          delayMs: 0,
          approvalRequestId: "ap-1",
          parentMessageId: "m1",
          toolName: "Edit",
          toolInput: {},
          approved: [emit(textEvent("approved-path"))],
          denied: [emit(textEvent("denied-path"))],
        },
      ],
      (event) => {
        seen.push(event);
        if (event.kind === "approval-requested")
          queueMicrotask(() => handle.interrupt());
      },
    );

    await handle.done;

    const kinds = seen.map((event) => event.kind);
    expect(kinds).toContain("session-interrupted");
    expect(kinds).toContain("turn-stream-ended");
    expect(kinds).not.toContain("text-chunk");
  });
});
