// The session-turn driver (sessions-surface Slice ③): the queued sentinel,
// the fold-and-settle lifecycle (overlay clears only AFTER the refetch — the
// monitor's order), and the two stop shapes (a real drop is SAID, the user's
// own interrupt is silent). The rendered behavior (thread + composer) is
// pinned in sessions-view.test.ts.

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useSessionTurn } from "./use-session-turn.js";
import type { ComposerSettings } from "../chat/use-session-settings.js";

// Every send carries the composer settings (per-session settings arc).
const SETTINGS: ComposerSettings = {
  modelId: "claude-opus-4-8",
  mode: "ask",
  thinkingEffort: "high",
  autoBuildout: false,
};

function sseFrame(kind: string, payload: object): Uint8Array {
  return new TextEncoder().encode(
    `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

function makeStreamHandle() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (kind: string, payload: object) =>
      controller.enqueue(sseFrame(kind, payload)),
    failWith: (error: Error) => controller.error(error),
    close: () => controller.close(),
  };
}

function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

function makeHarness() {
  const handle = makeStreamHandle();
  const POST = vi.fn(async (_path: string, init: { signal: AbortSignal }) => {
    // Mirror fetch's abort contract: an aborted request errors the body
    // reader with an AbortError.
    init.signal.addEventListener("abort", () => {
      try {
        handle.failWith(abortError());
      } catch {
        // already closed
      }
    });
    return { data: handle.stream, response: { ok: true, status: 200 } };
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  let turn!: ReturnType<typeof useSessionTurn>;
  const Host = defineComponent({
    setup() {
      turn = useSessionTurn(() => "sp-1");
      return () => h("div");
    },
  });
  mount(Host, {
    global: {
      plugins: [createPinia(), [VueQueryPlugin, { queryClient }]],
      provide: { [vynelClientKey as symbol]: { POST } as never },
    },
  });
  return { handle, POST, invalidateSpy, turn: () => turn };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useSessionTurn", () => {
  it("folds the turn's frames, flags the queued sentinel, and settles AFTER the refetch", async () => {
    const { handle, invalidateSpy, turn } = makeHarness();
    const started = turn().startTurn("What did you find?", SETTINGS);
    await settle();
    expect(turn().isStreaming.value).toBe(true);

    handle.push("turn-queued", {});
    await settle();
    expect(turn().isQueued.value).toBe(true);

    handle.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-1",
      textDelta: "Three tiers.",
    });
    await settle();
    expect(turn().isQueued.value).toBe(false);
    // The SHARED live-turn view (active-turn-view) carries the streamed text.
    expect(turn().view.value?.segments).toHaveLength(1);
    expect(turn().view.value?.segments[0]!.text).toBe("Three tiers.");

    handle.push("turn-stream-ended", {});
    handle.close();
    await started;

    // Settled clean: the view clears AFTER the refetch lands (the chat-turn
    // order — nothing reflows to empty in between).
    expect(turn().isStreaming.value).toBe(false);
    expect(turn().errorText.value).toBeNull();
    expect(turn().view.value).toBeNull();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["chat-sessions"],
    });
  });

  it("a dropped stream is SAID — errorText set, streaming off, still reconciled", async () => {
    const { handle, invalidateSpy, turn } = makeHarness();
    const started = turn().startTurn("hello", SETTINGS);
    await settle();

    handle.failWith(new Error("network gone"));
    await started;

    expect(turn().errorText.value).toBe("network gone");
    expect(turn().isStreaming.value).toBe(false);
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("the user's own interrupt stays silent — no error surfaced, view settles", async () => {
    const { turn } = makeHarness();
    const started = turn().startTurn("hello", SETTINGS);
    await settle();

    turn().interrupt();
    await started;

    expect(turn().errorText.value).toBeNull();
    expect(turn().isStreaming.value).toBe(false);
  });
});

// The DETACH (live-channel slice 4): hold the stream until the server's first
// frame, then hand the turn to the standing watch when the host says so.
describe("useSessionTurn — detach", () => {
  it("holds the stream until the server's first frame, then hands off cleanly", async () => {
    const handle = makeStreamHandle();
    let aborted = false;
    const POST = vi.fn(async (_path: string, init: { signal: AbortSignal }) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        try {
          handle.failWith(abortError());
        } catch {
          // already closed
        }
      });
      return { data: handle.stream, response: { ok: true, status: 200 } };
    });
    let turn!: ReturnType<typeof useSessionTurn>;
    const Host = defineComponent({
      setup() {
        turn = useSessionTurn(() => "sp-1", { detachWhen: () => true });
        return () => h("div");
      },
    });
    mount(Host, {
      global: {
        plugins: [
          createPinia(),
          [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
        ],
        provide: { [vynelClientKey as symbol]: { POST } as never },
      },
    });
    const started = turn.startTurn("do it", SETTINGS);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(aborted).toBe(false); // the send must land first
    handle.push("user-message-persisted", {
      kind: "user-message-persisted",
      message: { id: "u-1", sessionId: "sp-1", role: "user", body: "do it" },
    });
    await vi.waitFor(() => expect(aborted).toBe(true));
    await started;
    expect(turn.isDetached.value).toBe(true);
    expect(turn.view.value).toBeNull();
    expect(turn.errorText.value).toBeNull();
    expect(turn.isQueued.value).toBe(false);
  });
});
