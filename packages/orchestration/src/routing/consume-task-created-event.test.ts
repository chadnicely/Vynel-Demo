// Integration test for the `task.created` outbox consumer — real SQLite.
// Proves a USER-created task becomes the pickup nudge (a report-delivery row
// targeting the workspace primary), an assistant-created one nudges nothing,
// and a deleted/global scope degrades to the global root.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findDelegationJobById } from '../repositories/index.js'
import { consumeTaskCreatedEvent } from './consume-task-created-event.js'
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
    taskId: randomUUID(),
    userId,
    workspaceId,
    title: 'Research SEO for the shop',
    source: 'user' as const,
    createdAt: new Date().toISOString(),
  }
}

describe('consumeTaskCreatedEvent', () => {
  it('enqueues a workspace-primary report delivery naming the task', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const payload = makePayload(user.id, workspace.id)

      const jobId = consumeTaskCreatedEvent(db, payload)

      expect(jobId).not.toBeNull()
      const job = findDelegationJobById(db, jobId!)
      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.workspacePath).toBe(workspace.path)
      expect(job?.parentSessionId).toBe(`task:${payload.taskId}`)
      expect(job?.workspaceName).toBe('Tasks')
      expect(job?.taskText).toContain('Research SEO for the shop')
      expect(job?.taskText).toContain(payload.taskId)
    })
  })

  it('nudges NOTHING for an assistant-created task (no self-nudge loop)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const jobId = consumeTaskCreatedEvent(db, {
        ...makePayload(user.id, workspace.id),
        source: 'assistant',
      })
      expect(jobId).toBeNull()
    })
  })

  it('degrades to the global root for a global task and for a deleted workspace', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())

      for (const workspaceId of [null, randomUUID()]) {
        const jobId = consumeTaskCreatedEvent(db, makePayload(user.id, workspaceId))
        const job = findDelegationJobById(db, jobId!)
        expect(job?.jobKind).toBe('report-delivery')
        expect(job?.workspaceId).toBeNull()
        expect(job?.targetPrimarySessionId).toBeNull()
      }
    })
  })
})
