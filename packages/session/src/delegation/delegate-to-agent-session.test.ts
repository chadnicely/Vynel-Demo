// Integration tests for `delegateToAgentSession` (persona-sessions arc) — the
// colleague runner. Real SQLite + the fake provider: fresh-or-resume, the
// listed 'agent' first segment, the every-turn persona, grant merging, and the
// mid-turn swap relink are exercised without a live SDK. The shared drive-loop
// shapes (denial breaker, interrupt, observer) are covered by the spawned/leaf
// runner tests — this file proves what is COLLEAGUE-specific.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById, listChatMessagesForSession } from '@vynel/chat/repositories'
import type { StartChatSessionInput } from '@vynel/providers'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { getOrCreateContinuingSession } from '../continuity/index.js'
import { findPrimarySessionById } from '../repositories/index.js'
import { delegateToAgentSession } from './delegate-to-agent-session.js'
import { ROUTED_TASK_INSTRUCTIONS } from './routed-turn-provider-input.js'

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
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

const AGENT = {
  agentSlug: 'researcher',
  agentName: 'Nova',
  agentPrompt: 'You research topics deeply and cite sources.',
} as const

describe('delegateToAgentSession', () => {
  it('FIRST turn: fresh SDK session, listed agent segment, every-turn persona, link + edge', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const colleague = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: AGENT.agentSlug,
      })
      expect(colleague.currentSdkSessionId).toBeNull()

      const startChatSessionInputs: StartChatSessionInput[] = []
      const result = await delegateToAgentSession(
        db,
        new FakeAiAgentProvider({
          seededSessionId: 'sdk-nova-1',
          resultText: 'Found three strong sources.',
          startChatSessionInputs,
        }),
        {
          parentSessionId: 'global-sdk-1',
          userId: user.id,
          targetPrimarySessionId: colleague.id,
          runCwdPath: workspace.path,
          ...AGENT,
          agentAllowedTools: ['Read', 'Grep'],
          agentDisallowedTools: ['Bash'],
          taskText: 'Research SQLite WAL mode.',
          userAttribution: { userSourceKind: 'global-root' },
          providerId: 'claude',
        },
      )

      // Fresh start — no resume; the persona + steer ride the system prompt.
      const input = startChatSessionInputs[0]!
      expect(input.resumeSessionId).toBeUndefined()
      expect(input.workspacePath).toBe(workspace.path)
      expect(input.systemPromptAppend).toContain('You are "Nova"')
      expect(input.systemPromptAppend).toContain(AGENT.agentPrompt)
      expect(input.systemPromptAppend).toContain(ROUTED_TASK_INSTRUCTIONS)
      // The agent's grants apply on the colleague turn.
      expect(input.allowedToolNames).toEqual(['Read', 'Grep'])
      expect(input.deniedToolNames).toEqual(['Bash'])

      expect(result.reference).toBe('sdk-nova-1')
      expect(result.resultText).toBe('Found three strong sources.')

      // The FIRST segment is the colleague's identity row: listed, named,
      // scope 'agent', filed under the grounding workspace.
      const segment = findChatSessionById(db, 'sdk-nova-1')
      expect(segment?.title).toBe('Nova')
      expect(segment?.visibility).toBe('listed')
      expect(segment?.scope).toBe('agent')
      expect(segment?.workspaceId).toBe(workspace.id)

      // The exchange persisted with persona attribution.
      const messages = listChatMessagesForSession(db, 'sdk-nova-1')
      expect(messages.map((m) => [m.role, m.sourceKind, m.sourceLabel])).toEqual([
        ['user', 'global-root', null],
        ['assistant', 'agent', 'Nova'],
      ])

      // The colleague primary now points at the fresh SDK session.
      expect(findPrimarySessionById(db, colleague.id)?.currentSdkSessionId).toBe('sdk-nova-1')
    })
  })

  it('SECOND turn resumes the colleague conversation — no new segment', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const colleague = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: AGENT.agentSlug,
      })

      await delegateToAgentSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-nova-1', resultText: 'First answer.' }),
        {
          parentSessionId: 'global-sdk-1',
          userId: user.id,
          targetPrimarySessionId: colleague.id,
          runCwdPath: workspace.path,
          ...AGENT,
          taskText: 'First task.',
          providerId: 'claude',
        },
      )

      const startChatSessionInputs: StartChatSessionInput[] = []
      await delegateToAgentSession(
        db,
        new FakeAiAgentProvider({
          seededSessionId: 'sdk-nova-1',
          resultText: 'Second answer, building on the first.',
          startChatSessionInputs,
        }),
        {
          parentSessionId: 'global-sdk-1',
          userId: user.id,
          targetPrimarySessionId: colleague.id,
          runCwdPath: workspace.path,
          ...AGENT,
          taskText: 'Second task.',
          providerId: 'claude',
        },
      )

      // Resume, not fresh — the SAME continuing conversation.
      expect(startChatSessionInputs[0]!.resumeSessionId).toBe('sdk-nova-1')
      // Both exchanges live on the one listed segment.
      const messages = listChatMessagesForSession(db, 'sdk-nova-1')
      expect(messages).toHaveLength(4)
      expect(findPrimarySessionById(db, colleague.id)?.currentSdkSessionId).toBe('sdk-nova-1')
    })
  })

  it('a mid-turn SDK swap relinks the colleague and records a hidden agent-scope swap segment', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const colleague = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: AGENT.agentSlug,
      })

      await delegateToAgentSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-nova-1', resultText: 'First.' }),
        {
          parentSessionId: 'global-sdk-1',
          userId: user.id,
          targetPrimarySessionId: colleague.id,
          runCwdPath: workspace.path,
          ...AGENT,
          taskText: 'First task.',
          providerId: 'claude',
        },
      )

      // The provider comes back under a NEW SDK id while we asked to resume the
      // old one — the compaction-swap shape.
      await delegateToAgentSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-nova-2', resultText: 'Second.' }),
        {
          parentSessionId: 'global-sdk-1',
          userId: user.id,
          targetPrimarySessionId: colleague.id,
          runCwdPath: workspace.path,
          ...AGENT,
          taskText: 'Second task.',
          providerId: 'claude',
        },
      )

      // Relinked: the next mention resumes the post-swap segment.
      expect(findPrimarySessionById(db, colleague.id)?.currentSdkSessionId).toBe('sdk-nova-2')
      // The swap segment keeps the stock hidden presentation, scope 'agent'.
      const swapSegment = findChatSessionById(db, 'sdk-nova-2')
      expect(swapSegment?.visibility).toBe('hidden')
      expect(swapSegment?.scope).toBe('agent')
      expect(swapSegment?.title).toBe('Continued conversation')
      // The identity segment is untouched.
      expect(findChatSessionById(db, 'sdk-nova-1')?.visibility).toBe('listed')
    })
  })

  it('throws on a mis-scoped or foreign target (the tick fails the job)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const workspacePrimary = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'workspace',
        workspaceId: workspace.id,
      })
      const colleague = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: AGENT.agentSlug,
      })

      const base = {
        parentSessionId: 'global-sdk-1',
        runCwdPath: workspace.path,
        ...AGENT,
        taskText: 'task',
        providerId: 'claude' as const,
      }
      await expect(
        delegateToAgentSession(db, new FakeAiAgentProvider({}), {
          ...base,
          userId: user.id,
          targetPrimarySessionId: workspacePrimary.id,
        }),
      ).rejects.toThrow(/not 'agent'/)
      await expect(
        delegateToAgentSession(db, new FakeAiAgentProvider({}), {
          ...base,
          userId: stranger.id,
          targetPrimarySessionId: colleague.id,
        }),
      ).rejects.toThrow(/not found or not owned/)
    })
  })
})
