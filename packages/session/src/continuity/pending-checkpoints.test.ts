// The DURABLE pending-checkpoint register — real SQLite, the identity's own
// `primary_sessions` row. Pins: mark/peek/take once; latest intent wins; the
// cap deepens per continuation and resets on a genuine turn; a genuine turn
// REPORTS a leftover without dropping it (the caller decides); the delegated
// hand-over hides the slot from the identity and gives it whole to the
// follow-up's claim; nothing lives in module state — a fresh module instance
// over the same database ("a restart") reads exactly what the old one wrote.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { withTransaction } from '@vynel/db'
import { findPrimarySessionById, insertPrimarySession } from '../repositories/index.js'
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

function seedPrimary(db: Database): string {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: null,
    scope: 'global',
    currentSdkSessionId: 'sdk-head-1',
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }).id
}

describe('pending checkpoints (durable)', () => {
  it('records the next step on the identity row and hands it out exactly once', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      const at = new Date('2026-08-18T10:00:00.000Z')
      const marked = markPendingCheckpoint(db, primary, 'wire the delegated tick', { now: () => at })
      expect(marked).toEqual({
        primarySessionId: primary,
        nextStep: 'wire the delegated tick',
        continuationDepth: 0,
        checkpointedAt: at,
      })
      // The row IS the register.
      const row = findPrimarySessionById(db, primary)!
      expect(row.pendingCheckpointNextStep).toBe('wire the delegated tick')
      expect(row.pendingCheckpointAt).toEqual(at)
      expect(row.pendingCheckpointJobId).toBeNull()
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toBe('wire the delegated tick')
      expect(takePendingCheckpoint(db, primary)?.nextStep).toBe('wire the delegated tick')
      // Consumed — a second take finds nothing, and the row says so.
      expect(takePendingCheckpoint(db, primary)).toBeNull()
      expect(findPrimarySessionById(db, primary)!.pendingCheckpointNextStep).toBeNull()
    })
  })

  it('survives a restart — a fresh module instance over the same database reads the mark', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedPrimary(db)
      markPendingCheckpoint(db, primary, 'sum the July receipts')
      vi.resetModules()
      const fresh = await import('./pending-checkpoints.js')
      expect(fresh.peekPendingCheckpoint(db, primary)?.nextStep).toBe('sum the July receipts')
      // …and the fresh instance's take is visible to the old one: no state anywhere but the row.
      expect(fresh.takePendingCheckpoint(db, primary)?.nextStep).toBe('sum the July receipts')
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
    })
  })

  it('a second checkpoint before the swap replaces the first — the latest intent wins', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      markPendingCheckpoint(db, primary, 'first')
      markPendingCheckpoint(db, primary, 'second')
      expect(takePendingCheckpoint(db, primary)?.nextStep).toBe('second')
    })
  })

  it('caps automatic continuations, deepening per continuation and resetting on a genuine turn', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      // Genuine turn → checkpoint → continuation (depth 1) → checkpoint → … up to the cap.
      for (let round = 0; round < MAX_CONSECUTIVE_CONTINUATIONS; round += 1) {
        const checkpoint = markPendingCheckpoint(db, primary, `step ${round + 1}`)
        expect(checkpoint.continuationDepth).toBe(round)
        expect(beginContinuation(db, checkpoint)).toBe(true)
        expect(takePendingCheckpoint(db, primary)?.nextStep).toBe(`step ${round + 1}`)
      }
      // One past the cap: refused, and the checkpoint is still on the row for a visible drop.
      const overflow = markPendingCheckpoint(db, primary, 'one too many')
      expect(overflow.continuationDepth).toBe(MAX_CONSECUTIVE_CONTINUATIONS)
      expect(beginContinuation(db, overflow)).toBe(false)
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toBe('one too many')
      expect(findPrimarySessionById(db, primary)!.pendingCheckpointDepth).toBe(MAX_CONSECUTIVE_CONTINUATIONS)
      // A genuine turn resets the guard (the depth column too — the cap counts across restarts).
      beginGenuineTurn(db, primary)
      expect(findPrimarySessionById(db, primary)!.pendingCheckpointDepth).toBeNull()
      expect(markPendingCheckpoint(db, primary, 'fresh').continuationDepth).toBe(0)
    })
  })

  it('a genuine turn REPORTS a leftover checkpoint without dropping it — the caller decides', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      markPendingCheckpoint(db, primary, 'left behind by a turn that never continued')
      const leftover = beginGenuineTurn(db, primary)
      expect(leftover?.nextStep).toBe('left behind by a turn that never continued')
      // Still there: the interactive loop continues it after the turn; the
      // delegated tick drops it visibly.
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toBe('left behind by a turn that never continued')
      takePendingCheckpoint(db, primary)
      expect(beginGenuineTurn(db, primary)).toBeNull()
    })
  })

  it('hands a checkpoint to a follow-up job: hidden from the identity, given whole to that job once', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      const at = new Date('2026-08-19T09:00:00.000Z')
      const checkpoint = markPendingCheckpoint(db, primary, 'the delegated next step', { now: () => at })
      markContinuationJob(db, 'job-follow-up', checkpoint)
      // Handed over: peek/take on the identity see nothing (a genuine turn in
      // between cannot enqueue it twice), the row remembers who owns it.
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
      expect(takePendingCheckpoint(db, primary)).toBeNull()
      expect(findPrimarySessionById(db, primary)!.pendingCheckpointJobId).toBe('job-follow-up')
      // A genuine job's claim is not the follow-up.
      expect(takeContinuationJob(db, 'job-genuine')).toBeNull()
      // The follow-up's claim takes it whole — once.
      expect(takeContinuationJob(db, 'job-follow-up')).toEqual({
        primarySessionId: primary,
        nextStep: 'the delegated next step',
        continuationDepth: 0,
        checkpointedAt: at,
      })
      expect(takeContinuationJob(db, 'job-follow-up')).toBeNull()
      const row = findPrimarySessionById(db, primary)!
      expect(row.pendingCheckpointNextStep).toBeNull()
      expect(row.pendingCheckpointJobId).toBeNull()
    })
  })

  it('a NEW checkpoint supersedes a queued follow-up hand-over — that job then claims as genuine', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      markContinuationJob(db, 'job-old', markPendingCheckpoint(db, primary, 'old step'))
      markPendingCheckpoint(db, primary, 'newer step')
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toBe('newer step')
      expect(takeContinuationJob(db, 'job-old')).toBeNull()
    })
  })

  it('reset seam clears everything for the identity — including a hand-over', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      const checkpoint = markPendingCheckpoint(db, primary, 'x')
      beginContinuation(db, checkpoint)
      markContinuationJob(db, 'job-x', checkpoint)
      clearPendingCheckpoint(db, primary)
      const row = findPrimarySessionById(db, primary)!
      expect(row.pendingCheckpointNextStep).toBeNull()
      expect(row.pendingCheckpointDepth).toBeNull()
      expect(row.pendingCheckpointAt).toBeNull()
      expect(row.pendingCheckpointJobId).toBeNull()
      expect(takeContinuationJob(db, 'job-x')).toBeNull()
    })
  })

  it('keys strictly by identity — another primary sees nothing; an unknown identity cannot be marked', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      markPendingCheckpoint(db, primary, 'mine')
      expect(peekPendingCheckpoint(db, 'some-other-primary')).toBeNull()
      expect(() => markPendingCheckpoint(db, 'some-other-primary', 'nope')).toThrow(NotFoundError)
      // A vanished identity cannot begin a continuation either.
      expect(
        beginContinuation(db, { primarySessionId: 'gone', nextStep: 'x', continuationDepth: 0, checkpointedAt: new Date() }),
      ).toBe(false)
    })
  })

  it('composes inside an outer transaction (the enqueue path wraps take + hand-over in one)', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      markPendingCheckpoint(db, primary, 'nested')
      const taken = withTransaction(db, (tx) => {
        const checkpoint = takePendingCheckpoint(tx, primary)
        markContinuationJob(tx, 'job-nested', checkpoint!)
        return checkpoint
      })
      expect(taken?.nextStep).toBe('nested')
      expect(takeContinuationJob(db, 'job-nested')?.nextStep).toBe('nested')
    })
  })
})
