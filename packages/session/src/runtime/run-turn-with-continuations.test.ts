// The automatic continuation loop: one generator the runners wrap their turn
// in — the genuine turn, then a continuation per pending checkpoint (the
// runner re-resolves the head inside its `runTurn`), up to the runaway cap.
// The register is the identity's row (real SQLite): a checkpoint pending
// BEFORE the loop starts — a restart survivor — is continued after the genuine
// turn; a stopped / failed / cut-short turn drops what is pending, visibly; a
// delivery turn drops only its own stray and leaves a survivor alone. The
// events of every turn flow through the ONE stream, in order.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import type { ChatTurnEvent } from '@vynel/chat'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, listRecentChatMessagesForSession } from '@vynel/chat/repositories'
import { insertPrimarySession } from '../repositories/index.js'
import {
  MAX_CONSECUTIVE_CONTINUATIONS,
  markPendingCheckpoint,
  peekPendingCheckpoint,
} from '../continuity/pending-checkpoints.js'
import { runContinuingTurn, runTurnWithContinuations } from './run-turn-with-continuations.js'
import type { ContinuationTurn } from './continuation-turn.js'

const HEAD = 'sdk-head-loop'

function seedIdentity(db: Database): string {
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
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: HEAD,
      userId: user.id,
      workspaceId: null,
      providerId: 'claude',
      startedAt: now,
      title: 'Global brain',
      scope: 'global',
      visibility: 'hidden',
    }),
  )
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: null,
    scope: 'global',
    currentSdkSessionId: HEAD,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }).id
}

function noteBodies(db: Database): string[] {
  return listRecentChatMessagesForSession(db, HEAD, 10).map((message) => message.body)
}

async function drain(stream: AsyncIterable<ChatTurnEvent>): Promise<ChatTurnEvent[]> {
  const events: ChatTurnEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

function turnEvents(label: string): ChatTurnEvent[] {
  return [
    { kind: 'text-chunk', messageId: `${label}-m`, textDelta: label },
    { kind: 'session-completed', sessionId: `${label}-s` },
  ]
}

describe('runTurnWithContinuations', () => {
  it('runs just the genuine turn when nothing was checkpointed', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedIdentity(db)
      const runs: Array<ContinuationTurn | null> = []
      const events = await drain(
        runTurnWithContinuations({
          db,
          primarySessionId: primary,
          runTurn: async function* (continuation) {
            runs.push(continuation)
            yield* turnEvents('t1')
          },
        }),
      )
      expect(runs).toEqual([null])
      expect(events.map((event) => event.kind)).toEqual(['text-chunk', 'session-completed'])
      expect(noteBodies(db)).toEqual([])
    })
  })

  it('continues after a checkpoint the turn left — the continuation carries the next step, in the same stream', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedIdentity(db)
      const runs: Array<ContinuationTurn | null> = []
      const events = await drain(
        runTurnWithContinuations({
          db,
          primarySessionId: primary,
          runTurn: async function* (continuation) {
            runs.push(continuation)
            if (continuation === null) {
              // The model checkpointed mid-turn (the tool marks it), then ended.
              markPendingCheckpoint(db, primary, 'wire the DM stream')
              yield* turnEvents('t1')
              return
            }
            yield* turnEvents('t2')
          },
        }),
      )
      expect(runs).toHaveLength(2)
      expect(runs[1]?.checkpoint.nextStep).toBe('wire the DM stream')
      expect(runs[1]?.persistedBody).toBe('Continuing after patching context — next: wire the DM stream')
      expect(runs[1]?.providerText).toContain('NEXT STEP: wire the DM stream')
      expect(runs[1]?.attribution).toEqual({ userSourceKind: 'global-root' })
      // Both turns' events, in order, on the one stream.
      expect(events.map((event) => event.kind)).toEqual([
        'text-chunk',
        'session-completed',
        'text-chunk',
        'session-completed',
      ])
      // Consumed — nothing left pending, nothing dropped.
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
      expect(noteBodies(db)).toEqual([])
    })
  })

  it('a checkpoint pending BEFORE the loop starts (a restart survivor) is continued after the genuine turn', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedIdentity(db)
      // The process died between checkpoint() and its continuation; the row remembers.
      markPendingCheckpoint(db, primary, 'finish the migration rehearsal')
      const logger = { warn: vi.fn(), info: vi.fn() }
      const runs: Array<ContinuationTurn | null> = []
      await drain(
        runTurnWithContinuations({
          db,
          primarySessionId: primary,
          runTurn: async function* (continuation) {
            runs.push(continuation)
            yield* turnEvents(continuation === null ? 't1' : 't2')
          },
          logger: logger as never,
        }),
      )
      expect(runs.map((run) => run?.checkpoint.nextStep ?? null)).toEqual([null, 'finish the migration rehearsal'])
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ primarySessionId: primary, nextStep: 'finish the migration rehearsal' }),
        expect.stringContaining('survived'),
      )
      expect(logger.warn).not.toHaveBeenCalled()
      expect(noteBodies(db)).toEqual([])
    })
  })

  it('keeps continuing while checkpoints keep coming, and stops at the runaway cap (dropped, noted)', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedIdentity(db)
      const logger = { warn: vi.fn(), info: vi.fn() }
      let runs = 0
      await drain(
        runTurnWithContinuations({
          db,
          primarySessionId: primary,
          runTurn: async function* () {
            runs += 1
            // A model that checkpoints on EVERY turn.
            markPendingCheckpoint(db, primary, `again ${runs}`)
            yield* turnEvents(`t${runs}`)
          },
          logger: logger as never,
        }),
      )
      // The genuine turn + the capped number of continuations.
      expect(runs).toBe(1 + MAX_CONSECUTIVE_CONTINUATIONS)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ primarySessionId: primary, reason: 'cap-reached' }),
        expect.stringContaining('checkpoint dropped'),
      )
      // The over-cap checkpoint was dropped, and the user is told — the next real message drives.
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
      expect(noteBodies(db)).toEqual([
        `Not continued — the next step was: again ${runs} (the automatic continuation limit was reached). Ask to continue when you want it picked up.`,
      ])
    })
  })

  it('never continues a turn the user STOPPED or that FAILED — the checkpoint is dropped with a note, nothing restarts', async () => {
    for (const [terminal, why] of [
      [{ kind: 'session-interrupted', sessionId: 't1-s' } as const, 'the turn was stopped'],
      [
        { kind: 'session-errored', sessionId: 't1-s', errorCode: 'engine-died', errorMessage: 'gone', isRecoverable: false } as const,
        'the turn failed',
      ],
    ] as const) {
      await withTestDatabase(async (db) => {
        const primary = seedIdentity(db)
        const logger = { warn: vi.fn(), info: vi.fn() }
        const runs: Array<ContinuationTurn | null> = []
        await drain(
          runTurnWithContinuations({
            db,
            primarySessionId: primary,
            runTurn: async function* (continuation) {
              runs.push(continuation)
              // The model checkpointed, kept working, and the turn ended badly.
              markPendingCheckpoint(db, primary, 'would restart the halted work')
              yield { kind: 'text-chunk', messageId: 'm', textDelta: 'working…' }
              yield terminal
            },
            logger: logger as never,
          }),
        )
        expect(runs).toEqual([null])
        expect(peekPendingCheckpoint(db, primary)).toBeNull()
        expect(noteBodies(db)).toEqual([
          `Not continued — the next step was: would restart the halted work (${why}). Ask to continue when you want it picked up.`,
        ])
      })
    }
  })

  it('a recoverable error followed by completion is a completed turn — it continues', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedIdentity(db)
      const runs: Array<ContinuationTurn | null> = []
      await drain(
        runTurnWithContinuations({
          db,
          primarySessionId: primary,
          runTurn: async function* (continuation) {
            runs.push(continuation)
            if (continuation === null) {
              markPendingCheckpoint(db, primary, 'carry on')
              yield { kind: 'session-errored', sessionId: 't1-s', errorCode: 'blip', errorMessage: 'retrying', isRecoverable: true }
            }
            yield* turnEvents(continuation === null ? 't1' : 't2')
          },
        }),
      )
      expect(runs).toHaveLength(2)
    })
  })

  it('a stream cut short (the client went away) drops what is pending — visibly — instead of hijacking the next turn', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedIdentity(db)
      const stream = runTurnWithContinuations({
        db,
        primarySessionId: primary,
        runTurn: async function* () {
          markPendingCheckpoint(db, primary, 'the step nobody will run')
          yield { kind: 'text-chunk', messageId: 'm', textDelta: 'working…' }
          yield* turnEvents('t1')
        },
      })
      // The consumer reads one event and stops (a disconnect closes the generator).
      for await (const event of stream) {
        if (event.kind === 'text-chunk') break
      }
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
      expect(noteBodies(db)).toEqual([
        'Not continued — the next step was: the step nobody will run (the turn was cut short). Ask to continue when you want it picked up.',
      ])
    })
  })

  it('autoContinue: false (a delivery turn) runs the genuine turn only, drops its OWN stray, and leaves a survivor alone', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedIdentity(db)
      // A survivor from an earlier interactive turn: not the delivery's to drop.
      const before = new Date('2026-08-19T08:00:00.000Z')
      markPendingCheckpoint(db, primary, 'the user turn that never continued', { now: () => before })
      const runs: Array<ContinuationTurn | null> = []
      await drain(
        runTurnWithContinuations({
          db,
          primarySessionId: primary,
          autoContinue: false,
          now: () => new Date('2026-08-19T09:00:00.000Z'),
          runTurn: async function* (continuation) {
            runs.push(continuation)
            yield* turnEvents('t1')
          },
        }),
      )
      expect(runs).toEqual([null])
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toBe('the user turn that never continued')
      expect(noteBodies(db)).toEqual([])

      // Even a delivery cut short (its client gone) leaves the survivor alone —
      // the ownership rule holds on every exit, not just the clean one.
      const cutShort = runTurnWithContinuations({
        db,
        primarySessionId: primary,
        autoContinue: false,
        now: () => new Date('2026-08-19T08:30:00.000Z'),
        runTurn: async function* () {
          yield { kind: 'text-chunk', messageId: 'm', textDelta: 'absorbing…' }
          yield* turnEvents('t1b')
        },
      })
      for await (const event of cutShort) {
        if (event.kind === 'text-chunk') break
      }
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toBe('the user turn that never continued')
      expect(noteBodies(db)).toEqual([])

      // The delivery's own stray (the model checkpointed DURING it) is dropped, noted.
      const logger = { warn: vi.fn(), info: vi.fn() }
      await drain(
        runTurnWithContinuations({
          db,
          primarySessionId: primary,
          autoContinue: false,
          now: () => new Date('2026-08-19T10:00:00.000Z'),
          runTurn: async function* () {
            markPendingCheckpoint(db, primary, 'a delivery never continues', { now: () => new Date('2026-08-19T10:00:01.000Z') })
            yield* turnEvents('t2')
          },
          logger: logger as never,
        }),
      )
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ nextStep: 'a delivery never continues', reason: 'never-continues' }),
        expect.stringContaining('checkpoint dropped'),
      )
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
      expect(noteBodies(db)).toEqual([
        'Not continued — the next step was: a delivery never continues (this kind of turn never continues work automatically). Ask to continue when you want it picked up.',
      ])
    })
  })

  it('runContinuingTurn: a plain conversation runs one turn; a continuing identity re-resolves the head per continuation; a vanished head skips it', async () => {
    await withTestDatabase(async (db) => {
      const primary = seedIdentity(db)
      // Plain: exactly one turn, the loop never engages (a checkpoint the model
      // leaves is never even taken — there is no identity to key it on).
      const plainStarts: Array<[string | undefined, ContinuationTurn | null]> = []
      await drain(
        runContinuingTurn({
          db,
          primarySessionId: null,
          resumeSessionId: 'seg-plain',
          resolveHead: async () => 'never-called',
          startOneTurn: async function* (resumeSessionId, continuation) {
            plainStarts.push([resumeSessionId, continuation])
            yield* turnEvents('p1')
          },
        }),
      )
      expect(plainStarts).toEqual([['seg-plain', null]])

      // Continuing: the genuine turn on the resolved head, the continuation on
      // the head the swap produced.
      const starts: Array<[string | undefined, string | null]> = []
      let head = 'seg-a'
      await drain(
        runContinuingTurn({
          db,
          primarySessionId: primary,
          resumeSessionId: 'seg-a',
          resolveHead: async () => head,
          startOneTurn: async function* (resumeSessionId, continuation) {
            starts.push([resumeSessionId, continuation?.checkpoint.nextStep ?? null])
            if (continuation === null) {
              markPendingCheckpoint(db, primary, 'finish the report')
              head = 'seg-b' // the boundary swap moved the head
            }
            yield* turnEvents(continuation === null ? 't1' : 't2')
          },
        }),
      )
      expect(starts).toEqual([
        ['seg-a', null],
        ['seg-b', 'finish the report'],
      ])

      // Vanished: the identity is gone by the time the continuation would run.
      const logger = { warn: vi.fn(), info: vi.fn() }
      const goneStarts: Array<string | null> = []
      await drain(
        runContinuingTurn({
          db,
          primarySessionId: primary,
          resumeSessionId: 'seg-a',
          resolveHead: async () => undefined,
          startOneTurn: async function* (_resumeSessionId, continuation) {
            goneStarts.push(continuation?.checkpoint.nextStep ?? null)
            if (continuation === null) markPendingCheckpoint(db, primary, 'never runs')
            yield* turnEvents('t1')
          },
          logger: logger as never,
        }),
      )
      expect(goneStarts).toEqual([null])
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ primarySessionId: primary }),
        expect.stringContaining('continuation skipped'),
      )
    })
  })
})
