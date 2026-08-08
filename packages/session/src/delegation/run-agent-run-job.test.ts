// Integration tests for the 'agent-run' queue branch (persona-sessions) — real
// SQLite, fake provider, end-to-end through `runDelegationClaimAndRunTick`:
// a `@agent` mention resumes that agent's COLLEAGUE session. The leaf-era
// deterministic result→report harvest is RETIRED — a completed colleague turn
// enqueues NOTHING (its spoken send_message is the only report path); the
// give-up failure push is the one deterministic delivery that remains.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { StartChatSessionInput } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById, listChatMessagesForSession } from '@vynel/chat/repositories'
import { createAgent } from '@vynel/agents'
import {
  enqueueAgentRun,
  findDelegationJobById,
  claimNextPendingDelegationJob,
} from '@vynel/orchestration'
import { getOrCreateContinuingSession } from '../continuity/index.js'
import { findPrimarySessionById } from '../repositories/index.js'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { ROUTED_TASK_INSTRUCTIONS } from './routed-turn-provider-input.js'

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

describe('agent-run jobs (persona-sessions)', () => {
  it('a WORKSPACE mention runs the colleague turn — serialized on the colleague, NO harvest', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await makeReviewerAgent(db, user.id)
      const colleague = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: 'code-reviewer',
      })

      const jobId = enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'ws-primary-sdk',
        agentSlug: 'code-reviewer',
        agentName: 'Code Reviewer',
        taskText: '@code-reviewer look at the latest diff',
        workspaceId: workspace.id,
        runCwdPath: workspace.path,
        targetPrimarySessionId: colleague.id,
        requesterWorkspaceId: workspace.id,
      })

      // The pool key is the COLLEAGUE primary — two mentions serialize FIFO.
      const turnInputs: StartChatSessionInput[] = []
      const runKeys: string[] = []
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'colleague-sdk-1',
          resultText: 'Reviewed the diff: 3 issues found.',
          startChatSessionInputs: turnInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        onRunStarted: ({ targetKey }) => runKeys.push(targetKey),
      })
      expect(processed).toBe(true)
      expect(runKeys).toEqual([colleague.id])

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('completed')
      expect(job?.resultText).toBe('Reviewed the diff: 3 issues found.')
      // test: correct expectation — the direct-reply tweak: mention runs complete
      // UNSURFACED so the catch-up net is how the root learns of the reply it
      // never narrated (absorbed on the next root turn, marked surfaced there).
      expect(job?.surfacedToRootAt).toBeNull()

      // The colleague turn ran fresh with the EVERY-TURN persona + steer.
      expect(turnInputs[0]!.resumeSessionId).toBeUndefined()
      expect(turnInputs[0]!.workspacePath).toBe(workspace.path)
      expect(turnInputs[0]!.systemPromptAppend).toContain('You are "Code Reviewer"')
      expect(turnInputs[0]!.systemPromptAppend).toContain('You review code carefully.')
      expect(turnInputs[0]!.systemPromptAppend).toContain(ROUTED_TASK_INSTRUCTIONS)

      // The identity segment: LISTED, scope 'agent', named, filed under the
      // grounding workspace — a durable coworker, not a hidden leaf.
      const segment = findChatSessionById(db, 'colleague-sdk-1')
      expect(segment?.scope).toBe('agent')
      expect(segment?.visibility).toBe('listed')
      expect(segment?.title).toBe('Code Reviewer')
      expect(segment?.workspaceId).toBe(workspace.id)

      // The transcript persisted with persona attribution (leaf gap closed).
      // test: correct expectation — a mention is the USER speaking directly
      // (redesign Case 3): inbound = 'user' + the origin scope's label, was
      // 'workspace-manager' relay attribution.
      const messages = listChatMessagesForSession(db, 'colleague-sdk-1')
      expect(messages.map((m) => [m.role, m.sourceKind, m.sourceLabel])).toEqual([
        ['user', 'user', 'Acme'],
        ['assistant', 'agent', 'Code Reviewer'],
      ])

      // Linked for the next mention.
      expect(findPrimarySessionById(db, colleague.id)?.currentSdkSessionId).toBe('colleague-sdk-1')

      // THE RETIREMENT: a completed colleague turn enqueues NO delivery — its
      // spoken send_message is the only report path.
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()
    })
  })

  it('a GLOBAL mention heals a legacy unstamped row and the SECOND mention resumes the colleague', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await makeReviewerAgent(db, user.id)

      // Legacy shape: no targetPrimarySessionId stamped — the tick get-or-creates.
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
          seededSessionId: 'colleague-sdk-g1',
          resultText: 'It is a monorepo with 30 packages.',
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })

      const colleague = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        scopeRef: 'code-reviewer',
      })
      expect(colleague.currentSdkSessionId).toBe('colleague-sdk-g1')

      // Second mention — stamped now — RESUMES the same conversation.
      enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'root-sdk-2',
        agentSlug: 'code-reviewer',
        agentName: 'Code Reviewer',
        taskText: '@code-reviewer and how many apps?',
        workspaceId: null,
        runCwdPath: '/tmp/vynel/global-root',
        targetPrimarySessionId: colleague.id,
      })
      const secondInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'colleague-sdk-g1',
          resultText: 'Seven apps.',
          startChatSessionInputs: secondInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(secondInputs[0]!.resumeSessionId).toBe('colleague-sdk-g1')

      // Both exchanges on the ONE listed transcript — memory accumulates.
      expect(listChatMessagesForSession(db, 'colleague-sdk-g1')).toHaveLength(4)
      // test: correct expectation — the global-grounded inbound is the USER
      // speaking directly, labeled from Global (redesign Case 3); was a
      // 'global-root' relay stamp.
      const messages = listChatMessagesForSession(db, 'colleague-sdk-g1')
      expect(messages[0]!.sourceKind).toBe('user')
      expect(messages[0]!.sourceLabel).toBe('Global')
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

  it('a SILENT completed colleague turn also enqueues nothing (the chip settles; status answers)', async () => {
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
        // No resultText — the colleague said nothing in chat text.
        provider: new FakeAiAgentProvider({ seededSessionId: 'colleague-sdk-s1' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('completed')
      // test: correct expectation — direct-reply tweak: unsurfaced until absorbed.
      expect(job?.surfacedToRootAt).toBeNull()
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()
    })
  })
})
