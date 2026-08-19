import { afterEach, describe, expect, it } from 'vitest'
import pino from 'pino'
import {
  startOverlayChannel,
  type OverlayChannel,
  type OverlayChannelOptions,
  type OverlayEvent,
} from './overlay-channel.js'

// Real-server tests on an ephemeral loopback port — the channel is transport
// code, so we exercise the actual SSE wire instead of mocking Hono.
//
// A "client" here is whatever holds one SSE subscription — in production the
// api's relay, one upstream per (surface, wake) pair — so every routing rule
// is asserted at that granularity.

const silentLogger = pino({ level: 'silent' })
const TURN_WATCHDOG_MS = 12_345
const DEFAULT_OPTIONS: OverlayChannelOptions = { wakeSurface: 'any', turnWatchdogMs: TURN_WATCHDOG_MS }

interface RecordedHooks {
  sessionEnds: number
  clientsGone: number
  spoken: Array<{ text: string; sessionId: string | null }>
}

function buildChannel(options: OverlayChannelOptions = DEFAULT_OPTIONS): {
  channel: OverlayChannel
  hooks: RecordedHooks
} {
  const hooks: RecordedHooks = { sessionEnds: 0, clientsGone: 0, spoken: [] }
  const channel = startOverlayChannel(
    0,
    {
      onSessionEnd: () => {
        hooks.sessionEnds += 1
      },
      onClientsGone: () => {
        hooks.clientsGone += 1
      },
      // A recognizable fake WAV: the requested text length as a 1-byte "wav".
      onSynthesize: (text) => Promise.resolve(new Uint8Array([text.length])),
      onSpeak: (text, sessionId) => {
        hooks.spoken.push({ text, sessionId })
        return Promise.resolve()
      },
    },
    silentLogger,
    options,
  )
  return { channel, hooks }
}

/** Subscribe to /events and collect parsed data events as they arrive. An
 *  omitted `wake` leaves the flag off the query (an app client that never
 *  declared — the conservative default is "cannot run a session"). */
async function subscribe(
  port: number,
  surface: 'app' | 'jarvis' = 'app',
  wake?: '1' | '0',
): Promise<{ events: OverlayEvent[]; close: () => void }> {
  const abort = new AbortController()
  const query = `surface=${surface}${wake === undefined ? '' : `&wake=${wake}`}`
  const response = await fetch(`http://127.0.0.1:${port}/events?${query}`, { signal: abort.signal })
  const reader = response.body!.getReader()
  const events: OverlayEvent[] = []
  const decoder = new TextDecoder()
  let buffer = ''
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (const match of buffer.matchAll(/^data: (.+)$/gm)) {
          const payload = match[1]!
          if (payload) events.push(JSON.parse(payload) as OverlayEvent)
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
      }
    } catch {
      // Aborted by the test's close() — expected.
    }
  })()
  return { events, close: () => abort.abort() }
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(predicate()).toBe(true)
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

const speakEvents = (events: OverlayEvent[]): OverlayEvent[] => events.filter((event) => event.kind === 'speak')
const wakeEvents = (events: OverlayEvent[]): OverlayEvent[] => events.filter((event) => event.kind === 'wake')

async function postJson(port: number, path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

let activeChannel: OverlayChannel | null = null

afterEach(() => {
  activeChannel?.stop()
  activeChannel = null
})

describe('overlay channel', () => {
  it('replays the current state on connect and streams wake events with the watchdog', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening
    channel.publishState('idle')

    const client = await subscribe(port, 'app', '1')
    await waitFor(() => client.events.length >= 1)
    expect(client.events[0]).toEqual({ kind: 'state', state: 'idle' })
    expect(channel.hasClient).toBe(true)

    channel.publishWake('what is the time')
    channel.publishState('wake')
    await waitFor(() => client.events.length >= 3)
    expect(client.events[1]).toEqual({
      kind: 'wake',
      command: 'what is the time',
      turnWatchdogMs: TURN_WATCHDOG_MS,
    })
    expect(client.events[2]).toEqual({ kind: 'state', state: 'wake' })
    client.close()
  })

  it('fires onSessionEnd for POST /session/end', async () => {
    const { channel, hooks } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const response = await fetch(`http://127.0.0.1:${port}/session/end`, { method: 'POST' })
    expect(response.ok).toBe(true)
    expect(hooks.sessionEnds).toBe(1)
  })

  it('fires onClientsGone when the last capable subscriber disconnects', async () => {
    const { channel, hooks } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const client = await subscribe(port, 'app', '1')
    await waitFor(() => channel.hasClient)

    client.close()
    await waitFor(() => hooks.clientsGone === 1)
    expect(channel.hasClient).toBe(false)
  })

  it('rejects whenListening when the port is already taken (a second daemon)', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const second = startOverlayChannel(
      port,
      {
        onSessionEnd: () => {},
        onClientsGone: () => {},
        onSynthesize: () => Promise.resolve(new Uint8Array()),
        onSpeak: () => Promise.resolve(),
      },
      silentLogger,
      DEFAULT_OPTIONS,
    )
    await expect(second.whenListening).rejects.toThrow(/EADDRINUSE/)
  })

  it('serves POST /synthesize as audio/wav and rejects empty text', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const ok = await postJson(port, '/synthesize', { text: 'Hello there.' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('audio/wav')
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array(['Hello there.'.length]))

    const bad = await postJson(port, '/synthesize', { text: '   ' })
    expect(bad.status).toBe(400)

    const oversized = await postJson(port, '/synthesize', { text: 'a'.repeat(1001) })
    expect(oversized.status).toBe(400)
  })

  it('speaks text posted to /speak with its producing session, null when none, and rejects empty text', async () => {
    const { channel, hooks } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const withSession = await postJson(port, '/speak', { text: 'Your report is ready.', sessionId: 'chat-7' })
    expect(withSession.status).toBe(200)
    const withoutSession = await postJson(port, '/speak', { text: 'Lunch in five.' })
    expect(withoutSession.status).toBe(200)
    // A blank id is "unknown", not a session named "".
    const blankSession = await postJson(port, '/speak', { text: 'Heads up.', sessionId: '' })
    expect(blankSession.status).toBe(200)
    expect(hooks.spoken).toEqual([
      { text: 'Your report is ready.', sessionId: 'chat-7' },
      { text: 'Lunch in five.', sessionId: null },
      { text: 'Heads up.', sessionId: null },
    ])

    const bad = await postJson(port, '/speak', { text: '   ' })
    expect(bad.status).toBe(400)
    expect(hooks.spoken).toHaveLength(3)
  })

  it('maps a synthesis failure to a 500 with an actionable body', async () => {
    const channel = startOverlayChannel(
      0,
      {
        onSessionEnd: () => {},
        onClientsGone: () => {},
        onSynthesize: () => Promise.reject(new Error('model exploded')),
        onSpeak: () => Promise.resolve(),
      },
      silentLogger,
      DEFAULT_OPTIONS,
    )
    activeChannel = channel
    const port = await channel.whenListening

    const response = await postJson(port, '/synthesize', { text: 'boom' })
    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain('daemon log')
  })

  it('replays an undelivered wake (with its command) to the next eligible connect', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    channel.publishWake('what is the weather') // nobody connected yet
    const client = await subscribe(port, 'app', '1')
    await waitFor(() => client.events.length >= 2)
    expect(client.events[1]).toEqual({
      kind: 'wake',
      command: 'what is the weather',
      turnWatchdogMs: TURN_WATCHDOG_MS,
    })

    // Delivered once — a second client must not start a second session.
    const second = await subscribe(port, 'app', '1')
    await waitFor(() => second.events.length >= 1)
    await settle()
    expect(wakeEvents(second.events)).toEqual([])
    client.close()
    second.close()
  })

  it('publishSpeak delivers to exactly the newest client with the session id, or reports nobody home', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    expect(channel.publishSpeak('nobody is listening', null)).toBe(false)

    const first = await subscribe(port)
    const second = await subscribe(port, 'jarvis')
    await waitFor(() => first.events.length >= 1 && second.events.length >= 1)

    expect(channel.publishSpeak('your report is ready', 'chat-7')).toBe(true)
    await waitFor(() => speakEvents(second.events).length === 1)
    expect(speakEvents(second.events)[0]).toEqual({
      kind: 'speak',
      text: 'your report is ready',
      sessionId: 'chat-7',
    })
    // Single delivery — the older client must stay silent.
    await settle()
    expect(speakEvents(first.events)).toEqual([])

    expect(channel.publishSpeak('no producer known', null)).toBe(true)
    await waitFor(() => speakEvents(second.events).length === 2)
    expect(speakEvents(second.events)[1]).toEqual({ kind: 'speak', text: 'no producer known', sessionId: null })
    first.close()
    second.close()
  })

  it('drops a pending wake once the daemon leaves the wake state', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    channel.publishWake('stale command')
    channel.publishState('idle') // handoff ended before anyone connected

    const client = await subscribe(port, 'app', '1')
    await waitFor(() => client.events.length >= 1)
    await settle()
    expect(wakeEvents(client.events)).toEqual([])
    client.close()
  })

  it("wakeSurface 'jarvis': app tabs never receive wakes, the jarvis window does", async () => {
    const { channel, hooks } = buildChannel({ wakeSurface: 'jarvis', turnWatchdogMs: TURN_WATCHDOG_MS })
    activeChannel = channel
    const port = await channel.whenListening

    const appTab = await subscribe(port, 'app', '1')
    await waitFor(() => channel.hasClient)
    expect(channel.hasWakeTarget).toBe(false)

    channel.publishWake('open my notes')
    await settle()
    expect(wakeEvents(appTab.events)).toEqual([])

    const jarvis = await subscribe(port, 'jarvis')
    await waitFor(() => wakeEvents(jarvis.events).length === 1)
    expect(wakeEvents(jarvis.events)[0]).toEqual({
      kind: 'wake',
      command: 'open my notes',
      turnWatchdogMs: TURN_WATCHDOG_MS,
    })
    expect(channel.hasWakeTarget).toBe(true)

    // Losing the jarvis window (the wake runner) fires onClientsGone even
    // though the app tab is still connected; losing a mere tab does not.
    jarvis.close()
    await waitFor(() => hooks.clientsGone === 1)
    appTab.close()
    await waitFor(() => !channel.hasClient)
    expect(hooks.clientsGone).toBe(1)
  })

  it("wakeSurface 'app' (window feature off): the jarvis surface never receives wakes, a capable app tab does", async () => {
    const { channel, hooks } = buildChannel({ wakeSurface: 'app', turnWatchdogMs: TURN_WATCHDOG_MS })
    activeChannel = channel
    const port = await channel.whenListening

    // The desktop shell keeps its hidden jarvis webview connected whatever the
    // flag says — a wake handed to it would vanish into a window nobody sees.
    const hiddenJarvis = await subscribe(port, 'jarvis')
    await waitFor(() => channel.hasClient)
    expect(channel.hasWakeTarget).toBe(false)

    channel.publishWake('open my notes')
    await settle()
    expect(wakeEvents(hiddenJarvis.events)).toEqual([])

    // A browser tab that declared Web Speech is the one client that may run it.
    const browserTab = await subscribe(port, 'app', '1')
    await waitFor(() => wakeEvents(browserTab.events).length === 1)
    expect(channel.hasWakeTarget).toBe(true)

    // Losing the tab (the wake runner) fires onClientsGone; losing the hidden
    // jarvis webview never does — it was never a runner here.
    browserTab.close()
    await waitFor(() => hooks.clientsGone === 1)
    hiddenJarvis.close()
    await waitFor(() => !channel.hasClient)
    expect(hooks.clientsGone).toBe(1)
  })
})

describe('overlay channel — wake capability', () => {
  it('an app client without wake=1 is connected but never a wake target', async () => {
    const { channel, hooks } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const silent = await subscribe(port, 'app', '0')
    const undeclared = await subscribe(port, 'app')
    await waitFor(() => silent.events.length >= 1 && undeclared.events.length >= 1)
    // The shouldHandOff seam (main.ts): a client is there, but nobody can run a
    // session — the native leg must answer.
    expect(channel.hasClient).toBe(true)
    expect(channel.hasWakeTarget).toBe(false)

    channel.publishWake('what is the time')
    await settle()
    expect(wakeEvents(silent.events)).toEqual([])
    expect(wakeEvents(undeclared.events)).toEqual([])

    // The held wake still reaches the first CAPABLE connect, skipping them both.
    const capable = await subscribe(port, 'app', '1')
    await waitFor(() => wakeEvents(capable.events).length === 1)
    expect(channel.hasWakeTarget).toBe(true)

    // An incapable client dropping is not a lost runner; the capable one is.
    silent.close()
    await settle()
    expect(hooks.clientsGone).toBe(0)
    capable.close()
    await waitFor(() => hooks.clientsGone === 1)
    undeclared.close()
    await waitFor(() => !channel.hasClient)
    expect(hooks.clientsGone).toBe(1)
  })

  it('the jarvis surface is always capable, wake flag or not', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const jarvis = await subscribe(port, 'jarvis', '0')
    await waitFor(() => channel.hasClient)
    expect(channel.hasWakeTarget).toBe(true)

    channel.publishWake('open my notes')
    await waitFor(() => wakeEvents(jarvis.events).length === 1)
    jarvis.close()
  })

  it('the newest CAPABLE client takes the wake even when an incapable one connected later', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const capable = await subscribe(port, 'app', '1')
    const silent = await subscribe(port, 'app', '0')
    await waitFor(() => capable.events.length >= 1 && silent.events.length >= 1)

    channel.publishWake('what is the time')
    await waitFor(() => wakeEvents(capable.events).length === 1)
    await settle()
    expect(wakeEvents(silent.events)).toEqual([])
    capable.close()
    silent.close()
  })
})

describe('overlay channel — speak routing by handoff owner', () => {
  it('routes speak to the client that took the wake, not the newest, until its session ends', async () => {
    const { channel, hooks } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const owner = await subscribe(port, 'jarvis')
    await waitFor(() => owner.events.length >= 1)
    channel.publishWake('summarize my day')
    await waitFor(() => wakeEvents(owner.events).length === 1)

    // A newer client (the desktop main window reconnecting) must not steal the
    // line — the owner's speaker has the room.
    const newer = await subscribe(port, 'app', '0')
    await waitFor(() => newer.events.length >= 1)
    expect(channel.publishSpeak('your build finished', 'schedule-1')).toBe(true)
    await waitFor(() => speakEvents(owner.events).length === 1)
    expect(speakEvents(owner.events)[0]).toEqual({
      kind: 'speak',
      text: 'your build finished',
      sessionId: 'schedule-1',
    })
    await settle()
    expect(speakEvents(newer.events)).toEqual([])

    // The session ends → no owner → back to the newest-client rule.
    const ended = await fetch(`http://127.0.0.1:${port}/session/end`, { method: 'POST' })
    expect(ended.ok).toBe(true)
    expect(hooks.sessionEnds).toBe(1)
    expect(channel.publishSpeak('lunch in five', null)).toBe(true)
    await waitFor(() => speakEvents(newer.events).length === 1)
    await settle()
    expect(speakEvents(owner.events)).toHaveLength(1)
    owner.close()
    newer.close()
  })

  it('the owner disconnecting ends the handoff even though another capable client remains', async () => {
    const { channel, hooks } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const bystander = await subscribe(port, 'app', '1')
    const owner = await subscribe(port, 'jarvis')
    await waitFor(() => bystander.events.length >= 1 && owner.events.length >= 1)
    channel.publishWake('what is the time')
    await waitFor(() => wakeEvents(owner.events).length === 1)
    expect(wakeEvents(bystander.events)).toEqual([])

    // The bystander never got the wake — nobody runs the session once the
    // owner is gone, so the daemon must take the mic back rather than stay deaf.
    owner.close()
    await waitFor(() => hooks.clientsGone === 1)
    expect(channel.hasWakeTarget).toBe(true)

    // And with no owner, speak falls back to the newest client.
    expect(channel.publishSpeak('still here', null)).toBe(true)
    await waitFor(() => speakEvents(bystander.events).length === 1)
    bystander.close()
  })
})
