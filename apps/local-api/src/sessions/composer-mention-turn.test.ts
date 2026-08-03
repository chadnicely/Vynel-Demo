// Integration tests for `prepareComposerMentionTurn` — real SQLite. The
// grammar and resolution have their own suites (contracts / orchestration);
// these prove the TURN-PATH plan: dispatch enqueueing (idempotent, keyed to
// the resolved session), self-reference filtering, the study descriptor, and
// the dispatch note.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createAgent } from '@vynel/agents'
import { claimNextPendingDelegationJob, type DelegationJob } from '@vynel/orchestration'
import type { Database } from '@vynel/db'
import { prepareComposerMentionTurn } from './composer-mention-turn.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

/** Drain every pending job via the exported claim op (repos stay internal). */
function claimAllPendingJobs(db: Database): DelegationJob[] {
  const jobs: DelegationJob[] = []
  for (;;) {
    const claimed = claimNextPendingDelegationJob(db, new Date())
    if (claimed === null) return jobs
    jobs.push(claimed)
  }
}

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string, name: string, managerName: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name,
    managerName,
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('prepareComposerMentionTurn', () => {
  it('returns null for a token-free message (the fast path)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const plan = await prepareComposerMentionTurn(
        db,
        {
          userId: user.id,
          userMessageText: 'no tokens at all',
          originWorkspaceId: null,
          originWorkspacePath: '/tmp/global-root',
        },
        { logger: silentLogger },
      )
      expect(plan).toBeNull()
    })
  })

  it('plans agent + persona dispatches and enqueues them ONCE on session resolve', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const acme = insertWorkspace(db, makeWorkspace(user.id, 'Acme', 'Sarah'))
      await createAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'researcher',
        name: 'Researcher',
        description: 'Researches.',
        prompt: 'You research.',
        source: 'user',
        trustTier: 'community',
      })

      const plan = await prepareComposerMentionTurn(
        db,
        {
          userId: user.id,
          userMessageText: '@researcher and @Sarah, look into pricing',
          originWorkspaceId: null,
          originWorkspacePath: '/tmp/global-root',
          permissionMode: 'ask',
          model: 'claude-haiku-4-5',
          thinkingEffort: 'low',
        },
        { logger: silentLogger },
      )
      expect(plan).not.toBeNull()
      expect(plan!.studyDescriptor).toBeNull()
      expect(plan!.systemPromptAppend).toContain('agent "Researcher" (@researcher)')
      expect(plan!.systemPromptAppend).toContain('Sarah (workspace "Acme")')

      // Nothing is enqueued before the session resolves…
      expect(claimAllPendingJobs(db)).toHaveLength(0)
      plan!.onSessionResolved('origin-sdk-1')
      plan!.onSessionResolved('origin-sdk-1') // …and a second resolve is a no-op.
      const jobs = claimAllPendingJobs(db)
      expect(jobs).toHaveLength(2)

      const agentJob = jobs.find((job) => job.jobKind === 'agent-run')
      expect(agentJob?.agentSlug).toBe('researcher')
      expect(agentJob?.parentSessionId).toBe('origin-sdk-1')
      expect(agentJob?.workspaceId).toBeNull()
      expect(agentJob?.workspacePath).toBe('/tmp/global-root')
      expect(agentJob?.requesterWorkspaceId).toBeNull()
      expect(agentJob?.model).toBe('claude-haiku-4-5')
      // Persona-sessions: a colleague turn is a routed turn — it inherits the
      // originating turn's mode (the retired leaf posture pinned null here).
      expect(agentJob?.permissionMode).toBe('ask')
      // The colleague identity is stamped at enqueue (claim serializes on it).
      expect(agentJob?.targetPrimarySessionId).not.toBeNull()

      const personaJob = jobs.find((job) => (job.jobKind ?? 'task') === 'task')
      expect(personaJob?.workspaceId).toBe(acme.id)
      expect(personaJob?.taskText).toBe('@researcher and @Sarah, look into pricing')
      expect(personaJob?.requesterWorkspaceId).toBeNull() // global origin = global reports
      expect(personaJob?.permissionMode).toBe('ask')
      expect(personaJob?.thinkingEffort).toBe('low')
    })
  })

  it('a WORKSPACE-chat mention stamps the originating workspace as the requester', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const origin = insertWorkspace(db, makeWorkspace(user.id, 'Origin', 'Mark'))
      const target = insertWorkspace(db, makeWorkspace(user.id, 'Target', 'Ava'))

      const plan = await prepareComposerMentionTurn(
        db,
        {
          userId: user.id,
          userMessageText: '@Ava what is the launch status?',
          originWorkspaceId: origin.id,
          originWorkspacePath: origin.path,
        },
        { logger: silentLogger },
      )
      plan!.onSessionResolved('ws-origin-sdk-1')
      const jobs = claimAllPendingJobs(db)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.workspaceId).toBe(target.id)
      expect(jobs[0]!.requesterWorkspaceId).toBe(origin.id)
    })
  })

  it('self-references dissolve: own persona and own # ref plan nothing', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const origin = insertWorkspace(db, makeWorkspace(user.id, 'Origin', 'Mark'))

      const plan = await prepareComposerMentionTurn(
        db,
        {
          userId: user.id,
          userMessageText: '@Mark check #Origin please',
          originWorkspaceId: origin.id,
          originWorkspacePath: origin.path,
        },
        { logger: silentLogger },
      )
      expect(plan).toBeNull()
    })
  })

  it('# refs compose the study descriptor over exactly the referenced workspaces', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      insertWorkspace(db, makeWorkspace(user.id, 'Alpha', 'Mark'))
      insertWorkspace(db, makeWorkspace(user.id, 'Beta', 'Ava'))

      const plan = await prepareComposerMentionTurn(
        db,
        {
          userId: user.id,
          userMessageText: 'compare #Alpha with #Beta',
          originWorkspaceId: null,
          originWorkspacePath: '/tmp/global-root',
        },
        { logger: silentLogger },
      )
      expect(plan!.studyDescriptor?.serverName).toBe('vynel-workspace-study')
      expect(plan!.studyDescriptor?.mutatingToolNames).toEqual([])
      const prompt = plan!.studyDescriptor?.contributePrompt?.({
        db,
        userId: user.id,
        appRequest: () => new Response(null),
      })
      expect(prompt).toContain('"Alpha"')
      expect(prompt).toContain('"Beta"')
      // No @ dispatches → no dispatch note, nothing enqueued on resolve.
      expect(plan!.systemPromptAppend).toBe('')
      plan!.onSessionResolved('sdk-x')
      expect(claimAllPendingJobs(db)).toHaveLength(0)
    })
  })
})
