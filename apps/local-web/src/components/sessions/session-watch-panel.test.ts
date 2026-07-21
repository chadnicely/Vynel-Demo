import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useSessionWatchStore } from "../../stores/session-watch-store.js";
import SessionWatchPanel from "./SessionWatchPanel.vue";

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
    push: (kind: string, payload: object) =>
      controller.enqueue(sseFrame(kind, payload)),
    fail: (message: string) => controller.error(new Error(message)),
    close: () => controller.close(),
  };
}

function makeHarness(onStreamRequest?: () => ReadableStream<Uint8Array>) {
  const streamSignals: AbortSignal[] = [];
  const GET = vi.fn(async (_path: string, init: { signal: AbortSignal }) => {
    streamSignals.push(init.signal);
    const stream = onStreamRequest?.() ?? makeStreamHandle().stream;
    return { data: stream, response: { ok: true, status: 200 } };
  });
  const client = { GET } as never;
  const pinia = createPinia();
  const wrapper = mount(SessionWatchPanel, {
    global: {
      plugins: [pinia],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return {
    wrapper,
    pinia,
    GET,
    streamSignals,
    store: useSessionWatchStore(pinia),
  };
}

describe("SessionWatchPanel", () => {
  it("stays hidden until a session is watched, then attaches to ITS stream", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness(() => handle.stream);
    expect(harness.wrapper.find(".session-watch").exists()).toBe(false);

    harness.store.open("s1", "Assistant · Ongoing conversation");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    expect(harness.GET.mock.calls[0]![0]).toBe("/sessions/{sessionId}/stream");
    expect(harness.GET.mock.calls[0]![1]).toMatchObject({
      params: { path: { sessionId: "s1" } },
      parseAs: "stream",
    });

    await flushPromises();
    expect(harness.wrapper.get(".watch-title").text()).toContain(
      "Assistant · Ongoing conversation",
    );
    expect(harness.wrapper.text()).toContain("Watching live");
    harness.wrapper.unmount();
  });

  it("folds live events into entries and settles on turn-stream-ended", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness(() => handle.stream);
    harness.store.open("s1", "Assistant");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    handle.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m1",
      textDelta: "Working on it",
    });
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("Working on it"),
    );
    expect(harness.wrapper.text()).toContain("Still working…");

    handle.push("turn-stream-ended", {});
    handle.close();
    await vi.waitFor(() =>
      expect(harness.wrapper.text()).toContain("you're all caught up"),
    );
    // The folded activity stays on screen after the turn ends.
    expect(harness.wrapper.text()).toContain("Working on it");
    harness.wrapper.unmount();
  });

  it("says so when the stream drops instead of swallowing the failure", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness(() => handle.stream);
    harness.store.open("s1", "Assistant");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    handle.fail("network died");
    await vi.waitFor(() =>
      expect(harness.wrapper.find(".state-note.is-error").exists()).toBe(true),
    );
    harness.wrapper.unmount();
  });

  it("Close detaches the stream and clears the store", async () => {
    const handle = makeStreamHandle();
    const harness = makeHarness(() => handle.stream);
    harness.store.open("s1", "Assistant");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    await flushPromises();

    await harness.wrapper.get('[aria-label="Close"]').trigger("click");
    await flushPromises();

    expect(harness.store.sessionId).toBeNull();
    expect(harness.streamSignals[0]!.aborted).toBe(true);
    harness.wrapper.unmount();
  });
});
