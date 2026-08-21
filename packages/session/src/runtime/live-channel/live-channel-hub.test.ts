import { describe, expect, it } from 'vitest'
import type { ChatTurnEvent } from '@vynel/chat'
import type { ParsedLiveChannelKey } from '@vynel/contracts/chat/live-channel'
import type { DisplayLiveFrame } from '@vynel/contracts/display/display-live'
import type { VoiceRelayEvent } from '@vynel/contracts/voice/daemon-events'
import { TurnEventBroadcaster, traceChannelKey } from '../../delegation/turn-event-broadcaster.js'
import { SessionActivityFeed } from '../session-activity-feed.js'
import { sessionChannelKey } from '../session-turn-channel.js'
import {
  LIVE_CHANNEL_CLOSE_CODES,
  LiveChannelHub,
  type LiveChannelOutboundFrame,
  type LiveChannelVoiceSource,
} from './live-channel-hub.js'

const USER = 'user-1'
const OTHER_USER = 'user-2'

function textChunk(messageId: string, textDelta: string): ChatTurnEvent {
  return { kind: 'text-chunk', messageId, textDelta }
}

const upserted: DisplayLiveFrame = {
  kind: 'upserted',
  widget: {
    id: 'w-1',
    scopeKey: 'global',
    title: 'This week',
    kind: 'metric',
    content: { kind: 'metric', value: '4', label: 'runs' },
    slot: 'stage',
    size: 'md',
    sortOrder: 1,
    createdBySessionId: null,
    expiresAt: null,
    createdAt: '2026-08-21T09:00:00.000Z',
    updatedAt: '2026-08-21T09:00:00.000Z',
  },
}
const cleared: DisplayLiveFrame = { kind: 'cleared', scopeKey: 'global' }

interface FakeSocket {
  frames: LiveChannelOutboundFrame[]
  closes: Array<{ code: number; reason: string }>
  transport: { send: (frame: LiveChannelOutboundFrame) => void; close: (code: number, reason: string) => void }
  /** Frames since the last take. */
  take: () => LiveChannelOutboundFrame[]
  failNextSend: boolean
  /** Throw on any frame matching this (a scripted mid-stream failure). */
  failWhen: ((frame: LiveChannelOutboundFrame) => boolean) | null
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    frames: [],
    closes: [],
    failNextSend: false,
    failWhen: null,
    transport: {
      send: (frame) => {
        if (socket.failNextSend || socket.failWhen?.(frame) === true) {
          socket.failNextSend = false
          throw new Error('socket gone')
        }
        socket.frames.push(frame)
      },
      close: (code, reason) => socket.closes.push({ code, reason }),
    },
    take: () => socket.frames.splice(0),
  }
  return socket
}

function subscribeMessage(...channels: string[]): string {
  return JSON.stringify({ op: 'subscribe', channels })
}
function unsubscribeMessage(...channels: string[]): string {
  return JSON.stringify({ op: 'unsubscribe', channels })
}

function buildHub(options: {
  authorize?: (userId: string, channel: ParsedLiveChannelKey) => boolean
  now?: () => number
  limits?: { maxSubscriptionsPerConnection?: number; maxConnectionsPerUser?: number; heartbeatIntervalMs?: number }
  voice?: LiveChannelVoiceSource
} = {}) {
  const turnEvents = new TurnEventBroadcaster<ChatTurnEvent>()
  const activityFeed = new SessionActivityFeed()
  const hub = new LiveChannelHub({
    turnEvents,
    activityFeed,
    authorizeChannel: options.authorize ?? (() => true),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.limits !== undefined ? { limits: options.limits } : {}),
    ...(options.voice !== undefined ? { voice: options.voice } : {}),
  })
  return { hub, turnEvents, activityFeed }
}

describe('LiveChannelHub', () => {
  it('greets with hello and answers subscribe/unsubscribe with acks', () => {
    const { hub } = buildHub()
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    expect(socket.take()).toEqual([
      { kind: 'hello', connectionId: connection.connectionId, protocolVersion: 1 },
    ])

    connection.handleMessage(subscribeMessage('session:s1'))
    expect(socket.take()).toEqual([{ kind: 'subscribed', channel: 'session:s1' }])
    expect(connection.subscribedChannels()).toEqual(['session:s1'])

    // Idempotent: a second subscribe re-acks and holds ONE listener.
    connection.handleMessage(subscribeMessage('session:s1'))
    expect(socket.take()).toEqual([{ kind: 'subscribed', channel: 'session:s1' }])
    expect(hub.subscriptionCount()).toBe(1)

    connection.handleMessage(unsubscribeMessage('session:s1'))
    expect(socket.take()).toEqual([{ kind: 'unsubscribed', channel: 'session:s1' }])
    expect(connection.subscribedChannels()).toEqual([])
    hub.dispose()
  })

  it('fans a session channel out to the subscribed sockets only, in order', () => {
    const { hub, turnEvents } = buildHub()
    const watcher = fakeSocket()
    const bystander = fakeSocket()
    const watching = hub.connect({ userId: USER, transport: watcher.transport })
    hub.connect({ userId: USER, transport: bystander.transport })
    watcher.take()
    bystander.take()

    watching.handleMessage(subscribeMessage('session:s1'))
    watcher.take()
    turnEvents.publish(sessionChannelKey('s1'), textChunk('m1', 'Hel'))
    turnEvents.publish(sessionChannelKey('s1'), textChunk('m1', 'lo'))
    turnEvents.publish(sessionChannelKey('s2'), textChunk('m9', 'other session'))

    expect(watcher.take()).toEqual([
      { kind: 'event', channel: 'session:s1', event: textChunk('m1', 'Hel') },
      { kind: 'event', channel: 'session:s1', event: textChunk('m1', 'lo') },
    ])
    expect(bystander.take()).toEqual([])
    hub.dispose()
  })

  it('keeps a session subscription STANDING across turns: channel-ended, then the next turn arrives', () => {
    const { hub, turnEvents } = buildHub()
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    connection.handleMessage(subscribeMessage('session:s1'))
    socket.take()

    turnEvents.publish(sessionChannelKey('s1'), textChunk('m1', 'first turn'))
    turnEvents.end(sessionChannelKey('s1'))
    turnEvents.publish(sessionChannelKey('s1'), textChunk('m2', 'second turn'))
    turnEvents.end(sessionChannelKey('s1'))

    expect(socket.take()).toEqual([
      { kind: 'event', channel: 'session:s1', event: textChunk('m1', 'first turn') },
      { kind: 'channel-ended', channel: 'session:s1' },
      { kind: 'event', channel: 'session:s1', event: textChunk('m2', 'second turn') },
      { kind: 'channel-ended', channel: 'session:s1' },
    ])
    expect(connection.subscribedChannels()).toEqual(['session:s1'])

    // Unsubscribed → the next turn is silent, and no listener lingers.
    connection.handleMessage(unsubscribeMessage('session:s1'))
    socket.take()
    turnEvents.publish(sessionChannelKey('s1'), textChunk('m3', 'unheard'))
    turnEvents.end(sessionChannelKey('s1'))
    expect(socket.take()).toEqual([])
    hub.dispose()
  })

  it('carries trace channels on the delegation trace key', () => {
    const { hub, turnEvents } = buildHub()
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    connection.handleMessage(subscribeMessage('trace:p1'))
    socket.take()
    turnEvents.publish(traceChannelKey('p1'), textChunk('m1', 'traced'))
    expect(socket.take()).toEqual([
      { kind: 'event', channel: 'trace:p1', event: textChunk('m1', 'traced') },
    ])
    hub.dispose()
  })

  it('answers the activity subscribe with the in-flight replay, then live frames', () => {
    const { hub, activityFeed } = buildHub()
    const running = activityFeed.begin({
      userId: USER,
      scopeKind: 'workspace',
      workspaceId: 'w1',
      sessionId: 's1',
      origin: 'web',
    })
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    socket.take()
    connection.handleMessage(subscribeMessage('activity'))
    const frames = socket.take()
    expect(frames[0]).toEqual({ kind: 'subscribed', channel: 'activity' })
    expect(frames[1]).toMatchObject({
      kind: 'event',
      channel: 'activity',
      event: { kind: 'turn-started', turnId: running.turnId, sessionId: 's1' },
    })

    running.end()
    expect(socket.take()).toEqual([
      {
        kind: 'event',
        channel: 'activity',
        event: { kind: 'turn-ended', turnId: running.turnId, sessionId: 's1', outcome: 'ended' },
      },
    ])

    // Another user's turns never reach this socket.
    const foreign = activityFeed.begin({
      userId: OTHER_USER,
      scopeKind: 'global',
      sessionId: 'g1',
      origin: 'web',
    })
    expect(socket.take()).toEqual([])
    foreign.end()
    hub.dispose()
  })

  it('refuses a session/trace the user may not watch with the not_found shape (no listener attached)', () => {
    const { hub, turnEvents } = buildHub({
      authorize: (userId, channel) => channel.kind === 'session' && channel.sessionId === 'mine',
    })
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    socket.take()
    connection.handleMessage(subscribeMessage('session:theirs', 'trace:p1', 'session:mine'))
    expect(socket.take()).toEqual([
      {
        kind: 'error',
        channel: 'session:theirs',
        code: 'not_found',
        message: 'No session to watch under "session:theirs".',
      },
      {
        kind: 'error',
        channel: 'trace:p1',
        code: 'not_found',
        message: 'No trace to watch under "trace:p1".',
      },
      { kind: 'subscribed', channel: 'session:mine' },
    ])
    turnEvents.publish(sessionChannelKey('theirs'), textChunk('m1', 'secret'))
    expect(socket.take()).toEqual([])
    expect(connection.subscribedChannels()).toEqual(['session:mine'])
    hub.dispose()
  })

  it('rejects malformed messages and unknown channels without dropping the socket', () => {
    const { hub } = buildHub()
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    socket.take()
    connection.handleMessage('garbage')
    connection.handleMessage(subscribeMessage('turn:x'))
    const frames = socket.take()
    expect(frames.map((frame) => frame.kind)).toEqual(['error', 'error'])
    expect(frames[0]).toMatchObject({ code: 'invalid_message', channel: null })
    expect(frames[1]).toMatchObject({ code: 'unknown_channel', channel: 'turn:x' })
    expect(hub.connectionCount()).toBe(1)
    hub.dispose()
  })

  it('caps subscriptions per connection and sockets per user', () => {
    const { hub } = buildHub({ limits: { maxSubscriptionsPerConnection: 2, maxConnectionsPerUser: 1 } })
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    socket.take()
    connection.handleMessage(subscribeMessage('session:a', 'session:b', 'session:c'))
    expect(socket.take().map((frame) => frame.kind)).toEqual(['subscribed', 'subscribed', 'error'])
    expect(connection.subscribedChannels()).toEqual(['session:a', 'session:b'])

    const second = fakeSocket()
    hub.connect({ userId: USER, transport: second.transport })
    expect(second.frames).toEqual([]) // no hello for a refused socket
    expect(second.closes).toEqual([
      { code: LIVE_CHANNEL_CLOSE_CODES.tooManyConnections, reason: 'too many connections' },
    ])
    expect(hub.connectionCount()).toBe(1)

    // A different user is unaffected.
    const other = fakeSocket()
    hub.connect({ userId: OTHER_USER, transport: other.transport })
    expect(other.frames.map((frame) => frame.kind)).toEqual(['hello'])
    hub.dispose()
  })

  it('releases every subscription when the socket closes — no listener survives', () => {
    const { hub, turnEvents, activityFeed } = buildHub()
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    connection.handleMessage(subscribeMessage('session:s1', 'trace:p1', 'activity'))
    expect(hub.subscriptionCount()).toBe(3)
    socket.take()

    connection.close()
    connection.close() // idempotent
    expect(hub.connectionCount()).toBe(0)
    expect(hub.subscriptionCount()).toBe(0)

    turnEvents.publish(sessionChannelKey('s1'), textChunk('m1', 'after close'))
    turnEvents.end(sessionChannelKey('s1'))
    activityFeed.begin({ userId: USER, scopeKind: 'global', origin: 'web' }).end()
    expect(socket.take()).toEqual([])
    hub.dispose()
  })

  it('dispose closes every socket with 1001 (going away) — shutdown never waits on a window', () => {
    const { hub } = buildHub()
    const a = fakeSocket()
    const b = fakeSocket()
    hub.connect({ userId: USER, transport: a.transport })
    hub.connect({ userId: OTHER_USER, transport: b.transport })
    hub.dispose()
    expect(a.closes).toEqual([{ code: 1001, reason: 'server shutting down' }])
    expect(b.closes).toEqual([{ code: 1001, reason: 'server shutting down' }])
    expect(hub.connectionCount()).toBe(0)
  })

  it('a send failing DURING the activity replay releases the feed listener (no leak)', () => {
    const { hub, activityFeed } = buildHub()
    const running = activityFeed.begin({ userId: USER, scopeKind: 'global', sessionId: 'g1', origin: 'web' })
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    socket.take()
    // The ack goes through; the replay's first frame (the running turn) blows up.
    socket.failWhen = (frame) => frame.kind === 'event'
    connection.handleMessage(subscribeMessage('activity'))
    expect(socket.closes).toEqual([{ code: LIVE_CHANNEL_CLOSE_CODES.sendFailed, reason: 'send failed' }])
    expect(hub.connectionCount()).toBe(0)
    // Nothing must reach the dead socket afterwards — the listener is gone.
    running.end()
    activityFeed.begin({ userId: USER, scopeKind: 'global', sessionId: 'g2', origin: 'web' }).end()
    expect(socket.frames.map((frame) => frame.kind)).toEqual(['subscribed'])
    hub.dispose()
  })

  /** A fake relay keyed the way the real one is — by (surface, wake-capable). */
  function fakeVoiceSource() {
    const listeners = new Map<string, Set<(event: VoiceRelayEvent) => void>>()
    const keyOf = (subscriber: { surface: string; wake: boolean }) =>
      `${subscriber.surface}/${subscriber.wake ? 'wake' : 'listen'}`
    const voice: LiveChannelVoiceSource = {
      subscribe: (subscriber, listener) => {
        const set = listeners.get(keyOf(subscriber)) ?? new Set()
        set.add(listener)
        listeners.set(keyOf(subscriber), set)
        listener({ kind: 'daemon-link', connected: true }) // synchronous replay
        return () => set.delete(listener)
      },
    }
    return { voice, listeners, keyOf }
  }

  it('voice channels ride the relay source: ack, then the replay, then live frames; released on unsubscribe', () => {
    const { voice, listeners, keyOf } = fakeVoiceSource()
    const { hub } = buildHub({ voice })
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    socket.take()
    connection.handleMessage(subscribeMessage('voice:app'))
    expect(socket.take()).toEqual([
      { kind: 'subscribed', channel: 'voice:app' },
      { kind: 'event', channel: 'voice:app', event: { kind: 'daemon-link', connected: true } },
    ])
    const appListeners = listeners.get(keyOf({ surface: 'app', wake: false })) ?? []
    for (const listener of appListeners) listener({ kind: 'speak', text: 'hi', sessionId: null })
    expect(socket.take()).toEqual([
      { kind: 'event', channel: 'voice:app', event: { kind: 'speak', text: 'hi', sessionId: null } },
    ])
    connection.handleMessage(unsubscribeMessage('voice:app'))
    expect(listeners.get(keyOf({ surface: 'app', wake: false }))?.size).toBe(0)
    hub.dispose()
  })

  it('a wake-capable voice key reaches the source as its own subscriber kind, and its frames come back on that key', () => {
    const { voice, listeners, keyOf } = fakeVoiceSource()
    const { hub } = buildHub({ voice })
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    socket.take()
    connection.handleMessage(subscribeMessage('voice:dock:wake'))
    expect(socket.take()).toEqual([
      { kind: 'subscribed', channel: 'voice:dock:wake' },
      { kind: 'event', channel: 'voice:dock:wake', event: { kind: 'daemon-link', connected: true } },
    ])
    // The capability is a distinct subscriber kind at the source — never folded into plain dock.
    expect(listeners.get(keyOf({ surface: 'dock', wake: true }))?.size).toBe(1)
    expect(listeners.get(keyOf({ surface: 'dock', wake: false }))).toBeUndefined()
    const wakeListeners = listeners.get(keyOf({ surface: 'dock', wake: true })) ?? []
    for (const listener of wakeListeners) listener({ kind: 'wake', command: 'open mail', turnWatchdogMs: 300_000 })
    expect(socket.take()).toEqual([
      {
        kind: 'event',
        channel: 'voice:dock:wake',
        event: { kind: 'wake', command: 'open mail', turnWatchdogMs: 300_000 },
      },
    ])
    hub.dispose()
  })

  it('fans a voice-control frame to every voice key of that user, and nobody else', () => {
    const { voice } = fakeVoiceSource()
    const { hub } = buildHub({ voice })
    const app = fakeSocket()
    const dock = fakeSocket()
    const stranger = fakeSocket()
    const appConnection = hub.connect({ userId: USER, transport: app.transport })
    const dockConnection = hub.connect({ userId: USER, transport: dock.transport })
    const strangerConnection = hub.connect({ userId: OTHER_USER, transport: stranger.transport })
    // The app window holds BOTH a voice key and an unrelated one — only the
    // voice key carries the frame.
    appConnection.handleMessage(subscribeMessage('voice:app', 'session:s1'))
    dockConnection.handleMessage(subscribeMessage('voice:dock'))
    strangerConnection.handleMessage(subscribeMessage('voice:dock'))
    app.take()
    dock.take()
    stranger.take()

    hub.publishVoiceControl(USER, { kind: 'display-active', active: true })
    expect(app.take()).toEqual([
      { kind: 'event', channel: 'voice:app', event: { kind: 'display-active', active: true } },
    ])
    expect(dock.take()).toEqual([
      { kind: 'event', channel: 'voice:dock', event: { kind: 'display-active', active: true } },
    ])
    expect(stranger.take()).toEqual([])
    hub.dispose()
  })

  it('replays the last voice-control frame to a window that subscribes after it', () => {
    const { voice } = fakeVoiceSource()
    const { hub } = buildHub({ voice })
    const app = fakeSocket()
    const appConnection = hub.connect({ userId: USER, transport: app.transport })
    appConnection.handleMessage(subscribeMessage('voice:app'))
    app.take()
    hub.publishVoiceControl(USER, { kind: 'display-active', active: true })
    app.take()

    // The dock opens (or reconnects) into a room that is already on screen —
    // the two windows connect independently, so without the replay it would
    // never hear a fact that was announced before it arrived.
    const dock = fakeSocket()
    const dockConnection = hub.connect({ userId: USER, transport: dock.transport })
    dock.take()
    dockConnection.handleMessage(subscribeMessage('voice:dock:wake'))
    expect(dock.take()).toEqual([
      { kind: 'subscribed', channel: 'voice:dock:wake' },
      { kind: 'event', channel: 'voice:dock:wake', event: { kind: 'daemon-link', connected: true } },
      // After the daemon's own replay: the two facts in the order they were established.
      {
        kind: 'event',
        channel: 'voice:dock:wake',
        event: { kind: 'display-active', active: true },
      },
    ])
    hub.dispose()
  })

  it('retracts display-active when the last app window closes, but not when its link moves inside it', () => {
    const { voice } = fakeVoiceSource()
    const { hub } = buildHub({ voice })
    const app = fakeSocket()
    const dock = fakeSocket()
    const appConnection = hub.connect({ userId: USER, transport: app.transport })
    const dockConnection = hub.connect({ userId: USER, transport: dock.transport })
    appConnection.handleMessage(subscribeMessage('voice:app'))
    dockConnection.handleMessage(subscribeMessage('voice:dock'))
    hub.publishVoiceControl(USER, { kind: 'display-active', active: true })
    app.take()
    dock.take()

    // Inside the app window the voice link moves between the overlay and the
    // room as the Display opens — a subscription churn, not a window closing.
    appConnection.handleMessage(unsubscribeMessage('voice:app'))
    appConnection.handleMessage(subscribeMessage('voice:app'))
    expect(dock.take()).toEqual([])

    // The window itself goes away: nobody is left who could ever say `false`,
    // so the dock must not stay hidden behind a fact frozen at `true`.
    appConnection.close()
    expect(dock.take()).toEqual([
      { kind: 'event', channel: 'voice:dock', event: { kind: 'display-active', active: false } },
    ])
    // Retracted, not merely broadcast — a window opening later starts clean.
    const late = fakeSocket()
    const lateConnection = hub.connect({ userId: USER, transport: late.transport })
    late.take()
    lateConnection.handleMessage(subscribeMessage('voice:dock'))
    expect(late.take()).toEqual([
      { kind: 'subscribed', channel: 'voice:dock' },
      { kind: 'event', channel: 'voice:dock', event: { kind: 'daemon-link', connected: true } },
    ])
    hub.dispose()
  })

  // The two control facts are independent — "the room is on screen" and "the
  // room is holding a conversation" arrive separately, and a dock that heard
  // only the newer one would mirror a session it cannot place.
  it('remembers each control kind and replays them all to a late window', () => {
    const { voice } = fakeVoiceSource()
    const { hub } = buildHub({ voice })
    const app = fakeSocket()
    const appConnection = hub.connect({ userId: USER, transport: app.transport })
    appConnection.handleMessage(subscribeMessage('voice:app'))
    app.take()
    hub.publishVoiceControl(USER, { kind: 'display-active', active: false })
    hub.publishVoiceControl(USER, {
      kind: 'display-session',
      live: true,
      phase: 'listening',
      caption: 'Listening…',
    })
    // A newer caption REPLACES the older one rather than piling up.
    hub.publishVoiceControl(USER, {
      kind: 'display-session',
      live: true,
      phase: 'speaking',
      caption: 'Two builds are green',
    })
    app.take()

    const dock = fakeSocket()
    const dockConnection = hub.connect({ userId: USER, transport: dock.transport })
    dock.take()
    dockConnection.handleMessage(subscribeMessage('voice:dock'))
    const replayed = dock.take()
    expect(replayed).toContainEqual({
      kind: 'event',
      channel: 'voice:dock',
      event: { kind: 'display-active', active: false },
    })
    expect(replayed).toContainEqual({
      kind: 'event',
      channel: 'voice:dock',
      event: {
        kind: 'display-session',
        live: true,
        phase: 'speaking',
        caption: 'Two builds are green',
      },
    })
    // One frame per kind, plus the subscribe ack and the daemon's own replay.
    expect(replayed).toHaveLength(4)
    hub.dispose()
  })

  it('retracts a live mirrored session when the app window closes, and nothing that was already off', () => {
    const { voice } = fakeVoiceSource()
    const { hub } = buildHub({ voice })
    const app = fakeSocket()
    const dock = fakeSocket()
    const appConnection = hub.connect({ userId: USER, transport: app.transport })
    const dockConnection = hub.connect({ userId: USER, transport: dock.transport })
    appConnection.handleMessage(subscribeMessage('voice:app'))
    dockConnection.handleMessage(subscribeMessage('voice:dock'))
    // The room was never on screen (the user talked to it, then switched away)
    // — so there is no `display-active: true` to take back, only the session.
    hub.publishVoiceControl(USER, { kind: 'display-active', active: false })
    hub.publishVoiceControl(USER, {
      kind: 'display-session',
      live: true,
      phase: 'thinking',
      caption: 'Thinking…',
    })
    app.take()
    dock.take()

    appConnection.close()
    expect(dock.take()).toEqual([
      {
        kind: 'event',
        channel: 'voice:dock',
        event: { kind: 'display-session', live: false, phase: 'idle', caption: '' },
      },
    ])
    hub.dispose()
  })

  it('without a voice source a voice subscribe answers not_found', () => {
    const { hub } = buildHub()
    const socket = fakeSocket()
    const connection = hub.connect({ userId: USER, transport: socket.transport })
    socket.take()
    connection.handleMessage(subscribeMessage('voice:dock'))
    expect(socket.take()).toMatchObject([{ kind: 'error', code: 'not_found', channel: 'voice:dock' }])
    hub.dispose()
  })

  it('a failing send closes that connection alone', () => {
    const { hub, turnEvents } = buildHub()
    const flaky = fakeSocket()
    const healthy = fakeSocket()
    const flakyConnection = hub.connect({ userId: USER, transport: flaky.transport })
    const healthyConnection = hub.connect({ userId: USER, transport: healthy.transport })
    flakyConnection.handleMessage(subscribeMessage('session:s1'))
    healthyConnection.handleMessage(subscribeMessage('session:s1'))
    flaky.take()
    healthy.take()

    flaky.failNextSend = true
    turnEvents.publish(sessionChannelKey('s1'), textChunk('m1', 'boom'))
    expect(flaky.closes).toEqual([{ code: LIVE_CHANNEL_CLOSE_CODES.sendFailed, reason: 'send failed' }])
    expect(healthy.take()).toEqual([
      { kind: 'event', channel: 'session:s1', event: textChunk('m1', 'boom') },
    ])
    expect(hub.connectionCount()).toBe(1)
    hub.dispose()
  })

  it('heartbeat: pings live sockets, closes one silent for two beats, any inbound message counts', () => {
    let nowMs = 1_000_000
    const { hub } = buildHub({ now: () => nowMs, limits: { heartbeatIntervalMs: 1_000 } })
    const quiet = fakeSocket()
    const chatty = fakeSocket()
    hub.connect({ userId: USER, transport: quiet.transport })
    const chattyConnection = hub.connect({ userId: USER, transport: chatty.transport })
    quiet.take()
    chatty.take()

    nowMs += 1_500
    hub.beat()
    expect(quiet.take()).toEqual([{ kind: 'ping' }])
    expect(chatty.take()).toEqual([{ kind: 'ping' }])
    chattyConnection.handleMessage(JSON.stringify({ op: 'pong' }))

    nowMs += 1_000 // quiet is now 2.5 s silent (> 2 beats); chatty answered 1 s ago
    hub.beat()
    expect(quiet.closes).toEqual([
      { code: LIVE_CHANNEL_CLOSE_CODES.heartbeatTimeout, reason: 'heartbeat timeout' },
    ])
    expect(chatty.closes).toEqual([])
    expect(chatty.take()).toEqual([{ kind: 'ping' }])
    expect(hub.connectionCount()).toBe(1)
    hub.dispose()
  })

  describe('the display channel', () => {
    it('acks without a replay, then fans a frame to that ONE user\'s subscribed sockets', () => {
      const { hub } = buildHub()
      const board = fakeSocket()
      const secondWindow = fakeSocket()
      const bystander = fakeSocket()
      const stranger = fakeSocket()
      const boardConnection = hub.connect({ userId: USER, transport: board.transport })
      const secondConnection = hub.connect({ userId: USER, transport: secondWindow.transport })
      hub.connect({ userId: USER, transport: bystander.transport })
      const strangerConnection = hub.connect({ userId: OTHER_USER, transport: stranger.transport })
      board.take()
      secondWindow.take()
      bystander.take()
      stranger.take()

      boardConnection.handleMessage(subscribeMessage('display'))
      secondConnection.handleMessage(subscribeMessage('display'))
      strangerConnection.handleMessage(subscribeMessage('display'))
      // The board is read over HTTP — the ack carries no replay of its own.
      expect(board.take()).toEqual([{ kind: 'subscribed', channel: 'display' }])
      expect(secondWindow.take()).toEqual([{ kind: 'subscribed', channel: 'display' }])
      expect(stranger.take()).toEqual([{ kind: 'subscribed', channel: 'display' }])

      hub.publishDisplayFrame(USER, upserted)
      const expected = { kind: 'event', channel: 'display', event: upserted }
      expect(board.take()).toEqual([expected])
      // Both of the user's windows see it — the channel is per user, not per window.
      expect(secondWindow.take()).toEqual([expected])
      // …and neither the same user's unsubscribed socket nor another user's.
      expect(bystander.take()).toEqual([])
      expect(stranger.take()).toEqual([])
      hub.dispose()
    })

    it('stops delivering after unsubscribe and after the socket closes', () => {
      const { hub } = buildHub()
      const socket = fakeSocket()
      const connection = hub.connect({ userId: USER, transport: socket.transport })
      socket.take()

      connection.handleMessage(subscribeMessage('display'))
      socket.take()
      connection.handleMessage(unsubscribeMessage('display'))
      expect(socket.take()).toEqual([{ kind: 'unsubscribed', channel: 'display' }])
      hub.publishDisplayFrame(USER, upserted)
      expect(socket.take()).toEqual([])

      connection.handleMessage(subscribeMessage('display'))
      socket.take()
      connection.close()
      hub.publishDisplayFrame(USER, upserted)
      expect(socket.take()).toEqual([])
      hub.dispose()
    })

    it('rides the ownership answer, and a scoped key is refused outright', () => {
      const { hub } = buildHub({ authorize: (_userId, channel) => channel.kind !== 'display' })
      const socket = fakeSocket()
      const connection = hub.connect({ userId: USER, transport: socket.transport })
      socket.take()

      connection.handleMessage(subscribeMessage('display'))
      expect(socket.take()).toEqual([
        {
          kind: 'error',
          channel: 'display',
          code: 'not_found',
          message: 'No display to watch under "display".',
        },
      ])
      // The channel is per USER — there is no per-scope key to subscribe to.
      connection.handleMessage(subscribeMessage('display:global'))
      expect(socket.take()[0]).toMatchObject({ code: 'unknown_channel', channel: 'display:global' })
      hub.dispose()
    })

    it('never throws on a dead socket — it closes it and keeps serving the rest', () => {
      const { hub } = buildHub()
      const flaky = fakeSocket()
      const healthy = fakeSocket()
      const flakyConnection = hub.connect({ userId: USER, transport: flaky.transport })
      const healthyConnection = hub.connect({ userId: USER, transport: healthy.transport })
      flakyConnection.handleMessage(subscribeMessage('display'))
      healthyConnection.handleMessage(subscribeMessage('display'))
      flaky.take()
      healthy.take()

      flaky.failNextSend = true
      expect(() => hub.publishDisplayFrame(USER, cleared)).not.toThrow()
      expect(flaky.closes).toEqual([
        { code: LIVE_CHANNEL_CLOSE_CODES.sendFailed, reason: 'send failed' },
      ])
      expect(healthy.take()).toEqual([{ kind: 'event', channel: 'display', event: cleared }])
      expect(hub.connectionCount()).toBe(1)
      hub.dispose()
    })
  })
})
