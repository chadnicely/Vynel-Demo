// The VOICE-requester delivery shape (voice-requester routing, 2026-08-27) —
// real SQLite, end-to-end through the tick: a delivery row addressed at the
// spoken thread's primary runs the injected runner with `thread: 'voice'`
// (never the global shape), a voice DIRECT row persists straight onto the
// VOICE head, and a voice-addressed row with NO live voice thread falls back
// to the global root (the deleted-requester-workspace failover, voice shape).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { insertUser } from '@vynel/db/repositories/users'
import { insertChatSession, listChatMessagesForSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import {
  enqueueReportDelivery,
  findDelegationJobById,
  claimNextPendingDelegationJob,
} from '@vynel/orchestration'
import {
  getOrCreateContinuingSession,
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

/** The spoken thread: its live primary + a linked recorded voice segment. */
async function seedLinkedVoiceThread(db: Database, userId: string, sdkSessionId: string) {
  const voicePrimary = await getOrCreateContinuingSession(db, { userId, scope: 'voice' })
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: sdkSessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Voice conversation',
      visibility: 'hidden',
      scope: 'voice',
    }),
  )
  linkPrimarySessionToSdkSession(db, {
    primarySessionId: voicePrimary.id,
    userId,
    sdkSessionId,
  })
  return voicePrimary
}

describe('voice-requester deliveries', () => {
  it('a voice-addressed report row runs the notify turn with thread voice', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const voicePrimary = await seedLinkedVoiceThread(db, user.id, 'voice-head-1')

      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'ws-root-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'The task you asked for is done.',
        requester: { kind: 'voice', voicePrimarySessionId: voicePrimary.id },
      })

      const runnerInputs: { thread?: string; reportBody: string }[] = []
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          runnerInputs.push({
            ...(input.thread !== undefined ? { thread: input.thread } : {}),
            reportBody: input.reportBody,
          })
          return { sessionId: 'voice-head-1', resultText: 'absorbed' }
        },
      })
      expect(processed).toBe(true)
      expect(runnerInputs).toHaveLength(1)
      expect(runnerInputs[0]!.thread).toBe('voice')
      expect(runnerInputs[0]!.reportBody).toContain('The task you asked for is done.')
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
    })
  })

  it('a voice-addressed DIRECT row runs the notify turn on the voice thread under the DIRECT steer — global untouched', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const voicePrimary = await seedLinkedVoiceThread(db, user.id, 'voice-head-2')
      // A linked GLOBAL root beside it — the row the bug used to land on.
      const globalPrimary = await getOrCreatePrimarySession(db, { userId: user.id })
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'global-head-2',
          userId: user.id,
          workspaceId: null,
          providerId: 'claude',
          startedAt: new Date(),
          title: 'Global brain',
          visibility: 'hidden',
        }),
      )
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: globalPrimary.id,
        userId: user.id,
        sdkSessionId: 'global-head-2',
      })

      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'james-seg-1',
        reporterLabel: 'James',
        reportBody: 'Backlog summary\n\nFour stale items.',
        requester: { kind: 'voice', voicePrimarySessionId: voicePrimary.id },
        deliverDirectly: true,
      })

      // The voice thread has no absorb net (no catch-up runs on it), so a
      // direct answer travels as a NOTIFY turn under the DIRECT steer — the
      // workspace requester's exact fallback shape — never a transcript-only
      // persist the spoken model would stay blind to.
      const runnerInputs: { thread?: string; steerInstructions?: string }[] = []
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          runnerInputs.push({
            ...(input.thread !== undefined ? { thread: input.thread } : {}),
            ...(input.steerInstructions !== undefined
              ? { steerInstructions: input.steerInstructions }
              : {}),
          })
          return { sessionId: 'voice-head-2', resultText: 'absorbed' }
        },
      })
      expect(processed).toBe(true)
      expect(runnerInputs).toHaveLength(1)
      expect(runnerInputs[0]!.thread).toBe('voice')
      expect(runnerInputs[0]!.steerInstructions).toContain('DIRECTLY TO THE USER')

      // Nothing persisted outside the runner, and nothing on the global head.
      expect(listChatMessagesForSession(db, 'voice-head-2')).toHaveLength(0)
      expect(listChatMessagesForSession(db, 'global-head-2')).toHaveLength(0)
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
      expect(claimNextPendingDelegationJob(db, new Date(Date.now() + 3_600_000))).toBeNull()
    })
  })

  it('a voice-addressed row with NO live voice thread falls back to the global notify shape', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())

      const jobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'ws-root-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Orphaned voice address.',
        requester: { kind: 'voice', voicePrimarySessionId: randomUUID() },
      })

      const runnerInputs: { thread?: string }[] = []
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          runnerInputs.push(input.thread !== undefined ? { thread: input.thread } : {})
          return { sessionId: 'global-head-x', resultText: 'absorbed' }
        },
      })
      expect(processed).toBe(true)
      expect(runnerInputs).toHaveLength(1)
      expect(runnerInputs[0]!.thread).toBeUndefined()
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
    })
  })
})
