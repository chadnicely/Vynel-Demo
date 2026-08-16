import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { CallRegistryError, type CallDescriptor } from './call-registry.js'
import { createCallEndpoints, type CallRoster, type CallVoice } from './call-endpoints.js'

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

// The mic-level restore default shells to real PowerShell — every test injects
// a fake so a POST here never touches the machine's audio endpoints.
function appWith(
  roster: CallRoster,
  voice: CallVoice = { speakIntoCall: vi.fn(() => true) },
  resolveCaptureProcessId: (imageName: string) => Promise<number | null> = async () => null,
  restoreMicLevels: () => Promise<unknown> = async () => [],
) {
  return createCallEndpoints(roster, voice, pino({ level: 'silent' }), resolveCaptureProcessId, restoreMicLevels)
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

  it('POST passes a sessionId through and rejects an invalid one', async () => {
    const roster = fakeRoster()
    const ok = await appWith(roster).request('/', post({ label: 'standup', sessionId: ' sess-1 ' }))
    expect(ok.status).toBe(200)
    expect(roster.startCall).toHaveBeenCalledWith({
      label: 'standup',
      mode: 'notetaker',
      sessionId: 'sess-1',
    })

    const invalid = await appWith(fakeRoster()).request('/', post({ sessionId: 42 }))
    expect(invalid.status).toBe(400)
  })

  it('POST passes a capturePid through and rejects a non-positive-integer one', async () => {
    const roster = fakeRoster()
    const ok = await appWith(roster).request('/', post({ label: 'zoom', mode: 'participant', capturePid: 4321 }))
    expect(ok.status).toBe(200)
    expect(roster.startCall).toHaveBeenCalledWith({
      label: 'zoom',
      mode: 'participant',
      capturePid: 4321,
    })

    for (const bad of [0, -3, 1.5, 'nope']) {
      const rejected = await appWith(fakeRoster()).request('/', post({ capturePid: bad }))
      expect(rejected.status).toBe(400)
    }
  })

  it('POST resolves captureProcessName to the tree-root pid and starts with it', async () => {
    const roster = fakeRoster()
    const lookup = vi.fn(async () => 4321)
    const response = await appWith(roster, undefined, lookup).request(
      '/',
      post({ label: 'meet', mode: 'participant', captureProcessName: ' chrome ' }),
    )

    expect(response.status).toBe(200)
    expect(lookup).toHaveBeenCalledWith('chrome')
    expect(roster.startCall).toHaveBeenCalledWith({
      label: 'meet',
      mode: 'participant',
      capturePid: 4321,
    })
  })

  it('POST 400s when the named process is not running — a deaf call must not start', async () => {
    const roster = fakeRoster()
    const response = await appWith(roster, undefined, async () => null).request(
      '/',
      post({ captureProcessName: 'chrome' }),
    )

    expect(response.status).toBe(400)
    expect(roster.startCall).not.toHaveBeenCalled()
  })

  it('POST 400s when the lookup itself fails, with the actionable message', async () => {
    const response = await appWith(fakeRoster(), undefined, async () => {
      throw new Error('captureProcessName is Windows-only')
    }).request('/', post({ captureProcessName: 'chrome' }))

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toContain('Windows-only')
  })

  it('a successful start restores the call mic levels; a failed start does not', async () => {
    const restore = vi.fn(async () => [])
    const started = await appWith(fakeRoster(), undefined, async () => null, restore).request(
      '/',
      post({ label: 'meet' }),
    )
    expect(started.status).toBe(200)
    if (process.platform === 'win32') {
      expect(restore).toHaveBeenCalledTimes(1)
    }

    restore.mockClear()
    const busyRoster = fakeRoster({
      startCall: vi.fn(() => {
        throw new CallRegistryError('pair-busy', 'all pairs are in use')
      }),
    })
    const failed = await appWith(busyRoster, undefined, async () => null, restore).request('/', post({}))
    expect(failed.status).toBe(409)
    expect(restore).not.toHaveBeenCalled()
  })

  it('POST rejects capturePid + captureProcessName together and bad name shapes', async () => {
    // Each rejection is pinned by its MESSAGE — the not-running lookup default
    // also 400s, so a bare status check could pass for the wrong reason.
    const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

    const both = await appWith(fakeRoster()).request(
      '/',
      post({ capturePid: 10, captureProcessName: 'chrome' }),
    )
    expect(both.status).toBe(400)
    expect(await errorOf(both)).toContain('not both')

    for (const bad of ['', '   ', 42, 'x'.repeat(65)]) {
      const rejected = await appWith(fakeRoster()).request('/', post({ captureProcessName: bad }))
      expect(rejected.status).toBe(400)
      expect(await errorOf(rejected)).toContain('at most 64 characters')
    }
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

  it('POST /:callId/speak relays the conductor’s line and 404s a dead call', async () => {
    const speakIntoCall = vi.fn(() => true)
    const spoken = await appWith(fakeRoster(), { speakIntoCall }).request('/call-1/speak', post({ text: ' Wrap up soon. ' }))
    expect(spoken.status).toBe(200)
    expect(speakIntoCall).toHaveBeenCalledWith('call-1', 'Wrap up soon.')

    const dead = await appWith(fakeRoster(), { speakIntoCall: vi.fn(() => false) }).request(
      '/gone/speak',
      post({ text: 'anyone?' }),
    )
    expect(dead.status).toBe(404)

    const empty = await appWith(fakeRoster()).request('/call-1/speak', post({ text: '   ' }))
    expect(empty.status).toBe(400)
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
