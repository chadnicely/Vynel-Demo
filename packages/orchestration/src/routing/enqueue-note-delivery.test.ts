// Integration tests for `enqueueNoteDelivery` (session-comms, the lateral
// kind) — real SQLite. Proves the NOTE row shape: jobKind 'note', task-style
// target columns (exactly one target), the sender riding the reused columns
// (label in workspaceName, session in parentSessionId, workspace in
// requesterWorkspaceId), and that the tracking views never see it.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findDelegationJobById,
  listInFlightDelegationsForUser,
  listRecentDelegationJobsForUser,
} from '../repositories/index.js'
import { enqueueNoteDelivery } from './enqueue-note-delivery.js'

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

function makeWorkspace(userId: string, name = 'Acme') {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('enqueueNoteDelivery', () => {
  it('inserts a pending SESSION-target note: kind "note", sender on the reused columns', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const targetPrimarySessionId = randomUUID()

      const jobId = enqueueNoteDelivery(db, {
        userId: user.id,
        senderSessionId: 'sender-sdk-1',
        senderLabel: 'Research: pricing',
        senderWorkspaceId: workspace.id,
        target: { kind: 'session', targetPrimarySessionId, runCwdPath: '/tmp/vynel/global-root' },
        noteBody: '[Note from Research: pricing]\n\nDone with the pricing pass.',
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('pending')
      expect(job?.jobKind).toBe('note')
      expect(job?.targetPrimarySessionId).toBe(targetPrimarySessionId)
      expect(job?.workspaceId).toBeNull()
      expect(job?.workspacePath).toBe('/tmp/vynel/global-root')
      // The reused columns carry the SENDER (the delivery-row reading).
      expect(job?.workspaceName).toBe('Research: pricing')
      expect(job?.parentSessionId).toBe('sender-sdk-1')
      expect(job?.requesterWorkspaceId).toBe(workspace.id)
      expect(job?.taskText).toContain('Done with the pricing pass.')
      // Never work: no model/effort, no origin, its own thread when none rides.
      expect(job?.model).toBeNull()
      expect(job?.originChannelId).toBeNull()
      expect(job?.threadId).not.toBeNull()
    })
  })

  it('inserts a WORKSPACE-target note; a global sender records no workspace', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueNoteDelivery(db, {
        userId: user.id,
        senderSessionId: 'global-sdk-1',
        senderLabel: 'Global',
        target: { kind: 'workspace', workspaceId: workspace.id, workspacePath: workspace.path },
        noteBody: '[Note from Global]\n\nheads up',
        threadId: 'thread-1',
        permissionMode: 'ask',
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.jobKind).toBe('note')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.workspacePath).toBe(workspace.path)
      expect(job?.targetPrimarySessionId).toBeNull()
      expect(job?.requesterWorkspaceId).toBeNull()
      expect(job?.threadId).toBe('thread-1')
      expect(job?.permissionMode).toBe('ask')
    })
  })

  it('a note is invisible to every tracking view (background runs, in-flight)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      enqueueNoteDelivery(db, {
        userId: user.id,
        senderSessionId: 'global-sdk-1',
        senderLabel: 'Global',
        target: { kind: 'workspace', workspaceId: workspace.id, workspacePath: workspace.path },
        noteBody: '[Note from Global]\n\nheads up',
      })

      expect(listRecentDelegationJobsForUser(db, user.id)).toEqual([])
      expect(listInFlightDelegationsForUser(db, user.id)).toEqual([])
    })
  })

  it('rejects an empty session target id (a row with NO target must be impossible)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(() =>
        enqueueNoteDelivery(db, {
          userId: user.id,
          senderSessionId: 's-1',
          senderLabel: 'X',
          target: { kind: 'session', targetPrimarySessionId: '  ', runCwdPath: '/tmp/x' },
          noteBody: 'n',
        }),
      ).toThrow(/non-empty/)
    })
  })
})
