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
    startedAt: null,
    completedAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("useTurnReference", () => {
  // The mark is module state so the thread and the composer share one — every
  // case starts from a clean slate.
  beforeEach(() => useTurnReference().clear());

  it("marks a turn with its author and first line", () => {
    const { mark, marked, markedMessageId } = useTurnReference();
    mark(makeMessage(), "You");

    expect(markedMessageId.value).toBe("m1");
    expect(marked.value?.author).toBe("You");
    expect(marked.value?.preview).toBe("Use desktop tools");
  });

  it("clicking the marked turn again unmarks it — the icon is a toggle", () => {
    const { mark, markedMessageId } = useTurnReference();
    mark(makeMessage(), "You");
    mark(makeMessage(), "You");

    expect(markedMessageId.value).toBeNull();
  });

  it("marking another turn moves the mark — only one at a time", () => {
    const { mark, markedMessageId } = useTurnReference();
    mark(makeMessage(), "You");
    mark(makeMessage({ id: "m2", body: "Second ask" }), "You");

    expect(markedMessageId.value).toBe("m2");
  });

  it("the preview strips markdown and takes the first non-empty line", () => {
    const { mark, marked } = useTurnReference();
    mark(makeMessage({ body: "\n\n## **Done** — it works\n\nDetail here." }), "Claude");

    expect(marked.value?.preview).toBe("Done — it works");
  });

  it("sending carries the reference line and spends the mark", () => {
    const { mark, applyTo, markedMessageId } = useTurnReference();
    mark(makeMessage(), "You");

    const sent = applyTo("do it again");
    expect(sent).toContain('Re: You');
    expect(sent).toContain('"Use desktop tools"');
    expect(sent.endsWith("do it again")).toBe(true);
    // Spent: the next message must not silently carry the same pointer.
    expect(markedMessageId.value).toBeNull();
    expect(applyTo("plain")).toBe("plain");
  });

  it("a long preview is truncated so the chip stays one line", () => {
    const { mark, marked } = useTurnReference();
    mark(makeMessage({ body: "x".repeat(200) }), "You");

    expect(marked.value!.preview.length).toBeLessThanOrEqual(60);
    expect(marked.value!.preview.endsWith("…")).toBe(true);
  });
});
