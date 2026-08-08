// The DIRECT-DELIVERY variant (kind `direct_to_user`) — real SQLite, end-to-end
// through the tick: a direct row persists the sender's message straight onto
// the global root's transcript under the Message marker with NO notify turn;
// a WORKSPACE requester has no absorb net yet, so it falls back to the notify
// machinery under the DIRECT steer (the manager absorbs without narrating).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { StartChatSessionInput } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, listChatMessagesForSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import {
  enqueueReportDelivery,
  findDelegationJobById,
  claimNextPendingDelegationJob,
} from '@vynel/orchestration'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

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
    managerName: 'Mark',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

async function seedLinkedPrimary(
  db: Database,
  userId: string,
  workspaceId: string | null,
  sdkSessionId: string,
) {
  const primary = await getOrCreatePrimarySession(
    db,
    workspaceId === null ? { userId } : { userId, workspaceId },
  )
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: sdkSessionId,
      userId,
      workspaceId,
      providerId: 'claude',
      startedAt: new Date(),
      title: workspaceId === null ? 'Global brain' : 'Workspace root',
      visibility: 'hidden',
    }),
  )
  linkPrimarySessionToSdkSession(db, { primarySessionId: primary.id, userId, sdkSessionId })
}

describe('direct-delivery jobs (kind direct_to_user)', () => {
  it('a GLOBAL-requester direct row lands on the root transcript under the Message marker — NO notify turn', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await seedLinkedPrimary(db, user.id, null, 'g-root-d1')

      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'james-seg-1',
        reporterLabel: 'James · Claw Launcher',
        reportBody: 'Overview of the agency app\n\nNuxt 4 + Vue 3; seven Pinia stores.',
        requester: { kind: 'global-root' },
        deliverDirectly: true,
      })
      expect(findDelegationJobById(db, jobId)?.jobKind).toBe('direct-delivery')

      let notifyTurns = 0
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async () => {
          notifyTurns += 1
          return { sessionId: 'g-root-d1', resultText: 'narrated' }
        },
      })
      expect(processed).toBe(true)
      expect(notifyTurns).toBe(0)

      const rows = listChatMessagesForSession(db, 'g-root-d1')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.role).toBe('user')
      expect(rows[0]!.sourceKind).toBe('agent')
      expect(rows[0]!.sourceLabel).toBe('James · Claw Launcher')
      // The Message marker (the badge reads "Message"), then the title line —
      // the compact box's teaser IS the title.
      expect(rows[0]!.body.startsWith('[Message from James · Claw Launcher')).toBe(true)
      expect(rows[0]!.body).toContain('Overview of the agency app')
      expect(findDelegationJobById(db, jobId)?.resultText).toBe('delivered directly')
      expect(claimNextPendingDelegationJob(db, new Date(Date.now() + 3_600_000))).toBeNull()
    })
  })

  it('a WORKSPACE-requester direct row falls back to the notify turn under the DIRECT steer + Message marker', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await seedLinkedPrimary(db, user.id, workspace.id, 'ws-primary-d1')

      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'colleague-sdk-1',
        reporterLabel: 'Nova',
        reportBody: 'Schema summary\n\nFour tables, one outbox.',
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
        deliverDirectly: true,
      })

      const notifyInputs: StartChatSessionInput[] = []
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-primary-d1',
          resultText: 'Noted.',
          startChatSessionInputs: notifyInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(processed).toBe(true)
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')

      // The DIRECT steer, never the report or update steer — the manager
      // absorbs a user-addressed message without narrating it.
      expect(notifyInputs[0]!.systemPromptAppend).toContain('DIRECTLY TO THE USER')
      expect(notifyInputs[0]!.systemPromptAppend).not.toContain('This message is a REPORT')

      const messages = listChatMessagesForSession(db, 'ws-primary-d1')
      expect(messages[0]!.role).toBe('user')
      expect(messages[0]!.body.startsWith('[Message from Nova')).toBe(true)
      expect(messages[0]!.body).toContain('Schema summary')
    })
  })
})
