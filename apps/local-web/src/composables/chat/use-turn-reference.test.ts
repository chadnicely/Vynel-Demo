import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import { useTurnReference } from "./use-turn-reference.js";

function makeMessage(
  overrides: Partial<ChatMessageResponse> = {},
): ChatMessageResponse {
  return {
    id: "m1",
    sessionId: "s1",
    role: "user",
    body: "Use desktop tools",
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: "2026-07-05T10:00:00.000Z",
    completedAt: "2026-07-05T10:00:01.000Z",
    createdAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("useTurnReference", () => {
  // The marks are module state so the thread and the composer share them —
  // every case starts from a clean slate.
  beforeEach(() => {
    const { clearFor } = useTurnReference();
    for (const sessionId of ["s1", "s2"]) clearFor(sessionId);
  });

  it("marks a turn with its author and first line", () => {
    const { mark, markedFor, isMarked } = useTurnReference();
    const message = makeMessage();
    mark(message, "You");

    expect(isMarked(message)).toBe(true);
    expect(markedFor("s1")?.author).toBe("You");
    expect(markedFor("s1")?.preview).toBe("Use desktop tools");
  });

  it("clicking the marked turn again unmarks it — the icon is a toggle", () => {
    const { mark, markedFor } = useTurnReference();
    mark(makeMessage(), "You");
    mark(makeMessage(), "You");

    expect(markedFor("s1")).toBeNull();
  });

  it("marking another turn moves the mark — one per conversation", () => {
    const { mark, markedFor } = useTurnReference();
    mark(makeMessage(), "You");
    mark(makeMessage({ id: "m2", body: "Second ask" }), "You");

    expect(markedFor("s1")?.messageId).toBe("m2");
  });

  // The defect this pins: one shared mark let a mark made in one thread ride
  // out on a message to another, quoting a turn absent from its history. More
  // than one composer is alive at a time, so the key has to be the session.
  it("a mark belongs to ITS conversation and no other", () => {
    const { mark, markedFor, applyTo } = useTurnReference();
    mark(makeMessage(), "You");

    expect(markedFor("s2")).toBeNull();
    expect(applyTo("s2", "unrelated message")).toBe("unrelated message");
    // Spending elsewhere must not have consumed it here.
    expect(markedFor("s1")?.messageId).toBe("m1");
  });

  it("two conversations hold their own marks at once", () => {
    const { mark, markedFor } = useTurnReference();
    mark(makeMessage(), "You");
    mark(makeMessage({ id: "m9", sessionId: "s2", body: "Other room" }), "You");

    expect(markedFor("s1")?.messageId).toBe("m1");
    expect(markedFor("s2")?.messageId).toBe("m9");
  });

  it("the preview strips markdown and takes the first non-empty line", () => {
    const { mark, markedFor } = useTurnReference();
    mark(
      makeMessage({ body: "\n\n## **Done** — it works\n\nDetail here." }),
      "Claude",
    );

    expect(markedFor("s1")?.preview).toBe("Done — it works");
  });

  it("sending carries the reference line and spends the mark", () => {
    const { mark, applyTo, markedFor } = useTurnReference();
    mark(makeMessage(), "You");

    const sent = applyTo("s1", "do it again");
    expect(sent).toContain("Re: You");
    expect(sent).toContain('"Use desktop tools"');
    expect(sent.endsWith("do it again")).toBe(true);
    // Spent: the next message must not silently carry the same pointer.
    expect(markedFor("s1")).toBeNull();
    expect(applyTo("s1", "plain")).toBe("plain");
  });

  it("a composer with no session yet cannot spend anything", () => {
    const { mark, applyTo } = useTurnReference();
    mark(makeMessage(), "You");

    expect(applyTo(null, "fresh conversation")).toBe("fresh conversation");
  });

  it("a long preview is truncated so the chip stays one line", () => {
    const { mark, markedFor } = useTurnReference();
    mark(makeMessage({ body: "x".repeat(200) }), "You");

    expect(markedFor("s1")!.preview.length).toBeLessThanOrEqual(60);
    expect(markedFor("s1")!.preview.endsWith("…")).toBe(true);
  });
});
