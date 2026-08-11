import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  endCallThroughDaemon,
  listCallsThroughDaemon,
  speakIntoCallThroughDaemon,
  startCallThroughDaemon,
} from './calls-through-daemon.js'

const DAEMON = 'http://127.0.0.1:18893'

const descriptor = {
  callId: 'call-1',
  label: '9pm standup',
  mode: 'notetaker' as const,
  sessionId: 'sess-1',
  startedAtIso: '2026-08-11T21:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Response | (() => never)) {
  const fetchSpy =
    typeof response === 'function' ? vi.fn(response) : vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

describe('calls-through-daemon', () => {
  it('starts a call and validates the descriptor at the boundary', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify(descriptor), { status: 200 }))

    const started = await startCallThroughDaemon(DAEMON, {
      label: '9pm standup',
      mode: 'notetaker',
      sessionId: 'sess-1',
    })

    expect(started).toEqual({ ok: true, value: descriptor })
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${DAEMON}/calls`)
    expect(JSON.parse(init.body as string)).toEqual({
      label: '9pm standup',
      mode: 'notetaker',
      sessionId: 'sess-1',
    })
  })

  it("relays the daemon's own error message as the reason", async () => {
    stubFetch(
      new Response(JSON.stringify({ error: 'the cable pair is in use by call x', kind: 'pair-busy' }), {
        status: 409,
      }),
    )

    const started = await startCallThroughDaemon(DAEMON, {
      label: 'call',
      mode: 'notetaker',
      sessionId: 'sess-1',
    })

    expect(started).toEqual({ ok: false, reason: 'the cable pair is in use by call x' })
  })

  it('a daemon that is not running yields the actionable soft reason', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED')
    })

    const listed = await listCallsThroughDaemon(DAEMON)

    expect(listed.ok).toBe(false)
    if (!listed.ok) expect(listed.reason).toContain('pnpm dev:voice')
  })

  it('an unexpected wire shape is a version-skew reason, not a crash', async () => {
    stubFetch(new Response(JSON.stringify({ calls: [{ nope: true }] }), { status: 200 }))

    const listed = await listCallsThroughDaemon(DAEMON)

    expect(listed.ok).toBe(false)
    if (!listed.ok) expect(listed.reason).toContain('out of sync')
  })

  it('ends a call by id and speaks into one', async () => {
    const endSpy = stubFetch(new Response(JSON.stringify(descriptor), { status: 200 }))
    const ended = await endCallThroughDaemon(DAEMON, 'call-1')
    expect(ended.ok).toBe(true)
    expect((endSpy.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(`${DAEMON}/calls/call-1`)

    const speakSpy = stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const spoken = await speakIntoCallThroughDaemon(DAEMON, 'call-1', 'wrap up soon')
    expect(spoken.ok).toBe(true)
    expect((speakSpy.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      `${DAEMON}/calls/call-1/speak`,
    )
  })
})
