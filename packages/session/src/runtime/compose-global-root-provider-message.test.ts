// Pins the voice-thread catch-up rule (voice-session arc): the root-awareness
// catch-up block belongs to the GLOBAL conversation. The collector is
// user-wide and marks reports surfaced exactly-once — if a VOICE turn absorbed
// it, the injected block would reach the spoken thread and the global chat
// would never see those reports. Also pins the A4 seam: composing NEVER marks
// (the caller marks once the turn is underway) and a continuation never
// re-collects.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import {
  claimNextPendingDelegationJob,
  enqueueWorkspaceDelegation,
  completeDelegationJob,
  collectDelegationReportsForRoot,
} from '@vynel/orchestration'
import { insertPrimarySession } from '../repositories/index.js'
import { markPendingCheckpoint } from '../continuity/index.js'
import { composeGlobalRootProviderMessage } from './compose-global-root-provider-message.js'

function seedUnseenReport(db: Database, userId: string): void {
  const now = new Date()
  const workspace = insertWorkspace(db, {
    id: crypto.randomUUID(),
    userId,
    name: 'Seo',
    kind: 'personal' as const,
    path: `/tmp/vynel/${crypto.randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const jobId = enqueueWorkspaceDelegation(db, {
    userId,
    parentSessionId: 'root-sdk-1',
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText: 'audit the pages',
  })
  // The terminal writers are a CAS on the CLAIM — settle a claimed row.
  claimNextPendingDelegationJob(db, now)
  completeDelegationJob(db, jobId, 'Audit done: 3 findings.', now)
}

function makeUser() {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

describe('composeGlobalRootProviderMessage — the voice-thread catch-up rule', () => {
  it('a GLOBAL turn absorbs the unseen report and hands its job id back — the CALLER marks, never the composer', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedUnseenReport(db, user.id)

      const message = composeGlobalRootProviderMessage(db, {
        userId: user.id,
        userMessageText: 'hello',
      })

      expect(message.providerUserMessageText).toContain('Audit done: 3 findings.')
      expect(message.catchUpJobIds).toHaveLength(1)
      // Still collectable: a compose that never reaches the SDK (a startup
      // failure) must not have consumed the report.
      const remaining = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(remaining.jobIds).toEqual(message.catchUpJobIds)
    })
  })

  it('a CONTINUATION turn never re-collects — the genuine turn under the same lock carried the block', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedUnseenReport(db, user.id)

      const message = composeGlobalRootProviderMessage(db, {
        userId: user.id,
        userMessageText: 'continue where you left off',
        continuation: true,
      })

      expect(message.providerUserMessageText).not.toContain('Audit done: 3 findings.')
      expect(message.catchUpJobIds).toEqual([])
    })
  })

  it('a VOICE turn neither absorbs the report nor marks it — the global chat keeps it', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedUnseenReport(db, user.id)

      const { providerUserMessageText: providerText, catchUpJobIds } =
        composeGlobalRootProviderMessage(db, {
          userId: user.id,
          userMessageText: 'check the weather',
          voice: true,
        })

      expect(catchUpJobIds).toEqual([])
      expect(providerText).not.toContain('Audit done: 3 findings.')
      // Still unseen — the next GLOBAL turn will surface it.
      const remaining = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(remaining.jobIds).toHaveLength(1)
      // The user's own text still leads the spoken turn (the voice marker is
      // appended after it — instruction-file content, not asserted verbatim).
      expect(providerText).toContain('check the weather')
    })
  })
})

// The RESTART SURVIVOR marker (audit r2 R2-H): a checkpoint still pending as a
// GENUINE turn composes is one an earlier turn left, so the model must be told
// it owes that step. Not on a continuation (its own checkpoint is consumed
// before its turn composes) and not on a delivery turn, which never continues.
describe('composeGlobalRootProviderMessage — the survivor marker', () => {
  function seedSurvivor(db: Database, userId: string): string {
    const now = new Date()
    const primary = insertPrimarySession(db, {
      id: crypto.randomUUID(),
      userId,
      workspaceId: null,
      scope: 'global',
      currentSdkSessionId: null,
      supersededFromSdkSessionId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    markPendingCheckpoint(db, primary.id, 'publish the changelog')
    return primary.id
  }

  it('rides the genuine turn once, naming the owed step', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const primarySessionId = seedSurvivor(db, user.id)

      const { providerUserMessageText } = composeGlobalRootProviderMessage(db, {
        userId: user.id,
        userMessageText: 'morning',
        primarySessionId,
      })

      expect(providerUserMessageText).toContain('morning')
      expect(providerUserMessageText).toContain('publish the changelog')
      expect(providerUserMessageText.match(/CHECKPOINT PENDING/g)).toHaveLength(1)
    })
  })

  it('never rides a CONTINUATION or a DELIVERY turn — one is already carrying it, the other never continues', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const primarySessionId = seedSurvivor(db, user.id)

      const continuation = composeGlobalRootProviderMessage(db, {
        userId: user.id,
        userMessageText: 'continue',
        primarySessionId,
        continuation: true,
      })
      const delivery = composeGlobalRootProviderMessage(db, {
        userId: user.id,
        userMessageText: 'a report landed',
        primarySessionId,
        autoContinue: false,
      })

      expect(continuation.providerUserMessageText).not.toContain('CHECKPOINT PENDING')
      expect(delivery.providerUserMessageText).not.toContain('CHECKPOINT PENDING')
    })
  })
})
