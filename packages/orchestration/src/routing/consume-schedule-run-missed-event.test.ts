// Integration test for the `schedule.run-missed` outbox consumer — real
// SQLite. Proves a slot Vynel was not running for becomes a report delivery on
// the SCHEDULE'S OWN scope (the workspace's conversation / the global root),
// signed as the schedule and carrying the one shared notice wording.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findDelegationJobById } from '../repositories/index.js'
import { consumeScheduleRunMissedEvent } from './consume-schedule-run-missed-event.js'
import type { Database } from '@vynel/db'

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

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function makePayload(userId: string, workspaceId: string | null) {
  return {
    scheduleId: randomUUID(),
    runId: randomUUID(),
    userId,
    workspaceId,
    channelId: null,
    scheduleDisplayName: 'Morning brief',
    missedAtLocal: 'Aug 21, 2026, 8:00 AM',
    nextFireAtLocal: 'Aug 22, 2026, 8:00 AM',
    missedAt: '2026-08-21T08:00:00.000Z',
  }
}

describe('consumeScheduleRunMissedEvent', () => {
  it('enqueues a workspace-primary delivery signed by the schedule', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const payload = makePayload(user.id, workspace.id)

      const job = findDelegationJobById(db, consumeScheduleRunMissedEvent(db, payload))

      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.workspacePath).toBe(workspace.path)
      // The `schedule:` prefix is what marks the delivery a SYSTEM notice.
      expect(job?.parentSessionId).toBe(`schedule:${payload.scheduleId}`)
      expect(job?.workspaceName).toBe('Schedule · Morning brief')
      expect(job?.taskText).toContain(
        '📅 Schedule · Morning brief missed its Aug 21, 2026, 8:00 AM run ' +
          '(Vynel was not running); next run Aug 22, 2026, 8:00 AM',
      )
      // The system-notification steer says "act on it"; without a relay clause
      // the notify turn would run the missed work or invent a replacement.
      expect(job?.taskText).toContain('Just tell the user this')
      expect(job?.taskText).toContain('do not create a timer or a replacement schedule')
    })
  })

  it('lands on the global root for a global schedule and for a deleted workspace', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())

      for (const workspaceId of [null, randomUUID()]) {
        const job = findDelegationJobById(
          db,
          consumeScheduleRunMissedEvent(db, makePayload(user.id, workspaceId)),
        )
        expect(job?.workspaceId).toBeNull()
        expect(job?.targetPrimarySessionId).toBeNull()
      }
    })
  })

  it('says "none" once a one-time schedule has disarmed', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const job = findDelegationJobById(
        db,
        consumeScheduleRunMissedEvent(db, {
          ...makePayload(user.id, null),
          nextFireAtLocal: null,
        }),
      )
      expect(job?.taskText).toContain('next run none')
    })
  })
})
