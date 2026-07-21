// Integration test for `delegateToSpawnedSession` (session-library Slice ④) —
// routing a task into a SPAWNED session's continuing conversation. Real SQLite
// + a fake provider: the resume + attributed persistence + edge are exercised
// without a live SDK. Mirrors the delegate-to-workspace-root test shapes.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { findChatSessionById, listChatMessagesForSession } from '@vynel/chat/repositories'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { SESSION_DELEGATED, type SessionDelegatedPayload } from '@vynel/orchestration'
import type { StartChatSessionInput } from '@vynel/providers'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { createSpawnedSession } from '../spawned/index.js'
import { getOrCreatePrimarySession } from '../continuity/index.js'
import { delegateToSpawnedSession } from './delegate-to-spawned-session.js'
import { ROUTED_TASK_INSTRUCTIONS } from './delegate-to-workspace-root.js'

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

async function spawnSession(db: Parameters<typeof createSpawnedSession>[0], userId: string) {
  return createSpawnedSession(db, new FakeAiAgentProvider({ seededSessionId: 'sdk-spawned-1' }), {
    userId,
    name: 'Research: pricing',
    purpose: 'compare pricing pages',
    workspacePath: '/tmp/vynel/global-root',
  })
}

describe('delegateToSpawnedSession', () => {
  it('RESUMES the spawned session, persists the attributed exchange on its listed segment, and emits the edge', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const created = await spawnSession(db, user.id)

      const startChatSessionInputs: StartChatSessionInput[] = []
      const result = await delegateToSpawnedSession(
        db,
        new FakeAiAgentProvider({
          seededSessionId: created.sessionId,
          resultText: 'Competitor A undercuts us by 12%.',
          startChatSessionInputs,
        }),
        {
          parentSessionId: 'global-sdk-1',
          userId: user.id,
          targetPrimarySessionId: created.primarySessionId,
          runCwdPath: '/tmp/vynel/global-root',
          sessionName: created.name,
          taskText: 'compare pricing',
          providerId: 'claude',
        },
      )

      // Resume, not fresh: the spawned session's continuing SDK session.
      expect(startChatSessionInputs[0]!.resumeSessionId).toBe(created.sessionId)
      expect(startChatSessionInputs[0]!.workspacePath).toBe('/tmp/vynel/global-root')
      // The background steer rides the SYSTEM prompt, never the persisted task.
      expect(startChatSessionInputs[0]!.systemPromptAppend).toBe(ROUTED_TASK_INSTRUCTIONS)

      expect(result.reference).toBe(created.sessionId)
      expect(result.resultText).toBe('Competitor A undercuts us by 12%.')

      // No new segment — the exchange landed on the LISTED named segment.
      const segment = findChatSessionById(db, created.sessionId)
      expect(segment?.title).toBe('Research: pricing')
      expect(segment?.visibility).toBe('listed')
      expect(segment?.scope).toBe('spawned')

      // Attributed like a routed turn — the SESSION'S NAME plays the manager.
      const messages = listChatMessagesForSession(db, created.sessionId)
      expect(messages.map((m) => [m.role, m.sourceKind, m.sourceLabel])).toEqual([
        ['user', 'global-root', null],
        ['assistant', 'workspace-manager', 'Research: pricing'],
      ])

      // The global → spawned-session tree edge for the monitor.
      const edges = listOutboxEventsByType(db, SESSION_DELEGATED)
      expect(edges).toHaveLength(1)
      const edge = edges[0]!.payload as SessionDelegatedPayload
      expect(edge.parentSessionId).toBe('global-sdk-1')
      expect(edge.childSessionId).toBe(created.sessionId)
      expect(edge.role).toBe('spawned-session')
    })
  })

  it('throws on an unknown / foreign / non-spawned target (the tick fails the job)', async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const created = await spawnSession(db, owner.id)
      const provider = new FakeAiAgentProvider({ resultText: 'never runs' })
      const base = {
        parentSessionId: 'global-sdk-1',
        runCwdPath: '/tmp/x',
        sessionName: 'S',
        taskText: 't',
        providerId: 'claude' as const,
      }

      // Unknown target.
      await expect(
        delegateToSpawnedSession(db, provider, {
          ...base,
          userId: owner.id,
          targetPrimarySessionId: randomUUID(),
        }),
      ).rejects.toThrow(/not found or not owned/)

      // Not owned — same error shape (no enumeration leak).
      await expect(
        delegateToSpawnedSession(db, provider, {
          ...base,
          userId: stranger.id,
          targetPrimarySessionId: created.primarySessionId,
        }),
      ).rejects.toThrow(/not found or not owned/)

      // A non-spawned primary (the global brain) never runs through this path.
      const globalPrimary = await getOrCreatePrimarySession(db, { userId: owner.id })
      await expect(
        delegateToSpawnedSession(db, provider, {
          ...base,
          userId: owner.id,
          targetPrimarySessionId: globalPrimary.id,
        }),
      ).rejects.toThrow(/scope 'global', not 'spawned'/)
    })
  })
})
