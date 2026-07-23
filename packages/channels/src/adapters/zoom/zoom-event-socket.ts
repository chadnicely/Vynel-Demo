// One Zoom WebSocket event connection: wss://ws.zoom.us delivers the
// Marketplace app's event subscription over an OUTBOUND socket (no public
// URL — the local-first fit, channels-zoom.md). This module owns the frame
// vocabulary + one connection's lifecycle: heartbeat every 25s (Zoom asks
// for ≤30s), inbound frames parsed defensively and folded into a buffer
// the adapter drains on each polling tick. Zoom does NOT replay events
// missed while disconnected (recorded limitation) — the tick recreates a
// dead connection on its next pass.

import type { NormalizedInboundMessage } from '../channel-adapter.js'

// The minimal socket surface the connection needs — `ws`'s WebSocket
// satisfies it; tests substitute a scripted fake.
export interface ZoomSocket {
  on(event: 'open' | 'close' | 'error', listener: () => void): void
  on(event: 'message', listener: (data: unknown) => void): void
  send(data: string): void
  close(): void
  readyState: number
}

export type ZoomSocketFactory = (url: string) => ZoomSocket

export const ZOOM_SOCKET_OPEN = 1
const ZOOM_SOCKET_CONNECTING = 0
const HEARTBEAT_INTERVAL_MS = 25_000
// A socket still CONNECTING within this window counts as alive — real
// handshakes take longer than one 5s poll tick sometimes, and tearing a
// connecting socket down each tick would loop token grants forever. Past
// the window a stuck handshake IS dead and gets recycled.
const CONNECT_GRACE_MS = 30_000
// Backstop for a channel nobody drains (disabled mid-flood): oldest-first
// drop keeps memory bounded; Zoom has no replay anyway.
const MAX_BUFFERED_MESSAGES = 500

export interface ZoomBotIdentity {
  robotJid: string
  accountId: string
}

export class ZoomEventSocket {
  private socket: ZoomSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private connectStartedAtMs = 0
  private readonly buffer: NormalizedInboundMessage[] = []

  constructor(
    private readonly identity: ZoomBotIdentity,
    private readonly socketFactory: ZoomSocketFactory,
  ) {}

  /** OPEN, or still CONNECTING within the grace window. */
  isAlive(): boolean {
    if (this.socket === null) return false
    if (this.socket.readyState === ZOOM_SOCKET_OPEN) return true
    return (
      this.socket.readyState === ZOOM_SOCKET_CONNECTING &&
      Date.now() - this.connectStartedAtMs < CONNECT_GRACE_MS
    )
  }

  connect(subscriptionId: string, accessToken: string): void {
    this.close()
    this.connectStartedAtMs = Date.now()
    const url = `wss://ws.zoom.us/ws?subscriptionId=${encodeURIComponent(subscriptionId)}&access_token=${encodeURIComponent(accessToken)}`
    const socket = this.socketFactory(url)
    this.socket = socket
    socket.on('message', (data) => this.onFrame(data))
    // Errors surface as a dead socket; the next tick reconnects. Listening
    // prevents an unhandled 'error' event from crashing the process.
    socket.on('error', () => undefined)
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState === ZOOM_SOCKET_OPEN) socket.send(JSON.stringify({ module: 'heartbeat' }))
    }, HEARTBEAT_INTERVAL_MS)
  }

  close(): void {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    try {
      this.socket?.close()
    } catch {
      // a socket already closing/closed must never fail teardown
    }
    this.socket = null
  }

  /** Drain everything received since the last drain (FIFO). */
  drainMessages(): NormalizedInboundMessage[] {
    return this.buffer.splice(0, this.buffer.length)
  }

  // Zoom frames: {"module":"build_connection",...} on connect, and event
  // deliveries as {"module":"message","content": <JSON string or object>}
  // where the content carries {event, payload}. Everything else (heartbeat
  // acks, unknown modules, malformed JSON) is ignored — the socket must
  // never throw into the process.
  private onFrame(data: unknown): void {
    const parsed = parseJsonObject(typeof data === 'string' ? data : String(data))
    if (parsed === null || parsed.module !== 'message') return
    const content =
      typeof parsed.content === 'string'
        ? parseJsonObject(parsed.content)
        : isRecord(parsed.content)
          ? parsed.content
          : null
    if (content === null || content.event !== 'bot_notification') return
    const message = normalizeBotNotification(content.payload, this.identity)
    if (message === null) return
    if (this.buffer.length >= MAX_BUFFERED_MESSAGES) this.buffer.shift()
    this.buffer.push(message)
  }
}

// `bot_notification` payload (Chatbot events doc): { accountId, robotJid,
// toJid, userJid, userId, userName, cmd, timestamp, channelName?,
// messageId? }. `cmd` is the text the user typed after invoking the bot.
// A toJid on Zoom's conference domain is a CHANNEL (our group); a user JID
// is the 1:1 bot chat. Every bot_notification is inherently addressed to
// the bot — Zoom only delivers messages directed at it.
export function normalizeBotNotification(
  payload: unknown,
  identity: ZoomBotIdentity,
): NormalizedInboundMessage | null {
  if (!isRecord(payload)) return null
  const text = typeof payload.cmd === 'string' ? payload.cmd.trim() : ''
  const userJid = typeof payload.userJid === 'string' ? payload.userJid : ''
  const toJid = typeof payload.toJid === 'string' ? payload.toJid : userJid
  if (text === '' || userJid === '') return null
  // Cross-account safety: a frame for another robot is not ours.
  if (typeof payload.robotJid === 'string' && payload.robotJid !== identity.robotJid) return null

  if (typeof payload.accountId === 'string' && payload.accountId !== identity.accountId) return null

  const timestamp = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now()
  const isGroup = toJid.includes('@conference.')
  return {
    externalMessageId:
      typeof payload.messageId === 'string' && payload.messageId !== ''
        ? payload.messageId
        : `zn:${timestamp}:${userJid}`,
    externalSenderId: userJid,
    externalSenderHandle: null,
    externalSenderDisplayName: typeof payload.userName === 'string' ? payload.userName : null,
    externalChatContextId: toJid,
    chatContextKind: isGroup ? 'group' : 'dm',
    chatContextTitle:
      isGroup && typeof payload.channelName === 'string' ? payload.channelName : null,
    isBotMentioned: true,
    messageBody: text,
    messageMetadata: { timestamp, zoomUserId: typeof payload.userId === 'string' ? payload.userId : null },
    receivedAt: new Date(timestamp),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
