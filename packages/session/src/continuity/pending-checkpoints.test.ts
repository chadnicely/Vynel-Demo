import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_CONSECUTIVE_CONTINUATIONS,
  beginContinuation,
  beginGenuineTurn,
  clearPendingCheckpoint,
  markContinuationJob,
  markPendingCheckpoint,
  peekPendingCheckpoint,
  takeContinuationJob,
  takePendingCheckpoint,
} from './pending-checkpoints.js'

const PRIMARY = 'primary-checkpoints-test'

afterEach(() => {
  clearPendingCheckpoint(PRIMARY)
})

describe('pending checkpoints', () => {
  it('records the next step for the identity and hands it out exactly once', () => {
    const at = new Date('2026-08-18T10:00:00.000Z')
    const marked = markPendingCheckpoint(PRIMARY, 'wire the delegated tick', { now: () => at })
    expect(marked).toEqual({
      primarySessionId: PRIMARY,
      nextStep: 'wire the delegated tick',
      continuationDepth: 0,
      checkpointedAt: at,
    })
    expect(peekPendingCheckpoint(PRIMARY)?.nextStep).toBe('wire the delegated tick')
    expect(takePendingCheckpoint(PRIMARY)?.nextStep).toBe('wire the delegated tick')
    // Consumed — a second take finds nothing.
    expect(takePendingCheckpoint(PRIMARY)).toBeNull()
  })

  it('a second checkpoint before the swap replaces the first — the latest intent wins', () => {
    markPendingCheckpoint(PRIMARY, 'first')
    markPendingCheckpoint(PRIMARY, 'second')
    expect(takePendingCheckpoint(PRIMARY)?.nextStep).toBe('second')
  })

  it('caps automatic continuations, deepening per continuation and resetting on a genuine turn', () => {
    // Genuine turn → checkpoint → continuation (depth 1) → checkpoint → … up to the cap.
    for (let round = 0; round < MAX_CONSECUTIVE_CONTINUATIONS; round += 1) {
      const checkpoint = markPendingCheckpoint(PRIMARY, `step ${round + 1}`)
      expect(checkpoint.continuationDepth).toBe(round)
      expect(beginContinuation(takePendingCheckpoint(PRIMARY)!)).toBe(true)
    }
    // One past the cap: refused — the next real message drives again.
    const overflow = markPendingCheckpoint(PRIMARY, 'one too many')
    expect(overflow.continuationDepth).toBe(MAX_CONSECUTIVE_CONTINUATIONS)
    expect(beginContinuation(takePendingCheckpoint(PRIMARY)!)).toBe(false)
    // A genuine turn resets the guard.
    beginGenuineTurn(PRIMARY)
    expect(markPendingCheckpoint(PRIMARY, 'fresh').continuationDepth).toBe(0)
  })

  it('a genuine turn drops a stale checkpoint an earlier turn left behind (and reports it)', () => {
    markPendingCheckpoint(PRIMARY, 'left behind by a disconnected turn')
    const stale = beginGenuineTurn(PRIMARY)
    expect(stale?.nextStep).toBe('left behind by a disconnected turn')
    // Gone — the new turn's end will not hijack it.
    expect(peekPendingCheckpoint(PRIMARY)).toBeNull()
    expect(beginGenuineTurn(PRIMARY)).toBeNull()
  })

  it('remembers a follow-up job as the continuation of its checkpoint — read once, cleared with the identity', () => {
    const checkpoint = markPendingCheckpoint(PRIMARY, 'the delegated next step')
    markContinuationJob('job-follow-up', checkpoint)
    expect(takeContinuationJob('job-follow-up')?.nextStep).toBe('the delegated next step')
    // Consumed — the claim reads it exactly once; an unknown job is genuine.
    expect(takeContinuationJob('job-follow-up')).toBeNull()
    expect(takeContinuationJob('job-genuine')).toBeNull()
    markContinuationJob('job-follow-up-2', checkpoint)
    clearPendingCheckpoint(PRIMARY)
    expect(takeContinuationJob('job-follow-up-2')).toBeNull()
  })

  it('keys strictly by identity — another primary sees nothing', () => {
    markPendingCheckpoint(PRIMARY, 'mine')
    expect(peekPendingCheckpoint('some-other-primary')).toBeNull()
  })
})
