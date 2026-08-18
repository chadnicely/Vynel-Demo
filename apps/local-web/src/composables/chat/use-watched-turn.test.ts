// The standing thread watcher on the live channel — the tab-switch reattach
// lifecycle: a mid-turn attach seeds from the persisted rows and streams the
// tail; a turn already running per the feed seeds the moment the channel is
// acked (show immediately); turn end settles rows-first then keeps the
// subscription for the next turn; the own-turn overlay suppresses the echo at
// render time; a socket drop re-seeds on the re-ack.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityStore } from "../../stores/activity-store.js";
import {
  FakeLiveSocket,
  installFakeLiveSocket,
  latestFakeLiveSocket,
} from "../../stores/live-channel-test-support.js";
import { useWatchedTurn, type WatchedTurnSnapshot } from "./use-watched-turn.js";
import { taskKeys } from "../tasks/task-keys.js";
import { todoKeys } from "../todos/todo-keys.js";

// The persisted rows of the running turn — stamped AFTER the feed's turn
// start (the seed bounds its absorb by it).
function makeSnapshot(): WatchedTurnSnapshot {
  return {
    messages: [
      {
        id: "u-1",
        role: "user",
        body: "Hey",
        thinkingBody: null,
        createdAt: "2026-07-31T00:00:01.000Z",
      },
      {
        id: "m-live",
        role: "assistant",
        body: "Hello wor",
        thinkingBody: null,
        createdAt: "2026-07-31T00:00:02.000Z",
      },
    ] as WatchedTurnSnapshot["messages"],
    toolCallsByMessageId: {},
  };
}

let restoreSocket: () => void;
beforeEach(() => {
  restoreSocket = installFakeLiveSocket();
});
afterEach(() => {
  restoreSocket();
});

function makeHarness(options?: { suppressed?: () => boolean }) {
  const fakeClient = {
    root: { getSession: vi.fn(async () => ({ messages: [], toolCallsByMessageId: {} })) },
  } as never;
  const refetchDetail = vi.fn(async (): Promise<WatchedTurnSnapshot> => makeSnapshot());

  const sessionId = ref<string | null>(null);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  let watched!: ReturnType<typeof useWatchedTurn>;
  let activity!: ReturnType<typeof useActivityStore>;
  const Host = defineComponent({
    setup() {
      activity = useActivityStore();
      watched = useWatchedTurn({
        sessionId: () => sessionId.value,
        isSuppressed: options?.suppressed ?? (() => false),
        refetchDetail,
      });
      return () => h("div");
    },
  });
  const wrapper = mount(Host, {
    global: {
      // The watcher refreshes the task/step views when a WATCHED turn writes
      // them, so it resolves a query client like every other chat composable.
      plugins: [createPinia(), [VueQueryPlugin, { queryClient }]],
      provide: { [vynelClientKey as symbol]: fakeClient },
    },
  });
  const markLive = (id: string, startedAt = "2026-07-31T00:00:00.000Z") =>
    activity.applyServerActivity({
      kind: "turn-started",
      turnId: `turn-${id}`,
      scopeKind: "workspace",
      workspaceId: "ws-1",
      sessionId: id,
      origin: "web",
      startedAt,
    });
  const markEnded = (id: string) =>
    activity.applyServerActivity({
      kind: "turn-ended",
      turnId: `turn-${id}`,
      sessionId: id,
      outcome: "ended",
    });
  /** The window's socket comes up and acks whatever is subscribed. */
  const openSocket = () => {
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    for (const message of socket.takeSent()) {
      if (message.op === "subscribe") socket.serverAcks(...message.channels);
    }
    return socket;
  };
  const push = (event: ChatTurnEvent, id = "sdk-1") =>
    latestFakeLiveSocket().serverSends({ kind: "event", channel: `session:${id}`, event });
  const endTurn = (id = "sdk-1") =>
    latestFakeLiveSocket().serverSends({ kind: "channel-ended", channel: `session:${id}` });
  /** Retarget the watcher and let its watch flush (the subscribe is async). */
  const setSession = async (id: string | null) => {
    sessionId.value = id;
    await nextTick();
  };
  return {
    wrapper,
    sessionId,
    setSession,
    refetchDetail,
    invalidateQueries,
    watched: () => watched,
    activity: () => activity,
    markLive,
    markEnded,
    openSocket,
    push,
    endTurn,
  };
}

const chunk = (textDelta: string, messageId = "m-live"): ChatTurnEvent => ({
  kind: "text-chunk",
  messageId,
  textDelta,
});

describe("useWatchedTurn", () => {
  it("stays detached with no session id — no socket, no subscription", async () => {
    const harness = makeHarness();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeLiveSocket.instances).toHaveLength(0);
    harness.wrapper.unmount();
  });

  it("subscribes the session channel and, when the feed says the turn is on, seeds from the rows AT ONCE (show immediately)", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    await harness.setSession("sdk-1");
    const socket = harness.openSocket();
    expect(socket.sent.length + 0).toBe(0);
    // No event yet — the persisted rows alone paint the running turn.
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello wor"),
    );
    expect(harness.watched().view.value?.userMessage?.id).toBe("u-1");
    expect(harness.watched().view.value?.status).toBe("streaming");
    expect(harness.refetchDetail).toHaveBeenCalledTimes(1);
    // The live tail appends directly — realtime, no further refetch.
    harness.push(chunk("ld!"));
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello world!"),
    );
    expect(harness.refetchDetail).toHaveBeenCalledTimes(1);
    harness.wrapper.unmount();
  });

  it("a mid-turn attach with events racing the seed dedupes the seam", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    await harness.setSession("sdk-1");
    harness.openSocket();
    // The overlap: "lo wor" was already persisted into the row body; the delta
    // lands while the seed's snapshot read is in flight.
    harness.push(chunk("lo world"));
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello world"),
    );
    expect(harness.refetchDetail).toHaveBeenCalledTimes(1);
    harness.wrapper.unmount();
  });

  it("no live turn on the feed → subscribed but idle; the first event of a turn seeds it", async () => {
    const harness = makeHarness();
    await harness.setSession("sdk-1");
    const socket = harness.openSocket();
    expect(socket.sent).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(harness.watched().view.value).toBeNull();
    expect(harness.refetchDetail).not.toHaveBeenCalled();
    harness.push(chunk("lo world"));
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello world"),
    );
    harness.wrapper.unmount();
  });

  it("seeds the elapsed clock from the activity feed's turn start", async () => {
    const harness = makeHarness();
    const startedAt = "2026-07-31T00:00:00.000Z";
    harness.markLive("sdk-1", startedAt);
    await harness.setSession("sdk-1");
    harness.openSocket();
    await vi.waitFor(() => expect(harness.watched().view.value).not.toBeNull());
    expect(harness.watched().view.value?.startedAtMs).toBe(Date.parse(startedAt));
    harness.wrapper.unmount();
  });

  it("turn end settles rows-first, clears the overlay, and the same subscription carries the next turn", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    await harness.setSession("sdk-1");
    const socket = harness.openSocket();
    await vi.waitFor(() => expect(harness.watched().view.value).not.toBeNull());

    harness.endTurn();
    await vi.waitFor(() => expect(harness.watched().view.value).toBeNull());
    // One refetch seeded the attach; the settle is the second.
    expect(harness.refetchDetail).toHaveBeenCalledTimes(2);
    expect(socket.takeSent()).toEqual([]); // no re-subscribe needed — standing
    // The session's NEXT turn just arrives on the same channel.
    harness.markEnded("sdk-1");
    harness.push(chunk("next", "m-2"));
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments.at(-1)?.text).toBe("next"),
    );
    harness.wrapper.unmount();
  });

  it("a turn ending while the seed is in flight never resurrects the overlay", async () => {
    const harness = makeHarness();
    await harness.setSession("sdk-1");
    harness.openSocket();
    // The first event starts the async seed (refetch + grace); the turn ends
    // BEFORE it resolves — the stale seed must not paint a "streaming"
    // overlay for a finished turn (nothing would ever clear it).
    harness.push(chunk("tail"));
    harness.endTurn();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(harness.watched().view.value).toBeNull();
    harness.wrapper.unmount();
  });

  it("the own-turn overlay suppresses the shared view at RENDER time; the fold keeps running", async () => {
    const suppressed = ref(true);
    const harness = makeHarness({ suppressed: () => suppressed.value });
    harness.markLive("sdk-1");
    await harness.setSession("sdk-1");
    harness.openSocket();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.watched().view.value).toBeNull();
    // Own turn settles → the shared fold (already seeded) shows at once.
    suppressed.value = false;
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello wor"),
    );
    harness.wrapper.unmount();
  });

  it("the feed's turn-ended arriving before the channel's end never cuts the overlay early", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    await harness.setSession("sdk-1");
    harness.openSocket();
    await vi.waitFor(() => expect(harness.watched().view.value).not.toBeNull());
    harness.markEnded("sdk-1");
    harness.push(chunk("ld!"));
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello world!"),
    );
    harness.endTurn();
    await vi.waitFor(() => expect(harness.watched().view.value).toBeNull());
    harness.wrapper.unmount();
  });

  it("a socket drop mid-turn re-seeds from the rows on the re-ack (or clears if the turn ended meanwhile)", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    await harness.setSession("sdk-1");
    const first = harness.openSocket();
    await vi.waitFor(() => expect(harness.watched().view.value).not.toBeNull());
    harness.push(chunk("ld"));
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello world"),
    );

    // Reconnect + re-ack while the feed still says live → a fresh seed.
    vi.useFakeTimers();
    first.serverDrops();
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    const second = harness.openSocket();
    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(harness.refetchDetail).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello wor"),
    );

    // Drop again; this time the turn ended during the outage — the re-ack clears.
    vi.useFakeTimers();
    second.serverDrops();
    harness.markEnded("sdk-1");
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    harness.openSocket();
    await vi.waitFor(() => expect(harness.watched().view.value).toBeNull());
    harness.wrapper.unmount();
  });

  it("surfaces a refused channel (not_found) as the watch's error text", async () => {
    const harness = makeHarness();
    await harness.setSession("sdk-1");
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    socket.serverSends({
      kind: "error",
      channel: "session:sdk-1",
      code: "not_found",
      message: 'No session to watch under "session:sdk-1".',
    });
    expect(harness.watched().errorText.value).toBe('No session to watch under "session:sdk-1".');
    harness.wrapper.unmount();
  });

  // The work-view refresh at a LIVE-EVENT INGEST — pinned here because this
  // harness drives real channel frames. The same four lines sit in
  // use-chat-turn and use-session-turn; without a test at an ingest, deleting
  // them anywhere restores the stale-dock bug silently.
  it("refreshes the task + step views when a watched turn writes them", async () => {
    const harness = makeHarness();
    await harness.setSession("sdk-1");
    harness.openSocket();
    harness.invalidateQueries.mockClear();
    harness.push({
      kind: "tool-call-completed",
      toolCall: { id: "tc-1", toolName: "mcp__vynel__set_todos", status: "completed" },
    } as never);
    await vi.waitFor(() => {
      const keys = harness.invalidateQueries.mock.calls.map((call) => {
        const filters = call[0];
        return typeof filters === "function" ? filters().queryKey : filters?.queryKey;
      });
      expect(keys).toContainEqual(todoKeys.all);
      expect(keys).toContainEqual(taskKeys.all);
    });
    harness.wrapper.unmount();
  });

  it("ignores a read tool — no refresh storm on every list call", async () => {
    const harness = makeHarness();
    await harness.setSession("sdk-1");
    harness.openSocket();
    harness.invalidateQueries.mockClear();
    harness.push({
      kind: "tool-call-completed",
      toolCall: { id: "tc-2", toolName: "mcp__vynel__list_tasks", status: "completed" },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const keys = harness.invalidateQueries.mock.calls.map((call) => {
      const filters = call[0];
      return typeof filters === "function" ? filters().queryKey : filters?.queryKey;
    });
    expect(keys).not.toContainEqual(todoKeys.all);
    harness.wrapper.unmount();
  });

  it("a session retarget unsubscribes the old channel and subscribes the new one; a late old frame never paints", async () => {
    const harness = makeHarness();
    await harness.setSession("sdk-1");
    const socket = harness.openSocket();
    await harness.setSession("sdk-2");
    await vi.waitFor(() =>
      expect(socket.takeSent()).toEqual([
        { op: "unsubscribe", channels: ["session:sdk-1"] },
        { op: "subscribe", channels: ["session:sdk-2"] },
      ]),
    );
    socket.serverAcks("session:sdk-2");
    harness.push(chunk("stale"), "sdk-1");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.watched().view.value).toBeNull();
    harness.push(chunk("fresh", "m-9"), "sdk-2");
    // (The shared fixture rows seed the new session's turn; the live delta is its tail.)
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments.at(-1)?.text).toBe("fresh"),
    );
    harness.wrapper.unmount();
  });
});
