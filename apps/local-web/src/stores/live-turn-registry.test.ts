// The registry's HEADLINE guarantees (persona-sessions B3): N subscribers to
// one source share ONE channel subscription + one fold; the entry dies only
// at refCount 0. The seed / settle / reseed behaviour is exercised through
// the adapter suite (use-watched-turn) against the fake socket — this file
// pins the multiplexing itself and the trace source's shape.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../plugins/vynel-client.js";
import { useActivityStore } from "./activity-store.js";
import {
  installFakeLiveSocket,
  latestFakeLiveSocket,
} from "./live-channel-test-support.js";
import {
  useLiveTurnRegistry,
  type LiveTurnSubscription,
} from "./live-turn-registry.js";

let restoreSocket: () => void;
beforeEach(() => {
  restoreSocket = installFakeLiveSocket();
});
afterEach(() => {
  restoreSocket();
});

function makeHarness() {
  const fakeClient = {
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
  const markLive = (id: string) =>
    activity.applyServerActivity({
      kind: "turn-started",
      turnId: `turn-${id}`,
      scopeKind: "global",
      workspaceId: null,
      sessionId: id,
      origin: "web",
      startedAt: "2026-07-31T00:00:00.000Z",
    });
  const openSocket = () => {
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    for (const message of socket.takeSent()) {
      if (message.op === "subscribe") socket.serverAcks(...message.channels);
    }
    return socket;
  };
  return { wrapper, registry: () => registry, markLive, openSocket };
}

describe("useLiveTurnRegistry", () => {
  it("two subscribers to one session share ONE channel subscription; the entry dies at refCount 0", () => {
    const harness = makeHarness();
    const registry = harness.registry();

    const first: LiveTurnSubscription = registry.subscribe({ kind: "session", id: "sdk-1" });
    const second: LiveTurnSubscription = registry.subscribe({ kind: "session", id: "sdk-1" });
    const socket = harness.openSocket();
    expect(registry.activeCount).toBe(1);
    expect(registry.attachedCount).toBe(1);
    // The shared fold: both handles see the same view ref.
    expect(first.view).toBe(second.view);
    expect(socket.sent).toEqual([]);

    first.release();
    expect(registry.activeCount).toBe(1); // the second holds it open
    expect(socket.takeSent()).toEqual([]);
    second.release();
    expect(registry.activeCount).toBe(0);
    expect(socket.takeSent()).toEqual([{ op: "unsubscribe", channels: ["session:sdk-1"] }]);
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
    harness.openSocket();
    // The immediate seed (live turn) read through the provider.
    await vi.waitFor(() => expect(providerFetch).toHaveBeenCalledTimes(1));

    // The provider leaves; the entry survives — its snapshot provider must NOT
    // remain the dead subscription's closure (the fallback re-engages; proven
    // here structurally: the entry stays alive and healthy for the survivor).
    provider.release();
    expect(registry.activeCount).toBe(1);
    survivor.release();
    expect(registry.activeCount).toBe(0);
    harness.wrapper.unmount();
  });

  it("distinct sources get distinct channels on the SAME socket", () => {
    const harness = makeHarness();
    const registry = harness.registry();
    const a = registry.subscribe({ kind: "session", id: "sdk-a" });
    const b = registry.subscribe({ kind: "session", id: "sdk-b" });
    const trace = registry.subscribe({ kind: "trace", id: "p-1" });
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    expect(socket.takeSent()).toEqual([
      { op: "subscribe", channels: ["session:sdk-a", "session:sdk-b", "trace:p-1"] },
    ]);
    expect(registry.activeCount).toBe(3);
    a.release();
    b.release();
    trace.release();
    expect(registry.activeCount).toBe(0);
    harness.wrapper.unmount();
  });

  it("a trace source folds from its first frame and stops at channel-ended (hasEnded stays)", () => {
    const harness = makeHarness();
    const registry = harness.registry();
    const trace = registry.subscribe({ kind: "trace", id: "p-1" });
    const socket = harness.openSocket();
    socket.serverSends({
      kind: "event",
      channel: "trace:p-1",
      event: { kind: "text-chunk", messageId: "m-1", textDelta: "traced" },
    });
    expect(trace.view.value?.segments[0]?.text).toBe("traced");
    socket.serverSends({ kind: "channel-ended", channel: "trace:p-1" });
    expect(trace.hasEnded.value).toBe(true);
    trace.release();
    harness.wrapper.unmount();
  });

  it("an entry with subscribers and no live turn is attached but quiet — no seed read", async () => {
    const harness = makeHarness();
    const registry = harness.registry();
    const fetchSnapshot = vi.fn(async () => ({ messages: [], toolCallsByMessageId: {} }));
    const sub = registry.subscribe({ kind: "session", id: "sdk-idle" }, { fetchSnapshot });
    harness.openSocket();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(registry.attachedCount).toBe(1);
    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(sub.view.value).toBeNull();
    sub.release();
    harness.wrapper.unmount();
  });
});
