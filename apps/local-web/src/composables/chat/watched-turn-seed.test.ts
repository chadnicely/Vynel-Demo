import { describe, expect, it } from "vitest";
import type {
  ChatMessageResponse,
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import {
  dropOverlapPrefix,
  isTurnOpeningEvent,
  seedWatchedTurnView,
} from "./watched-turn-seed.js";

function makeMessage(input: {
  id: string;
  role: "user" | "assistant";
  body: string;
  thinkingBody?: string;
  createdAt?: string;
}): ChatMessageResponse {
  return {
    id: input.id,
    sessionId: "session-1",
    role: input.role,
    sourceKind: null,
    sourceLabel: null,
    partialSessionId: null,
    originChannel: null,
    body: input.body,
    thinkingBody: input.thinkingBody ?? null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: "2026-07-31T00:00:00.000Z",
    completedAt: null,
    createdAt: input.createdAt ?? "2026-07-31T00:00:00.000Z",
  } as ChatMessageResponse;
}

function textChunk(messageId: string, textDelta: string): ChatTurnEvent {
  return { kind: "text-chunk", messageId, textDelta };
}

describe("dropOverlapPrefix", () => {
  it("drops the streamed prefix already ending the seed", () => {
    expect(dropOverlapPrefix("Hello wor", "lo world")).toBe("ld");
  });

  it("keeps everything when nothing overlaps", () => {
    expect(dropOverlapPrefix("Hello", "world")).toBe("world");
  });

  it("drops everything when the seed already contains the whole stream tail", () => {
    expect(dropOverlapPrefix("Hello world", "world")).toBe("");
  });

  it("handles empty sides", () => {
    expect(dropOverlapPrefix("", "abc")).toBe("abc");
    expect(dropOverlapPrefix("abc", "")).toBe("");
  });

  it("greedy-longest wins on repeating text", () => {
    // Both k=2 ("ab") and k=4 ("abab") suffix the seed — longest is taken.
    expect(dropOverlapPrefix("xabab", "ababY")).toBe("Y");
  });
});

describe("seedWatchedTurnView", () => {
  it("a turn-opening first event folds plainly — no snapshot absorb", () => {
    const view = seedWatchedTurnView({
      messages: [
        makeMessage({ id: "old-user", role: "user", body: "earlier turn" }),
        makeMessage({ id: "old-reply", role: "assistant", body: "done" }),
      ],
      toolCallsByMessageId: {},
      bufferedEvents: [
        {
          kind: "user-message-persisted",
          message: makeMessage({ id: "new-user", role: "user", body: "Hey" }),
        } as ChatTurnEvent,
        textChunk("m-1", "Hi!"),
      ],
      startedAtMs: 111,
    });

    expect(view.startedAtMs).toBe(111);
    expect(view.userMessage?.id).toBe("new-user");
    // The previous turn's rows stay settled — never absorbed.
    expect(view.segments.map((s) => s.messageId)).toEqual(["m-1"]);
    expect(view.segments[0]!.text).toBe("Hi!");
  });

  it("a mid-turn attach absorbs the running turn's rows and dedupes the streamed seam", () => {
    const toolCall = { id: "tc-1", parentMessageId: "m-live" } as ChatToolCallResponse;
    const view = seedWatchedTurnView({
      messages: [
        makeMessage({ id: "u-old", role: "user", body: "before" }),
        makeMessage({ id: "a-old", role: "assistant", body: "settled reply" }),
        makeMessage({ id: "u-1", role: "user", body: "Hey" }),
        makeMessage({
          id: "m-live",
          role: "assistant",
          body: "Hello wor",
          thinkingBody: "let me th",
        }),
      ],
      toolCallsByMessageId: { "m-live": [toolCall] },
      // "lo wor" was emitted before the snapshot's DB read (already in the
      // row body); only "ld" is genuinely new.
      bufferedEvents: [
        textChunk("m-live", "lo wor"),
        textChunk("m-live", "ld"),
        {
          kind: "thinking-chunk",
          messageId: "m-live",
          thinkingDelta: "ink hard",
        } as ChatTurnEvent,
      ],
      startedAtMs: 222,
    });

    expect(view.userMessage?.id).toBe("u-1");
    expect(view.segments.map((s) => s.messageId)).toEqual(["m-live"]);
    expect(view.segments[0]!.text).toBe("Hello world");
    expect(view.segments[0]!.thinking).toBe("let me think hard");
    expect(view.segments[0]!.toolCalls).toEqual([toolCall]);
    // The pre-turn rows stay out of the overlay (they render settled).
    expect(view.isThinkingLive).toBe(true);
  });

  it("a NEW message first seen in the buffer folds normally alongside seeded ones", () => {
    const view = seedWatchedTurnView({
      messages: [
        makeMessage({ id: "u-1", role: "user", body: "Hey" }),
        makeMessage({ id: "m-1", role: "assistant", body: "First." }),
      ],
      toolCallsByMessageId: {},
      bufferedEvents: [textChunk("m-2", "Second "), textChunk("m-2", "message")],
      startedAtMs: 333,
    });

    expect(view.segments.map((s) => s.messageId)).toEqual(["m-1", "m-2"]);
    expect(view.segments[0]!.text).toBe("First.");
    expect(view.segments[1]!.text).toBe("Second message");
    expect(view.isThinkingLive).toBe(false);
  });

  it("the turn-start boundary keeps a prior no-user-row turn out of the absorb", () => {
    // Two consecutive background turns share no user row between them — only
    // the feed's turn start separates them.
    const view = seedWatchedTurnView({
      messages: [
        makeMessage({
          id: "u-task",
          role: "user",
          body: "run the report",
          createdAt: "2026-07-31T00:00:00.000Z",
        }),
        makeMessage({
          id: "a-prior",
          role: "assistant",
          body: "prior fire's reply",
          createdAt: "2026-07-31T00:01:00.000Z",
        }),
        makeMessage({
          id: "a-current",
          role: "assistant",
          body: "current fire",
          createdAt: "2026-07-31T00:10:00.000Z",
        }),
      ],
      toolCallsByMessageId: {},
      bufferedEvents: [textChunk("a-current", "…")],
      startedAtMs: 555,
      turnStartedAtMs: Date.parse("2026-07-31T00:09:00.000Z"),
    });

    expect(view.segments.map((s) => s.messageId)).toEqual(["a-current"]);
    // The pre-boundary task row is not this turn's user message either.
    expect(view.userMessage).toBeNull();
  });

  it("tool activity in the buffer resets the thinking flag (mirrors the live fold)", () => {
    const view = seedWatchedTurnView({
      messages: [
        makeMessage({ id: "u-1", role: "user", body: "Hey" }),
        makeMessage({ id: "m-live", role: "assistant", body: "" }),
      ],
      toolCallsByMessageId: {},
      bufferedEvents: [
        {
          kind: "thinking-chunk",
          messageId: "m-live",
          thinkingDelta: "hmm",
        } as ChatTurnEvent,
        {
          kind: "tool-call-started",
          toolCall: { id: "tc-1", parentMessageId: "m-live" },
        } as ChatTurnEvent,
      ],
      startedAtMs: 666,
    });
    expect(view.isThinkingLive).toBe(false);
  });

  it("no buffered events and no known turn start yields a bare view (nothing knowable yet)", () => {
    const view = seedWatchedTurnView({
      messages: [makeMessage({ id: "u-1", role: "user", body: "Hey" })],
      toolCallsByMessageId: {},
      bufferedEvents: [],
      startedAtMs: 444,
    });
    expect(view.segments).toEqual([]);
    expect(view.userMessage).toBeNull();
  });

  // The "show immediately" attach (live-channel): the feed says the turn is
  // on, nothing has streamed yet — the persisted rows alone paint it.
  it("no buffered events but a KNOWN turn start absorbs the running turn's rows", () => {
    const view = seedWatchedTurnView({
      messages: [
        makeMessage({ id: "u-old", role: "user", body: "earlier", createdAt: "2026-07-31T00:00:00.000Z" }),
        makeMessage({ id: "m-old", role: "assistant", body: "done", createdAt: "2026-07-31T00:00:01.000Z" }),
        makeMessage({ id: "u-1", role: "user", body: "Hey", createdAt: "2026-07-31T00:01:00.500Z" }),
        makeMessage({ id: "m-live", role: "assistant", body: "Hello wor", createdAt: "2026-07-31T00:01:01.000Z" }),
      ],
      toolCallsByMessageId: {},
      bufferedEvents: [],
      startedAtMs: 444,
      turnStartedAtMs: Date.parse("2026-07-31T00:01:00.000Z"),
    });
    expect(view.status).toBe("streaming");
    expect(view.userMessage?.id).toBe("u-1");
    expect(view.segments.map((segment) => segment.messageId)).toEqual(["m-live"]);
    expect(view.isThinkingLive).toBe(false);
  });

  it("a known turn start whose rows have not landed yet yields an empty streaming view", () => {
    const view = seedWatchedTurnView({
      messages: [
        makeMessage({ id: "u-old", role: "user", body: "earlier", createdAt: "2026-07-31T00:00:00.000Z" }),
        makeMessage({ id: "m-old", role: "assistant", body: "done", createdAt: "2026-07-31T00:00:01.000Z" }),
      ],
      toolCallsByMessageId: {},
      bufferedEvents: [],
      startedAtMs: 444,
      turnStartedAtMs: Date.parse("2026-07-31T00:01:00.000Z"),
    });
    expect(view.status).toBe("streaming");
    expect(view.userMessage).toBeNull();
    expect(view.segments).toEqual([]);
  });
});

describe("isTurnOpeningEvent", () => {
  it("recognizes the two turn-opening kinds only", () => {
    expect(
      isTurnOpeningEvent({
        kind: "user-message-persisted",
        message: makeMessage({ id: "u", role: "user", body: "x" }),
      } as ChatTurnEvent),
    ).toBe(true);
    expect(isTurnOpeningEvent(textChunk("m", "x"))).toBe(false);
  });
});
