import { describe, expect, it } from 'vitest'
import { parseDelegationModeHeader, wrapAppRequestWithMode } from './delegation-mode-header.js'

describe('parseDelegationModeHeader', () => {
  it('parses each valid permission mode', () => {
    expect(parseDelegationModeHeader('ask')).toBe('ask')
    expect(parseDelegationModeHeader('auto')).toBe('auto')
    // test: correct expectation — 'bypass' (the user's truly-silent grant)
    // joined the vocabulary 2026-07-30 and inherits onto delegations.
    expect(parseDelegationModeHeader('bypass')).toBe('bypass')
    expect(parseDelegationModeHeader('bypass-with-behavior-gate')).toBe(
      'bypass-with-behavior-gate',
    )
  })

  it('yields undefined for an absent header (the pre-mode default)', () => {
    expect(parseDelegationModeHeader(undefined)).toBeUndefined()
  })

  it('yields undefined for an unknown or malformed value — never throws', () => {
    expect(parseDelegationModeHeader('')).toBeUndefined()
    expect(parseDelegationModeHeader('plan-only')).toBeUndefined()
    expect(parseDelegationModeHeader('ASK')).toBeUndefined()
  })
})

describe('wrapAppRequestWithMode', () => {
  it('sets the mode header on every request and preserves existing headers', async () => {
    const seen: { url: string; mode: string | null; other: string | null }[] = []
    const appRequest = (async (input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      seen.push({
        url: String(input),
        mode: headers.get('x-vynel-delegation-mode'),
        other: headers.get('x-existing'),
      })
      return new Response('{}')
      // The factory type is structural — a plain async fn satisfies it.
    }) as Parameters<typeof wrapAppRequestWithMode>[0]

    const wrapped = wrapAppRequestWithMode(appRequest, 'auto')
    await wrapped('/routing/message', { headers: { 'x-existing': 'kept' } })
    await wrapped('/routing/message', {})

    expect(seen).toEqual([
      { url: '/routing/message', mode: 'auto', other: 'kept' },
      { url: '/routing/message', mode: 'auto', other: null },
    ])
  })

  it('round-trips with the parser — what one side writes the other side reads', async () => {
    let headerValue: string | undefined
    const appRequest = (async (_input: unknown, init?: RequestInit) => {
      headerValue = new Headers(init?.headers).get('x-vynel-delegation-mode') ?? undefined
      return new Response('{}')
    }) as Parameters<typeof wrapAppRequestWithMode>[0]

    await wrapAppRequestWithMode(appRequest, 'bypass-with-behavior-gate')('/routing/message')
    expect(parseDelegationModeHeader(headerValue)).toBe('bypass-with-behavior-gate')
  })
})
