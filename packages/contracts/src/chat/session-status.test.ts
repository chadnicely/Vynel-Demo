// The session ladder — precedence, supersession, and note attribution
// (the workspace deriveView's contract, per-conversation).

import { describe, expect, it } from 'vitest'
import { deriveSessionStatus, type SessionStatusFacts } from './session-status.js'

const QUIET = { liveTurnStartedAt: null }

function facts(overrides: Partial<SessionStatusFacts> = {}): SessionStatusFacts {
  return {
    setStatus: null,
    statusNote: null,
    statusSetAt: null,
    lastError: null,
    pendingApprovalCount: 0,
    latestUserMessageAt: null,
    ...overrides,
  }
}

describe('deriveSessionStatus', () => {
  it('is idle when nothing is known', () => {
    expect(deriveSessionStatus(facts(), QUIET)).toEqual({ status: 'idle', note: null })
  })

  it('a latest-assistant error is problem, carrying the error text as the note', () => {
    const view = deriveSessionStatus(
      facts({
        lastError: {
          code: 'error_during_execution',
          message: "You've hit your session limit · resets 2:20pm",
          at: '2026-08-16T12:56:00Z',
        },
      }),
      QUIET,
    )
    expect(view.status).toBe('problem')
    expect(view.note).toBe("You've hit your session limit · resets 2:20pm")
  })

  it('a live turn outdates the error — the retry shows running', () => {
    const view = deriveSessionStatus(
      facts({ lastError: { code: null, message: 'limit', at: '2026-08-16T12:56:00Z' } }),
      { liveTurnStartedAt: '2026-08-16T13:00:00Z' },
    )
    expect(view.status).toBe('running')
  })

  it('a pending approval is needs_input and outranks running', () => {
    const view = deriveSessionStatus(facts({ pendingApprovalCount: 2 }), {
      liveTurnStartedAt: '2026-08-16T13:00:00Z',
    })
    expect(view.status).toBe('needs_input')
  })

  it('problem outranks needs_input (the workspace precedence)', () => {
    const view = deriveSessionStatus(
      facts({
        pendingApprovalCount: 1,
        lastError: { code: null, message: 'boom', at: '2026-08-16T12:00:00Z' },
      }),
      QUIET,
    )
    expect(view.status).toBe('problem')
  })

  it('a set status stands with its note until the user speaks again', () => {
    const set = facts({
      setStatus: 'completed',
      statusNote: 'All three drafts are in your inbox.',
      statusSetAt: '2026-08-16T12:00:00Z',
      latestUserMessageAt: '2026-08-16T11:00:00Z',
    })
    expect(deriveSessionStatus(set, QUIET)).toEqual({
      status: 'completed',
      note: 'All three drafts are in your inbox.',
    })

    // The user's next message supersedes it.
    const superseded = { ...set, latestUserMessageAt: '2026-08-16T12:30:00Z' }
    expect(deriveSessionStatus(superseded, QUIET)).toEqual({ status: 'idle', note: null })
  })

  it('a live turn starting after the set state supersedes it too', () => {
    const view = deriveSessionStatus(
      facts({ setStatus: 'needs_input', statusNote: 'Pick a variant.', statusSetAt: '2026-08-16T12:00:00Z' }),
      { liveTurnStartedAt: '2026-08-16T12:30:00Z' },
    )
    expect(view.status).toBe('running')
    expect(view.note).toBeNull()
  })

  it('set problem stands over idle and keeps its own note over the error text', () => {
    const view = deriveSessionStatus(
      facts({
        setStatus: 'problem',
        statusNote: 'Blocked: the repo needs a login.',
        statusSetAt: '2026-08-16T13:00:00Z',
        lastError: { code: null, message: 'earlier error', at: '2026-08-16T12:00:00Z' },
      }),
      QUIET,
    )
    expect(view.status).toBe('problem')
    expect(view.note).toBe('Blocked: the repo needs a login.')
  })
})
