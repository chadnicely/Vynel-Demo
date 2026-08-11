import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceBrainEvent } from '../loop/voice-session-types.js'
import { VOICE_MODEL } from '../brain/run-brain-turn.js'
import { createCallSessionClient } from './call-session-client.js'

const API = 'http://127.0.0.1:18892'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Response) {
  const fetchSpy = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

async function collect(events: AsyncIterable<VoiceBrainEvent>): Promise<VoiceBrainEvent[]> {
  const collected: VoiceBrainEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

describe('createCallSessionClient', () => {
  it('creates the spawned call session with the priming purpose', async () => {
    const fetchSpy = stubFetch(
      new Response(JSON.stringify({ status: 'created', sessionId: 'sess-1', name: '9pm standup' }), {
        status: 200,
      }),
    )

    const created = await createCallSessionClient(API).createCallSession({
      name: '9pm standup',
      purpose: 'You are in the 9pm standup as a notetaker.',
    })

    expect(created).toEqual({ sessionId: 'sess-1' })
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API}/sessions/spawned`)
    expect(JSON.parse(init.body as string)).toEqual({
      name: '9pm standup',
      purpose: 'You are in the 9pm standup as a notetaker.',
    })
  })

  it('throws actionably when session creation fails', async () => {
    stubFetch(new Response('{}', { status: 503 }))

    await expect(
      createCallSessionClient(API).createCallSession({ name: 'call', purpose: 'p' }),
    ).rejects.toThrow('creating the call session failed (503)')
  })

  it('streams a call turn as brain events over the shared SSE wire', async () => {
    const sse = [
      'event: text-chunk\ndata: {"kind":"text-chunk","textDelta":"On it. "}\n\n',
      'event: text-chunk\ndata: {"kind":"text-chunk","textDelta":"Checking now."}\n\n',
      'event: turn-stream-ended\ndata: {}\n\n',
    ].join('')
    const fetchSpy = stubFetch(new Response(sse, { status: 200 }))

    const events = await collect(
      createCallSessionClient(API).runCallTurn('sess-1', 'Vynel, check the deploy'),
    )

    expect(events).toEqual([
      { kind: 'text', delta: 'On it. ' },
      { kind: 'text', delta: 'Checking now.' },
      { kind: 'completed' },
    ])
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API}/sessions/sess-1/turn`)
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['userMessageText']).toBe('Vynel, check the deploy')
    expect(body['model']).toBe(VOICE_MODEL)
  })

  it('yields a failed event when the turn request is rejected', async () => {
    stubFetch(new Response('{}', { status: 404 }))

    const events = await collect(createCallSessionClient(API).runCallTurn('gone', 'hello'))

    expect(events).toEqual([{ kind: 'failed', message: 'brain request failed (404)' }])
  })
})
