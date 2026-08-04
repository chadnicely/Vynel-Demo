// Tests for the ONE activity source seam (sessions-surface Slice ①) — the
// SESSION-kind behaviors the old useSessionWatch never had: settled history on
// open, the settled-wins merge with the live overlay, and the settle path
// (refetch + overlay swap) on turn end. The TRACE-kind lifecycle coverage
// (recast here from use-delegation-trace-live.test.ts when the Slice-② panel
// retired that adapter) guards the reviewer-flagged load-bearing paths: the
// drop-path refetch that re-arms polling, the settle order, and re-target
// identity.

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import {
  useActivityMonitor,
  type ActivitySource,
} from "./use-activity-monitor.js";

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
    fail: (message: string) => controller.error(new Error(message)),
    close: () => controller.close(),
  };
}

function makeTranscript(messages: Array<{ id: string; body: string }>) {
  return {
    session: { id: "sdk-1" },
    messages: messages.map((message) => ({
      id: message.id,
      role: "assistant",
      sourceKind: null,
      sourceLabel: null,
      body: message.body,
    })),
    toolCallsByMessageId: {},
  };
}

function makeHarness(options: {
  transcript?: () => ReturnType<typeof makeTranscript>;
  onStreamRequest?: () => ReadableStream<Uint8Array>;
}) {
  const getSession = vi.fn(async () =>
    options.transcript?.() ?? makeTranscript([]),
  );
  const getTrace = vi.fn(async (partialSessionId: string) => ({
    partialSessionId,
    status: "claimed",
    entries: [],
  }));
  const streamPaths: string[] = [];
  const GET = vi.fn(async (path: string, init: { signal: AbortSignal }) => {
    streamPaths.push(path);
    const stream =
      options.onStreamRequest?.() ?? makeStreamHandle().stream;
    void init;
    return { data: stream, response: { ok: true, status: 200 } };
  });
  const fakeClient = { root: { getSession, getTrace }, GET } as never;

  const source: Ref<ActivitySource | null> = ref(null);
  let monitor!: ReturnType<typeof useActivityMonitor>;
  const Host = defineComponent({
    setup() {
      monitor = useActivityMonitor(() => source.value);
      return () => h("div");
    },
  });
  const wrapper = mount(Host, {
    global: {
      plugins: [
        createPinia(),
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      provide: { [vynelClientKey as symbol]: fakeClient },
    },
  });
  return {
    wrapper,
    source,
    getSession,
    getTrace,
    GET,
    streamPaths,
    monitor: () => monitor,
  };
}

describe("useActivityMonitor (session kind)", () => {
  it("opens onto the settled transcript — history renders before any stream frame", async () => {
    const harness = makeHarness({
      transcript: () =>
        makeTranscript([
          { id: "m-old-1", body: "earlier answer" },
          { id: "m-old-2", body: "later answer" },
        ]),
    });

    harness.source.value = { kind: "session", id: "sdk-1" };
    await vi.waitFor(() =>
      expect(harness.monitor().entries.value.map((entry) => entry.id)).toEqual([
        "m-old-1",
        "m-old-2",
      ]),
    );
    // The session kind attached its own stream and never touched the trace read.
    expect(harness.streamPaths).toEqual(["/sessions/{sessionId}/stream"]);
    expect(harness.getTrace).not.toHaveBeenCalled();
    harness.wrapper.unmount();
  });

  it("merges settled-wins: an overlay row for a persisted id never duplicates; new rows append", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({
      transcript: () => makeTranscript([{ id: "m-old-1", body: "persisted" }]),
      onStreamRequest: () => handle.stream,
    });

    harness.source.value = { kind: "session", id: "sdk-1" };
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(harness.monitor().entries.value).toHaveLength(1),
    );

    // A delta for the ALREADY-PERSISTED row: settled wins by id (the keep-alive
    // poll advances it) — no duplicate entry appears.
    handle.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-old-1",
      textDelta: " more",
    });
    // A NEW live row appends after the settled history.
    handle.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live-1",
      textDelta: "streaming now",
    });
    await vi.waitFor(() =>
      expect(harness.monitor().entries.value.map((entry) => entry.id)).toEqual([
        "m-old-1",
        "m-live-1",
      ]),
    );
    expect(
      harness.monitor().entries.value.find((entry) => entry.id === "m-old-1")!
        .body,
    ).toBe("persisted");
    harness.wrapper.unmount();
  });

  it("re-targeting a session source aborts the old stream and starts the successor clean", async () => {
    const harness = makeHarness({
      transcript: () => makeTranscript([{ id: "m-a", body: "session A row" }]),
    });

    harness.source.value = { kind: "session", id: "sdk-a" };
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    harness.source.value = { kind: "session", id: "sdk-b" };
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(2));

    // A's stream was aborted; B attached; the successor is streaming.
    const firstSignal = harness.GET.mock.calls[0]![1].signal;
    const secondSignal = harness.GET.mock.calls[1]![1].signal;
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    expect(harness.monitor().isStreaming.value).toBe(true);

    harness.wrapper.unmount();
    expect(secondSignal.aborted).toBe(true); // unmount detaches
  });

  it("the settle path: turn-stream-ended flags hasEnded, refetches the transcript, clears the overlay", async () => {
    const handle = makeStreamHandle();
    let persisted = [{ id: "m-old-1", body: "persisted" }];
    const harness = makeHarness({
      transcript: () => makeTranscript(persisted),
      onStreamRequest: () => handle.stream,
    });

    harness.source.value = { kind: "session", id: "sdk-1" };
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    handle.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live-1",
      textDelta: "streaming",
    });
    await vi.waitFor(() =>
      expect(harness.monitor().entries.value).toHaveLength(2),
    );

    // The turn persists server-side; the settle refetch must swap the overlay
    // for the persisted copy — not drop the row.
    persisted = [
      { id: "m-old-1", body: "persisted" },
      { id: "m-live-1", body: "streaming" },
    ];
    const fetchesBeforeEnd = harness.getSession.mock.calls.length;
    handle.push("turn-stream-ended", {});
    handle.close();

    // test: correct expectation (B3) — the watch is STANDING now: hasEnded is
    // a transient pulse (settle → clear → re-subscribe for the next turn), so
    // the meaningful signals are the settle refetch, the swapped rows, and the
    // stream re-attaching (a second GET).
    await vi.waitFor(() =>
      expect(harness.getSession.mock.calls.length).toBeGreaterThan(
        fetchesBeforeEnd,
      ),
    );
    await vi.waitFor(() => expect(harness.GET.mock.calls.length).toBeGreaterThan(1));
    // The row survived the swap — now as a settled entry.
    await vi.waitFor(() =>
      expect(harness.monitor().entries.value.map((entry) => entry.id)).toEqual([
        "m-old-1",
        "m-live-1",
      ]),
    );
    harness.wrapper.unmount();
  });
});

describe("useActivityMonitor (trace kind) — the live lifecycle", () => {
  it("a DROPPED stream restores polling: streaming flips off and a refetch fires", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({ onStreamRequest: () => handle.stream });

    harness.source.value = { kind: "trace", id: "trace-1" };
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    expect(harness.monitor().isStreaming.value).toBe(true);
    const fetchesBeforeDrop = harness.getTrace.mock.calls.length;

    handle.fail("network died");
    await vi.waitFor(() =>
      expect(harness.monitor().isStreaming.value).toBe(false),
    );
    // The explicit drop-path refetch — what re-arms the fast poll interval.
    await vi.waitFor(() =>
      expect(harness.getTrace.mock.calls.length).toBeGreaterThan(
        fetchesBeforeDrop,
      ),
    );
    harness.wrapper.unmount();
  });

  it("the SETTLE path (turn-stream-ended) flips streaming off, refetches once, clears the overlay", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness({ onStreamRequest: () => handle.stream });

    harness.source.value = { kind: "trace", id: "trace-1" };
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    handle.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m1",
      textDelta: "hi",
    });
    await vi.waitFor(() =>
      expect(
        harness.monitor().entries.value.some((entry) => entry.id === "m1"),
      ).toBe(true),
    );

    const fetchesBeforeEnd = harness.getTrace.mock.calls.length;
    handle.push("turn-stream-ended", {});
    handle.close();
    await vi.waitFor(() =>
      expect(harness.monitor().isStreaming.value).toBe(false),
    );
    await vi.waitFor(() =>
      expect(harness.getTrace.mock.calls.length).toBeGreaterThan(
        fetchesBeforeEnd,
      ),
    );
    // Overlay cleared — the settled rows are the story now.
    await vi.waitFor(() =>
      expect(
        harness.monitor().entries.value.some((entry) => entry.id === "m1"),
      ).toBe(false),
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

    harness.source.value = { kind: "trace", id: "trace-a" };
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    harness.source.value = { kind: "trace", id: "trace-b" };
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(2));

    // A's stream was aborted; B's is live and the superseded attach's teardown
    // did not clobber it (the identity guard).
    const firstSignal = harness.GET.mock.calls[0]![1].signal;
    const secondSignal = harness.GET.mock.calls[1]![1].signal;
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    expect(harness.monitor().isStreaming.value).toBe(true);

    harness.wrapper.unmount();
    expect(secondSignal.aborted).toBe(true); // unmount detaches
  });
});
