// The origin-turn engine's DETACH (live-channel slice 4): the send holds its
// HTTP stream only until the server has taken the turn AND the host says the
// shared fold has it — then the stream aborts (server turn unaffected), the
// local overlay clears, nothing is marked failed, and the standing watch
// renders the rest. Without `detachWhen` the engine streams to the end as it
// always did. Driven with scripted SSE bodies + a real query client — no network.

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useChatTurn } from "./use-chat-turn.js";
import type { SessionScope } from "./session-scope.js";
import type { ComposerSettings } from "./use-session-settings.js";

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
    aborted: false,
    push: (kind: string, payload: object) => controller.enqueue(sseFrame(kind, payload)),
    close: () => controller.close(),
    abort() {
      this.aborted = true;
      controller.error(new DOMException("aborted", "AbortError"));
    },
  };
}

const SETTINGS: ComposerSettings = {
  modelId: "claude-opus-4-8",
  mode: "ask",
  thinkingEffort: "high",
  autoBuildout: false,
} as ComposerSettings;

const userRow = {
  id: "u-1",
  sessionId: "sdk-1",
  role: "user",
  body: "Hey",
  createdAt: "2026-08-19T00:00:00.000Z",
};

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function makeHarness(options?: {
  detachWhen?: () => boolean;
  scope?: SessionScope;
}) {
  const handles: ReturnType<typeof makeStreamHandle>[] = [];
  const POST = vi.fn(async (_path: string, init?: { signal?: AbortSignal }) => {
    const handle = makeStreamHandle();
    handles.push(handle);
    // Honor the request signal like fetch does.
    init?.signal?.addEventListener("abort", () => handle.abort());
    return { data: handle.stream, response: { ok: true, status: 200 } };
  });
  const interruptSession = vi.fn(async () => undefined);
  const interruptTurn = vi.fn(async () => ({ interrupted: true }));
  const fakeClient = {
    POST,
    chat: { interruptSession },
    root: { interruptTurn },
  } as never;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  let turn!: ReturnType<typeof useChatTurn>;
  let activity!: ReturnType<typeof useActivityStore>;
  const Host = defineComponent({
    setup() {
      activity = useActivityStore();
      turn = useChatTurn({
        scope: () => options?.scope ?? { kind: "workspace", workspaceId: "ws-1" },
        ...(options?.detachWhen !== undefined ? { detachWhen: options.detachWhen } : {}),
      });
      return () => h("div");
    },
  });
  wrapper = mount(Host, {
    global: {
      plugins: [createPinia(), [VueQueryPlugin, { queryClient }]],
      provide: { [vynelClientKey as symbol]: fakeClient },
    },
  });
  const send = () =>
    turn.startTurn({ sessionId: "sdk-1", isContinuous: true, userText: "Hey", settings: SETTINGS });
  return {
    handles,
    POST,
    interruptSession,
    interruptTurn,
    invalidateQueries,
    turn: () => turn,
    activity: () => activity,
    send,
    stream: () => handles[0]!,
  };
}

describe("useChatTurn", () => {
  it("without detachWhen streams to the end: folds, settles by invalidation, clears", async () => {
    const harness = makeHarness();
    const done = harness.send();
    await vi.waitFor(() => expect(harness.POST).toHaveBeenCalledTimes(1));
    harness.stream().push("user-message-persisted", { kind: "user-message-persisted", message: userRow });
    harness.stream().push("text-chunk", { kind: "text-chunk", messageId: "m-1", textDelta: "Hi" });
    await vi.waitFor(() => expect(harness.turn().view.value?.segments[0]?.text).toBe("Hi"));
    harness.stream().push("session-completed", { kind: "session-completed", sessionId: "sdk-1" });
    harness.stream().push("turn-stream-ended", {});
    harness.stream().close();
    await done;
    expect(harness.turn().view.value).toBeNull();
    expect(harness.turn().isDetached.value).toBe(false);
    expect(harness.stream().aborted).toBe(false);
    expect(harness.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["chat-sessions"] });
  });

  it("detaches once the server has the turn AND the shared fold has it — never before the first frame", async () => {
    const sharedFoldReady = ref(true); // the host says "ready" from the very start
    const harness = makeHarness({ detachWhen: () => sharedFoldReady.value });
    const done = harness.send();
    await vi.waitFor(() => expect(harness.POST).toHaveBeenCalledTimes(1));
    // The send must reach the server: no abort while the request is in flight
    // and no frame has arrived, even though the host already says ready.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(harness.stream().aborted).toBe(false);
    expect(harness.turn().view.value?.status).toBe("streaming");

    // The first frame = the server owns the turn → detach.
    harness.stream().push("user-message-persisted", { kind: "user-message-persisted", message: userRow });
    await vi.waitFor(() => expect(harness.stream().aborted).toBe(true));
    await done;
    expect(harness.turn().isDetached.value).toBe(true);
    expect(harness.turn().view.value).toBeNull();
    // Not a failure: no error note, no interrupted settle, no invalidation storm.
    expect(harness.turn().errorText.value).toBeNull();
    expect(harness.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["chat-sessions"] });
    // The session id stays for Stop; the local presence count is released.
    expect(harness.turn().activeSessionId.value).toBe("sdk-1");
    expect(harness.activity().runningTurnCount).toBe(0);
  });

  it("detaches later, the moment the host's word turns true mid-stream", async () => {
    const sharedFoldReady = ref(false);
    const harness = makeHarness({ detachWhen: () => sharedFoldReady.value });
    const done = harness.send();
    await vi.waitFor(() => expect(harness.POST).toHaveBeenCalledTimes(1));
    harness.stream().push("user-message-persisted", { kind: "user-message-persisted", message: userRow });
    harness.stream().push("text-chunk", { kind: "text-chunk", messageId: "m-1", textDelta: "Hi" });
    await vi.waitFor(() => expect(harness.turn().view.value?.segments[0]?.text).toBe("Hi"));
    expect(harness.stream().aborted).toBe(false);

    sharedFoldReady.value = true;
    await nextTick();
    await vi.waitFor(() => expect(harness.stream().aborted).toBe(true));
    await done;
    expect(harness.turn().isDetached.value).toBe(true);
    expect(harness.turn().view.value).toBeNull();
    expect(harness.turn().errorText.value).toBeNull();
  });

  it("a queued sentinel before the first real frame keeps the stream (the send is still parked)", async () => {
    const harness = makeHarness({ detachWhen: () => true });
    const done = harness.send();
    await vi.waitFor(() => expect(harness.POST).toHaveBeenCalledTimes(1));
    harness.stream().push("turn-queued", { kind: "turn-queued", reason: "busy" });
    await vi.waitFor(() => expect(harness.turn().isQueuedBehindTask.value).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(harness.stream().aborted).toBe(false);
    harness.stream().push("user-message-persisted", { kind: "user-message-persisted", message: userRow });
    await vi.waitFor(() => expect(harness.stream().aborted).toBe(true));
    await done;
    expect(harness.turn().isQueuedBehindTask.value).toBe(false);
  });

  it("interrupt after the detach still stops the server turn (the session id was kept)", async () => {
    const harness = makeHarness({ detachWhen: () => true });
    const done = harness.send();
    await vi.waitFor(() => expect(harness.POST).toHaveBeenCalledTimes(1));
    harness.stream().push("user-message-persisted", { kind: "user-message-persisted", message: userRow });
    await done;
    harness.turn().interrupt();
    expect(harness.interruptSession).toHaveBeenCalledWith("ws-1", "sdk-1");
  });
});

// Stop is identity-shaped (session-hardening D3). The Voice chat panel is a
// GLOBAL-scope surface speaking into the SPOKEN thread, so a scope-shaped
// interrupt reached the typed thread instead — killing a concurrent global
// turn while the voice turn ran on.
describe("useChatTurn.interrupt on the global scope", () => {
  it("names the session the turn is running on", async () => {
    const harness = makeHarness({ scope: { kind: "global" } });
    const done = harness
      .turn()
      .startTurn({ sessionId: null, isContinuous: true, userText: "Hey", settings: SETTINGS });
    await vi.waitFor(() => expect(harness.POST).toHaveBeenCalledTimes(1));
    harness
      .stream()
      .push("session-created", { kind: "session-created", session: { id: "voice-segment-1" } });
    await vi.waitFor(() => expect(harness.turn().activeSessionId.value).toBe("voice-segment-1"));

    harness.turn().interrupt();
    expect(harness.interruptTurn).toHaveBeenCalledWith({ sessionId: "voice-segment-1" });
    // The interrupt already aborted the stream — the send settles as the
    // user-cancelled turn it is.
    await done.catch(() => undefined);
  });

  it("falls back to the global head when no session is resolved yet", () => {
    const harness = makeHarness({ scope: { kind: "global" } });
    harness.turn().interrupt();
    expect(harness.interruptTurn).toHaveBeenCalledWith({});
  });

  it("uses the DISPLAYED thread when this engine holds no turn of its own", () => {
    const harness = makeHarness({ scope: { kind: "global" } });
    harness.turn().interrupt("watched-segment-1");
    expect(harness.interruptTurn).toHaveBeenCalledWith({ sessionId: "watched-segment-1" });
  });
});
