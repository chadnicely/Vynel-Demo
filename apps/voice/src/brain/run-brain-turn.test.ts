import { afterEach, describe, expect, it, vi } from 'vitest'
import { VOICE_TIER_MODE, VOICE_TIER_MODEL } from '@vynel/contracts/chat/voice-tier'
import type { VoiceBrainEvent } from '../loop/voice-session-types.js'
import { createBrainClient, mapFrameToBrainEvent, streamTurnEvents } from './run-brain-turn.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function collect(events: AsyncIterable<VoiceBrainEvent>): Promise<VoiceBrainEvent[]> {
  const collected: VoiceBrainEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

function stubFetch(response: Response) {
  const fetchSpy = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

describe('mapFrameToBrainEvent', () => {
  it('maps a text-chunk to a text event', () => {
    expect(
      mapFrameToBrainEvent({ event: 'text-chunk', data: '{"kind":"text-chunk","textDelta":"hello"}' }),
    ).toEqual({ kind: 'text', delta: 'hello' })
  })

  // CORRECTED expectation (was `{ kind: 'completed' }`): the transport terminal
  // is not a session event and whether it means "completed" depends on what came
  // before it — `streamTurnEvents` owns that decision now, in one home.
  it('ignores the transport terminal — the stream reader owns what it means', () => {
    expect(mapFrameToBrainEvent({ event: 'turn-stream-ended', data: '{}' })).toBeNull()
  })

  it("maps session-completed to completed — the answer is done there; the boundary swap frames after it are not voice's to wait on", () => {
    expect(
      mapFrameToBrainEvent({ event: 'session-completed', data: '{"kind":"session-completed","sessionId":"s"}' }),
    ).toEqual({ kind: 'completed' })
    expect(
      mapFrameToBrainEvent({ event: 'context-patching', data: '{"kind":"context-patching","sessionId":"s","primarySessionId":"p"}' }),
    ).toBeNull()
    expect(
      mapFrameToBrainEvent({ event: 'context-patched', data: '{"kind":"context-patched","sessionId":"s","primarySessionId":"p","toSessionId":"t"}' }),
    ).toBeNull()
  })

  it('maps an UNrecoverable session-errored to a failure with the message', () => {
    expect(
      mapFrameToBrainEvent({
        event: 'session-errored',
        data: '{"kind":"session-errored","errorMessage":"boom","isRecoverable":false}',
      }),
    ).toEqual({ kind: 'failed', message: 'boom' })
  })

  it('maps a RECOVERABLE session-errored to retrying — the runner recovers, the daemon must not apologise', () => {
    expect(
      mapFrameToBrainEvent({
        event: 'session-errored',
        data: '{"kind":"session-errored","errorMessage":"engine blip","isRecoverable":true}',
      }),
    ).toEqual({ kind: 'retrying', message: 'engine blip' })
  })

  it('treats a MISSING isRecoverable as a failure — only an explicit true is transient', () => {
    expect(
      mapFrameToBrainEvent({
        event: 'session-errored',
        data: '{"kind":"session-errored","errorMessage":"boom"}',
      }),
    ).toEqual({ kind: 'failed', message: 'boom' })
  })

  it('maps the queued sentinel off the EVENT NAME — its payload carries no kind', () => {
    expect(mapFrameToBrainEvent({ event: 'turn-queued', data: '{"reason":"busy"}' })).toEqual({
      kind: 'queued',
    })
    expect(
      mapFrameToBrainEvent({ event: 'turn-queued', data: '{"reason":"context-patching"}' }),
    ).toEqual({ kind: 'queued' })
  })

  it('ignores frames voice does not speak (thinking, tool calls)', () => {
    expect(
      mapFrameToBrainEvent({ event: 'thinking-chunk', data: '{"kind":"thinking-chunk"}' }),
    ).toBeNull()
    expect(
      mapFrameToBrainEvent({ event: 'tool-call-started', data: '{"kind":"tool-call-started"}' }),
    ).toBeNull()
  })

  it('ignores malformed data', () => {
    expect(mapFrameToBrainEvent({ event: 'text-chunk', data: 'not json' })).toBeNull()
  })
})

describe('streamTurnEvents', () => {
  const URL = 'http://127.0.0.1:18892/root/turn'

  it('ends the turn at the transport terminal when the session completed', async () => {
    stubFetch(
      new Response(
        'event: session-completed\ndata: {"kind":"session-completed","sessionId":"s"}\n\n' +
          'event: turn-stream-ended\ndata: {}\n\n',
      ),
    )
    expect(await collect(streamTurnEvents(URL, {}))).toEqual([{ kind: 'completed' }])
  })

  it('a recoverable error FOLLOWED BY completion is a completed turn — nothing is spoken about it', async () => {
    stubFetch(
      new Response(
        'event: session-errored\ndata: {"kind":"session-errored","errorMessage":"blip","isRecoverable":true}\n\n' +
          'event: text-chunk\ndata: {"kind":"text-chunk","textDelta":"back"}\n\n' +
          'event: session-completed\ndata: {"kind":"session-completed","sessionId":"s"}\n\n',
      ),
    )
    expect(await collect(streamTurnEvents(URL, {}))).toEqual([
      { kind: 'text', delta: 'back' },
      { kind: 'completed' },
    ])
  })

  it('a recoverable error the turn NEVER recovers from becomes the failure — never silence', async () => {
    stubFetch(
      new Response(
        'event: session-errored\ndata: {"kind":"session-errored","errorMessage":"the engine did not respond","isRecoverable":true}\n\n' +
          'event: turn-stream-ended\ndata: {}\n\n',
      ),
    )
    expect(await collect(streamTurnEvents(URL, {}))).toEqual([
      { kind: 'failed', message: 'the engine did not respond' },
    ])
  })

  it('surfaces the queued sentinel to the driver', async () => {
    stubFetch(
      new Response(
        'event: turn-queued\ndata: {"reason":"busy"}\n\n' +
          'event: session-completed\ndata: {"kind":"session-completed","sessionId":"s"}\n\n',
      ),
    )
    expect(await collect(streamTurnEvents(URL, {}))).toEqual([
      { kind: 'queued' },
      { kind: 'completed' },
    ])
  })

  it('passes the caller signal to fetch and yields NOTHING when the watchdog aborts it', async () => {
    const controller = new AbortController()
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      controller.abort()
      const error = new Error('This operation was aborted')
      error.name = 'AbortError'
      expect(init.signal).toBeDefined()
      throw error
    })
    vi.stubGlobal('fetch', fetchSpy)

    // A watchdog abort is not a failure to announce — the driver already told
    // the room, and the server turn keeps running.
    expect(await collect(streamTurnEvents(URL, {}, { signal: controller.signal }))).toEqual([])
  })

  it('gives up on a server that accepts the socket and never answers (the connect deadline)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }),
    )

    const events = collect(streamTurnEvents(URL, {}, { connectTimeoutMs: 5_000 }))
    await vi.advanceTimersByTimeAsync(5_001)
    expect(await events).toEqual([{ kind: 'failed', message: 'the brain did not answer within 5s' }])
  })

  it('reports an unreachable brain rather than hanging', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')))
    expect(await collect(streamTurnEvents(URL, {}))).toEqual([
      { kind: 'failed', message: 'ECONNREFUSED' },
    ])
  })
})

describe('createBrainClient', () => {
  it('sends the whole voice tier — model, effort, MODE and the voice flag', async () => {
    const fetchSpy = stubFetch(new Response('event: turn-stream-ended\ndata: {}\n\n'))

    await collect(createBrainClient('http://127.0.0.1:18892')('what time is it'))

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:18892/root/turn')
    expect(JSON.parse(init.body as string)).toEqual({
      userMessageText: 'what time is it',
      model: VOICE_TIER_MODEL,
      thinkingEffort: 'low',
      mode: VOICE_TIER_MODE,
      voice: true,
    })
  })
})
