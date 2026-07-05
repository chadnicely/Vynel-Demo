// Test for `enqueueWorkspaceDelegation` — real SQLite. Verifies the pending job
// round-trips every input field, mints the partialSessionId correlation key (Ch2),
// nulls the lifecycle columns, and that distinct enqueues produce distinct ids.
// `userId` + `workspaceId` need real FK parents (cascade refs); `parentSessionId`
// is a LOOSE text ref, so any string works (no chat_sessions row needed). FK-parent
// fixtures copy the makeUser/makeWorkspace precedent from
// chat/record-delegated-root-messages.test.ts.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findDelegationJobById } from '../repositories/index.js'
import { enqueueWorkspaceDelegation } from './enqueue-workspace-delegation.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('enqueueWorkspaceDelegation', () => {
  it('enqueues a pending job that round-trips every input field, mints the trace key, nulls the rest', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-root-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize this week’s notes',
      })

      expect(typeof jobId).toBe('string')
      expect(jobId.length).toBeGreaterThan(0)

      const job = findDelegationJobById(db, jobId)
      expect(job).not.toBeNull()
      expect(job!.id).toBe(jobId)
      expect(job!.userId).toBe(user.id)
      expect(job!.parentSessionId).toBe('global-root-1')
      expect(job!.workspaceId).toBe(workspace.id)
      expect(job!.workspacePath).toBe(workspace.path)
      expect(job!.workspaceName).toBe('Acme')
      expect(job!.taskText).toBe('summarize this week’s notes')
      expect(job!.status).toBe('pending')
      expect(job!.createdAt).toBeInstanceOf(Date)

      // Ch2: the correlation key is MINTED at enqueue — a non-empty string, distinct
      // from the job id (the job is the queue row; this is the trace key).
      expect(typeof job!.partialSessionId).toBe('string')
      expect(job!.partialSessionId!.length).toBeGreaterThan(0)
      expect(job!.partialSessionId).not.toBe(jobId)

      expect(job!.claimedAt).toBeNull()
      expect(job!.completedAt).toBeNull()
      expect(job!.resultText).toBeNull()
      expect(job!.errorMessage).toBeNull()

      // Ch4: no origin passed → the origin columns are null (a web/voice non-channel origin).
      expect(job!.originChannelId).toBeNull()
      expect(job!.originExternalSenderId).toBeNull()
      expect(job!.originExternalChatContextId).toBeNull()

      // Surface-up step 1: no mode passed → null (the runner's bypass default applies).
      expect(job!.permissionMode).toBeNull()
    })
  })

  it('stores the delegating turn’s permission mode when given (surface-up step 1)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-root-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'tidy the notes',
        permissionMode: 'ask',
      })

      expect(findDelegationJobById(db, jobId)!.permissionMode).toBe('ask')
    })
  })

  it('stamps the origin channel onto the job when a channel drove the delegation (Ch4)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-root-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
        origin: { channelId: 'chan-1', externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
      })

      const job = findDelegationJobById(db, jobId)!
      expect(job.originChannelId).toBe('chan-1')
      expect(job.originExternalSenderId).toBe('tg-42')
      expect(job.originExternalChatContextId).toBe('chat-7')
    })
  })

  it('produces a distinct id per enqueue, both pending', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const firstId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-root-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'check the logs',
      })
      const secondId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-root-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'draft the changelog',
      })

      expect(firstId).not.toBe(secondId)
      expect(findDelegationJobById(db, firstId)!.status).toBe('pending')
      expect(findDelegationJobById(db, secondId)!.status).toBe('pending')
    })
  })
})
