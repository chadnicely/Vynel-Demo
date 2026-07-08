import { afterEach, describe, expect, it, vi } from 'vitest'
import { speakThroughDaemon } from './speak-through-daemon.js'

// The load-bearing contract: a missing/erroring daemon is a SUCCESS with
// spoken:false — never a throw — so the brain reads it as "answer in text".

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('speakThroughDaemon', () => {
  it('reports spoken:true when the daemon accepts', async () => {
    const calls: Array<{ url: string; body: string }> = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) })
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
    })
    const result = await speakThroughDaemon('http://127.0.0.1:8997', 'Your report is ready.')
    expect(result).toEqual({ spoken: true })
    expect(calls[0]?.url).toBe('http://127.0.0.1:8997/speak')
    expect(JSON.parse(calls[0]!.body)).toEqual({ text: 'Your report is ready.' })
  })

  it('reports spoken:false (not a throw) when the daemon is unreachable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')))
    const result = await speakThroughDaemon('http://127.0.0.1:8997', 'Hi.')
    expect(result.spoken).toBe(false)
    expect(result.reason).toContain('not running')
  })

  it('reports spoken:false with the status when the daemon errors', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })))
    const result = await speakThroughDaemon('http://127.0.0.1:8997', 'Hi.')
    expect(result).toEqual({ spoken: false, reason: 'the voice daemon returned 500' })
  })
})
