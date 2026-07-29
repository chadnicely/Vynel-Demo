// Integration test for the `schedule.run-failed` outbox consumer — real
// SQLite. Proves a failed schedule run becomes a GLOBAL-ROOT report-delivery
// row (both targets null, kind 'report-delivery'), carrying the schedule's
// name and error so the notify turn can tell the user what broke.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { findDelegationJobById } from '../repositories/index.js'
import { consumeScheduleRunFailedEvent } from './consume-schedule-run-failed-event.js'

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

describe('consumeScheduleRunFailedEvent', () => {
  it('enqueues a global-root report delivery carrying the schedule name and error', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const scheduleId = randomUUID()

      const jobId = consumeScheduleRunFailedEvent(db, {
        scheduleId,
        runId: randomUUID(),
        userId: user.id,
        workspaceId: null,
        scheduleDisplayName: 'Morning brief',
        errorMessage: 'workspace not found',
        firedAt: '2026-07-28T08:00:00.000Z',
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.jobKind).toBe('report-delivery')
      // Global-root requester: the only permitted no-target row.
      expect(job?.workspaceId).toBeNull()
      expect(job?.targetPrimarySessionId).toBeNull()
      expect(job?.parentSessionId).toBe(`schedule:${scheduleId}`)
      expect(job?.workspaceName).toBe('Schedule · Morning brief')
      expect(job?.taskText).toContain('Morning brief')
      expect(job?.taskText).toContain('workspace not found')
    })
  })
})
