// Integration test for `delegateToSpawnedSession` (session-library Slice ④) —
// routing a task into a SPAWNED session's continuing conversation. Real SQLite
// + a fake provider: the resume + attributed persistence + edge are exercised
// without a live SDK. Mirrors the delegate-to-workspace-root test shapes.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listPendingApprovalsForUser } from '@vynel/approvals'
import { findChatSessionById, listChatMessagesForSession } from '@vynel/chat/repositories'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { SESSION_DELEGATED, type SessionDelegatedPayload } from '@vynel/orchestration'
import type { StartChatSessionInput } from '@vynel/providers'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { createSpawnedSession } from '../spawned/index.js'
import { getOrCreatePrimarySession } from '../continuity/index.js'
import { findPrimarySessionById } from '../repositories/index.js'
import { resolveSessionChainTranscript } from '../runtime/resolve-primary-transcript.js'
import { delegateToSpawnedSession } from './delegate-to-spawned-session.js'
import { ROUTED_TASK_INSTRUCTIONS } from './routed-turn-provider-input.js'
import { composeSessionInstruction } from '@vynel/instructions/session-instructions'

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
      // test: correct expectation for the base+kind stack — the child identity
      // (base + spawned-session) now LEADS the routed steer on every turn.
      expect(startChatSessionInputs[0]!.systemPromptAppend).toBe(
        `${composeSessionInstruction('spawned-session')}\n\n${ROUTED_TASK_INSTRUCTIONS}`,
      )

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

  it('threads a workspace-grounded MCP attachment into the resumed turn (Slice ④b ground toolset)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const created = await spawnSession(db, user.id)

      const startChatSessionInputs: StartChatSessionInput[] = []
      await delegateToSpawnedSession(
        db,
        new FakeAiAgentProvider({
          seededSessionId: created.sessionId,
          resultText: 'done',
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
          mcpAttachment: {
            mcpServers: { vynel: { name: 'vynel' } },
            deniedMcpToolPatterns: [],
            mutatingToolNames: [],
            askModeApprovalToolNames: [],
            systemPromptAppend: '',
          },
        },
      )

      const turnInput = startChatSessionInputs[0]!
      expect(turnInput.mcpServers).toEqual({ vynel: { name: 'vynel' } })
      // No wildcard patterns ride to the provider — registration alone offers
      // the tools; the canUseTool policy map gates each call (SHADOWED fix).
      expect('allowedMcpToolPatterns' in turnInput).toBe(false)
      expect(turnInput.deniedToolNames).toEqual([])
      // Empty composer prompt → identity + the routed steer, no trailing join.
      expect(turnInput.systemPromptAppend).toBe(
        `${composeSessionInstruction('spawned-session')}\n\n${ROUTED_TASK_INSTRUCTIONS}`,
      )
      // No declared mutators → the field stays absent (the provider floor alone).
      expect(turnInput.alwaysRequireApprovalToolNames).toBeUndefined()
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

  // The mis-filing bug (2026-08-16 → fixed 2026-08-17): a workspace-grounded
  // spawned session's approval recorded workspace_id NULL, so the parent room
  // could never light for its own child's card and the GLOBAL scope lit
  // instead. 65 such rows existed in the dev DB. Both groundings are pinned
  // here — null is CORRECT for a global-grounded session, and the defect was
  // that it was unconditional.
  it('records a WORKSPACE-grounded session’s approval against its room, and its segment too', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Letterman',
        kind: 'personal',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      })
      const created = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-ws-spawned' }),
        {
          userId: user.id,
          name: 'Research: pricing',
          purpose: 'compare pricing pages',
          workspacePath: workspace.path,
          workspaceId: workspace.id,
        },
      )

      const provider = new FakeAiAgentProvider({
        seededSessionId: created.sessionId,
        resultText: 'done',
        approvalToolName: 'Bash',
      })
      const run = delegateToSpawnedSession(db, provider, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        targetPrimarySessionId: created.primarySessionId,
        runCwdPath: workspace.path,
        sessionName: created.name,
        taskText: 'compare pricing',
        providerId: 'claude',
      })
      // Let the card park, then approve so the turn completes.
      await vi.waitFor(() => {
        expect(listPendingApprovalsForUser(db, user.id)).toHaveLength(1)
      })
      const [card] = listPendingApprovalsForUser(db, user.id)
      // THE FIX: the card names the room, so the room can light for it.
      expect(card?.workspaceId).toBe(workspace.id)
      // …and it still names the session, which is what the per-conversation
      // status reads (both facts, on every card).
      expect(card?.sessionId).toBe(created.sessionId)

      await provider.respondToApprovalRequest('appr-1', { kind: 'approved' })
      await run

      // The turn's own segment carries the ground too — a swap used to move a
      // workspace-grounded session out of its room's list.
      expect(findChatSessionById(db, created.sessionId)?.workspaceId).toBe(workspace.id)
    })
  })

  it('a GLOBAL-grounded spawned session still records null — that half was never wrong', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const created = await spawnSession(db, user.id)
      const provider = new FakeAiAgentProvider({
        seededSessionId: created.sessionId,
        resultText: 'done',
        approvalToolName: 'Bash',
      })
      const run = delegateToSpawnedSession(db, provider, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        targetPrimarySessionId: created.primarySessionId,
        runCwdPath: '/tmp/vynel/global-root',
        sessionName: created.name,
        taskText: 'compare pricing',
        providerId: 'claude',
      })
      await vi.waitFor(() => {
        expect(listPendingApprovalsForUser(db, user.id)).toHaveLength(1)
      })
      expect(listPendingApprovalsForUser(db, user.id)[0]?.workspaceId).toBeNull()

      await provider.respondToApprovalRequest('appr-1', { kind: 'approved' })
      await run
    })
  })

  it('bridges the spawned session at the turn boundary — its OWN continuity, its chain, its listed identity untouched', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const created = await spawnSession(db, user.id)
      // The resumed turn runs on the spawned segment; the swap's priming
      // session is the second start. The turn's usage lands the segment at
      // 0.95 of Haiku's window.
      const provider = new FakeAiAgentProvider({
        sessionIds: [created.sessionId, 'sdk-spawned-2'],
        resultText: 'Competitor A undercuts us by 12%.',
        usage: { inputTokens: 190_000, outputTokens: 10, model: 'claude-haiku-4-5' },
        summary: 'GOAL: finish the routed task. DONE: the docs are summarized. NEXT: await the next task. FACTS: three docs, all current.',
      })

      const result = await delegateToSpawnedSession(db, provider, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        targetPrimarySessionId: created.primarySessionId,
        runCwdPath: '/tmp/vynel/global-root',
        sessionName: created.name,
        taskText: 'compare pricing',
        providerId: 'claude',
      })
      expect(result.reference).toBe(created.sessionId)

      // The spawned primary now continues on the fresh segment, chained to
      // its predecessor; scope + ground follow the identity (spawned, global-
      // grounded → null workspace), hidden — the listed identity row stays.
      expect(findPrimarySessionById(db, created.primarySessionId)?.currentSdkSessionId).toBe('sdk-spawned-2')
      const fresh = findChatSessionById(db, 'sdk-spawned-2')
      expect(fresh?.continuedFromSessionId).toBe(created.sessionId)
      expect(fresh?.scope).toBe('spawned')
      expect(fresh?.workspaceId).toBeNull()
      expect(fresh?.visibility).toBe('hidden')
      expect(findChatSessionById(db, created.sessionId)?.visibility).toBe('listed')

      // Never lose chat: the chain opened from the new head shows the exchange.
      const chain = resolveSessionChainTranscript(db, { userId: user.id, headSessionId: 'sdk-spawned-2' })
      expect(chain.messages.map((m) => m.body)).toEqual([
        'compare pricing',
        'Competitor A undercuts us by 12%.',
      ])
    })
  })
})
