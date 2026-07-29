// The retry classifier + requeue gate: transient provider/infra failures
// requeue with backoff; everything else (and exhausted attempts) is terminal.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { enqueueReportDelivery, findDelegationJobById } from '@vynel/orchestration'
import {
  DELEGATION_MAX_ATTEMPTS,
  extractEmbeddedErrorCode,
  isRecoverableTurnFailure,
  requeueIfRecoverable,
} from './classify-turn-failure.js'

const logger = pino({ level: 'silent' })

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

describe('isRecoverableTurnFailure', () => {
  it.each([
    'the routed turn errored (rate_limit_error): Too many requests',
    'API Error: 529 overloaded_error',
    'fetch failed: ECONNRESET',
    'the routed turn errored (provider_start_timeout): The Claude engine did not respond',
    'Internal server error from upstream',
  ])('recoverable: %s', (message) => {
    expect(isRecoverableTurnFailure(message)).toBe(true)
  })

  it.each([
    'workspace not found',
    'the routed turn errored (invalid_request): prompt too long',
    'delegateToSpawnedSession: spawned session x has no linked SDK session',
  ])('terminal: %s', (message) => {
    expect(isRecoverableTurnFailure(message)).toBe(false)
  })
})

describe('extractEmbeddedErrorCode', () => {
  it('recovers the runner-embedded code and returns null otherwise', () => {
    expect(extractEmbeddedErrorCode('the routed turn errored (rate_limit_error): x')).toBe(
      'rate_limit_error',
    )
    expect(extractEmbeddedErrorCode('plain network failure')).toBeNull()
  })
})

describe('requeueIfRecoverable', () => {
  function seedJob(db: Parameters<typeof enqueueReportDelivery>[0]): string {
    const user = insertUser(db, makeUser())
    return enqueueReportDelivery(db, {
      userId: user.id,
      reporterSessionId: 'reporter-1',
      reporterLabel: 'Mark · Acme',
      reportBody: 'Done.',
      requester: { kind: 'global-root' },
    })
  }

  it('requeues a recoverable failure with the counter bumped and a future deadline', async () => {
    await withTestDatabase((db) => {
      const jobId = seedJob(db)
      const job = findDelegationJobById(db, jobId)!
      const requeued = requeueIfRecoverable(db, job, 'ECONNRESET while streaming', logger, 'test')
      expect(requeued).toBe(true)
      const row = findDelegationJobById(db, jobId)!
      expect(row.status).toBe('pending')
      expect(row.attemptCount).toBe(1)
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
    })
  })

  it('refuses a non-recoverable failure', async () => {
    await withTestDatabase((db) => {
      const jobId = seedJob(db)
      const job = findDelegationJobById(db, jobId)!
      expect(requeueIfRecoverable(db, job, 'workspace not found', logger, 'test')).toBe(false)
    })
  })

  it('refuses once the attempt ceiling is reached', async () => {
    await withTestDatabase((db) => {
      const jobId = seedJob(db)
      const job = {
        ...findDelegationJobById(db, jobId)!,
        attemptCount: DELEGATION_MAX_ATTEMPTS - 1,
      }
      expect(requeueIfRecoverable(db, job, 'ECONNRESET', logger, 'test')).toBe(false)
    })
  })
})
