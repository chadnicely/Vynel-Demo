// Lifecycle tests for the live trace composable — the paths the reviewer flagged
// as load-bearing: a DROPPED stream must restore polling (an explicit refetch —
// TanStack only re-evaluates refetchInterval on query updates), the SETTLE path
// must flip streaming off before its refetch, and a RE-TARGET must abort the old
// stream without clobbering the successor's state. Real Vue app + vue-query;
// the vynel client is a fake behind the sanctioned injection key
// (the app-shell.test harness pattern).

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useDelegationTraceLive } from "./use-delegation-trace-live.js";

function sseFrame(kind: string, payload: object): Uint8Array {
  return new TextEncoder().encode(
    `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

/** A controllable observe stream: the test pushes frames / errors / closes. */
function makeStreamHandle() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (kind: string, payload: object) => controller.enqueue(sseFrame(kind, payload)),
    fail: (message: string) => controller.error(new Error(message)),
    close: () => controller.close(),
  };
}

function makeHarness(options: {
  traceStatus?: () => string;
  onStreamRequest?: (signal: AbortSignal) => ReadableStream<Uint8Array>;
}) {
  const getTrace = vi.fn(async (partialSessionId: string) => ({
    partialSessionId,
    status: options.traceStatus?.() ?? "claimed",
    entries: [],
  }));
  const streamSignals: AbortSignal[] = [];
  const GET = vi.fn(async (_path: string, init: { signal: AbortSignal }) => {
    streamSignals.push(init.signal);
    const stream =
      options.onStreamRequest?.(init.signal) ?? makeStreamHandle().stream;
    return { data: stream, response: { ok: true, status: 200 } };
  });
  const fakeClient = { root: { getTrace }, GET } as never;

  const watchTarget: Ref<string | null> = ref(null);
  let live!: ReturnType<typeof useDelegationTraceLive>;
  const Host = defineComponent({
    setup() {
      live = useDelegationTraceLive(() => watchTarget.value);
      return () => h("div");
    },
  });
  const wrapper = mount(Host, {
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      provide: { [vynelClientKey as symbol]: fakeClient },
    },
  });
  return {
    wrapper,
    watchTarget,
    getTrace,
    GET,
    streamSignals,
    live: () => live,
  };
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe("useDelegationTraceLive", () => {
  it("a DROPPED stream restores polling: streaming flips off and a refetch fires", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({ onStreamRequest: () => handle.stream });

    harness.watchTarget.value = "trace-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    expect(harness.live().isStreaming.value).toBe(true);
    const fetchesBeforeDrop = harness.getTrace.mock.calls.length;

    handle.fail("network died");
    await vi.waitFor(() => expect(harness.live().isStreaming.value).toBe(false));
    // The explicit drop-path refetch — what re-arms the fast poll interval.
    await vi.waitFor(() =>
      expect(harness.getTrace.mock.calls.length).toBeGreaterThan(fetchesBeforeDrop),
    );
    harness.wrapper.unmount();
  });

  it("the SETTLE path (turn-stream-ended) flips streaming off, refetches once, clears the overlay", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({ onStreamRequest: () => handle.stream });

    harness.watchTarget.value = "trace-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    handle.push("text-chunk", { kind: "text-chunk", messageId: "m1", textDelta: "hi" });
    await vi.waitFor(() =>
      expect(harness.live().entries.value.some((entry) => entry.id === "m1")).toBe(true),
    );

    const fetchesBeforeEnd = harness.getTrace.mock.calls.length;
    handle.push("turn-stream-ended", {});
    handle.close();
    await vi.waitFor(() => expect(harness.live().isStreaming.value).toBe(false));
    await vi.waitFor(() =>
      expect(harness.getTrace.mock.calls.length).toBeGreaterThan(fetchesBeforeEnd),
    );
    // Overlay cleared — the settled rows are the story now.
    await vi.waitFor(() =>
      expect(harness.live().entries.value.some((entry) => entry.id === "m1")).toBe(false),
    );
    harness.wrapper.unmount();
  });

  it("re-targeting aborts the old stream and keeps the successor streaming", async () => {
    const handles: ReturnType<typeof makeStreamHandle>[] = [];
    const harness = makeHarness({
      onStreamRequest: () => {
        const handle = makeStreamHandle();
        handles.push(handle);
        return handle.stream;
      },
    });

    harness.watchTarget.value = "trace-a";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    harness.watchTarget.value = "trace-b";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(2));
    await flush();

    // A's stream was aborted; B's is live and the superseded attach's teardown
    // did not clobber it (the identity guard).
    expect(harness.streamSignals[0]!.aborted).toBe(true);
    expect(harness.streamSignals[1]!.aborted).toBe(false);
    expect(harness.live().isStreaming.value).toBe(true);

    harness.wrapper.unmount();
    expect(harness.streamSignals[1]!.aborted).toBe(true); // unmount detaches
  });
});
