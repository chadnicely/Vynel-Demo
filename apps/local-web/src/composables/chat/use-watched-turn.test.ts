// The standing thread watcher — the tab-switch reattach lifecycle: a mid-turn
// attach seeds from the persisted rows and streams the tail; turn end settles
// rows-first then re-subscribes; the own-turn overlay suppresses the echo.
// Since the socket diet the watch attaches ONLY while the activity feed
// reports a turn on the session (and someone would render it) — every case
// that expects a connection first marks the turn live on the feed.

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useWatchedTurn, type WatchedTurnSnapshot } from "./use-watched-turn.js";
import { taskKeys } from "../tasks/task-keys.js";
import { todoKeys } from "../todos/todo-keys.js";

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
    close: () => controller.close(),
    // What a real fetch body does when its request signal aborts.
    abort: () => controller.error(new DOMException("aborted", "AbortError")),
  };
}

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

function makeHarness(options?: { suppressed?: () => boolean }) {
  const handles: ReturnType<typeof makeStreamHandle>[] = [];
  const GET = vi.fn(async (_path: string, init?: { signal?: AbortSignal }) => {
    const handle = makeStreamHandle();
    handles.push(handle);
    // Honor the request signal like fetch does — the registry's gate detaches
    // an idle watch by aborting it.
    init?.signal?.addEventListener("abort", () => handle.abort());
    return { data: handle.stream, response: { ok: true, status: 200 } };
  });
  const fakeClient = { GET } as never;
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
  // The feed's word that a turn is on / off for a session — what the
  // registry's attach gate reads.
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
      outcome: "ended",
    } as never);
  return {
    wrapper,
    sessionId,
    GET,
    refetchDetail,
    handles,
    invalidateQueries,
    watched: () => watched,
    activity: () => activity,
    markLive,
    markEnded,
  };
}

describe("useWatchedTurn", () => {
  it("stays detached with no session id", async () => {
    const harness = makeHarness();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.GET).not.toHaveBeenCalled();
    harness.wrapper.unmount();
  });

  it("mid-turn attach seeds from the rows, dedupes the seam, then streams live", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    harness.sessionId.value = "sdk-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    // The overlap: "lo wor" was already persisted into the row body.
    harness.handles[0]!.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live",
      textDelta: "lo world",
    });
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe(
        "Hello world",
      ),
    );
    expect(harness.refetchDetail).toHaveBeenCalledTimes(1);
    expect(harness.watched().view.value?.userMessage?.id).toBe("u-1");

    // Post-seed deltas append directly — realtime, no further refetch.
    harness.handles[0]!.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live",
      textDelta: "!",
    });
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe(
        "Hello world!",
      ),
    );
    expect(harness.refetchDetail).toHaveBeenCalledTimes(1);
    harness.wrapper.unmount();
  });

  it("seeds the elapsed clock from the activity feed's turn start", async () => {
    const harness = makeHarness();
    const startedAt = "2026-07-31T00:00:00.000Z";
    harness.activity().applyServerActivity({
      kind: "turn-started",
      turnId: "turn-1",
      scopeKind: "workspace",
      workspaceId: "ws-1",
      sessionId: "sdk-1",
      origin: "web",
      startedAt,
    });
    harness.sessionId.value = "sdk-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    harness.handles[0]!.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live",
      textDelta: "x",
    });
    await vi.waitFor(() =>
      expect(harness.watched().view.value).not.toBeNull(),
    );
    expect(harness.watched().view.value?.startedAtMs).toBe(
      Date.parse(startedAt),
    );
    harness.wrapper.unmount();
  });

  it("turn end settles rows-first, clears the overlay, and re-subscribes while the feed still says live", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    harness.sessionId.value = "sdk-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    harness.handles[0]!.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live",
      textDelta: "lo world",
    });
    await vi.waitFor(() =>
      expect(harness.watched().view.value).not.toBeNull(),
    );

    harness.handles[0]!.push("turn-stream-ended", {});
    await vi.waitFor(() => expect(harness.watched().view.value).toBeNull());
    // One refetch seeded the attach; the settle is the second.
    expect(harness.refetchDetail).toHaveBeenCalledTimes(2);
    // The session's NEXT turn is already being watched.
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(2));
    harness.wrapper.unmount();
  });

  it("a turn ending while the seed is in flight never resurrects the overlay", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    harness.sessionId.value = "sdk-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));

    // The first event starts the async seed (refetch + grace); the turn ends
    // BEFORE it resolves — the stale seed must not paint a "streaming"
    // overlay for a finished turn (nothing would ever clear it).
    harness.handles[0]!.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live",
      textDelta: "tail",
    });
    harness.handles[0]!.push("turn-stream-ended", {});

    // The settle re-subscribes for the session's next turn...
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(2));
    // ...and even after the seed's grace window has long passed, no overlay.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(harness.watched().view.value).toBeNull();
    harness.wrapper.unmount();
  });

  it("a suppressed-only watch holds NO socket; it attaches the moment suppression lifts (the socket diet)", async () => {
    const suppressed = ref(true);
    const harness = makeHarness({ suppressed: () => suppressed.value });
    harness.markLive("sdk-1");
    harness.sessionId.value = "sdk-1";
    // test: correct expectation — the own overlay renders this turn, so the
    // shared watch would show nothing here; since the socket diet it no
    // longer connects at all for a consumer that cannot render it (the
    // browser's per-origin connection cap is what the diet protects).
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(harness.GET).not.toHaveBeenCalled();
    expect(harness.watched().view.value).toBeNull();
    // Own turn settles → the consumer would render → the watch attaches.
    suppressed.value = false;
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    harness.wrapper.unmount();
  });

  it("no live turn on the feed → no socket; the feed's turn-started attaches, its turn-ended detaches an idle watch", async () => {
    const harness = makeHarness();
    harness.sessionId.value = "sdk-1";
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(harness.GET).not.toHaveBeenCalled();
    // The feed says a turn is on → attach.
    harness.markLive("sdk-1");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    // The turn ended before any event reached this idle attach → detach; no
    // re-attach until the feed says the next turn is on.
    harness.markEnded("sdk-1");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.GET).toHaveBeenCalledTimes(1);
    harness.markLive("sdk-1");
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(2));
    harness.wrapper.unmount();
  });

  it("a gate close mid-turn never cuts the turn: it settles first, then stays detached", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    harness.sessionId.value = "sdk-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    harness.handles[0]!.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live",
      textDelta: "lo world",
    });
    await vi.waitFor(() => expect(harness.watched().view.value).not.toBeNull());
    // The feed's turn-ended lands BEFORE the channel's terminal frame (two
    // connections, no ordering) — the overlay must keep streaming until the
    // channel says the turn is over.
    harness.markEnded("sdk-1");
    harness.handles[0]!.push("text-chunk", {
      kind: "text-chunk",
      messageId: "m-live",
      textDelta: "!",
    });
    await vi.waitFor(() =>
      expect(harness.watched().view.value?.segments[0]?.text).toBe("Hello world!"),
    );
    harness.handles[0]!.push("turn-stream-ended", {});
    await vi.waitFor(() => expect(harness.watched().view.value).toBeNull());
    // Settled and detached — no idle re-attach without a live turn.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.GET).toHaveBeenCalledTimes(1);
    harness.wrapper.unmount();
  });

  // The work-view refresh at a LIVE-EVENT INGEST — pinned here because this
  // harness drives real SSE frames. The same four lines sit in use-chat-turn
  // and use-session-turn; without a test at an ingest, deleting them anywhere
  // restores the stale-dock bug silently.
  it("refreshes the task + step views when a watched turn writes them", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    harness.sessionId.value = "sdk-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    harness.invalidateQueries.mockClear();

    harness.handles[0]!.push("tool-call-completed", {
      kind: "tool-call-completed",
      toolCall: { id: "tc-1", toolName: "mcp__vynel__set_todos", status: "completed" },
    });
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
    harness.markLive("sdk-1");
    harness.sessionId.value = "sdk-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    harness.invalidateQueries.mockClear();

    harness.handles[0]!.push("tool-call-completed", {
      kind: "tool-call-completed",
      toolCall: { id: "tc-2", toolName: "mcp__vynel__list_tasks", status: "completed" },
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    const keys = harness.invalidateQueries.mock.calls.map((call) => {
      const filters = call[0];
      return typeof filters === "function" ? filters().queryKey : filters?.queryKey;
    });
    expect(keys).not.toContainEqual(todoKeys.all);
    harness.wrapper.unmount();
  });

  it("a session retarget abandons the old watch and attaches the new session", async () => {
    const harness = makeHarness();
    harness.markLive("sdk-1");
    harness.markLive("sdk-2");
    harness.sessionId.value = "sdk-1";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(1));
    harness.sessionId.value = "sdk-2";
    await vi.waitFor(() => expect(harness.GET).toHaveBeenCalledTimes(2));
    // The abandoned watch was ABORTED (its body errored like a real fetch on
    // abort) — a late frame has no stream to land on; the new session's
    // stream is the one attached, and nothing stale ever paints the view.
    expect(() =>
      harness.handles[0]!.push("text-chunk", {
        kind: "text-chunk",
        messageId: "m-live",
        textDelta: "stale",
      }),
    ).toThrow();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.watched().view.value).toBeNull();
    harness.wrapper.unmount();
  });
});
