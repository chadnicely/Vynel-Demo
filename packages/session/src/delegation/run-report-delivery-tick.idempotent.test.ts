// A3c (session-hardening): a RETRIED notify turn must never land its report
// twice. The consumer persists a resumed turn's inbound row before the provider
// starts (durability-first), so a recoverable failure + requeue used to append
// the child's report a second time on the requester's transcript. The delivery
// job now carries a STABLE inbound id (its own job id) and every user-row write
// is find-or-insert by id — attempt two re-uses attempt one's row.
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listChatMessagesForSession, listChatSessionsForWorkspace } from '@vynel/chat/repositories'
import {
  enqueueReportDelivery,
  findDelegationJobById,
  requeueDelegationJob,
} from '@vynel/orchestration'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'

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

/** Attempt one: starts, then errors RECOVERABLY (a 5xx). Attempt two (a resume
 *  of the same session): starts and completes. `inputs` captures both. */
class FailOnceThenCompleteProvider extends FakeAiAgentProvider {
  readonly inputs: StartChatSessionInput[] = []
  override startChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
    this.inputs.push(input)
    const attempt = this.inputs.length
    const sessionId = 'requester-sdk-1'
    async function* events(): AsyncIterable<NormalizedSessionEvent> {
      yield {
        kind: 'session-started',
        sessionId,
        resumedFromExisting: input.resumeSessionId !== undefined,
        startedAt: new Date(),
      }
      if (attempt === 1) {
        yield {
          kind: 'session-errored',
          sessionId,
          errorCode: 'api_error',
          errorMessage: 'API error 500 (fake overload)',
          isRecoverable: true,
          erroredAt: new Date(),
        }
        return
      }
      yield {
        kind: 'text-chunk',
        sessionId,
        messageId: 'a-1',
        textDelta: 'Noted the findings.',
        isFinalChunk: true,
      }
      yield { kind: 'session-completed', sessionId, isNewSession: false, completedAt: new Date() }
    }
    return events()
  }
}

function enqueueWorkspaceDelivery(db: Database, userId: string, workspace: { id: string; path: string }) {
  return enqueueReportDelivery(db, {
    userId,
    reporterSessionId: 'child-sdk-1',
    reporterLabel: 'Research session',
    reportBody: 'The findings: three items.',
    requester: { kind: 'workspace-primary', workspaceId: workspace.id, workspacePath: workspace.path },
  })
}

describe('runReportDeliveryJob — a retried notify turn lands its report exactly once (A3c)', () => {
  it('first attempt fails recoverably after session-started, requeues, second attempt completes → ONE inbound row', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const deliveryId = enqueueWorkspaceDelivery(db, user.id, workspace)
      const provider = new FailOnceThenCompleteProvider()
      const deps = { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() }

      await runDelegationClaimAndRunTick(db, deps)
      const afterFirst = findDelegationJobById(db, deliveryId)!
      expect(afterFirst.status).toBe('pending')
      expect(afterFirst.attemptCount).toBe(1)
      expect(provider.inputs).toHaveLength(1)

      // The backoff would hold the row for 30 s — make it due now, keeping the attempt count.
      requeueDelegationJob(db, deliveryId, {
        errorMessage: afterFirst.errorMessage ?? 'retry',
        errorCode: afterFirst.errorCode ?? null,
        attemptCount: afterFirst.attemptCount ?? 1,
        nextAttemptAt: new Date(0),
      })

      await runDelegationClaimAndRunTick(db, deps)
      const afterSecond = findDelegationJobById(db, deliveryId)!
      expect(afterSecond.status).toBe('completed')
      expect(provider.inputs).toHaveLength(2)
      // Attempt two RESUMED the same requester session — the resumed early
      // write is exactly the path that used to append the report twice.
      expect(provider.inputs[1]!.resumeSessionId).toBe('requester-sdk-1')

      const sessions = listChatSessionsForWorkspace(db, workspace.id, { includeHidden: true })
      const inboundRows = sessions
        .flatMap((session) => listChatMessagesForSession(db, session.id))
        // The inbound row carries the report inside the delivered-report marker.
        .filter((row) => row.role === 'user' && row.body.includes('The findings: three items.'))
      expect(inboundRows).toHaveLength(1)
      // The stable id IS the delivery job's id — the find-or-insert key.
      expect(inboundRows[0]!.id).toBe(deliveryId)
    })
  })
})
