// The feed subscription's lifecycle on the live channel: events fold into the
// activity store and settle the session queries; a dropped socket resets the
// server-turn map, the reconnect re-subscribes (settling once more for the
// missed frames); dispose releases the channel. Driven with the fake socket +
// fake timers — no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import type { VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";
import { useActivityStore } from "../../stores/activity-store.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import {
  FakeLiveSocket,
  installFakeLiveSocket,
  latestFakeLiveSocket,
} from "../../stores/live-channel-test-support.js";
import { useSessionActivityFeed } from "./use-session-activity-feed.js";

const started: SessionActivityEvent = {
  kind: "turn-started",
  turnId: "t1",
  scopeKind: "global",
  workspaceId: null,
  sessionId: null,
  origin: "telegram",
  startedAt: "2026-07-19T10:00:00.000Z",
};

// Inference helper — vi.spyOn's bare ReturnType can't hold the QueryClient
// method's generic signature.
function spyOnInvalidate(client: QueryClient) {
  return vi.spyOn(client, "invalidateQueries");
}

describe("useSessionActivityFeed", () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof spyOnInvalidate>;
  let wrapper: VueWrapper | null = null;
  let restoreSocket: () => void;

  function mountFeed() {
    const Harness = defineComponent({
      setup() {
        useSessionActivityFeed();
        return () => null;
      },
    });
    wrapper = mount(Harness, {
      global: { plugins: [createPinia(), [VueQueryPlugin, { queryClient }]] },
    });
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    socket.serverAcks("activity");
    return socket;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    restoreSocket = installFakeLiveSocket();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    invalidateSpy = spyOnInvalidate(queryClient);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    restoreSocket();
    vi.useRealTimers();
  });

  it("subscribes the activity channel on the window's socket and folds its events into the store", () => {
    const socket = mountFeed();
    expect(FakeLiveSocket.instances).toHaveLength(1);
    expect(socket.sent).toContainEqual({ op: "subscribe", channels: ["activity"] });

    socket.serverSends({ kind: "event", channel: "activity", event: started });
    const store = useActivityStore();
    expect(store.hasGlobalServerTurn).toBe(true);
    expect(store.globalServerTurnOrigin).toBe("telegram");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["chat-sessions"] });

    socket.serverSends({
      kind: "event",
      channel: "activity",
      event: { kind: "turn-ended", turnId: "t1", sessionId: "sess-1", outcome: "ended" },
    });
    expect(store.hasGlobalServerTurn).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["workspaces"] });
  });

  it("resets the server-turn map on a drop; the reconnect re-subscribes and settles once", () => {
    const socket = mountFeed();
    socket.serverSends({ kind: "event", channel: "activity", event: started });
    const store = useActivityStore();
    expect(store.hasGlobalServerTurn).toBe(true);
    invalidateSpy.mockClear();

    // The socket drops (server restart) — liveness is stale immediately…
    socket.serverDrops();
    expect(store.hasGlobalServerTurn).toBe(false);
    expect(FakeLiveSocket.instances).toHaveLength(1); // …and the reconnect waits out the backoff

    vi.advanceTimersByTime(1_000);
    expect(FakeLiveSocket.instances).toHaveLength(2);
    const next = latestFakeLiveSocket();
    next.serverOpens("lc_2");
    expect(next.takeSent()).toEqual([{ op: "subscribe", channels: ["activity"] }]);
    // The gap may have swallowed turn-ended frames — one settle invalidation on the re-ack.
    next.serverAcks("activity");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["chat-sessions"] });
    // …and the server's replay rebuilds the map.
    next.serverSends({ kind: "event", channel: "activity", event: started });
    expect(store.hasGlobalServerTurn).toBe(true);
  });

  it("dispose releases the channel — the socket goes idle, no reconnects fire", () => {
    const socket = mountFeed();
    const live = useLiveChannelStore();
    expect(live.channelCount()).toBe(1);
    wrapper!.unmount();
    wrapper = null;
    expect(live.channelCount()).toBe(0);
    expect(socket.takeSent().at(-1)).toEqual({ op: "unsubscribe", channels: ["activity"] });
    socket.serverDrops();
    vi.advanceTimersByTime(60_000);
    expect(FakeLiveSocket.instances).toHaveLength(1);
  });
});
