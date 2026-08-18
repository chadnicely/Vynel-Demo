// The relay's contract: one upstream per surface, opened by the first
// listener and closed by the last; state to everyone, wake/speak to the newest
// only (the daemon's single-delivery rule, one hop later); the daemon's
// replay-on-connect mirrored to a late listener; reconnect with backoff while
// anyone listens; the link light. Driven with scripted SSE bodies + a fake
// timer — no daemon.

import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { VoiceRelayEvent } from '@vynel/contracts/voice/daemon-events'
import { createVoiceDaemonRelay } from './voice-daemon-relay.js'

const silentLogger = pino({ level: 'silent' })

function makeScriptedStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const encoder = new TextEncoder()
  return {
    stream,
    aborted: false,
    emit: (payload: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)),
    ping: () => controller.enqueue(encoder.encode('event: ping\ndata: \n\n')),
    close: () => controller.close(),
    abort() {
      this.aborted = true
      controller.error(new DOMException('aborted', 'AbortError'))
    },
  }
}

function makeHarness() {
  const streams: Array<ReturnType<typeof makeScriptedStream> & { url: string }> = []
  const timers: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
  const fetchDaemon = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const scripted = Object.assign(makeScriptedStream(), { url: String(input) })
    streams.push(scripted)
    init?.signal?.addEventListener('abort', () => scripted.abort())
    return new Response(scripted.stream, { status: 200 })
  })
  const relay = createVoiceDaemonRelay({
    voiceDaemonUrl: 'http://127.0.0.1:18893',
    logger: silentLogger,
    fetchDaemon: fetchDaemon as unknown as typeof fetch,
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs, cancelled: false }
      timers.push(timer)
      return { cancel: () => (timer.cancelled = true) }
    },
  })
  const listen = (): { events: VoiceRelayEvent[]; listener: (event: VoiceRelayEvent) => void } => {
    const events: VoiceRelayEvent[] = []
    return { events, listener: (event) => events.push(event) }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  return { relay, streams, timers, fetchDaemon, listen, settle }
}

describe('voice daemon relay', () => {
  it('opens ONE upstream per surface on the first listener, closes it after the last', async () => {
    const h = makeHarness()
    const a = h.listen()
    const b = h.listen()
    const releaseA = h.relay.subscribe('app', a.listener)
    const releaseB = h.relay.subscribe('app', b.listener)
    await h.settle()
    expect(h.fetchDaemon).toHaveBeenCalledTimes(1)
    expect(h.streams[0]!.url).toBe('http://127.0.0.1:18893/events?surface=app')
    expect(h.relay.listenerCount('app')).toBe(2)
    expect(h.relay.isConnected('app')).toBe(true)

    // A second surface is its own upstream.
    const j = h.listen()
    const releaseJ = h.relay.subscribe('jarvis', j.listener)
    await h.settle()
    expect(h.fetchDaemon).toHaveBeenCalledTimes(2)
    expect(h.streams[1]!.url).toBe('http://127.0.0.1:18893/events?surface=jarvis')

    releaseA()
    expect(h.streams[0]!.aborted).toBe(false) // b still listens
    releaseB()
    expect(h.streams[0]!.aborted).toBe(true) // last leaver closes the link
    expect(h.relay.isConnected('app')).toBe(false)
    releaseJ()
    expect(h.streams[1]!.aborted).toBe(true)
    h.relay.dispose()
  })

  it('state reaches every listener; wake and speak reach the NEWEST only; the link light rides along', async () => {
    const h = makeHarness()
    const first = h.listen()
    const second = h.listen()
    h.relay.subscribe('app', first.listener)
    await h.settle()
    h.relay.subscribe('app', second.listener)
    await h.settle()
    // Both saw the link come up (first: false→true; second: replayed true).
    expect(first.events).toEqual([
      { kind: 'daemon-link', connected: false },
      { kind: 'daemon-link', connected: true },
    ])
    expect(second.events).toEqual([{ kind: 'daemon-link', connected: true }])
    first.events.length = 0
    second.events.length = 0

    h.streams[0]!.emit({ kind: 'state', state: 'listening' })
    h.streams[0]!.emit({ kind: 'speak', text: 'good morning' })
    h.streams[0]!.emit({ kind: 'wake', command: 'open mail' })
    h.streams[0]!.ping()
    h.streams[0]!.emit({ kind: 'nonsense' })
    await h.settle()
    expect(first.events).toEqual([{ kind: 'state', state: 'listening' }])
    expect(second.events).toEqual([
      { kind: 'state', state: 'listening' },
      { kind: 'speak', text: 'good morning' },
      { kind: 'wake', command: 'open mail' },
    ])
    h.relay.dispose()
  })

  it('a listener joining late gets the last known state at once (the daemon replay, one hop later)', async () => {
    const h = makeHarness()
    h.relay.subscribe('jarvis', h.listen().listener)
    await h.settle()
    h.streams[0]!.emit({ kind: 'state', state: 'wake' })
    await h.settle()
    const late = h.listen()
    h.relay.subscribe('jarvis', late.listener)
    expect(late.events).toEqual([
      { kind: 'daemon-link', connected: true },
      { kind: 'state', state: 'wake' },
    ])
    h.relay.dispose()
  })

  it('a dropped upstream turns the light off and reconnects with backoff while anyone listens', async () => {
    const h = makeHarness()
    const window = h.listen()
    h.relay.subscribe('app', window.listener)
    await h.settle()
    window.events.length = 0

    h.streams[0]!.close() // the daemon restarted
    await h.settle()
    expect(window.events).toEqual([{ kind: 'daemon-link', connected: false }])
    expect(h.timers).toHaveLength(1)
    expect(h.timers[0]!.delayMs).toBe(1_000)
    h.timers[0]!.callback()
    await h.settle()
    expect(h.fetchDaemon).toHaveBeenCalledTimes(2)
    expect(window.events.at(-1)).toEqual({ kind: 'daemon-link', connected: true })

    // Drops again while down: 2 s, 4 s … up to the cap; nobody listening → no reconnect.
    h.streams[1]!.close()
    await h.settle()
    expect(h.timers[1]!.delayMs).toBe(1_000) // a successful connect reset the backoff
    h.relay.dispose()
  })

  it('an unreachable daemon keeps the light off and retries with growing delays', async () => {
    const h = makeHarness()
    h.fetchDaemon.mockImplementation(async () => {
      throw new Error('ECONNREFUSED')
    })
    const window = h.listen()
    h.relay.subscribe('app', window.listener)
    await h.settle()
    expect(window.events).toEqual([{ kind: 'daemon-link', connected: false }])
    expect(h.timers.map((timer) => timer.delayMs)).toEqual([1_000])
    h.timers[0]!.callback()
    await h.settle()
    expect(h.timers.map((timer) => timer.delayMs)).toEqual([1_000, 2_000])
    h.timers[1]!.callback()
    await h.settle()
    expect(h.timers.map((timer) => timer.delayMs)).toEqual([1_000, 2_000, 4_000])
    h.relay.dispose()
  })

  it('a link loss forgets the last state — a late window must not inherit "speaking" from a dead daemon', async () => {
    const h = makeHarness()
    h.relay.subscribe('app', h.listen().listener)
    await h.settle()
    h.streams[0]!.emit({ kind: 'state', state: 'speaking' })
    await h.settle()
    h.streams[0]!.close()
    await h.settle()
    const late = h.listen()
    h.relay.subscribe('app', late.listener)
    expect(late.events).toEqual([{ kind: 'daemon-link', connected: false }])
    h.relay.dispose()
  })

  it('warns once per outage, then stays quiet at debug across the retries', async () => {
    const warn = vi.fn()
    const debug = vi.fn()
    const relay = createVoiceDaemonRelay({
      voiceDaemonUrl: 'http://127.0.0.1:1',
      logger: { warn, debug, info: vi.fn(), error: vi.fn() } as unknown as typeof silentLogger,
      fetchDaemon: (async () => {
        throw new Error('ECONNREFUSED')
      }) as unknown as typeof fetch,
      setTimer: (callback) => {
        // Retry fast for the test — but on the timer queue, so the test's own
        // waits still get to run (a microtask retry loop would starve them).
        const handle = setTimeout(callback, 1)
        return { cancel: () => clearTimeout(handle) }
      },
    })
    relay.subscribe('jarvis', () => {})
    await new Promise((resolve) => setTimeout(resolve, 30))
    relay.dispose()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(debug.mock.calls.length).toBeGreaterThan(1)
  })

  it('dispose aborts every upstream and inert-s later subscribes', async () => {
    const h = makeHarness()
    h.relay.subscribe('app', h.listen().listener)
    await h.settle()
    h.relay.dispose()
    expect(h.streams[0]!.aborted).toBe(true)
    const release = h.relay.subscribe('app', h.listen().listener)
    await h.settle()
    expect(h.fetchDaemon).toHaveBeenCalledTimes(1)
    release()
  })
})
