// The spawned-session turn engine's DETACH (live-channel slice 4) — the
// use-chat-turn shape: hold the stream until the server's first frame, then
// hand the turn to the standing watch when the host says so.

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useSessionTurn } from "./use-session-turn.js";
import type { ComposerSettings } from "../chat/use-session-settings.js";

function sseFrame(kind: string, payload: object): Uint8Array {
  return new TextEncoder().encode(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`);
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
    aborted: false,
    push: (kind: string, payload: object) => controller.enqueue(sseFrame(kind, payload)),
    abort() {
      this.aborted = true;
      controller.error(new DOMException("aborted", "AbortError"));
    },
  };
}

const SETTINGS = {
  modelId: "claude-opus-4-8",
  mode: "ask",
  thinkingEffort: "high",
  autoBuildout: false,
} as ComposerSettings;

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function makeHarness(detachWhen: () => boolean) {
  const handles: ReturnType<typeof makeStreamHandle>[] = [];
  const POST = vi.fn(async (_path: string, init?: { signal?: AbortSignal }) => {
    const handle = makeStreamHandle();
    handles.push(handle);
    init?.signal?.addEventListener("abort", () => handle.abort());
    return { data: handle.stream, response: { ok: true, status: 200 } };
  });
  let turn!: ReturnType<typeof useSessionTurn>;
  const Host = defineComponent({
    setup() {
      turn = useSessionTurn(() => "spawned-1", { detachWhen });
      return () => h("div");
    },
  });
  wrapper = mount(Host, {
    global: {
      plugins: [
        createPinia(),
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      provide: { [vynelClientKey as symbol]: { POST } as never },
    },
  });
  return { POST, turn: () => turn, stream: () => handles[0]! };
}

describe("useSessionTurn — detach", () => {
  it("holds the stream until the server's first frame, then hands off cleanly", async () => {
    const ready = ref(true);
    const harness = makeHarness(() => ready.value);
    const done = harness.turn().startTurn("do it", SETTINGS);
    await vi.waitFor(() => expect(harness.POST).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(harness.stream().aborted).toBe(false); // the send must land first
    harness.stream().push("user-message-persisted", {
      kind: "user-message-persisted",
      message: { id: "u-1", sessionId: "spawned-1", role: "user", body: "do it" },
    });
    await vi.waitFor(() => expect(harness.stream().aborted).toBe(true));
    await done;
    expect(harness.turn().isDetached.value).toBe(true);
    expect(harness.turn().view.value).toBeNull();
    expect(harness.turn().errorText.value).toBeNull();
    expect(harness.turn().isQueued.value).toBe(false);
  });
});
