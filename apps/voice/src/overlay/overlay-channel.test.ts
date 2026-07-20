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

const silentLogger = pino({ level: 'silent' })

interface RecordedHooks {
  sessionEnds: number
  clientsGone: number
  spoken: string[]
}

function buildChannel(options?: OverlayChannelOptions): {
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
      onSpeak: (text) => {
        hooks.spoken.push(text)
        return Promise.resolve()
      },
    },
    silentLogger,
    options,
  )
  return { channel, hooks }
}

/** Subscribe to /events and collect parsed data events as they arrive. */
async function subscribe(
  port: number,
  surface: 'app' | 'jarvis' = 'app',
): Promise<{ events: OverlayEvent[]; close: () => void }> {
  const abort = new AbortController()
  const response = await fetch(`http://127.0.0.1:${port}/events?surface=${surface}`, {
    signal: abort.signal,
  })
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

let activeChannel: OverlayChannel | null = null

afterEach(() => {
  activeChannel?.stop()
  activeChannel = null
})

describe('overlay channel', () => {
  it('replays the current state on connect and streams wake events', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening
    channel.publishState('idle')

    const client = await subscribe(port)
    await waitFor(() => client.events.length >= 1)
    expect(client.events[0]).toEqual({ kind: 'state', state: 'idle' })
    expect(channel.hasClient).toBe(true)

    channel.publishWake('what is the time')
    channel.publishState('wake')
    await waitFor(() => client.events.length >= 3)
    expect(client.events[1]).toEqual({ kind: 'wake', command: 'what is the time' })
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

  it('fires onClientsGone when the last subscriber disconnects', async () => {
    const { channel, hooks } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const client = await subscribe(port)
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
    )
    await expect(second.whenListening).rejects.toThrow(/EADDRINUSE/)
  })

  it('serves POST /synthesize as audio/wav and rejects empty text', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const ok = await fetch(`http://127.0.0.1:${port}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello there.' }),
    })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('audio/wav')
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array(['Hello there.'.length]))

    const bad = await fetch(`http://127.0.0.1:${port}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })
    expect(bad.status).toBe(400)

    const oversized = await fetch(`http://127.0.0.1:${port}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(1001) }),
    })
    expect(oversized.status).toBe(400)
  })

  it('speaks text posted to /speak and rejects empty text', async () => {
    const { channel, hooks } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    const ok = await fetch(`http://127.0.0.1:${port}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Your report is ready.' }),
    })
    expect(ok.status).toBe(200)
    expect(hooks.spoken).toEqual(['Your report is ready.'])

    const bad = await fetch(`http://127.0.0.1:${port}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })
    expect(bad.status).toBe(400)
    expect(hooks.spoken).toHaveLength(1)
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
    )
    activeChannel = channel
    const port = await channel.whenListening

    const response = await fetch(`http://127.0.0.1:${port}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'boom' }),
    })
    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain('daemon log')
  })

  it('replays an undelivered wake (with its command) to the next eligible connect', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    channel.publishWake('what is the weather') // nobody connected yet
    const client = await subscribe(port)
    await waitFor(() => client.events.length >= 2)
    expect(client.events[1]).toEqual({ kind: 'wake', command: 'what is the weather' })

    // Delivered once — a second client must not start a second session.
    const second = await subscribe(port)
    await waitFor(() => second.events.length >= 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(second.events.filter((event) => event.kind === 'wake')).toEqual([])
    client.close()
    second.close()
  })

  it('publishSpeak delivers to exactly the newest client, or reports nobody home', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    expect(channel.publishSpeak('nobody is listening')).toBe(false)

    const first = await subscribe(port)
    const second = await subscribe(port, 'jarvis')
    await waitFor(() => first.events.length >= 1 && second.events.length >= 1)

    expect(channel.publishSpeak('your report is ready')).toBe(true)
    await waitFor(() => second.events.some((event) => event.kind === 'speak'))
    expect(second.events.find((event) => event.kind === 'speak')).toEqual({
      kind: 'speak',
      text: 'your report is ready',
    })
    // Single delivery — the older client must stay silent.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(first.events.filter((event) => event.kind === 'speak')).toEqual([])
    first.close()
    second.close()
  })

  it('drops a pending wake once the daemon leaves the wake state', async () => {
    const { channel } = buildChannel()
    activeChannel = channel
    const port = await channel.whenListening

    channel.publishWake('stale command')
    channel.publishState('idle') // handoff ended before anyone connected

    const client = await subscribe(port)
    await waitFor(() => client.events.length >= 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(client.events.filter((event) => event.kind === 'wake')).toEqual([])
    client.close()
  })

  it("wakeSurface 'jarvis': app tabs never receive wakes, the jarvis window does", async () => {
    const { channel, hooks } = buildChannel({ wakeSurface: 'jarvis' })
    activeChannel = channel
    const port = await channel.whenListening

    const appTab = await subscribe(port, 'app')
    await waitFor(() => channel.hasClient)
    expect(channel.hasWakeTarget).toBe(false)

    channel.publishWake('open my notes')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(appTab.events.filter((event) => event.kind === 'wake')).toEqual([])

    const jarvis = await subscribe(port, 'jarvis')
    await waitFor(() => jarvis.events.some((event) => event.kind === 'wake'))
    expect(jarvis.events.find((event) => event.kind === 'wake')).toEqual({
      kind: 'wake',
      command: 'open my notes',
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
})
