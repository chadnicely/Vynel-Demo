// The feed subscription's lifecycle: events fold into the activity store and
// settle the session queries; a dropped stream resets the server-turn map and
// reconnects with backoff (settling once more for the missed frames); dispose
// stops the loop for good. Driven with controllable ReadableStreams + fake
// timers — no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import type { VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useSessionActivityFeed } from "./use-session-activity-feed.js";

function makeScriptedStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    emit: (frame: string) => controller.enqueue(encoder.encode(frame)),
    close: () => controller.close(),
  };
}

const startedFrame =
  'event: turn-started\ndata: {"kind":"turn-started","turnId":"t1","scopeKind":"global","workspaceId":null,"sessionId":null,"origin":"telegram","startedAt":"2026-07-19T10:00:00.000Z"}\n\n';

// Inference helper — vi.spyOn's bare ReturnType can't hold the QueryClient
// method's generic signature.
function spyOnInvalidate(client: QueryClient) {
  return vi.spyOn(client, "invalidateQueries");
}

describe("useSessionActivityFeed", () => {
  let streams: ReturnType<typeof makeScriptedStream>[];
  let getMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof spyOnInvalidate>;
  let wrapper: VueWrapper | null = null;

  function mountFeed() {
    const Harness = defineComponent({
      setup() {
        useSessionActivityFeed();
        return () => null;
      },
    });
    wrapper = mount(Harness, {
      global: {
        plugins: [createPinia(), [VueQueryPlugin, { queryClient }]],
        provide: {
          [vynelClientKey as symbol]: { GET: getMock } as unknown as VynelClient,
        },
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    streams = [];
    getMock = vi.fn(async () => {
      const scripted = makeScriptedStream();
      streams.push(scripted);
      return { data: scripted.stream, response: { ok: true, status: 200 } };
    });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    invalidateSpy = spyOnInvalidate(queryClient);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  it("folds feed events into the store and settles the session queries", async () => {
    mountFeed();
    await vi.advanceTimersByTimeAsync(0);
    expect(getMock).toHaveBeenCalledTimes(1);

    streams[0]!.emit(startedFrame);
    await vi.advanceTimersByTimeAsync(0);

    const store = useActivityStore();
    expect(store.hasGlobalServerTurn).toBe(true);
    expect(store.globalServerTurnOrigin).toBe("telegram");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["chat-sessions"] });

    streams[0]!.emit(
      'event: turn-ended\ndata: {"kind":"turn-ended","turnId":"t1","sessionId":"sess-1"}\n\n',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(store.hasGlobalServerTurn).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["workspaces"] });
  });

  it("resets the server-turn map on a drop, reconnects with backoff, and settles once", async () => {
    mountFeed();
    await vi.advanceTimersByTimeAsync(0);
    streams[0]!.emit(startedFrame);
    await vi.advanceTimersByTimeAsync(0);

    const store = useActivityStore();
    expect(store.hasGlobalServerTurn).toBe(true);
    invalidateSpy.mockClear();

    // The server closes the stream (restart) — liveness is stale immediately…
    streams[0]!.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.hasGlobalServerTurn).toBe(false);
    expect(getMock).toHaveBeenCalledTimes(1); // …and the reconnect waits out the backoff

    await vi.advanceTimersByTimeAsync(1_000);
    expect(getMock).toHaveBeenCalledTimes(2);
    // The gap may have swallowed turn-ended frames — one settle invalidation.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["chat-sessions"] });
  });

  it("dispose stops the loop — no further reconnects fire", async () => {
    mountFeed();
    await vi.advanceTimersByTimeAsync(0);
    streams[0]!.close(); // drop → the loop enters its backoff sleep
    await vi.advanceTimersByTimeAsync(0);

    wrapper!.unmount();
    wrapper = null;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});
