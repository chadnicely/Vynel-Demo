// The relay's contract: one upstream per subscriber kind (surface × wake-
// capable), opened by the first listener and closed by the last; state to
// everyone, wake to the newest only (the daemon's single-delivery rule, one
// hop later), speak to the window that took the wake while it still listens,
// else the newest; the daemon's replay-on-connect mirrored to a late listener;
// reconnect with backoff while anyone listens; the link light. Driven with
// scripted SSE bodies + a fake timer — no daemon.

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

const APP = { surface: 'app', wake: false } as const
const APP_WAKE = { surface: 'app', wake: true } as const
const JARVIS = { surface: 'jarvis', wake: true } as const

describe('voice daemon relay', () => {
  it('opens ONE upstream per subscriber kind on the first listener, closes it after the last', async () => {
    const h = makeHarness()
    const a = h.listen()
    const b = h.listen()
    const releaseA = h.relay.subscribe(APP, a.listener)
    const releaseB = h.relay.subscribe(APP, b.listener)
    await h.settle()
    expect(h.fetchDaemon).toHaveBeenCalledTimes(1)
    expect(h.streams[0]!.url).toBe('http://127.0.0.1:18893/events?surface=app&wake=0')
    expect(h.relay.listenerCount(APP)).toBe(2)
    expect(h.relay.isConnected(APP)).toBe(true)

    // Another surface is its own upstream — declared wake-capable to the daemon.
    const j = h.listen()
    const releaseJ = h.relay.subscribe(JARVIS, j.listener)
    await h.settle()
    expect(h.fetchDaemon).toHaveBeenCalledTimes(2)
    expect(h.streams[1]!.url).toBe('http://127.0.0.1:18893/events?surface=jarvis&wake=1')

    // The same surface with the other capability is a THIRD upstream: the
    // daemon must be able to hand a wake to the capable one alone.
    const c = h.listen()
    const releaseC = h.relay.subscribe(APP_WAKE, c.listener)
    await h.settle()
    expect(h.fetchDaemon).toHaveBeenCalledTimes(3)
    expect(h.streams[2]!.url).toBe('http://127.0.0.1:18893/events?surface=app&wake=1')
    expect(h.relay.listenerCount(APP)).toBe(2)
    expect(h.relay.listenerCount(APP_WAKE)).toBe(1)

    releaseA()
    expect(h.streams[0]!.aborted).toBe(false) // b still listens
    releaseB()
    expect(h.streams[0]!.aborted).toBe(true) // last leaver closes the link
    expect(h.relay.isConnected(APP)).toBe(false)
    expect(h.relay.isConnected(APP_WAKE)).toBe(true)
    releaseJ()
    expect(h.streams[1]!.aborted).toBe(true)
    releaseC()
    expect(h.streams[2]!.aborted).toBe(true)
    h.relay.dispose()
  })

  it('state reaches every listener; wake and speak reach the NEWEST only; the link light rides along', async () => {
    const h = makeHarness()
    const first = h.listen()
    const second = h.listen()
    h.relay.subscribe(APP, first.listener)
    await h.settle()
    h.relay.subscribe(APP, second.listener)
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
    h.streams[0]!.emit({ kind: 'speak', text: 'good morning', sessionId: 'sched-1' })
    h.streams[0]!.emit({ kind: 'wake', command: 'open mail', turnWatchdogMs: 300_000 })
    h.streams[0]!.ping()
    h.streams[0]!.emit({ kind: 'nonsense' })
    await h.settle()
    expect(first.events).toEqual([{ kind: 'state', state: 'listening' }])
    // The producing session and the watchdog bound ride through untouched.
    expect(second.events).toEqual([
      { kind: 'state', state: 'listening' },
      { kind: 'speak', text: 'good morning', sessionId: 'sched-1' },
      { kind: 'wake', command: 'open mail', turnWatchdogMs: 300_000 },
    ])
    h.relay.dispose()
  })

  it('a speak goes to the window that took the wake while it still listens — else the newest', async () => {
    const h = makeHarness()
    const older = h.listen()
    const owner = h.listen()
    h.relay.subscribe(JARVIS, older.listener)
    await h.settle()
    const releaseOwner = h.relay.subscribe(JARVIS, owner.listener)
    await h.settle()
    // The wake lands on the newest (the daemon's rule) — it now OWNS the handoff.
    h.streams[0]!.emit({ kind: 'wake', command: '' })
    await h.settle()
    expect(owner.events.at(-1)).toEqual({ kind: 'wake', command: '' })

    // A window joining later does NOT take the conversation's lines away.
    const latest = h.listen()
    h.relay.subscribe(JARVIS, latest.listener)
    await h.settle()
    h.streams[0]!.emit({ kind: 'speak', text: 'your build is green', sessionId: 'sched-1' })
    await h.settle()
    expect(owner.events.at(-1)).toEqual({
      kind: 'speak',
      text: 'your build is green',
      sessionId: 'sched-1',
    })
    expect(latest.events.some((event) => event.kind === 'speak')).toBe(false)
    expect(older.events.some((event) => event.kind === 'speak')).toBe(false)

    // The owner leaves → the next speak falls back to the newest window.
    releaseOwner()
    h.streams[0]!.emit({ kind: 'speak', text: 'and deployed', sessionId: null })
    await h.settle()
    expect(latest.events.at(-1)).toEqual({ kind: 'speak', text: 'and deployed', sessionId: null })
    expect(older.events.some((event) => event.kind === 'speak')).toBe(false)
    h.relay.dispose()
  })

  it('a listener joining late gets the last known state at once (the daemon replay, one hop later)', async () => {
    const h = makeHarness()
    h.relay.subscribe(JARVIS, h.listen().listener)
    await h.settle()
    h.streams[0]!.emit({ kind: 'state', state: 'wake' })
    await h.settle()
    const late = h.listen()
    h.relay.subscribe(JARVIS, late.listener)
    expect(late.events).toEqual([
      { kind: 'daemon-link', connected: true },
      { kind: 'state', state: 'wake' },
    ])
    h.relay.dispose()
  })

  it('a dropped upstream turns the light off and reconnects with backoff while anyone listens', async () => {
    const h = makeHarness()
    const window = h.listen()
    h.relay.subscribe(APP, window.listener)
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
    h.relay.subscribe(APP, window.listener)
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
    h.relay.subscribe(APP, h.listen().listener)
    await h.settle()
    h.streams[0]!.emit({ kind: 'state', state: 'speaking' })
    await h.settle()
    h.streams[0]!.close()
    await h.settle()
    const late = h.listen()
    h.relay.subscribe(APP, late.listener)
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
    relay.subscribe(JARVIS, () => {})
    await new Promise((resolve) => setTimeout(resolve, 30))
    relay.dispose()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(debug.mock.calls.length).toBeGreaterThan(1)
  })

  it('dispose aborts every upstream and inert-s later subscribes', async () => {
    const h = makeHarness()
    h.relay.subscribe(APP, h.listen().listener)
    await h.settle()
    h.relay.dispose()
    expect(h.streams[0]!.aborted).toBe(true)
    const release = h.relay.subscribe(APP, h.listen().listener)
    await h.settle()
    expect(h.fetchDaemon).toHaveBeenCalledTimes(1)
    release()
  })
})
