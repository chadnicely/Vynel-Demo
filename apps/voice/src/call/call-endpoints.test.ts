import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { CallRegistryError, type CallDescriptor } from './call-registry.js'
import { createCallEndpoints, type CallRoster } from './call-endpoints.js'

const descriptor: CallDescriptor = {
  callId: 'call-1',
  label: '9pm standup',
  mode: 'notetaker',
  startedAtIso: '2026-08-11T21:00:00.000Z',
}

function fakeRoster(overrides: Partial<CallRoster> = {}): CallRoster {
  return {
    startCall: vi.fn(() => descriptor),
    endCall: vi.fn(() => descriptor),
    listCalls: vi.fn(() => [descriptor]),
    ...overrides,
  }
}

function appWith(roster: CallRoster) {
  return createCallEndpoints(roster, pino({ level: 'silent' }))
}

function post(body?: unknown) {
  return body === undefined
    ? { method: 'POST' }
    : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
}

describe('call endpoints', () => {
  it('POST starts a call and returns its descriptor', async () => {
    const roster = fakeRoster()
    const response = await appWith(roster).request('/', post({ label: ' 9pm standup ', mode: 'participant' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(descriptor)
    expect(roster.startCall).toHaveBeenCalledWith({ label: '9pm standup', mode: 'participant' })
  })

  it('POST without a body applies the defaults: label "call", notetaker mode', async () => {
    const roster = fakeRoster()
    const response = await appWith(roster).request('/', post())

    expect(response.status).toBe(200)
    expect(roster.startCall).toHaveBeenCalledWith({ label: 'call', mode: 'notetaker' })
  })

  it('POST rejects an oversized label before touching the registry', async () => {
    const roster = fakeRoster()
    const response = await appWith(roster).request('/', post({ label: 'x'.repeat(121) }))

    expect(response.status).toBe(400)
    expect(roster.startCall).not.toHaveBeenCalled()
  })

  it('POST rejects an unknown mode before touching the registry', async () => {
    const roster = fakeRoster()
    const response = await appWith(roster).request('/', post({ mode: 'karaoke' }))

    expect(response.status).toBe(400)
    expect(roster.startCall).not.toHaveBeenCalled()
  })

  it('maps registry error kinds to honest statuses', async () => {
    const busy = fakeRoster({
      startCall: vi.fn(() => {
        throw new CallRegistryError('pair-busy', 'the cable pair is in use by call call-1')
      }),
    })
    const busyResponse = await appWith(busy).request('/', post())
    expect(busyResponse.status).toBe(409)
    expect(await busyResponse.json()).toEqual({
      error: 'the cable pair is in use by call call-1',
      kind: 'pair-busy',
    })

    const unconfigured = fakeRoster({
      startCall: vi.fn(() => {
        throw new CallRegistryError('not-configured', 'call audio is not configured')
      }),
    })
    expect((await appWith(unconfigured).request('/', post())).status).toBe(400)
  })

  it('GET lists the live calls', async () => {
    const response = await appWith(fakeRoster()).request('/')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ calls: [descriptor] })
  })

  it('DELETE ends a call; an unknown id maps to 404', async () => {
    const roster = fakeRoster()
    const ended = await appWith(roster).request('/call-1', { method: 'DELETE' })
    expect(ended.status).toBe(200)
    expect(roster.endCall).toHaveBeenCalledWith('call-1')

    const missing = fakeRoster({
      endCall: vi.fn(() => {
        throw new CallRegistryError('unknown-call', 'no live call nope')
      }),
    })
    expect((await appWith(missing).request('/nope', { method: 'DELETE' })).status).toBe(404)
  })

  it('an unexpected registry failure returns a generic 500 without leaking internals', async () => {
    const broken = fakeRoster({
      startCall: vi.fn(() => {
        throw new Error('cpal exploded at 0x0000')
      }),
    })
    const response = await appWith(broken).request('/', post())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'call operation failed — see the daemon log' })
  })
})
