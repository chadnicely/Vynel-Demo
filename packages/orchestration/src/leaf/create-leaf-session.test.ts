// S2 fold-in (build brief Slice 3b+4 §2.7): locks the SHIPPED 3a `createLeafSession`
// contract with a fake provider BEFORE routing wires it live. Real SQLite (the agent
// row is resolved from the DB); the provider is faked at the SDK boundary.
//
// The non-negotiable assertion: the leaf ALWAYS spawns under
// `permissionMode: 'bypass-with-behavior-gate'` so the PreToolUse + canUseTool
// safety backstop cards every irreversible leaf tool, regardless of the agent's own
// permission mode (`.claude/docs/agent-base/root-session-architecture.md §11`).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createAgent } from '@vynel/agents'
import type { StartChatSessionInput } from '@vynel/providers'
import { createLeafSession } from './create-leaf-session.js'
import { makeFakeLeafProvider, type CapturedApprovalResponse } from '../test-support/fake-leaf-provider.js'

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
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('createLeafSession', () => {
  it('resolves the agent, spawns a leaf under the behavior-gate backstop, and returns the reference + clean result', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, {
        userId: user.id,
        workspaceId: workspace.id,
        slug: 'researcher',
        name: 'Researcher',
        description: 'Researches topics.',
        prompt: 'You research.',
        source: 'user',
        trustTier: 'community',
        allowedTools: ['Read', 'Grep'],
      })
      const captured: StartChatSessionInput[] = []
      const provider = makeFakeLeafProvider(
        { sessionId: 'leaf-sdk-1', resultText: 'The report.' },
        captured,
      )

      const result = await createLeafSession(db, provider, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: '/ws/a',
        agentSlug: 'researcher',
        taskText: 'Give me a report.',
      })

      expect(result.reference).toBe('leaf-sdk-1')
      expect(result.resultText).toBe('The report.')
      expect(result.agentSlug).toBe('researcher')

      // The safety backstop — every leaf spawns under the behavior gate.
      expect(captured).toHaveLength(1)
      expect(captured[0]!.permissionMode).toBe('bypass-with-behavior-gate')
      expect(captured[0]!.workspacePath).toBe('/ws/a')
      expect(captured[0]!.userMessageText).toBe('Give me a report.')
      // The agent's tool grants flow into the leaf's allow-list.
      expect(captured[0]!.allowedToolNames).toEqual(['Read', 'Grep'])
      // A fresh leaf — no resume; the SDK assigns its own session id.
      expect(captured[0]!.resumeSessionId).toBeUndefined()
    })
  })

  it('falls back to a USER-scoped agent when none exists at the target workspace scope', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // The hand is user-scoped (available in every workspace) — NOT workspace-scoped.
      await createAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'researcher',
        name: 'Researcher',
        description: 'Researches topics.',
        prompt: 'You research.',
        source: 'user',
        trustTier: 'community',
      })
      const captured: StartChatSessionInput[] = []
      const provider = makeFakeLeafProvider(
        { sessionId: 'leaf-sdk-2', resultText: 'Done.' },
        captured,
      )

      // Delegating into the workspace resolves the user-scoped hand by fallback.
      const result = await createLeafSession(db, provider, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: '/ws/a',
        agentSlug: 'researcher',
        taskText: 'Report.',
      })
      expect(result.reference).toBe('leaf-sdk-2')
      // The leaf still runs in the target workspace folder.
      expect(captured[0]!.workspacePath).toBe('/ws/a')
    })
  })

  it('fail-closed denies a carded tool in a routed leaf and still returns a result (no deadlock)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, {
        userId: user.id,
        workspaceId: workspace.id,
        slug: 'researcher',
        name: 'Researcher',
        description: 'Researches topics.',
        prompt: 'You research.',
        source: 'user',
        trustTier: 'community',
      })
      const approvalResponses: CapturedApprovalResponse[] = []
      // The routed leaf reaches for Bash (a carded tool) before answering.
      const provider = makeFakeLeafProvider(
        { sessionId: 'leaf-3', resultText: 'I reported as text.', approvalToolName: 'Bash' },
        undefined,
        approvalResponses,
      )

      const result = await createLeafSession(db, provider, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: '/ws/a',
        agentSlug: 'researcher',
        taskText: 'do it',
      })

      // The leaf COMPLETED (did not hang) and returned its result.
      expect(result.resultText).toBe('I reported as text.')
      // The carded tool was auto-DENIED (fail-closed) — routing never bypasses it.
      expect(approvalResponses).toHaveLength(1)
      expect(approvalResponses[0]!.requestId).toBe('appr-1')
      expect(approvalResponses[0]!.decision).toMatchObject({ kind: 'denied' })
    })
  })

  it('throws when the agent slug does not resolve in scope', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const provider = makeFakeLeafProvider({ sessionId: 'x', resultText: '' })

      await expect(
        createLeafSession(db, provider, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: '/ws/a',
          agentSlug: 'nonexistent',
          taskText: 't',
        }),
      ).rejects.toThrow()
    })
  })
})
