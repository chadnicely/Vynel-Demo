// `LiveChannelHub` — the server half of the live channel: ONE socket per
// window, many subscriptions. Transport-blind (the api's WebSocket route hands
// it a `send`/`close` pair per connection) and stateful by nature — a registry
// of connections and what each listens to (the provider-registry class
// exception). It bridges the two in-process sources the SSE routes already
// read — the `SessionActivityFeed` (per user, replay on subscribe) and the
// `TurnEventBroadcaster` (session + trace channels) — into per-connection
// frames, and re-attaches a session/trace listener after every turn end so a
// subscription is STANDING (`channel-ended`, then the next turn just arrives).
//
// Ownership stays with the api: `authorizeChannel` answers "may this user watch
// this session/trace" from the DB; the hub never sees a row.

import type { ChatTurnEvent } from '@vynel/chat'
import {
  LIVE_CHANNEL_PROTOCOL_VERSION,
  parseLiveChannelClientMessage,
  parseLiveChannelKey,
  type LiveChannelKey,
  type LiveChannelServerFrame,
  type ParsedLiveChannelKey,
} from '@vynel/contracts/chat/live-channel'
import type { SessionActivityEvent } from '@vynel/contracts/chat/session-activity'
import type { VoiceRelayEvent, VoiceSurface } from '@vynel/contracts/voice/daemon-events'
import type { StructuralLogger } from '@vynel/logger'
import type { TurnEventBroadcaster } from '../../delegation/turn-event-broadcaster.js'
import { traceChannelKey } from '../../delegation/turn-event-broadcaster.js'
import type { SessionActivityFeed } from '../session-activity-feed.js'
import { sessionChannelKey } from '../session-turn-channel.js'

/** The frames the hub emits — the wire vocabulary with the SERVER-side turn
 *  event (Date fields); the transport's JSON serialization turns them into
 *  the contracts shape (ISO strings), exactly as the SSE routes do. */
export type LiveChannelOutboundFrame =
  | Exclude<LiveChannelServerFrame, { kind: 'event' }>
  | { kind: 'event'; channel: 'activity'; event: SessionActivityEvent }
  | { kind: 'event'; channel: `voice:${VoiceSurface}`; event: VoiceRelayEvent }
  | { kind: 'event'; channel: LiveChannelKey; event: ChatTurnEvent }

export interface LiveChannelTransport {
  send: (frame: LiveChannelOutboundFrame) => void
  close: (code: number, reason: string) => void
}

export interface LiveChannelLimits {
  maxSubscriptionsPerConnection: number
  maxConnectionsPerUser: number
  /** Beats between server pings; a connection silent for two beats is closed. */
  heartbeatIntervalMs: number
}

export const DEFAULT_LIVE_CHANNEL_LIMITS: LiveChannelLimits = {
  maxSubscriptionsPerConnection: 512,
  maxConnectionsPerUser: 32,
  heartbeatIntervalMs: 25_000,
}

/** The voice daemon's events per surface — the api's relay (ONE daemon link
 *  per surface, however many windows listen). The source owns the delivery
 *  rules (state to every listener; wake/speak to the newest — the daemon's
 *  single-delivery contract) and replays the current link/state to a new
 *  listener synchronously inside subscribe(). */
export interface LiveChannelVoiceSource {
  subscribe: (surface: VoiceSurface, listener: (event: VoiceRelayEvent) => void) => () => void
}

export interface LiveChannelHubDeps {
  turnEvents: TurnEventBroadcaster<ChatTurnEvent>
  activityFeed: SessionActivityFeed
  /** Omitted = voice channels answer `not_found` (no daemon relay wired). */
  voice?: LiveChannelVoiceSource
  /** May this user watch this channel? Sync — a DB ownership read. The
   *  activity channel is always the user's own and never asked. */
  authorizeChannel: (userId: string, channel: ParsedLiveChannelKey) => boolean
  logger?: StructuralLogger
  limits?: Partial<LiveChannelLimits>
  /** Test seam for the heartbeat clock. */
  now?: () => number
}

export interface LiveChannelConnection {
  readonly connectionId: string
  /** One raw client message (the socket's text frame). Never throws. */
  handleMessage: (raw: unknown) => void
  /** The socket closed (any side) — releases every subscription. Idempotent. */
  close: () => void
  /** Diagnostics. */
  subscribedChannels: () => LiveChannelKey[]
}

/** Close codes the hub uses (4000–4999 = application-defined). */
export const LIVE_CHANNEL_CLOSE_CODES = {
  /** RFC 6455 "going away" — the server is shutting down. */
  goingAway: 1001,
  heartbeatTimeout: 4000,
  tooManyConnections: 4001,
  sendFailed: 4002,
} as const

interface ConnectionState {
  connectionId: string
  userId: string
  transport: LiveChannelTransport
  /** channel key → its detach (broadcaster / feed unsubscribe). */
  subscriptions: Map<LiveChannelKey, () => void>
  lastInboundAtMs: number
  closed: boolean
}

export class LiveChannelHub {
  private readonly connections = new Map<string, ConnectionState>()
  private readonly limits: LiveChannelLimits
  private readonly now: () => number
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private nextConnectionNumber = 0

  constructor(private readonly deps: LiveChannelHubDeps) {
    this.limits = { ...DEFAULT_LIVE_CHANNEL_LIMITS, ...deps.limits }
    this.now = deps.now ?? (() => Date.now())
  }

  /** Register a socket. Sends `hello` first. Refuses (closes) when the user
   *  already holds `maxConnectionsPerUser` sockets — a leak guard, not a quota. */
  connect(input: { userId: string; transport: LiveChannelTransport }): LiveChannelConnection {
    const connectionId = `lc_${++this.nextConnectionNumber}_${Math.random().toString(36).slice(2, 8)}`
    const state: ConnectionState = {
      connectionId,
      userId: input.userId,
      transport: input.transport,
      subscriptions: new Map(),
      lastInboundAtMs: this.now(),
      closed: false,
    }
    const connection: LiveChannelConnection = {
      connectionId,
      handleMessage: (raw) => this.handleMessage(state, raw),
      close: () => this.closeConnection(state),
      subscribedChannels: () => [...state.subscriptions.keys()],
    }
    const held = [...this.connections.values()].filter((c) => c.userId === input.userId).length
    if (held >= this.limits.maxConnectionsPerUser) {
      this.deps.logger?.warn(
        { userId: input.userId, held },
        'live-channel: connection refused — too many sockets for one user',
      )
      state.closed = true
      input.transport.close(LIVE_CHANNEL_CLOSE_CODES.tooManyConnections, 'too many connections')
      return connection
    }
    this.connections.set(connectionId, state)
    this.ensureHeartbeat()
    this.send(state, { kind: 'hello', connectionId, protocolVersion: LIVE_CHANNEL_PROTOCOL_VERSION })
    return connection
  }

  /** Stop the heartbeat and close every socket — process shutdown / tests.
   *  Closes with 1001 (going away): the node server's close() waits for
   *  upgraded sockets, so a window left open would otherwise hold shutdown
   *  until its own stall timer fires; clients back off and reconnect. */
  dispose(): void {
    for (const state of [...this.connections.values()]) {
      this.closeConnection(state, LIVE_CHANNEL_CLOSE_CODES.goingAway, 'server shutting down')
    }
    this.stopHeartbeat()
  }

  /** Diagnostics: open sockets / total subscriptions across them. */
  connectionCount(): number {
    return this.connections.size
  }
  subscriptionCount(): number {
    let total = 0
    for (const state of this.connections.values()) total += state.subscriptions.size
    return total
  }

  private handleMessage(state: ConnectionState, raw: unknown): void {
    if (state.closed) return
    state.lastInboundAtMs = this.now()
    const message = parseLiveChannelClientMessage(raw)
    if (message === null) {
      this.send(state, {
        kind: 'error',
        channel: null,
        code: 'invalid_message',
        message: 'Expected {"op":"subscribe"|"unsubscribe","channels":[...]} or {"op":"pong"}.',
      })
      return
    }
    if (message.op === 'pong') return
    for (const channel of message.channels) {
      if (message.op === 'subscribe') this.subscribe(state, channel)
      else this.unsubscribe(state, channel)
    }
  }

  private subscribe(state: ConnectionState, channel: LiveChannelKey): void {
    if (state.subscriptions.has(channel)) {
      this.send(state, { kind: 'subscribed', channel }) // idempotent
      return
    }
    const parsed = parseLiveChannelKey(channel)
    if (parsed === null) {
      this.send(state, {
        kind: 'error',
        channel,
        code: 'unknown_channel',
        message: `Unknown channel "${channel}" — use activity, session:<id>, trace:<id> or voice:<surface>.`,
      })
      return
    }
    if (state.subscriptions.size >= this.limits.maxSubscriptionsPerConnection) {
      this.send(state, {
        kind: 'error',
        channel,
        code: 'limit_exceeded',
        message: `This connection already holds ${this.limits.maxSubscriptionsPerConnection} subscriptions.`,
      })
      return
    }
    if (parsed.kind === 'voice' && this.deps.voice === undefined) {
      this.send(state, {
        kind: 'error',
        channel,
        code: 'not_found',
        message: 'The voice daemon relay is not available on this engine.',
      })
      return
    }
    if (parsed.kind !== 'activity' && !this.deps.authorizeChannel(state.userId, parsed)) {
      // Unknown and not-owned answer alike (no enumeration leak — the SSE routes' 404 shape).
      this.send(state, {
        kind: 'error',
        channel,
        code: 'not_found',
        message: `No ${parsed.kind} to watch under "${channel}".`,
      })
      return
    }
    // Registered BEFORE the first frame can flow so a replay (activity) or an
    // event racing the subscribe is never sent for a channel we don't hold.
    if (parsed.kind === 'activity') {
      const activity = this.attachActivity(state)
      state.subscriptions.set(channel, activity.detach)
      this.send(state, { kind: 'subscribed', channel })
      activity.replay()
      return
    }
    if (parsed.kind === 'voice') {
      const voice = this.attachVoice(state, channel, parsed.surface)
      state.subscriptions.set(channel, voice.detach)
      this.send(state, { kind: 'subscribed', channel })
      voice.replay()
      return
    }
    state.subscriptions.set(
      channel,
      this.attachTurnChannel(state, channel, broadcasterKeyFor(parsed)),
    )
    this.send(state, { kind: 'subscribed', channel })
  }

  private unsubscribe(state: ConnectionState, channel: LiveChannelKey): void {
    const detach = state.subscriptions.get(channel)
    if (detach === undefined) return
    state.subscriptions.delete(channel)
    detach()
    this.send(state, { kind: 'unsubscribed', channel })
  }

  /** The feed replays in-flight turns on subscribe — but the `subscribed`
   *  frame must precede them, so the actual attach (`replay`) is deferred to
   *  the caller; `detach` is registered first so a send failure mid-replay
   *  still releases it. */
  private attachActivity(state: ConnectionState): { detach: () => void; replay: () => void } {
    let unsubscribe: (() => void) | null = null
    let detached = false
    return {
      detach: () => {
        detached = true
        unsubscribe?.()
        unsubscribe = null
      },
      replay: () => {
        if (detached) return
        // The feed replays synchronously INSIDE subscribe(): a send failure
        // mid-replay closes the connection (detach runs before the handle is
        // assigned) — release the handle here in that case, never leak it.
        const handle = this.deps.activityFeed.subscribe(
          state.userId,
          (event: SessionActivityEvent) => {
            this.send(state, { kind: 'event', channel: 'activity', event })
          },
        )
        if (detached) handle()
        else unsubscribe = handle
      },
    }
  }

  /** The voice relay replays link + state synchronously inside subscribe()
   *  — the same deferred shape as the activity feed (ack first, replay after,
   *  detach registered before either). */
  private attachVoice(
    state: ConnectionState,
    channel: LiveChannelKey,
    surface: VoiceSurface,
  ): { detach: () => void; replay: () => void } {
    const source = this.deps.voice
    let unsubscribe: (() => void) | null = null
    let detached = false
    return {
      detach: () => {
        detached = true
        unsubscribe?.()
        unsubscribe = null
      },
      replay: () => {
        if (detached || source === undefined) return
        const handle = source.subscribe(surface, (event) => {
          this.send(state, { kind: 'event', channel: `voice:${surface}` as const, event })
        })
        if (detached) handle()
        else unsubscribe = handle
      },
    }
  }

  /** A STANDING session/trace subscription: the broadcaster detaches every
   *  listener at a turn's end, so re-attach for the next turn right there. */
  private attachTurnChannel(
    state: ConnectionState,
    channel: LiveChannelKey,
    broadcasterKey: string,
  ): () => void {
    let unsubscribe: (() => void) | null = null
    let detached = false
    const attach = (): void => {
      unsubscribe = this.deps.turnEvents.subscribe(broadcasterKey, {
        onEvent: (event) => this.send(state, { kind: 'event', channel, event }),
        onEnd: () => {
          unsubscribe = null
          this.send(state, { kind: 'channel-ended', channel })
          if (!detached && !state.closed) attach()
        },
      })
    }
    attach()
    return () => {
      detached = true
      unsubscribe?.()
      unsubscribe = null
    }
  }

  private send(state: ConnectionState, frame: LiveChannelOutboundFrame): void {
    if (state.closed) return
    try {
      state.transport.send(frame)
    } catch (error) {
      this.deps.logger?.warn(
        { connectionId: state.connectionId, error: error instanceof Error ? error.message : String(error) },
        'live-channel: send failed — closing the connection',
      )
      this.closeConnection(state, LIVE_CHANNEL_CLOSE_CODES.sendFailed, 'send failed')
    }
  }

  private closeConnection(state: ConnectionState, code?: number, reason?: string): void {
    if (state.closed) return
    state.closed = true
    for (const detach of state.subscriptions.values()) detach()
    state.subscriptions.clear()
    this.connections.delete(state.connectionId)
    if (code !== undefined) {
      try {
        state.transport.close(code, reason ?? '')
      } catch {
        // the socket is already gone — nothing left to close
      }
    }
    if (this.connections.size === 0) this.stopHeartbeat()
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null) return
    this.heartbeatTimer = setInterval(() => this.beat(), this.limits.heartbeatIntervalMs)
    // Never keep the process alive for a heartbeat.
    if (typeof this.heartbeatTimer === 'object' && 'unref' in this.heartbeatTimer) {
      this.heartbeatTimer.unref()
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  /** One beat: close connections silent for two intervals, ping the rest.
   *  Exposed for tests (a fake clock drives it directly). */
  beat(): void {
    const staleBefore = this.now() - 2 * this.limits.heartbeatIntervalMs
    for (const state of [...this.connections.values()]) {
      if (state.lastInboundAtMs < staleBefore) {
        this.closeConnection(state, LIVE_CHANNEL_CLOSE_CODES.heartbeatTimeout, 'heartbeat timeout')
        continue
      }
      this.send(state, { kind: 'ping' })
    }
  }
}

function broadcasterKeyFor(parsed: ParsedLiveChannelKey): string {
  switch (parsed.kind) {
    case 'session':
      return sessionChannelKey(parsed.sessionId)
    case 'trace':
      return traceChannelKey(parsed.partialSessionId)
    case 'activity':
    case 'voice':
      throw new Error(`the ${parsed.kind} channel is not a broadcaster channel`)
  }
}
