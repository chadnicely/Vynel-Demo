// Integration tests for `enqueueSessionDelegation` (session-library Slice ④) —
// real SQLite. Proves the SESSION-target row shape: exactly one target set
// (targetPrimarySessionId, workspace columns null), workspacePath carrying the
// RUN CWD, and the same pending/correlation contract as the workspace sibling.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { findDelegationJobById } from '../repositories/index.js'
import { enqueueSessionDelegation } from './enqueue-session-delegation.js'

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

describe('enqueueSessionDelegation', () => {
  it('inserts a pending SESSION-target row: exactly one target, run cwd stored, correlation key minted', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const targetPrimarySessionId = randomUUID()

      const jobId = enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        targetPrimarySessionId,
        runCwdPath: '/tmp/vynel/global-root',
        taskText: 'summarize the findings',
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('pending')
      expect(job?.targetPrimarySessionId).toBe(targetPrimarySessionId)
      // Exactly-one-target: the workspace columns are null…
      expect(job?.workspaceId).toBeNull()
      expect(job?.workspaceName).toBeNull()
      // …except workspacePath, which holds the RUN CWD (one column, one reading).
      expect(job?.workspacePath).toBe('/tmp/vynel/global-root')
      expect(job?.taskText).toBe('summarize the findings')
      expect(job?.parentSessionId).toBe('global-sdk-1')
      // The correlation key is minted at enqueue (the trace + stop anchor).
      expect(job?.partialSessionId).not.toBeNull()
      expect(job?.permissionMode).toBeNull()
      // No model/effort picks passed → null (the provider defaults apply).
      expect(job?.model).toBeNull()
      expect(job?.thinkingEffort).toBeNull()
    })
  })

  it('threads origin + permissionMode + the model/effort picks like the workspace sibling', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const jobId = enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        targetPrimarySessionId: randomUUID(),
        runCwdPath: '/tmp/x',
        taskText: 't',
        origin: { channelId: 'ch-1', externalSenderId: 's-1', externalChatContextId: 'ctx-1' },
        permissionMode: 'ask',
        model: 'claude-haiku-4-5',
        thinkingEffort: 'low',
      })
      const job = findDelegationJobById(db, jobId)
      expect(job?.originChannelId).toBe('ch-1')
      expect(job?.originExternalSenderId).toBe('s-1')
      expect(job?.originExternalChatContextId).toBe('ctx-1')
      expect(job?.permissionMode).toBe('ask')
      expect(job?.model).toBe('claude-haiku-4-5')
      expect(job?.thinkingEffort).toBe('low')
    })
  })

  it('rejects an empty target id (a row with NO target must be impossible)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(() =>
        enqueueSessionDelegation(db, {
          userId: user.id,
          parentSessionId: 'global-sdk-1',
          targetPrimarySessionId: '  ',
          runCwdPath: '/tmp/x',
          taskText: 't',
        }),
      ).toThrow(/non-empty/)
    })
  })
})
