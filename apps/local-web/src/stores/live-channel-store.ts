// The live channel's CLIENT half: ONE WebSocket per window (`/api/live`),
// many subscriptions — the activity feed, every watched session, every
// delegation trace ride this socket. Browsers cap HTTP/1.1 at six connections
// per host shared by all windows of the origin; WebSockets sit in their own
// pool, so this costs the request budget nothing no matter how many threads
// are live (docs/module-notes/live-channel.md).
//
// Contract for consumers (`subscribe`):
//   - refcounted per channel: N consumers of one channel = ONE server
//     subscription; the last release unsubscribes.
//   - `onSubscribed` fires on every server ack — the first one AND each
//     re-subscribe after a reconnect (the socket re-subscribes its whole set
//     on open); `onDetached` fires when the socket drops. A consumer that
//     seeds state on attach does so from `onSubscribed`.
//   - `onEvent` / `onEnded` (a turn's `channel-ended`) / `onError` (the
//     server refused this channel: not_found etc.) are per channel.
//   - the socket connects lazily on the first subscribe, reconnects with
//     backoff (1 s → 15 s), answers server pings, and treats 60 s of silence
//     as a dead socket (the server pings every 25 s).

import { ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import {
  LIVE_CHANNEL_PATH,
  type LiveChannelClientMessage,
  type LiveChannelErrorCode,
  type LiveChannelKey,
  type LiveChannelServerFrame,
} from "@vynel/contracts/chat/live-channel";

export type LiveChannelStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  /** No WebSocket in this environment (tests) — subscriptions are inert. */
  | "unavailable";

export interface LiveChannelHandlers {
  onEvent: (event: unknown) => void;
  /** The server acked this channel (first subscribe and every re-subscribe). */
  onSubscribed?: () => void;
  /** The socket dropped — the subscription resumes on reconnect. */
  onDetached?: () => void;
  /** A session/trace turn ended (`channel-ended`); the subscription stays. */
  onEnded?: () => void;
  onError?: (error: { code: LiveChannelErrorCode; message: string }) => void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
const STALL_MS = 60_000;

/** The socket URL — same origin as the page, the gateway's upgrade path. */
export function liveChannelUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${LIVE_CHANNEL_PATH}`;
}

export const useLiveChannelStore = defineStore("live-channel", () => {
  const status = ref<LiveChannelStatus>("idle");
  const connectionId = shallowRef<string | null>(null);

  const channels = new Map<LiveChannelKey, Set<LiveChannelHandlers>>();
  /** Channels the CURRENT socket has acked. */
  const acknowledged = new Set<LiveChannelKey>();
  let socket: WebSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function send(message: LiveChannelClientMessage): void {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  function orderedChannelKeys(): LiveChannelKey[] {
    const keys = [...channels.keys()];
    return keys.sort((left, right) =>
      left === "activity" ? -1 : right === "activity" ? 1 : 0,
    );
  }

  function armStallTimer(): void {
    if (stallTimer !== null) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stallTimer = null;
      // No frame (not even a ping) for a minute — the socket is dead even if
      // the browser hasn't noticed; close it and let the reconnect run.
      socket?.close();
    }, STALL_MS);
  }

  function clearStallTimer(): void {
    if (stallTimer === null) return;
    clearTimeout(stallTimer);
    stallTimer = null;
  }

  function dispatch(
    channel: LiveChannelKey,
    call: (handlers: LiveChannelHandlers) => void,
  ): void {
    const set = channels.get(channel);
    if (set === undefined) return;
    for (const handlers of [...set]) {
      try {
        call(handlers);
      } catch {
        // One consumer's throw must never break the socket for the others.
      }
    }
  }

  function handleFrame(frame: LiveChannelServerFrame): void {
    switch (frame.kind) {
      case "hello":
        // The server accepted us — only now is the backoff reset (a refusal
        // after the upgrade closes without hello and must keep backing off).
        reconnectAttempt = 0;
        status.value = "open";
        connectionId.value = frame.connectionId;
        return;
      case "subscribed":
        acknowledged.add(frame.channel);
        dispatch(frame.channel, (handlers) => handlers.onSubscribed?.());
        return;
      case "unsubscribed":
        return;
      case "event":
        dispatch(frame.channel, (handlers) => handlers.onEvent(frame.event));
        return;
      case "channel-ended":
        dispatch(frame.channel, (handlers) => handlers.onEnded?.());
        return;
      case "error":
        if (frame.channel === null) return; // a malformed message of ours — nothing to route
        dispatch(frame.channel, (handlers) =>
          handlers.onError?.({ code: frame.code, message: frame.message }),
        );
        return;
      case "ping":
        send({ op: "pong" });
        return;
    }
  }

  function connect(): void {
    if (disposed || socket !== null) return;
    if (typeof WebSocket === "undefined") {
      status.value = "unavailable";
      return;
    }
    status.value = reconnectAttempt === 0 ? "connecting" : "reconnecting";
    const ws = new WebSocket(liveChannelUrl());
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      armStallTimer();
      // Re-subscribe the whole set — a reconnect restores every consumer.
      // `activity` goes first: its replay tells the session watchers whether
      // their turn is on before their own acks arrive (the seed-on-ack rule).
      if (channels.size > 0) send({ op: "subscribe", channels: orderedChannelKeys() });
    };
    ws.onmessage = (message: MessageEvent<string>) => {
      if (socket !== ws) return;
      armStallTimer();
      let frame: LiveChannelServerFrame;
      try {
        frame = JSON.parse(message.data) as LiveChannelServerFrame;
      } catch {
        return; // not ours — ignore rather than drop the socket
      }
      handleFrame(frame);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      connectionId.value = null;
      clearStallTimer();
      const hadAcks = acknowledged.size > 0;
      acknowledged.clear();
      if (hadAcks) {
        for (const channel of channels.keys()) {
          dispatch(channel, (handlers) => handlers.onDetached?.());
        }
      }
      scheduleReconnect();
    };
    ws.onerror = () => {
      // The browser follows an error with close — the reconnect rides that.
    };
  }

  function scheduleReconnect(): void {
    if (disposed || channels.size === 0) {
      status.value = "idle";
      return;
    }
    status.value = "reconnecting";
    const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  }

  function subscribe(channel: LiveChannelKey, handlers: LiveChannelHandlers): () => void {
    let set = channels.get(channel);
    const isNewChannel = set === undefined;
    if (set === undefined) {
      set = new Set();
      channels.set(channel, set);
    }
    set.add(handlers);
    if (isNewChannel) send({ op: "subscribe", channels: [channel] });
    else if (acknowledged.has(channel)) handlers.onSubscribed?.();
    connect();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = channels.get(channel);
      if (current === undefined) return;
      current.delete(handlers);
      if (current.size > 0) return;
      channels.delete(channel);
      acknowledged.delete(channel);
      send({ op: "unsubscribe", channels: [channel] });
    };
  }

  /** Tear the socket down — window unload / tests. */
  function dispose(): void {
    disposed = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearStallTimer();
    const ws = socket;
    socket = null;
    ws?.close();
    status.value = "idle";
    connectionId.value = null;
    acknowledged.clear();
  }

  /** Diagnostics: channels this window currently holds. */
  function channelCount(): number {
    return channels.size;
  }

  return { status, connectionId, subscribe, dispose, channelCount };
});
