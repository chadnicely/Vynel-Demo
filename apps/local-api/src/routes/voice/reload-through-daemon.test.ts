import { afterEach, describe, expect, it, vi } from 'vitest'
import { reloadVoiceThroughDaemon } from './reload-through-daemon.js'

// Like speak: a missing daemon is a SUCCESS with reloaded:false — the pick is
// saved regardless and the daemon reads it at its next start.

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reloadVoiceThroughDaemon', () => {
  it('relays the daemon’s outcome when it accepts', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url)
      return Promise.resolve(
        new Response(
          JSON.stringify({ ttsModelId: 'piper-lessac', sttModelId: 'moonshine-base', speakerId: 0, changed: ['tts'], missing: [] }),
          { status: 200 },
        ),
      )
    })
    const result = await reloadVoiceThroughDaemon('http://127.0.0.1:8997')
    expect(calls).toEqual(['http://127.0.0.1:8997/reload'])
    expect(result).toEqual({
      reloaded: true,
      ttsModelId: 'piper-lessac',
      sttModelId: 'moonshine-base',
      speakerId: 0,
      changed: ['tts'],
      missing: [],
    })
  })

  it('tells a slow model load apart from a missing daemon', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('timed out', 'TimeoutError')))
    expect(await reloadVoiceThroughDaemon('http://127.0.0.1:8997')).toEqual({
      reloaded: false,
      reason: 'the voice daemon is still loading the new model',
    })
  })

  it('reports reloaded:false (not a throw) when the daemon is unreachable or errors', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')))
    expect(await reloadVoiceThroughDaemon('http://127.0.0.1:8997')).toEqual({
      reloaded: false,
      reason: 'the voice daemon is not running',
    })
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })))
    expect(await reloadVoiceThroughDaemon('http://127.0.0.1:8997')).toEqual({
      reloaded: false,
      reason: 'the voice daemon returned 500',
    })
  })
})
