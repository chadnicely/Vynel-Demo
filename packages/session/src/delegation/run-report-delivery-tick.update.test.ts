// The UPDATE-DELIVERY variant of the notify machinery (persona-sessions) —
// real SQLite + fake provider, end-to-end through the tick: an update row runs
// the SAME notify turn as a report but under the UPDATE marker + steer, its
// rows carry the chain key, a completed update cascades nothing, and a
// terminally failed update never becomes a give-up push (ephemeral status).

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
  enqueueUpdateDelivery,
  findDelegationJobById,
  claimNextPendingDelegationJob,
} from '@vynel/orchestration'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'
import { settleFailedDelegationAttempt } from './settle-failed-delegation-attempt.js'
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

async function seedLinkedWorkspacePrimary(
  db: Database,
  userId: string,
  workspaceId: string,
  sdkSessionId: string,
) {
  const primary = await getOrCreatePrimarySession(db, { userId, workspaceId })
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: sdkSessionId,
      userId,
      workspaceId,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Workspace root',
      visibility: 'hidden',
    }),
  )
  linkPrimarySessionToSdkSession(db, { primarySessionId: primary.id, userId, sdkSessionId })
}

describe('update-delivery jobs (persona-sessions)', () => {
  it('a WORKSPACE-requester update runs the notify turn under the UPDATE marker + steer, chain key stamped', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await seedLinkedWorkspacePrimary(db, user.id, workspace.id, 'ws-primary-u1')
      const threadId = randomUUID()

      const jobId = enqueueUpdateDelivery(db, {
        threadId,
        userId: user.id,
        reporterSessionId: 'colleague-sdk-1',
        reporterLabel: 'Nova',
        updateBody: 'Received — starting on the schema.',
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
      })

      const notifyInputs: StartChatSessionInput[] = []
      const delivered = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-primary-u1',
          resultText: 'Noted.',
          startChatSessionInputs: notifyInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(delivered).toBe(true)
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')

      // The UPDATE steer, never the report or task steer.
      expect(notifyInputs[0]!.systemPromptAppend).toContain('STATUS UPDATE')
      expect(notifyInputs[0]!.systemPromptAppend).not.toContain('This message is a REPORT')
      expect(notifyInputs[0]!.systemPromptAppend).not.toContain('This task was routed')

      // The inbound row wears the update marker and the CHAIN key.
      const messages = listChatMessagesForSession(db, 'ws-primary-u1')
      expect(messages[0]!.role).toBe('user')
      expect(messages[0]!.body.startsWith('[Update from Nova')).toBe(true)
      expect(messages[0]!.body).toContain('Received — starting on the schema.')
      expect(messages[0]!.threadId).toBe(threadId)
      expect(messages[1]!.threadId).toBe(threadId)

      // Anti-cascade: a completed update enqueues NOTHING further.
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()
    })
  })

  it('a GLOBAL-requester update reaches the injected runner with the update steer + marker', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      enqueueUpdateDelivery(db, {
        userId: user.id,
        reporterSessionId: 'colleague-sdk-2',
        reporterLabel: 'Nova',
        updateBody: 'Halfway through.',
        requester: { kind: 'global-root' },
      })

      const calls: Array<{ reportBody: string; steerInstructions?: string }> = []
      const delivered = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'never used' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          calls.push({
            reportBody: input.reportBody,
            ...(input.steerInstructions !== undefined
              ? { steerInstructions: input.steerInstructions }
              : {}),
          })
          return { sessionId: 'global-notify-sdk', resultText: 'absorbed' }
        },
      })
      expect(delivered).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.reportBody.startsWith('[Update from Nova')).toBe(true)
      expect(calls[0]!.steerInstructions).toContain('STATUS UPDATE')
    })
  })

  it('a terminally failed update NEVER becomes a give-up push (ephemeral status)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      enqueueUpdateDelivery(db, {
        userId: user.id,
        reporterSessionId: 'colleague-sdk-3',
        reporterLabel: 'Nova',
        updateBody: 'Received.',
        requester: { kind: 'global-root' },
      })
      const claimed = claimNextPendingDelegationJob(db, new Date())
      expect(claimed).not.toBeNull()

      settleFailedDelegationAttempt(db, claimed!, 'the requester conversation is corrupt', {
        logger: silentLogger,
        queueLabel: 'update-delivery',
        retryHint: 'never used for a delivery row.',
      })

      expect(findDelegationJobById(db, claimed!.id)?.status).toBe('failed')
      // No push enqueued — the queue is dry.
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()
    })
  })
})
