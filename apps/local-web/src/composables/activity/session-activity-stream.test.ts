// Wire → SessionActivityEvent decode for the /activity/stream feed: real
// ReadableStream through the shared frame reader, heartbeat comments skipped.

import { describe, expect, it } from "vitest";
import {
  frameToSessionActivityEvent,
  readSessionActivityEvents,
} from "./session-activity-stream.js";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readSessionActivityEvents", () => {
  it("decodes the feed's event frames and skips heartbeat comments", async () => {
    const stream = streamOf(
      'event: turn-started\ndata: {"kind":"turn-started","turnId":"t1","scopeKind":"global","workspaceId":null,"sessionId":null,"origin":"telegram","startedAt":"2026-07-19T10:00:00.000Z"}\n\n',
      ":ping\n\n",
      'event: turn-updated\ndata: {"kind":"turn-updated","turnId":"t1","sessionId":"sess-1"}\n\n',
      'event: turn-ended\ndata: {"kind":"turn-ended","turnId":"t1","sessionId":"sess-1"}\n\n',
    );

    const events = [];
    for await (const event of readSessionActivityEvents(stream)) {
      events.push(event);
    }

    expect(events.map((event) => event.kind)).toEqual([
      "turn-started",
      "turn-updated",
      "turn-ended",
    ]);
    expect(events[0]).toMatchObject({ turnId: "t1", origin: "telegram" });
  });

  it("tolerates frames split across chunk boundaries", async () => {
    const frame =
      'event: turn-ended\ndata: {"kind":"turn-ended","turnId":"t9","sessionId":null}\n\n';
    const stream = streamOf(frame.slice(0, 20), frame.slice(20));

    const events = [];
    for await (const event of readSessionActivityEvents(stream)) {
      events.push(event);
    }
    expect(events).toEqual([
      { kind: "turn-ended", turnId: "t9", sessionId: null },
    ]);
  });

  it("frameToSessionActivityEvent recovers kind from the event name and nulls heartbeats", () => {
    expect(frameToSessionActivityEvent({ event: "", data: "" })).toBeNull();
    expect(
      frameToSessionActivityEvent({
        event: "turn-ended",
        data: '{"turnId":"t1","sessionId":null}',
      }),
    ).toEqual({ kind: "turn-ended", turnId: "t1", sessionId: null });
  });
});
