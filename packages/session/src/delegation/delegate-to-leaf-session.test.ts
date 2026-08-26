// S2 fold-in (build brief Slice 3b+4 §2.7): locks the SHIPPED 3a
// `delegateToLeafSession` composition with the fake provider + a real SQLite DB
// BEFORE routing wires it live. This is the session-tier composition that ties the pure
// orchestration ops to the chat `chat_sessions` row + the `session.delegated`
// edge — so the test asserts all three: the leaf runs under the safety backstop,
// it is recorded as a HIDDEN browsable chat segment (gold §7), and the parent→child
// tree edge is emitted for the monitor (Slice 5a).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById } from '@vynel/chat/repositories'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { createAgentRowForTest as createAgent } from '@vynel/agents/test-support'
import { SESSION_DELEGATED, type SessionDelegatedPayload } from '@vynel/orchestration'
import type { StartChatSessionInput } from '@vynel/providers'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { delegateToLeafSession } from './delegate-to-leaf-session.js'

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

describe('delegateToLeafSession', () => {
  it('runs the leaf under the backstop, records it as a hidden segment, and emits session.delegated', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, {
        userId: user.id,
        workspaceId: workspace.id,
        slug: 'researcher',
        name: 'Researcher',
        description: 'Researches.',
        prompt: 'You research.',
        source: 'user',
        trustTier: 'community',
      })
      const capturedInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'leaf-sdk-9',
        resultText: 'Here is the report.',
        startChatSessionInputs: capturedInputs,
      })

      const result = await delegateToLeafSession(db, provider, {
        parentSessionId: 'global-root-sdk-1',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        agentSlug: 'researcher',
        taskText: 'Report on project A.',
        providerId: 'claude',
      })

      expect(result.reference).toBe('leaf-sdk-9')
      expect(result.resultText).toBe('Here is the report.')

      // The leaf spawned under the safety backstop.
      expect(capturedInputs).toHaveLength(1)
      expect(capturedInputs[0]!.permissionMode).toBe('bypass-with-behavior-gate')

      // Recorded as a hidden, browsable chat segment (gold §7).
      const leaf = findChatSessionById(db, 'leaf-sdk-9')
      expect(leaf).not.toBeNull()
      expect(leaf!.visibility).toBe('hidden')
      expect(leaf!.workspaceId).toBe(workspace.id)
      expect(leaf!.userId).toBe(user.id)

      // The parent→child tree edge for the monitor (Slice 5a consumes it).
      const events = listOutboxEventsByType(db, SESSION_DELEGATED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as SessionDelegatedPayload
      expect(payload.parentSessionId).toBe('global-root-sdk-1')
      expect(payload.childSessionId).toBe('leaf-sdk-9')
      expect(payload.role).toBe('researcher')
      expect(payload.userId).toBe(user.id)
    })
  })
})
