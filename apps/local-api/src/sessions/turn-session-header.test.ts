import { describe, expect, it } from 'vitest'
import {
  TURN_SESSION_HEADER,
  createTurnSessionCarrier,
  parseTurnSessionHeader,
} from './turn-session-header.js'

/** A dispatcher stub that records the header it was called with. */
function recordingAppRequest() {
  const seen: (string | null)[] = []
  const appRequest = (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get(TURN_SESSION_HEADER))
    return new Response(null, { status: 204 })
  }
  return { seen, appRequest }
}

describe('parseTurnSessionHeader', () => {
  it('treats absent and blank as no session', () => {
    expect(parseTurnSessionHeader(undefined)).toBeUndefined()
    expect(parseTurnSessionHeader('   ')).toBeUndefined()
    expect(parseTurnSessionHeader('session-1')).toBe('session-1')
  })
})

describe('createTurnSessionCarrier', () => {
  it('stamps nothing until the turn resolves, then EVERY later request', async () => {
    const { seen, appRequest } = recordingAppRequest()
    const carrier = createTurnSessionCarrier()
    const wrapped = carrier.wrapAppRequest(appRequest)

    await wrapped('/todos')
    carrier.resolve('session-1')
    await wrapped('/todos')

    expect(seen).toEqual([null, 'session-1'])
  })

  it('seeds from a resumed session so the first request is already stamped', async () => {
    const { seen, appRequest } = recordingAppRequest()
    const wrapped = createTurnSessionCarrier('session-resumed').wrapAppRequest(appRequest)

    await wrapped('/todos')

    expect(seen).toEqual(['session-resumed'])
  })

  it('follows a mid-turn compaction swap and ignores an empty id', async () => {
    const { seen, appRequest } = recordingAppRequest()
    const carrier = createTurnSessionCarrier('session-1')
    const wrapped = carrier.wrapAppRequest(appRequest)

    carrier.resolve('') // a pre-session error frame must not blank the identity
    await wrapped('/todos')
    carrier.resolve('session-2')
    await wrapped('/todos')

    expect(seen).toEqual(['session-1', 'session-2'])
  })

  it('keeps the caller\'s own headers', async () => {
    const seenContentType: (string | null)[] = []
    const wrapped = createTurnSessionCarrier('session-1').wrapAppRequest((_input, init) => {
      seenContentType.push(new Headers(init?.headers).get('content-type'))
      return new Response(null, { status: 204 })
    })

    await wrapped('/todos', { method: 'PUT', headers: { 'content-type': 'application/json' } })

    expect(seenContentType).toEqual(['application/json'])
  })
})
