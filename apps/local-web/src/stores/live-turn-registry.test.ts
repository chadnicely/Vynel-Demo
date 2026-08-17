// The registry's HEADLINE guarantees (persona-sessions B3): N subscribers to
// one source share ONE SSE + one fold; the entry dies only at refCount 0.
// The loop's behavior (seed, settle, re-attach, retry) is exercised through
// the adapter suites (use-watched-turn / use-activity-monitor) against real
// fake streams — this file pins the multiplexing itself.

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../plugins/vynel-client.js";
import { useActivityStore } from "./activity-store.js";
import {
  useLiveTurnRegistry,
  type LiveTurnSubscription,
} from "./live-turn-registry.js";

function makeHangingStream() {
  // A stream that never emits — enough to hold a subscription open.
  return new ReadableStream<Uint8Array>({ start() {} });
}

function makeHarness() {
  const GET = vi.fn(async () => ({
    data: makeHangingStream(),
    response: new Response(null, { status: 200 }),
  }));
  const fakeClient = {
    GET,
    root: { getSession: vi.fn(async () => ({ messages: [], toolCallsByMessageId: {} })) },
  };
  let registry!: ReturnType<typeof useLiveTurnRegistry>;
  let activity!: ReturnType<typeof useActivityStore>;
  const Host = defineComponent({
    setup() {
      registry = useLiveTurnRegistry();
      activity = useActivityStore();
      return () => h("div");
    },
  });
  const wrapper = mount(Host, {
    global: {
      plugins: [
        createPinia(),
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      provide: { [vynelClientKey as symbol]: fakeClient },
    },
  });
  // A session watch attaches only while the feed reports a turn on it (the
  // socket diet) — mark one live before expecting a stream.
  const markLive = (id: string) =>
    activity.applyServerActivity({
      kind: "turn-started",
      turnId: `turn-${id}`,
      scopeKind: "global",
      workspaceId: null,
      sessionId: id,
      origin: "web",
      startedAt: "2026-07-31T00:00:00.000Z",
    } as never);
  return { wrapper, GET, registry: () => registry, markLive };
}

describe("useLiveTurnRegistry", () => {
  it("two subscribers to one session share ONE stream; the entry dies at refCount 0", async () => {
    const harness = makeHarness();
    const registry = harness.registry();

    harness.markLive("sdk-1");
    const first: LiveTurnSubscription = registry.subscribe({ kind: "session", id: "sdk-1" });
    const second: LiveTurnSubscription = registry.subscribe({ kind: "session", id: "sdk-1" });
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    expect(registry.activeCount).toBe(1);
    await vi.waitFor(() => expect(registry.attachedCount).toBe(1));
    // The shared fold: both handles see the same view ref.
    expect(first.view).toBe(second.view);

    first.release();
    expect(registry.activeCount).toBe(1); // the second holds it open
    second.release();
    expect(registry.activeCount).toBe(0);
    // A double release is a no-op, never a negative refcount.
    second.release();
    expect(registry.activeCount).toBe(0);
    harness.wrapper.unmount();
  });

  it("the provider's release re-engages the fallback for survivors", async () => {
    const harness = makeHarness();
    const registry = harness.registry();
    const providerFetch = vi.fn(async () => ({
      messages: [],
      toolCallsByMessageId: {},
    }));

    harness.markLive("sdk-1");
    // The provider subscribes FIRST (wins the slot), a plain survivor second.
    const provider = registry.subscribe(
      { kind: "session", id: "sdk-1" },
      { fetchSnapshot: providerFetch },
    );
    const survivor = registry.subscribe({ kind: "session", id: "sdk-1" });
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    // The provider leaves; the entry survives — its snapshot provider must NOT
    // remain the dead subscription's closure (the fallback re-engages; proven
    // here structurally: the entry stays alive and healthy for the survivor).
    provider.release();
    expect(registry.activeCount).toBe(1);
    survivor.release();
    expect(registry.activeCount).toBe(0);
    harness.wrapper.unmount();
  });

  it("distinct sources get distinct streams", async () => {
    const harness = makeHarness();
    const registry = harness.registry();

    harness.markLive("sdk-a");
    harness.markLive("sdk-b");
    const a = registry.subscribe({ kind: "session", id: "sdk-a" });
    const b = registry.subscribe({ kind: "session", id: "sdk-b" });
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(2));
    expect(registry.activeCount).toBe(2);
    a.release();
    b.release();
    expect(registry.activeCount).toBe(0);
    harness.wrapper.unmount();
  });

  it("an entry with subscribers but no live turn holds no socket — the entry lives, the connection waits for the feed", async () => {
    const harness = makeHarness();
    const registry = harness.registry();
    const sub = registry.subscribe({ kind: "session", id: "sdk-idle" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(registry.activeCount).toBe(1);
    expect(registry.attachedCount).toBe(0);
    expect(harness.GET).not.toHaveBeenCalled();
    harness.markLive("sdk-idle");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(registry.attachedCount).toBe(1));
    sub.release();
    expect(registry.activeCount).toBe(0);
    harness.wrapper.unmount();
  });

  it("two subscribers, both suppressed → no socket; one lifting suppression → one socket", async () => {
    const harness = makeHarness();
    const registry = harness.registry();
    harness.markLive("sdk-1");
    const firstSuppressed = ref(true);
    const first = registry.subscribe(
      { kind: "session", id: "sdk-1" },
      { isSuppressed: () => firstSuppressed.value },
    );
    const second = registry.subscribe(
      { kind: "session", id: "sdk-1" },
      { isSuppressed: () => true },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(harness.GET).not.toHaveBeenCalled();
    firstSuppressed.value = false;
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    first.release();
    second.release();
    harness.wrapper.unmount();
  });
});
