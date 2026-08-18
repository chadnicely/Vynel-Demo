// A scripted `WebSocket` stand-in for the live-channel suites: tests install
// it as the global, then drive each opened socket (open / frame / close) and
// read what the client sent. Mirrors the browser API surface the store uses
// (readyState, send, close, on* handlers) — nothing more.

import type {
  LiveChannelClientMessage,
  LiveChannelServerFrame,
} from "@vynel/contracts/chat/live-channel";

export class FakeLiveSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  /** Every socket constructed since `reset()`, in order. */
  static instances: FakeLiveSocket[] = [];
  static reset(): void {
    FakeLiveSocket.instances = [];
  }

  readonly url: string;
  readyState = FakeLiveSocket.CONNECTING;
  sent: LiveChannelClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeLiveSocket.instances.push(this);
  }

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as LiveChannelClientMessage);
  }

  close(): void {
    if (this.readyState === FakeLiveSocket.CLOSED) return;
    this.readyState = FakeLiveSocket.CLOSED;
    this.onclose?.();
  }

  // ── test drivers ──
  serverOpens(connectionId = "lc_test"): void {
    this.readyState = FakeLiveSocket.OPEN;
    this.onopen?.();
    this.serverSends({ kind: "hello", connectionId, protocolVersion: 1 });
  }
  serverSends(frame: LiveChannelServerFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  serverAcks(...channels: string[]): void {
    for (const channel of channels) this.serverSends({ kind: "subscribed", channel });
  }
  serverDrops(): void {
    this.readyState = FakeLiveSocket.CLOSED;
    this.onclose?.();
  }
  /** Messages since the last take. */
  takeSent(): LiveChannelClientMessage[] {
    return this.sent.splice(0);
  }
}

/** Install the fake as the page's WebSocket for one test (returns the restore). */
export function installFakeLiveSocket(): () => void {
  FakeLiveSocket.reset();
  const previous = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeLiveSocket;
  return () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = previous;
  };
}

/** The most recently opened fake socket. */
export function latestFakeLiveSocket(): FakeLiveSocket {
  const socket = FakeLiveSocket.instances.at(-1);
  if (socket === undefined) throw new Error("no live socket was opened");
  return socket;
}
