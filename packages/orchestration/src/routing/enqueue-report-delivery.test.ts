// Integration tests for `enqueueReportDelivery` (session-comms, the revert
// flow) — real SQLite. Proves the report-delivery row shape for BOTH requester
// kinds, the adjusted target invariant (both targets null is permitted for kind
// 'report-delivery' ONLY — the global root), and that the task enqueue ops
// keep writing a NULL jobKind (legacy NULL = 'task', the additive-migration
// contract).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findDelegationJobById } from '../repositories/index.js'
import { enqueueWorkspaceDelegation } from './enqueue-workspace-delegation.js'
import { enqueueSessionDelegation } from './enqueue-session-delegation.js'
import { enqueueReportDelivery } from './enqueue-report-delivery.js'

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

describe('enqueueReportDelivery', () => {
  it('a GLOBAL-ROOT requester writes the only permitted no-target row: both targets null + kind report-delivery', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())

      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'ws-root-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'All docs are current.',
        requester: { kind: 'global-root' },
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('pending')
      expect(job?.jobKind).toBe('report-delivery')
      // The global root = BOTH targets null (permitted for this kind only).
      expect(job?.workspaceId).toBeNull()
      expect(job?.targetPrimarySessionId).toBeNull()
      expect(job?.workspacePath).toBeNull()
      // Column reuse: the report body rides taskText, the CHILD's label rides
      // workspaceName, the reporter's sdk session rides parentSessionId.
      expect(job?.taskText).toBe('All docs are current.')
      expect(job?.workspaceName).toBe('Mark · Acme')
      expect(job?.parentSessionId).toBe('ws-root-sdk-1')
      // Its own fresh trace key; no origin/mode/model columns ever set.
      expect(job?.partialSessionId).not.toBeNull()
      expect(job?.originChannelId).toBeNull()
      expect(job?.permissionMode).toBeNull()
      expect(job?.model).toBeNull()
    })
  })

  it('a WORKSPACE-PRIMARY requester targets that workspace + stores its path as the run cwd', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'spawned-sdk-1',
        reporterLabel: 'Acme research',
        reportBody: 'Backlog has 4 stale items.',
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.jobKind).toBe('report-delivery')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.workspacePath).toBe(workspace.path)
      expect(job?.targetPrimarySessionId).toBeNull()
      expect(job?.workspaceName).toBe('Acme research')
      expect(job?.taskText).toBe('Backlog has 4 stale items.')
    })
  })

  it('rejects an empty report body and an empty reporter session id (fail fast at the boundary)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(() =>
        enqueueReportDelivery(db, {
          userId: user.id,
          reporterSessionId: 'sdk-1',
          reporterLabel: 'S',
          reportBody: '   ',
          requester: { kind: 'global-root' },
        }),
      ).toThrow(/non-empty/)
      expect(() =>
        enqueueReportDelivery(db, {
          userId: user.id,
          reporterSessionId: '  ',
          reporterLabel: 'S',
          reportBody: 'r',
          requester: { kind: 'global-root' },
        }),
      ).toThrow(/non-empty/)
    })
  })

  it('deliverDirectly flips the row to kind direct-delivery (the direct_to_user door); default stays report-delivery', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const directId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 's-1',
        reporterLabel: 'James',
        reportBody: 'Title\n\nBody',
        requester: { kind: 'global-root' },
        deliverDirectly: true,
      })
      const plainId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 's-1',
        reporterLabel: 'James',
        reportBody: 'r',
        requester: { kind: 'global-root' },
      })
      expect(findDelegationJobById(db, directId)?.jobKind).toBe('direct-delivery')
      expect(findDelegationJobById(db, plainId)?.jobKind).toBe('report-delivery')
    })
  })

  it('the TASK enqueue ops keep writing a NULL jobKind (legacy NULL = task — the additive-migration pin)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const workspaceJobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 't',
      })
      const sessionJobId = enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-1',
        targetPrimarySessionId: randomUUID(),
        runCwdPath: '/tmp/x',
        taskText: 't',
      })
      expect(findDelegationJobById(db, workspaceJobId)?.jobKind).toBeNull()
      expect(findDelegationJobById(db, sessionJobId)?.jobKind).toBeNull()
    })
  })
})
