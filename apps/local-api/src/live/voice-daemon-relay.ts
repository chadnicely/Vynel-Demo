// The VOICE DAEMON RELAY — the api's one link per subscriber kind to the
// daemon's overlay channel (`GET /events?surface=app|dock&wake=1|0`, SSE),
// fanned to every window subscribed to that `voice:<surface>[:wake]` key on
// the live channel. Before this each window held its own EventSource to the
// daemon — an HTTP-pool connection per window (main app + dock = two of the
// browser's six). Now the windows ride their live socket and the api holds ONE
// upstream per (surface, wake-capable), opened when the first window
// subscribes and closed when the last leaves.
//
// The daemon's contract survives intact (apps/voice overlay-channel.ts):
//   - it sees one client per subscriber kind — `hasClient` / `hasWakeTarget` /
//     `onClientsGone` behave exactly as with one window per kind, and a wake
//     can only reach an upstream whose windows declared they can run it;
//   - `state` is broadcast to every listener of the upstream;
//   - `wake` is SINGLE delivery — the daemon sends it to its newest capable
//     client, the relay hands it to the upstream's NEWEST window (the daemon's
//     own rule, one hop later) and remembers that window as the wake OWNER;
//     the owner leaving while siblings stay re-subscribes the upstream, so the
//     daemon (whose owner IS the upstream) sees its session runner disconnect
//     and takes the mic back instead of staying handed off;
//   - `speak` is SINGLE delivery too — the daemon routes it to the upstream
//     that owns the handoff (else its newest), the relay hands it to the
//     window that took the wake while it is still subscribed, else the newest
//     — so a line produced during a dock conversation plays in THAT window;
//   - the daemon replays its state on connect and holds an undelivered wake
//     for the next connect — the relay reconnects (backoff) while anyone
//     listens, and replays the last known state + link to a NEW listener so a
//     window opening late sees the truth at once.
// `daemon-link` is the relay's own frame: whether the upstream is live (the
// browser's "daemon connected" light; false while it retries).

import type { Logger } from 'pino'
import { parseSseFrames } from '@vynel/sdk'
import { liveChannelKeys, type VoiceChannelKey } from '@vynel/contracts/chat/live-channel'
import {
  parseVoiceDaemonEvent,
  type VoiceRelayEvent,
  type VoiceSubscriber,
} from '@vynel/contracts/voice/daemon-events'
import type { LiveChannelVoiceSource } from '@vynel/session/runtime'

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 15_000

export interface VoiceDaemonRelayOptions {
  /** The daemon's loopback base URL (env VYNEL_VOICE_DAEMON_URL). */
  voiceDaemonUrl: string
  logger: Logger
  /** Test seam. */
  fetchDaemon?: typeof fetch
  /** Test seam for the reconnect clock. */
  setTimer?: (callback: () => void, delayMs: number) => { cancel: () => void }
}

type Listener = (event: VoiceRelayEvent) => void

interface UpstreamLink {
  readonly subscriber: VoiceSubscriber
  /** Insertion order = subscribe order; the newest is the last. */
  listeners: Set<Listener>
  /** The window the last wake went to — a relayed speak plays there first. */
  wakeOwner: Listener | null
  upstream: AbortController | null
  connected: boolean
  lastState: string | null
  reconnectAttempt: number
  reconnectTimer: { cancel: () => void } | null
  /** One warning per outage — a missing daemon must not fill the log every retry. */
  warnedDown: boolean
}

export interface VoiceDaemonRelay extends LiveChannelVoiceSource {
  /** Diagnostics: is the upstream for this subscriber kind live right now? */
  isConnected: (subscriber: VoiceSubscriber) => boolean
  listenerCount: (subscriber: VoiceSubscriber) => number
  dispose: () => void
}

export function createVoiceDaemonRelay(options: VoiceDaemonRelayOptions): VoiceDaemonRelay {
  const fetchDaemon = options.fetchDaemon ?? fetch
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delayMs: number) => {
      const handle = setTimeout(callback, delayMs)
      return { cancel: () => clearTimeout(handle) }
    })
  const links = new Map<VoiceChannelKey, UpstreamLink>()
  let disposed = false

  function linkFor(subscriber: VoiceSubscriber): UpstreamLink {
    const key = liveChannelKeys.voice(subscriber)
    let link = links.get(key)
    if (link === undefined) {
      link = {
        subscriber,
        listeners: new Set(),
        wakeOwner: null,
        upstream: null,
        connected: false,
        lastState: null,
        reconnectAttempt: 0,
        reconnectTimer: null,
        warnedDown: false,
      }
      links.set(key, link)
    }
    return link
  }

  function newestListener(link: UpstreamLink): Listener | null {
    let newest: Listener | null = null
    for (const listener of link.listeners) newest = listener
    return newest
  }

  /** The ONE window a single-delivery event goes to. A wake takes the newest
   *  window and makes it the owner; a speak prefers that owner while it still
   *  listens (the handoff's window), else the newest. */
  function singleDeliveryTarget(link: UpstreamLink, kind: 'wake' | 'speak'): Listener | null {
    if (kind === 'speak' && link.wakeOwner !== null && link.listeners.has(link.wakeOwner)) {
      return link.wakeOwner
    }
    const newest = newestListener(link)
    if (kind === 'wake') link.wakeOwner = newest
    return newest
  }

  function deliver(link: UpstreamLink, event: VoiceRelayEvent): void {
    const targets =
      event.kind === 'wake' || event.kind === 'speak'
        ? [singleDeliveryTarget(link, event.kind)].filter(
            (listener): listener is Listener => listener !== null,
          )
        : [...link.listeners]
    for (const listener of targets) {
      try {
        listener(event)
      } catch {
        // One window's throw must never break the relay for the others.
      }
    }
  }

  function setConnected(link: UpstreamLink, connected: boolean): void {
    if (link.connected === connected) return
    link.connected = connected
    // A dead link's last state is stale — a window opening while the daemon
    // is down must not inherit "speaking" and keep its mic gated.
    if (!connected) link.lastState = null
    else link.warnedDown = false
    options.logger.info({ ...link.subscriber, connected }, 'voice relay: daemon link changed')
    deliver(link, { kind: 'daemon-link', connected })
  }

  async function runUpstream(link: UpstreamLink): Promise<void> {
    const controller = new AbortController()
    link.upstream = controller
    try {
      const url = new URL('/events', options.voiceDaemonUrl)
      url.searchParams.set('surface', link.subscriber.surface)
      url.searchParams.set('wake', link.subscriber.wake ? '1' : '0')
      const response = await fetchDaemon(url, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new Error(`voice daemon answered ${response.status}`)
      }
      link.reconnectAttempt = 0
      setConnected(link, true)
      for await (const frame of parseSseFrames(iterateBody(response.body))) {
        if (link.upstream !== controller) return
        if (frame.event === 'ping' || frame.data === '') continue
        let payload: unknown
        try {
          payload = JSON.parse(frame.data)
        } catch {
          continue // not a daemon event — ignore rather than drop the link
        }
        const event = parseVoiceDaemonEvent(payload)
        if (event === null) continue
        if (event.kind === 'state') link.lastState = event.state
        deliver(link, event)
      }
      // The daemon closed the stream (restart) — reconnect below.
    } catch (error) {
      if (link.upstream !== controller) return // superseded / stopped
      if (!isAbortError(error)) {
        const detail = {
          ...link.subscriber,
          error: error instanceof Error ? error.message : String(error),
        }
        // Once per outage at warn (a dev box without the daemon is common);
        // the retries stay visible at debug.
        if (link.warnedDown) options.logger.debug(detail, 'voice relay: daemon still unreachable')
        else options.logger.warn(detail, 'voice relay: daemon link dropped — retrying')
        link.warnedDown = true
      }
    } finally {
      if (link.upstream === controller) {
        link.upstream = null
        setConnected(link, false)
        scheduleReconnect(link)
      }
    }
  }

  function scheduleReconnect(link: UpstreamLink): void {
    if (disposed || link.listeners.size === 0 || link.reconnectTimer !== null) return
    const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** link.reconnectAttempt, RECONNECT_MAX_MS)
    link.reconnectAttempt += 1
    link.reconnectTimer = setTimer(() => {
      link.reconnectTimer = null
      if (disposed || link.listeners.size === 0 || link.upstream !== null) return
      void runUpstream(link)
    }, delayMs)
  }

  function stopUpstream(link: UpstreamLink): void {
    link.reconnectTimer?.cancel()
    link.reconnectTimer = null
    link.reconnectAttempt = 0
    const upstream = link.upstream
    link.upstream = null
    upstream?.abort()
    link.connected = false
    link.lastState = null
  }

  /** Re-subscribe to the daemon so it SEES a disconnect. Its handoff owner is
   *  this upstream, not a window: when the window that took the wake leaves
   *  while siblings keep the link open, the daemon would never learn its
   *  session runner is gone and stay handed off — deaf, the mic never taken
   *  back. The reconnect is the disconnect it understands (onClientsGone →
   *  endHandoff; a wake it still holds replays to a sibling). The link light
   *  holds across the gap — a failed reconnect still reports it off — and a
   *  link already down needs nothing: the daemon saw that one, the pending
   *  retry re-subscribes. */
  function cycleUpstream(link: UpstreamLink): void {
    const upstream = link.upstream
    if (upstream === null) return
    link.upstream = null
    upstream.abort()
    void runUpstream(link)
  }

  return {
    subscribe(subscriber, listener) {
      if (disposed) return () => {}
      const link = linkFor(subscriber)
      link.listeners.add(listener)
      // A late window learns the truth at once (the daemon's own
      // replay-on-connect, one hop later).
      try {
        listener({ kind: 'daemon-link', connected: link.connected })
        if (link.lastState !== null) listener({ kind: 'state', state: link.lastState })
      } catch {
        // a throwing listener is still registered — the caller's problem
      }
      if (link.upstream === null && link.reconnectTimer === null) void runUpstream(link)
      let released = false
      return () => {
        if (released) return
        released = true
        link.listeners.delete(listener)
        // The owning window left — the next speak takes the newest, not a ghost.
        const wasOwner = link.wakeOwner === listener
        if (wasOwner) link.wakeOwner = null
        if (link.listeners.size === 0) stopUpstream(link)
        else if (wasOwner) cycleUpstream(link)
      }
    },
    isConnected: (subscriber) => links.get(liveChannelKeys.voice(subscriber))?.connected ?? false,
    listenerCount: (subscriber) =>
      links.get(liveChannelKeys.voice(subscriber))?.listeners.size ?? 0,
    dispose() {
      disposed = true
      for (const link of links.values()) {
        stopUpstream(link)
        link.listeners.clear()
        link.wakeOwner = null
      }
    },
  }
}

async function* iterateBody(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

function isAbortError(candidate: unknown): boolean {
  return candidate instanceof Error && candidate.name === 'AbortError'
}
