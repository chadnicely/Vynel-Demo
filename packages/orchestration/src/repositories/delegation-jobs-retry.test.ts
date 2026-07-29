// The retry mechanics on the delegation queue (migration 0023): requeue puts a
// claimed job back to pending with backoff bookkeeping, and the claim gates on
// `nextAttemptAt` — a backed-off row is invisible until its deadline passes,
// NULL (legacy/first attempt) is always due.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { enqueueReportDelivery } from '../routing/enqueue-report-delivery.js'
import {
  claimNextPendingDelegationJob,
  findDelegationJobById,
  requeueDelegationJob,
} from './delegation-jobs.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function seedJob(db: Parameters<typeof enqueueReportDelivery>[0]): string {
  const user = insertUser(db, makeUser())
  return enqueueReportDelivery(db, {
    userId: user.id,
    reporterSessionId: 'reporter-1',
    reporterLabel: 'Mark · Acme',
    reportBody: 'The work is done.',
    requester: { kind: 'global-root' },
  })
}

describe('delegation retry mechanics', () => {
  it('a NULL nextAttemptAt row (legacy/first attempt) is claimable immediately', async () => {
    await withTestDatabase((db) => {
      const jobId = seedJob(db)
      const claimed = claimNextPendingDelegationJob(db, new Date())
      expect(claimed?.id).toBe(jobId)
    })
  })

  it('requeue backs the job off: invisible before the deadline, claimable after, counter kept', async () => {
    await withTestDatabase((db) => {
      const jobId = seedJob(db)
      const claimed = claimNextPendingDelegationJob(db, new Date())
      expect(claimed?.id).toBe(jobId)

      const deadline = new Date(Date.now() + 60_000)
      const requeued = requeueDelegationJob(db, jobId, {
        errorMessage: 'rate limited',
        errorCode: 'rate_limit',
        attemptCount: 1,
        nextAttemptAt: deadline,
      })
      expect(requeued.status).toBe('pending')
      expect(requeued.claimedAt).toBeNull()

      // Backed off — not claimable now.
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()

      // Due — claimable again, attempt bookkeeping intact.
      const reclaimed = claimNextPendingDelegationJob(db, new Date(deadline.getTime() + 1000))
      expect(reclaimed?.id).toBe(jobId)
      expect(reclaimed?.attemptCount).toBe(1)
      expect(reclaimed?.errorCode).toBe('rate_limit')
      expect(findDelegationJobById(db, jobId)?.status).toBe('claimed')
    })
  })
})
