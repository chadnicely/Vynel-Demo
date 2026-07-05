import { describe, expect, it } from "vitest";
import {
  frameToChatTurnEvent,
  parseSseFrame,
  splitSseFrames,
} from "./sse-frames.js";

describe("splitSseFrames", () => {
  it("returns complete frames and keeps the trailing partial as rest", () => {
    const { frames, rest } = splitSseFrames(
      "event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: 3",
    );
    expect(frames).toEqual(["event: a\ndata: 1", "event: b\ndata: 2"]);
    expect(rest).toBe("event: c\ndata: 3");
  });

  it("emits nothing until a frame is terminated by a blank line", () => {
    const { frames, rest } = splitSseFrames("event: a\ndata: 1");
    expect(frames).toEqual([]);
    expect(rest).toBe("event: a\ndata: 1");
  });

  it("tolerates CRLF line endings", () => {
    const { frames } = splitSseFrames("event: a\r\ndata: 1\r\n\r\n");
    expect(frames).toEqual(["event: a\ndata: 1"]);
  });
});

describe("parseSseFrame", () => {
  it("extracts the event name and data payload", () => {
    expect(parseSseFrame("event: text-chunk\ndata: {\"kind\":\"x\"}")).toEqual({
      event: "text-chunk",
      data: '{"kind":"x"}',
    });
  });

  it("joins multi-line data and ignores comments", () => {
    expect(parseSseFrame(": keep-alive\nevent: e\ndata: a\ndata: b")).toEqual({
      event: "e",
      data: "a\nb",
    });
  });
});

describe("frameToChatTurnEvent", () => {
  it("parses a full event payload", () => {
    const event = frameToChatTurnEvent({
      event: "text-chunk",
      data: '{"kind":"text-chunk","messageId":"m1","textDelta":"hi"}',
    });
    expect(event).toEqual({
      kind: "text-chunk",
      messageId: "m1",
      textDelta: "hi",
    });
  });

  it("recovers kind from the event name for the terminal empty frame", () => {
    const event = frameToChatTurnEvent({
      event: "turn-stream-ended",
      data: "{}",
    });
    expect(event).toEqual({ kind: "turn-stream-ended" });
  });
});
