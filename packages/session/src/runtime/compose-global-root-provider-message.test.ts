// Pins the voice-thread catch-up rule (voice-session arc): the root-awareness
// catch-up block belongs to the GLOBAL conversation. The collector is
// user-wide and marks reports surfaced exactly-once — if a VOICE turn absorbed
// it, the injected block would reach the spoken thread and the global chat
// would never see those reports.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import {
  enqueueWorkspaceDelegation,
  completeDelegationJob,
  collectDelegationReportsForRoot,
} from '@vynel/orchestration'
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
  it('a GLOBAL turn absorbs the unseen report and marks it surfaced', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedUnseenReport(db, user.id)

      const providerText = composeGlobalRootProviderMessage(db, {
        userId: user.id,
        userMessageText: 'hello',
      })

      expect(providerText).toContain('Audit done: 3 findings.')
      // Exactly-once: a second compose finds nothing left to surface.
      const remaining = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(remaining.jobIds).toHaveLength(0)
    })
  })

  it('a VOICE turn neither absorbs the report nor marks it — the global chat keeps it', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedUnseenReport(db, user.id)

      const providerText = composeGlobalRootProviderMessage(db, {
        userId: user.id,
        userMessageText: 'check the weather',
        voice: true,
      })

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
