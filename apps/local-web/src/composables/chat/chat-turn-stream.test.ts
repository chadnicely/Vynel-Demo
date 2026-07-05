import { describe, expect, it } from "vitest";
import type { VynelClient } from "@vynel/sdk";
import { streamChatTurnEvents } from "./chat-turn-stream.js";

// Build a ReadableStream that emits the given UTF-8 chunks in order — lets a
// test split SSE frames across arbitrary byte boundaries.
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
}

interface Captured {
  path: string;
  init: { params?: unknown; body?: unknown; parseAs?: string };
}

function fakeClient(
  stream: ReadableStream<Uint8Array>,
  ok = true,
): { client: VynelClient; captured: Captured[] } {
  const captured: Captured[] = [];
  const client = {
    POST: async (path: string, init: Captured["init"]) => {
      captured.push({ path, init });
      return { data: ok ? stream : undefined, response: { ok } as Response };
    },
  } as unknown as VynelClient;
  return { client, captured };
}

const FRAMES =
  "event: session-created\ndata: {\"kind\":\"session-created\",\"session\":{\"id\":\"s1\"}}\n\n" +
  "event: text-chunk\ndata: {\"kind\":\"text-chunk\",\"messageId\":\"m1\",\"textDelta\":\"hi\"}\n\n" +
  "event: turn-stream-ended\ndata: {}\n\n";

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const event of gen) out.push(event);
  return out;
}

describe("streamChatTurnEvents", () => {
  it("posts a workspace turn to the chat route with the composed body", async () => {
    const { client, captured } = fakeClient(streamFromChunks([FRAMES]));
    await collect(
      streamChatTurnEvents(client, {
        scope: { kind: "workspace", workspaceId: "ws1" },
        userMessageText: "hello",
        continueRoot: true,
        mode: "ask",
        signal: new AbortController().signal,
      }),
    );
    expect(captured[0]?.path).toBe(
      "/workspaces/{workspaceId}/chat/sessions/turn",
    );
    expect(captured[0]?.init.params).toEqual({ path: { workspaceId: "ws1" } });
    expect(captured[0]?.init.body).toEqual({
      userMessageText: "hello",
      continueRoot: true,
      mode: "ask",
    });
    expect(captured[0]?.init.parseAs).toBe("stream");
  });

  it("posts a global turn to the root route with text only", async () => {
    const { client, captured } = fakeClient(streamFromChunks([FRAMES]));
    await collect(
      streamChatTurnEvents(client, {
        scope: { kind: "global" },
        userMessageText: "hello",
        signal: new AbortController().signal,
      }),
    );
    expect(captured[0]?.path).toBe("/root/turn");
    expect(captured[0]?.init.body).toEqual({ userMessageText: "hello" });
  });

  it("decodes events even when frames are split across byte chunks", async () => {
    const mid = Math.floor(FRAMES.length / 2);
    const { client } = fakeClient(
      streamFromChunks([FRAMES.slice(0, mid), FRAMES.slice(mid)]),
    );
    const events = await collect(
      streamChatTurnEvents(client, {
        scope: { kind: "global" },
        userMessageText: "hello",
        signal: new AbortController().signal,
      }),
    );
    expect(events).toEqual([
      { kind: "session-created", session: { id: "s1" } },
      { kind: "text-chunk", messageId: "m1", textDelta: "hi" },
      { kind: "turn-stream-ended" },
    ]);
  });

  it("throws when the response is not ok", async () => {
    const { client } = fakeClient(streamFromChunks([FRAMES]), false);
    await expect(
      collect(
        streamChatTurnEvents(client, {
          scope: { kind: "global" },
          userMessageText: "hello",
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow();
  });
});
