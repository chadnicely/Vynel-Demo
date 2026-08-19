// The asks recovery service (session-hardening D5): the reap expires only the
// pending rows older than the interactive bound — a young pending row is a live
// form whose own waiter owns its bound — and the interval + stop() wiring
// holds. Real SQLite for the reap; fake timers for the cadence.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { listPendingAsks } from '@vynel/asks'
import { insertAskRequest, findAskRequestById } from '@vynel/asks/test-support'
import type { Database } from '@vynel/db'
import { reapStaleAskRequests, startAsksRecoveryService } from './asks-recovery-service.js'

const silentLogger = pino({ level: 'silent' })
const TWO_HOURS_MS = 2 * 60 * 60_000

function seedUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

function seedPendingAsk(db: Database, userId: string, createdAt: Date) {
  return insertAskRequest(db, {
    id: randomUUID(),
    userId,
    workspaceId: null,
    sessionId: null,
    taskId: null,
    questionsJson: JSON.stringify([{ id: 'q', label: 'Which?', type: 'text' }]),
    answersJson: null,
    status: 'pending',
    createdAt,
    resolvedAt: null,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('reapStaleAskRequests', () => {
  it('expires only the pending rows older than the bound — a live form is untouched', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const now = new Date()
      const orphan = seedPendingAsk(db, userId, new Date(now.getTime() - TWO_HOURS_MS - 60_000))
      const live = seedPendingAsk(db, userId, new Date(now.getTime() - 5 * 60_000))

      const reaped = reapStaleAskRequests(db, { maxAgeMs: TWO_HOURS_MS, now }, { logger: silentLogger })
      expect(reaped.expiredCount).toBe(1)
      expect(findAskRequestById(db, orphan.id)!.status).toBe('expired')
      expect(findAskRequestById(db, live.id)!.status).toBe('pending')
      expect(listPendingAsks(db, { userId }).map((ask) => ask.id)).toEqual([live.id])
    })
  })
})

describe('startAsksRecoveryService', () => {
  it('reaps on the interval and stop() halts it', async () => {
    vi.useFakeTimers()
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const service = startAsksRecoveryService({
        db,
        logger: silentLogger,
        maxAgeMs: TWO_HOURS_MS,
        intervalMs: 60_000,
      })
      // Born already-stale (a row from a waiter that died) — the next tick reaps it.
      const orphan = seedPendingAsk(db, userId, new Date(Date.now() - TWO_HOURS_MS - 1_000))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(findAskRequestById(db, orphan.id)!.status).toBe('expired')

      service.stop()
      const laterOrphan = seedPendingAsk(db, userId, new Date(Date.now() - TWO_HOURS_MS - 1_000))
      await vi.advanceTimersByTimeAsync(180_000)
      expect(findAskRequestById(db, laterOrphan.id)!.status).toBe('pending')
    })
  })
})
