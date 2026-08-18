// The VOICE DAEMON RELAY — the api's one link per surface to the daemon's
// overlay channel (`GET /events?surface=app|jarvis`, SSE), fanned to every
// window subscribed to `voice:<surface>` on the live channel. Before this each
// window held its own EventSource to the daemon — an HTTP-pool connection per
// window (main app + Jarvis = two of the browser's six). Now the windows ride
// their live socket and the api holds ONE upstream per surface, opened when
// the first window subscribes and closed when the last leaves.
//
// The daemon's contract survives intact (apps/voice overlay-channel.ts):
//   - it sees one client per surface — `hasClient` / `hasWakeTarget` /
//     `onClientsGone` behave exactly as with one window per surface;
//   - `state` is broadcast to every listener of the surface;
//   - `wake` and `speak` are SINGLE delivery — the daemon sends them to its
//     newest client, the relay hands them to the surface's NEWEST listener
//     (the daemon's own rule, one hop later);
//   - the daemon replays its state on connect and holds an undelivered wake
//     for the next connect — the relay reconnects (backoff) while anyone
//     listens, and replays the last known state + link to a NEW listener so a
//     window opening late sees the truth at once.
// `daemon-link` is the relay's own frame: whether the upstream is live (the
// browser's "daemon connected" light; false while it retries).

import type { Logger } from 'pino'
import { parseSseFrames } from '@vynel/sdk'
import {
  parseVoiceDaemonEvent,
  type VoiceRelayEvent,
  type VoiceSurface,
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

interface SurfaceLink {
  /** Insertion order = subscribe order; the newest is the last. */
  listeners: Set<Listener>
  upstream: AbortController | null
  connected: boolean
  lastState: string | null
  reconnectAttempt: number
  reconnectTimer: { cancel: () => void } | null
}

export interface VoiceDaemonRelay extends LiveChannelVoiceSource {
  /** Diagnostics: is the upstream for this surface live right now? */
  isConnected: (surface: VoiceSurface) => boolean
  listenerCount: (surface: VoiceSurface) => number
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
  const links = new Map<VoiceSurface, SurfaceLink>()
  let disposed = false

  function linkFor(surface: VoiceSurface): SurfaceLink {
    let link = links.get(surface)
    if (link === undefined) {
      link = {
        listeners: new Set(),
        upstream: null,
        connected: false,
        lastState: null,
        reconnectAttempt: 0,
        reconnectTimer: null,
      }
      links.set(surface, link)
    }
    return link
  }

  function newestListener(link: SurfaceLink): Listener | null {
    let newest: Listener | null = null
    for (const listener of link.listeners) newest = listener
    return newest
  }

  function deliver(link: SurfaceLink, event: VoiceRelayEvent): void {
    // The daemon's single-delivery kinds go to the newest window (its own
    // rule); everything else is state and reaches every window.
    const targets =
      event.kind === 'wake' || event.kind === 'speak'
        ? [newestListener(link)].filter((listener): listener is Listener => listener !== null)
        : [...link.listeners]
    for (const listener of targets) {
      try {
        listener(event)
      } catch {
        // One window's throw must never break the relay for the others.
      }
    }
  }

  function setConnected(surface: VoiceSurface, link: SurfaceLink, connected: boolean): void {
    if (link.connected === connected) return
    link.connected = connected
    options.logger.info({ surface, connected }, 'voice relay: daemon link changed')
    deliver(link, { kind: 'daemon-link', connected })
  }

  async function runUpstream(surface: VoiceSurface, link: SurfaceLink): Promise<void> {
    const controller = new AbortController()
    link.upstream = controller
    try {
      const url = new URL('/events', options.voiceDaemonUrl)
      url.searchParams.set('surface', surface)
      const response = await fetchDaemon(url, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new Error(`voice daemon answered ${response.status}`)
      }
      link.reconnectAttempt = 0
      setConnected(surface, link, true)
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
        options.logger.warn(
          { surface, error: error instanceof Error ? error.message : String(error) },
          'voice relay: daemon link dropped',
        )
      }
    } finally {
      if (link.upstream === controller) {
        link.upstream = null
        setConnected(surface, link, false)
        scheduleReconnect(surface, link)
      }
    }
  }

  function scheduleReconnect(surface: VoiceSurface, link: SurfaceLink): void {
    if (disposed || link.listeners.size === 0 || link.reconnectTimer !== null) return
    const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** link.reconnectAttempt, RECONNECT_MAX_MS)
    link.reconnectAttempt += 1
    link.reconnectTimer = setTimer(() => {
      link.reconnectTimer = null
      if (disposed || link.listeners.size === 0 || link.upstream !== null) return
      void runUpstream(surface, link)
    }, delayMs)
  }

  function stopUpstream(link: SurfaceLink): void {
    link.reconnectTimer?.cancel()
    link.reconnectTimer = null
    link.reconnectAttempt = 0
    const upstream = link.upstream
    link.upstream = null
    upstream?.abort()
    link.connected = false
  }

  return {
    subscribe(surface, listener) {
      if (disposed) return () => {}
      const link = linkFor(surface)
      link.listeners.add(listener)
      // A late window learns the truth at once (the daemon's own
      // replay-on-connect, one hop later).
      try {
        listener({ kind: 'daemon-link', connected: link.connected })
        if (link.lastState !== null) listener({ kind: 'state', state: link.lastState })
      } catch {
        // a throwing listener is still registered — the caller's problem
      }
      if (link.upstream === null && link.reconnectTimer === null) void runUpstream(surface, link)
      let released = false
      return () => {
        if (released) return
        released = true
        link.listeners.delete(listener)
        if (link.listeners.size === 0) stopUpstream(link)
      }
    },
    isConnected: (surface) => links.get(surface)?.connected ?? false,
    listenerCount: (surface) => links.get(surface)?.listeners.size ?? 0,
    dispose() {
      disposed = true
      for (const link of links.values()) {
        stopUpstream(link)
        link.listeners.clear()
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
