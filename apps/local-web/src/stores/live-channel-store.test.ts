// The one-socket-per-window store: lazy connect, refcounted channels, ack →
// onSubscribed, event routing, pong, drop → onDetached + backoff reconnect +
// full re-subscribe, stall detection.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useLiveChannelStore } from "./live-channel-store.js";
import {
  FakeLiveSocket,
  installFakeLiveSocket,
  latestFakeLiveSocket,
} from "./live-channel-test-support.js";

let restoreSocket: () => void;

beforeEach(() => {
  setActivePinia(createPinia());
  restoreSocket = installFakeLiveSocket();
  vi.useFakeTimers();
});
afterEach(() => {
  restoreSocket();
  vi.useRealTimers();
});

describe("useLiveChannelStore", () => {
  it("connects on the first subscribe, subscribes on open, routes events by channel", () => {
    const live = useLiveChannelStore();
    expect(FakeLiveSocket.instances).toHaveLength(0);

    const seen: unknown[] = [];
    const subscribed = vi.fn();
    live.subscribe("session:s1", { onEvent: (event) => seen.push(event), onSubscribed: subscribed });
    expect(FakeLiveSocket.instances).toHaveLength(1);
    expect(live.status).toBe("connecting");
    const socket = latestFakeLiveSocket();
    expect(socket.url).toMatch(/^ws:\/\/.+\/api\/live$/);
    expect(socket.takeSent()).toEqual([]); // nothing until open

    socket.serverOpens("lc_1");
    expect(live.status).toBe("open");
    expect(live.connectionId).toBe("lc_1");
    expect(socket.takeSent()).toEqual([{ op: "subscribe", channels: ["session:s1"] }]);

    socket.serverAcks("session:s1");
    expect(subscribed).toHaveBeenCalledTimes(1);
    socket.serverSends({
      kind: "event",
      channel: "session:s1",
      event: { kind: "text-chunk", messageId: "m1", textDelta: "hi" },
    });
    socket.serverSends({
      kind: "event",
      channel: "session:other",
      event: { kind: "text-chunk", messageId: "m2", textDelta: "not mine" },
    });
    expect(seen).toEqual([{ kind: "text-chunk", messageId: "m1", textDelta: "hi" }]);
  });

  it("refcounts a channel: one server subscription, late joiners get onSubscribed at once, last release unsubscribes", () => {
    const live = useLiveChannelStore();
    const firstSubscribed = vi.fn();
    const secondSubscribed = vi.fn();
    const releaseFirst = live.subscribe("activity", { onEvent: () => {}, onSubscribed: firstSubscribed });
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    socket.takeSent();
    socket.serverAcks("activity");
    expect(firstSubscribed).toHaveBeenCalledTimes(1);

    const releaseSecond = live.subscribe("activity", { onEvent: () => {}, onSubscribed: secondSubscribed });
    expect(socket.takeSent()).toEqual([]); // no second server subscribe
    expect(secondSubscribed).toHaveBeenCalledTimes(1); // already acked → immediate
    expect(live.channelCount()).toBe(1);

    releaseFirst();
    expect(socket.takeSent()).toEqual([]); // still one consumer
    releaseSecond();
    expect(socket.takeSent()).toEqual([{ op: "unsubscribe", channels: ["activity"] }]);
    expect(live.channelCount()).toBe(0);
    releaseSecond(); // idempotent
    expect(socket.takeSent()).toEqual([]);
  });

  it("a channel added while open subscribes immediately; channel-ended and error route to its handlers", () => {
    const live = useLiveChannelStore();
    live.subscribe("activity", { onEvent: () => {} });
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    socket.takeSent();

    const ended = vi.fn();
    const errored = vi.fn();
    live.subscribe("session:s9", { onEvent: () => {}, onEnded: ended, onError: errored });
    expect(socket.takeSent()).toEqual([{ op: "subscribe", channels: ["session:s9"] }]);
    socket.serverSends({ kind: "channel-ended", channel: "session:s9" });
    socket.serverSends({
      kind: "error",
      channel: "session:s9",
      code: "not_found",
      message: "No session to watch.",
    });
    socket.serverSends({ kind: "error", channel: null, code: "invalid_message", message: "bad" });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(errored).toHaveBeenCalledWith({ code: "not_found", message: "No session to watch." });
  });

  it("answers ping with pong", () => {
    const live = useLiveChannelStore();
    live.subscribe("activity", { onEvent: () => {} });
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    socket.takeSent();
    socket.serverSends({ kind: "ping" });
    expect(socket.takeSent()).toEqual([{ op: "pong" }]);
  });

  it("a drop fires onDetached, reconnects with backoff, and re-subscribes every channel", () => {
    const live = useLiveChannelStore();
    const detached = vi.fn();
    const subscribed = vi.fn();
    live.subscribe("activity", { onEvent: () => {}, onDetached: detached, onSubscribed: subscribed });
    live.subscribe("session:s1", { onEvent: () => {}, onDetached: detached, onSubscribed: subscribed });
    const first = latestFakeLiveSocket();
    first.serverOpens();
    first.takeSent();
    first.serverAcks("activity", "session:s1");
    expect(subscribed).toHaveBeenCalledTimes(2);

    first.serverDrops();
    expect(detached).toHaveBeenCalledTimes(2);
    expect(live.status).toBe("reconnecting");
    expect(live.connectionId).toBeNull();
    expect(FakeLiveSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(FakeLiveSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeLiveSocket.instances).toHaveLength(2);
    const second = latestFakeLiveSocket();
    second.serverOpens("lc_2");
    expect(second.takeSent()).toEqual([
      { op: "subscribe", channels: ["activity", "session:s1"] },
    ]);
    second.serverAcks("activity", "session:s1");
    expect(subscribed).toHaveBeenCalledTimes(4); // re-acked → consumers reseed
    expect(live.status).toBe("open");

    // Backoff doubles while the server stays down (1 s, 2 s, 4 s …).
    second.serverDrops();
    vi.advanceTimersByTime(1_000);
    const third = latestFakeLiveSocket();
    expect(FakeLiveSocket.instances).toHaveLength(3);
    third.serverDrops();
    vi.advanceTimersByTime(1_999);
    expect(FakeLiveSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeLiveSocket.instances).toHaveLength(4);
  });

  it("a socket that dropped before any ack does not fire onDetached (nothing was attached)", () => {
    const live = useLiveChannelStore();
    const detached = vi.fn();
    live.subscribe("activity", { onEvent: () => {}, onDetached: detached });
    const socket = latestFakeLiveSocket();
    socket.serverDrops();
    expect(detached).not.toHaveBeenCalled();
    expect(live.status).toBe("reconnecting");
  });

  it("with no channels left, a drop goes idle and the next subscribe reconnects fresh", () => {
    const live = useLiveChannelStore();
    const release = live.subscribe("activity", { onEvent: () => {} });
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    release();
    socket.serverDrops();
    expect(live.status).toBe("idle");
    vi.advanceTimersByTime(30_000);
    expect(FakeLiveSocket.instances).toHaveLength(1);

    live.subscribe("activity", { onEvent: () => {} });
    expect(FakeLiveSocket.instances).toHaveLength(2);
  });

  it("closes a silent socket after 60 s (the server pings every 25 s) and reconnects", () => {
    const live = useLiveChannelStore();
    live.subscribe("activity", { onEvent: () => {} });
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    vi.advanceTimersByTime(59_000);
    socket.serverSends({ kind: "ping" }); // any frame re-arms the stall clock
    vi.advanceTimersByTime(59_000);
    expect(socket.readyState).toBe(FakeLiveSocket.OPEN);
    vi.advanceTimersByTime(1_000);
    expect(socket.readyState).toBe(FakeLiveSocket.CLOSED);
    expect(live.status).toBe("reconnecting");
  });

  it("dispose closes the socket and never reconnects", () => {
    const live = useLiveChannelStore();
    live.subscribe("activity", { onEvent: () => {} });
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    live.dispose();
    expect(socket.readyState).toBe(FakeLiveSocket.CLOSED);
    vi.advanceTimersByTime(60_000);
    expect(FakeLiveSocket.instances).toHaveLength(1);
    expect(live.status).toBe("idle");
  });

  it("without a WebSocket implementation the store is inert (unavailable), never throws", () => {
    restoreSocket();
    const previous = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
    try {
      const live = useLiveChannelStore();
      const release = live.subscribe("activity", { onEvent: () => {} });
      expect(live.status).toBe("unavailable");
      release();
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = previous;
      restoreSocket = installFakeLiveSocket();
    }
  });
});
