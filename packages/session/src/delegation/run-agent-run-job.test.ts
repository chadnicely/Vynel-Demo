// Integration tests for the 'agent-run' queue branch (chat-mentions) — real
// SQLite, fake provider, end-to-end through `runDelegationClaimAndRunTick`:
// enqueue an agent run → the tick runs the mentioned agent as a FRESH leaf →
// completion co-commits the result report for the ORIGINATING chat → a later
// tick delivers it as the notify turn's attributed inbound.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { StartChatSessionInput } from '@vynel/providers'
import { composeReportMessageMarker } from '@vynel/contracts/chat/report-message-marker'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findChatSessionById,
  listChatMessagesForSession,
  insertChatSession,
} from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { createAgent } from '@vynel/agents'
import {
  enqueueAgentRun,
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

async function setUpWorkspacePrimary(
  db: Database,
  userId: string,
  workspaceId: string,
): Promise<string> {
  const primary = await getOrCreatePrimarySession(db, { userId, workspaceId })
  const sdkSessionId = `ws-primary-${randomUUID()}`
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
  return sdkSessionId
}

async function makeReviewerAgent(db: Database, userId: string) {
  return createAgent(db, {
    userId,
    workspaceId: null,
    slug: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Reviews code.',
    prompt: 'You review code carefully.',
    source: 'user',
    trustTier: 'community',
  })
}

describe('agent-run jobs (chat-mentions)', () => {
  it('runs the leaf, records it, and delivers the result to the ORIGINATING workspace chat', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const wsPrimarySdkId = await setUpWorkspacePrimary(db, user.id, workspace.id)
      await makeReviewerAgent(db, user.id)

      const jobId = enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: wsPrimarySdkId,
        agentSlug: 'code-reviewer',
        agentName: 'Code Reviewer',
        taskText: '@code-reviewer look at the latest diff',
        workspaceId: workspace.id,
        runCwdPath: workspace.path,
        requesterWorkspaceId: workspace.id,
      })

      // Tick 1: the leaf run. The pool key must be the JOB id — a leaf holds
      // no conversation, so it must never reserve the workspace's slot.
      const leafInputs: StartChatSessionInput[] = []
      const runKeys: string[] = []
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'leaf-sdk-1',
          resultText: 'Reviewed the diff: 3 issues found.',
          startChatSessionInputs: leafInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        onRunStarted: ({ targetKey }) => runKeys.push(targetKey),
      })
      expect(processed).toBe(true)
      expect(runKeys).toEqual([jobId])

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('completed')
      expect(job?.resultText).toBe('Reviewed the diff: 3 issues found.')
      expect(job?.surfacedToRootAt).not.toBeNull()

      // The leaf ran FRESH with the agent's prompt, in the workspace cwd.
      expect(leafInputs[0]!.resumeSessionId).toBeUndefined()
      expect(leafInputs[0]!.workspacePath).toBe(workspace.path)
      expect(leafInputs[0]!.systemPromptAppend).toBe('You review code carefully.')
      expect(leafInputs[0]!.userMessageText).toBe('@code-reviewer look at the latest diff')
      // …and was recorded as a hidden agent-scope chat segment.
      const leafSession = findChatSessionById(db, 'leaf-sdk-1')
      expect(leafSession?.scope).toBe('agent')
      expect(leafSession?.visibility).toBe('hidden')

      // Tick 2: the co-committed report-delivery lands the result as the
      // notify turn's attributed inbound ON THE ORIGINATING workspace chat.
      const notifyInputs: StartChatSessionInput[] = []
      const delivered = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: wsPrimarySdkId,
          resultText: 'Thanks — folding the review in.',
          startChatSessionInputs: notifyInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(delivered).toBe(true)
      expect(notifyInputs[0]!.resumeSessionId).toBe(wsPrimarySdkId)

      const messages = listChatMessagesForSession(db, wsPrimarySdkId)
      expect(messages.map((m) => [m.role, m.sourceLabel])).toEqual([
        ['user', 'Code Reviewer'],
        ['assistant', 'Mark · Acme'],
      ])
      expect(messages[0]!.body).toBe(
        `${composeReportMessageMarker('Code Reviewer')}\n\nReviewed the diff: 3 issues found.`,
      )
    })
  })

  it('a GLOBAL-chat mention delivers through the injected global notify runner', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await makeReviewerAgent(db, user.id)

      enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'root-sdk-1',
        agentSlug: 'code-reviewer',
        agentName: 'Code Reviewer',
        taskText: '@code-reviewer summarize the repo',
        workspaceId: null,
        runCwdPath: '/tmp/vynel/global-root',
      })

      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'leaf-sdk-2',
          resultText: 'The repo is a monorepo with 30 packages.',
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })

      // The delivery row targets the GLOBAL root (no workspace columns) and
      // reaches the injected runner on the next tick.
      const reportCalls: Array<{ reportBody: string; sourceLabel: string }> = []
      const delivered = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'never used' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          reportCalls.push({ reportBody: input.reportBody, sourceLabel: input.sourceLabel })
          return { sessionId: 'global-notify-sdk', resultText: 'absorbed' }
        },
      })
      expect(delivered).toBe(true)
      expect(reportCalls).toHaveLength(1)
      expect(reportCalls[0]!.sourceLabel).toBe('Code Reviewer')
      expect(reportCalls[0]!.reportBody).toContain('The repo is a monorepo with 30 packages.')
    })
  })

  it('an unknown agent fails terminally and pushes the failure to the originating chat', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'origin-sdk',
        agentSlug: 'ghost-agent',
        agentName: 'Ghost',
        taskText: '@ghost-agent do things',
        workspaceId: workspace.id,
        runCwdPath: workspace.path,
        requesterWorkspaceId: workspace.id,
      })

      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unreachable' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(processed).toBe(true)
      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('failed')
      expect(job?.errorMessage).toContain('ghost-agent')

      // The give-up push targets the ORIGINATING workspace's primary — not
      // the global root — and tells the user how to retry.
      const push = claimNextPendingDelegationJob(db, new Date())
      expect(push?.jobKind).toBe('report-delivery')
      expect(push?.workspaceId).toBe(workspace.id)
      expect(push?.taskText).toContain('failed')
      expect(push?.taskText).toContain('@ghost-agent')
    })
  })

  it('a silent leaf still completes and delivers an honest stub report', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await makeReviewerAgent(db, user.id)

      const jobId = enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'root-sdk-1',
        agentSlug: 'code-reviewer',
        agentName: 'Code Reviewer',
        taskText: '@code-reviewer ping',
        workspaceId: null,
        runCwdPath: '/tmp/vynel/global-root',
      })

      await runDelegationClaimAndRunTick(db, {
        // No resultText — the leaf drain captures an empty result.
        provider: new FakeAiAgentProvider({ seededSessionId: 'leaf-sdk-3' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')

      const delivery = claimNextPendingDelegationJob(db, new Date())
      expect(delivery?.jobKind).toBe('report-delivery')
      expect(delivery?.taskText).toContain('without producing a text result')
    })
  })
})
