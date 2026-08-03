// Integration tests for `enqueueUpdateDelivery` (persona-sessions) — real
// SQLite. Proves the update-delivery row shape (the report-delivery invariant,
// new kind), the PENDING coalesce (one in-flight update per user+target+thread,
// body replaced IN PLACE keeping queue position + trace key), the
// claimed-row escape (a spoken update is never rewritten), and that the shared
// GLOBAL_ROOT_DELIVERY_TARGET_KEY gates update rows at claim time exactly like
// report rows.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  claimNextPendingDelegationJob,
  findDelegationJobById,
  GLOBAL_ROOT_DELIVERY_TARGET_KEY,
} from '../repositories/index.js'
import { enqueueUpdateDelivery } from './enqueue-update-delivery.js'

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

describe('enqueueUpdateDelivery', () => {
  it('writes an update-delivery row with the report-delivery target invariant', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())

      const jobId = enqueueUpdateDelivery(db, {
        userId: user.id,
        reporterSessionId: 'ws-root-sdk-1',
        reporterLabel: 'Mark · Acme',
        updateBody: 'Received — will report when done.',
        requester: { kind: 'global-root' },
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('pending')
      expect(job?.jobKind).toBe('update-delivery')
      expect(job?.workspaceId).toBeNull()
      expect(job?.targetPrimarySessionId).toBeNull()
      expect(job?.taskText).toBe('Received — will report when done.')
      expect(job?.workspaceName).toBe('Mark · Acme')
      expect(job?.parentSessionId).toBe('ws-root-sdk-1')
      expect(job?.partialSessionId).not.toBeNull()
      expect(job?.threadId).not.toBeNull()
    })
  })

  it('a WORKSPACE-PRIMARY requester targets that workspace with its path as run cwd', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueUpdateDelivery(db, {
        userId: user.id,
        reporterSessionId: 'spawned-sdk-1',
        reporterLabel: 'Email research',
        updateBody: 'Halfway through the provider comparison.',
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.jobKind).toBe('update-delivery')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.workspacePath).toBe(workspace.path)
      expect(job?.targetPrimarySessionId).toBeNull()
    })
  })

  it('COALESCES while pending: same (user, target, thread) replaces the body in place', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const threadId = randomUUID()
      const early = new Date('2026-01-01T00:00:00Z')
      const late = new Date('2026-01-01T00:00:05Z')

      const firstId = enqueueUpdateDelivery(
        db,
        {
          threadId,
          userId: user.id,
          reporterSessionId: 'sdk-1',
          reporterLabel: 'Mark · Acme',
          updateBody: 'Received the task.',
          requester: { kind: 'global-root' },
        },
        { now: () => early },
      )
      const first = findDelegationJobById(db, firstId)

      const secondId = enqueueUpdateDelivery(
        db,
        {
          threadId,
          userId: user.id,
          reporterSessionId: 'sdk-1b',
          reporterLabel: 'Mark · Acme',
          updateBody: 'Started on the schema.',
          requester: { kind: 'global-root' },
        },
        { now: () => late },
      )

      // Same row: newer body + provenance, ORIGINAL queue position + trace key.
      expect(secondId).toBe(firstId)
      const coalesced = findDelegationJobById(db, firstId)
      expect(coalesced?.taskText).toBe('Started on the schema.')
      expect(coalesced?.parentSessionId).toBe('sdk-1b')
      expect(coalesced?.createdAt).toEqual(first?.createdAt)
      expect(coalesced?.partialSessionId).toBe(first?.partialSessionId)
    })
  })

  it('does NOT coalesce across threads or across requester targets', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const threadId = randomUUID()

      const globalId = enqueueUpdateDelivery(db, {
        threadId,
        userId: user.id,
        reporterSessionId: 'sdk-1',
        reporterLabel: 'S',
        updateBody: 'u1',
        requester: { kind: 'global-root' },
      })
      const otherThreadId = enqueueUpdateDelivery(db, {
        threadId: randomUUID(),
        userId: user.id,
        reporterSessionId: 'sdk-1',
        reporterLabel: 'S',
        updateBody: 'u2',
        requester: { kind: 'global-root' },
      })
      const workspaceTargetId = enqueueUpdateDelivery(db, {
        threadId,
        userId: user.id,
        reporterSessionId: 'sdk-1',
        reporterLabel: 'S',
        updateBody: 'u3',
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
      })

      expect(new Set([globalId, otherThreadId, workspaceTargetId]).size).toBe(3)
    })
  })

  it('a CLAIMED update is never rewritten — the next update becomes a fresh row behind it', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const threadId = randomUUID()

      const firstId = enqueueUpdateDelivery(db, {
        threadId,
        userId: user.id,
        reporterSessionId: 'sdk-1',
        reporterLabel: 'S',
        updateBody: 'Received.',
        requester: { kind: 'global-root' },
      })
      const claimed = claimNextPendingDelegationJob(db, new Date())
      expect(claimed?.id).toBe(firstId)

      const secondId = enqueueUpdateDelivery(db, {
        threadId,
        userId: user.id,
        reporterSessionId: 'sdk-1',
        reporterLabel: 'S',
        updateBody: 'Progress: halfway.',
        requester: { kind: 'global-root' },
      })

      expect(secondId).not.toBe(firstId)
      expect(findDelegationJobById(db, firstId)?.taskText).toBe('Received.')
      expect(findDelegationJobById(db, secondId)?.status).toBe('pending')
    })
  })

  it('the shared GLOBAL key gates a both-null update row at claim time, like a report row', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      enqueueUpdateDelivery(db, {
        userId: user.id,
        reporterSessionId: 'sdk-1',
        reporterLabel: 'S',
        updateBody: 'global-bound update',
        requester: { kind: 'global-root' },
      })

      // Key busy → the both-null update row is invisible to the claim.
      expect(
        claimNextPendingDelegationJob(db, new Date(), {
          excludeTargetKeys: [GLOBAL_ROOT_DELIVERY_TARGET_KEY],
        }),
      ).toBeNull()

      // A WORKSPACE-target update row claims alongside a busy global key.
      const workspaceBoundId = enqueueUpdateDelivery(db, {
        userId: user.id,
        reporterSessionId: 'sdk-2',
        reporterLabel: 'S',
        updateBody: 'workspace-bound update',
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
      })
      const claimed = claimNextPendingDelegationJob(db, new Date(), {
        excludeTargetKeys: [GLOBAL_ROOT_DELIVERY_TARGET_KEY],
      })
      expect(claimed?.id).toBe(workspaceBoundId)
    })
  })

  it('rejects an empty update body and an empty reporter session id', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(() =>
        enqueueUpdateDelivery(db, {
          userId: user.id,
          reporterSessionId: 'sdk-1',
          reporterLabel: 'S',
          updateBody: '   ',
          requester: { kind: 'global-root' },
        }),
      ).toThrow(/non-empty/)
      expect(() =>
        enqueueUpdateDelivery(db, {
          userId: user.id,
          reporterSessionId: ' ',
          reporterLabel: 'S',
          updateBody: 'u',
          requester: { kind: 'global-root' },
        }),
      ).toThrow(/non-empty/)
    })
  })
})
