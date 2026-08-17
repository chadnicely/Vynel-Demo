// Integration tests for the session-tier swap composition — real SQLite, fake
// provider (no live SDK). Proves the full primary-as-thread boundary swap:
// distill → mint a fresh seeded session → record it as a browsable chat segment
// → repoint the primary (record superseded) → emit session.swapped — and that a
// non-pressured turn does none of it. The carry-fidelity + live recall are
// proven separately by the live swap smoke (build brief Slice 1 §6).
//
// `applyPrimaryTurnContinuity` is THE one post-turn op for every continuing
// identity: the cases below run it per scope (workspace / global / spawned /
// agent) and pin the two invariants every scope shares — the identity's own
// ground + scope land on the swap segment, and the chain-walking transcript
// still spans the pre-swap rows afterwards (never lose chat).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertPrimarySession, findPrimarySessionById } from '../repositories/index.js'
import {
  findChatSessionById,
  listChatSessionsForWorkspace,
  insertChatSession,
  insertChatMessage,
  type NewChatMessage,
} from '@vynel/chat/repositories'
import type { PrimarySessionScope } from '../repositories/index.js'
import { resolvePrimaryTranscript, resolveSessionChainTranscript } from './resolve-primary-transcript.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { SESSION_SWAPPED_EVENT_TYPE } from '../continuity/index.js'
import {
  FakeAiAgentProvider,
  type SummarizeSessionCall,
} from './test-support/fake-ai-agent-provider.js'
import type { StartChatSessionInput } from '@vynel/providers'
import { bridgePrimarySessionAfterTurn } from './bridge-primary-session-after-turn.js'
import { applyPrimaryTurnContinuity } from './apply-primary-turn-continuity.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
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
    name: 'WS',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function seedPrimary(
  db: Parameters<typeof insertPrimarySession>[0],
  userId: string,
  workspaceId: string | null,
  currentSdkSessionId: string | null,
  identity: { scope?: PrimarySessionScope; scopeRef?: string } = {},
) {
  const now = new Date()
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    ...(identity.scope !== undefined ? { scope: identity.scope } : {}),
    ...(identity.scopeRef !== undefined ? { scopeRef: identity.scopeRef } : {}),
    currentSdkSessionId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

// A persisted segment the way the shared consumer leaves it after a turn:
// `lastContextTokens` = the LAST usage report (the current occupancy), `model`
// = what actually ran. The continuity op reads exactly these two.
function seedSegmentRow(
  db: Parameters<typeof insertChatSession>[0],
  row: {
    sessionId: string
    userId: string
    workspaceId: string | null
    scope?: 'global' | 'workspace' | 'agent' | 'spawned'
    visibility?: 'listed' | 'hidden'
    lastContextTokens?: number
    model?: string
  },
) {
  const now = new Date()
  return insertChatSession(db, {
    id: row.sessionId,
    userId: row.userId,
    workspaceId: row.workspaceId,
    providerId: 'claude',
    title: 'New session',
    ...(row.scope !== undefined ? { scope: row.scope } : {}),
    ...(row.visibility !== undefined ? { visibility: row.visibility } : {}),
    ...(row.lastContextTokens !== undefined ? { lastContextTokens: row.lastContextTokens } : {}),
    ...(row.model !== undefined ? { model: row.model } : {}),
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  })
}

function seedUserMessage(db: Parameters<typeof insertChatMessage>[0], sessionId: string, body: string) {
  const now = new Date()
  const message: NewChatMessage = {
    id: randomUUID(),
    sessionId,
    role: 'user',
    body,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
  }
  return insertChatMessage(db, message)
}

// Over the 0.85 threshold on Haiku's 200k window (0.95); under it (0.05).
const PRESSURED = { lastContextTokens: 190_000, model: 'claude-haiku-4-5' }
const RELAXED = { lastContextTokens: 10_000, model: 'claude-haiku-4-5' }

const HIGH_OCCUPANCY = { usedTokens: 190_000, contextWindow: 200_000 } // ratio 0.95 > 0.85
const LOW_OCCUPANCY = { usedTokens: 10_000, contextWindow: 200_000 } // ratio 0.05

// A carry that clears the fidelity floor (a stub under it aborts the swap).
const USABLE_CARRY =
  'GOAL: ship the launcher. DONE: test environment green end-to-end. NEXT: continue the migration rehearsal. FACTS: codename BLUEHERON.'

describe('bridgePrimarySessionAfterTurn', () => {
  it('under pressure: swaps to a fresh seeded segment, repoints the primary, emits session.swapped', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-old')
      const summarizeSessionInputs: SummarizeSessionCall[] = []
      const startChatSessionInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'sdk-fresh',
        summary: USABLE_CARRY,
        summarizeSessionInputs,
        startChatSessionInputs,
      })

      const result = await bridgePrimarySessionAfterTurn(
        db,
        {
          primarySessionId: primary.id,
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          providerId: 'claude',
          measurement: HIGH_OCCUPANCY,
          model: 'claude-opus-4-8',
        },
        { provider },
      )

      // The carry-fidelity rule: the SUMMARY distill resumes the session, so
      // it runs on the turn's own model (window ≥ content by construction);
      // the priming ack over the short carry stays on the cheap model.
      expect(summarizeSessionInputs).toHaveLength(1)
      expect(summarizeSessionInputs[0]?.model).toBe('claude-opus-4-8')
      expect(startChatSessionInputs).toHaveLength(1)
      expect(startChatSessionInputs[0]?.model).toBe('claude-haiku-4-5')

      expect(result?.fromSdkSessionId).toBe('sdk-old')
      expect(result?.toSdkSessionId).toBe('sdk-fresh')

      // Primary repointed to the fresh session; superseded recorded.
      const reloaded = findPrimarySessionById(db, primary.id)
      expect(reloaded?.currentSdkSessionId).toBe('sdk-fresh')
      expect(reloaded?.supersededFromSdkSessionId).toBe('sdk-old')

      // The fresh session is a recorded, empty chat segment — HIDDEN from the
      // curated sidebar (Slice 2) but browsable + present with includeHidden.
      const segment = findChatSessionById(db, 'sdk-fresh')
      expect(segment?.totalMessageCount).toBe(0)
      expect(segment?.visibility).toBe('hidden')
      // The continuity chain link — the sessions panel's A ──▶ B edge.
      expect(segment?.continuedFromSessionId).toBe('sdk-old')
      expect(listChatSessionsForWorkspace(db, workspace.id).map((s) => s.id)).not.toContain(
        'sdk-fresh',
      )
      expect(
        listChatSessionsForWorkspace(db, workspace.id, { includeHidden: true }).map((s) => s.id),
      ).toContain('sdk-fresh')

      // session.swapped emitted for the future monitor.
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(1)
    })
  })

  it('not under pressure: no swap, no fresh segment, primary unchanged', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-old')
      const provider = new FakeAiAgentProvider({ seededSessionId: 'sdk-fresh', summary: 'x' })

      const result = await bridgePrimarySessionAfterTurn(
        db,
        {
          primarySessionId: primary.id,
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          providerId: 'claude',
          measurement: LOW_OCCUPANCY,
          model: null,
        },
        { provider },
      )

      expect(result).toBeNull()
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-old')
      expect(findChatSessionById(db, 'sdk-fresh')).toBeNull()
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(0)
    })
  })
})

describe('applyPrimaryTurnContinuity', () => {
  it('first WORKSPACE primary turn: links the primary + hides the first segment, no swap below pressure', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, null) // unlinked
      // The first primary turn created this session via the normal new-session
      // flow (visibility 'listed' by default), like handleSessionStarted would —
      // and the consumer's usage handler left its occupancy on the row.
      seedSegmentRow(db, {
        sessionId: 'sdk-first',
        userId: user.id,
        workspaceId: workspace.id,
        lastContextTokens: 10_000,
        model: 'claude-opus-4-8', // 1M window → ratio 0.01, no pressure
      })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'sdk-fresh', summary: 'x' })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: null,
          effectiveSdkSessionId: 'sdk-first',
          userId: user.id,
          workspacePath: workspace.path,
          providerId: 'claude',
        },
        { provider },
      )

      expect(result).toBeNull() // no swap
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-first') // linked
      // The first segment is hidden so the brain shows as one entry, not a
      // stray "New session" row in the curated sidebar.
      expect(findChatSessionById(db, 'sdk-first')?.visibility).toBe('hidden')
      expect(listChatSessionsForWorkspace(db, workspace.id).map((s) => s.id)).not.toContain(
        'sdk-first',
      )
    })
  })

  it('links then swaps when the linked segment is over the (overridden) threshold', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-loaded')
      seedSegmentRow(db, {
        sessionId: 'sdk-loaded',
        userId: user.id,
        workspaceId: workspace.id,
        lastContextTokens: 50_000, // 0.25 on a 200k window
        model: 'claude-haiku-4-5',
      })
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'sdk-fresh',
        summary: USABLE_CARRY,
      })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: 'sdk-loaded',
          effectiveSdkSessionId: 'sdk-loaded',
          userId: user.id,
          workspacePath: workspace.path,
          providerId: 'claude',
          threshold: 0.2, // smoke-style override: 0.25 > 0.2 → swap
        },
        { provider },
      )

      expect(result?.toSdkSessionId).toBe('sdk-fresh')
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-fresh')
    })
  })

  it('a segment with no measured occupancy yet is never bridged (nothing to measure)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-quiet')
      seedSegmentRow(db, { sessionId: 'sdk-quiet', userId: user.id, workspaceId: workspace.id })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'sdk-fresh', summary: USABLE_CARRY })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: 'sdk-quiet',
          effectiveSdkSessionId: 'sdk-quiet',
          userId: user.id,
          workspacePath: workspace.path,
          providerId: 'claude',
          threshold: 0.01,
        },
        { provider },
      )

      expect(result).toBeNull()
      expect(findChatSessionById(db, 'sdk-fresh')).toBeNull()
    })
  })

  it('GLOBAL primary (no workspace): swaps to a workspace-less segment scoped global — and the thread still spans both segments', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const primary = seedPrimary(db, user.id, null, 'global-old', { scope: 'global' })
      seedSegmentRow(db, {
        sessionId: 'global-old',
        userId: user.id,
        workspaceId: null,
        scope: 'global',
        visibility: 'hidden',
        ...PRESSURED,
      })
      seedUserMessage(db, 'global-old', 'the fact from before the swap')
      const provider = new FakeAiAgentProvider({ seededSessionId: 'global-fresh', summary: USABLE_CARRY })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: 'global-old',
          effectiveSdkSessionId: 'global-old',
          userId: user.id,
          workspacePath: '/tmp/vynel/global-root',
          providerId: 'claude',
        },
        { provider },
      )

      expect(result?.fromSdkSessionId).toBe('global-old')
      expect(result?.toSdkSessionId).toBe('global-fresh')
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('global-fresh')

      // The identity's own ground + scope, not the builder's default: a
      // workspace-less segment scoped 'global', hidden, chain-linked.
      const segment = findChatSessionById(db, 'global-fresh')
      expect(segment?.workspaceId).toBeNull()
      expect(segment?.scope).toBe('global')
      expect(segment?.visibility).toBe('hidden')
      expect(segment?.continuedFromSessionId).toBe('global-old')

      // Never lose chat: the global thread walks the chain back through the
      // fresh (empty) segment to the pre-swap rows.
      const transcript = resolvePrimaryTranscript(db, { userId: user.id })
      expect(transcript.session?.id).toBe('global-fresh')
      expect(transcript.messages.map((m) => m.body)).toEqual(['the fact from before the swap'])
    })
  })

  it("SPAWNED session: the swap segment inherits scope spawned + the primary's own ground; the chain opens from the new head", async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // A workspace-grounded spawned session (Slice ④b) — its ground is its room.
      const primary = seedPrimary(db, user.id, workspace.id, 'spawned-old', { scope: 'spawned' })
      seedSegmentRow(db, {
        sessionId: 'spawned-old',
        userId: user.id,
        workspaceId: workspace.id,
        scope: 'spawned',
        visibility: 'listed',
        ...PRESSURED,
      })
      seedUserMessage(db, 'spawned-old', 'the mailing feature is half done')
      const provider = new FakeAiAgentProvider({ seededSessionId: 'spawned-fresh', summary: USABLE_CARRY })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: 'spawned-old',
          effectiveSdkSessionId: 'spawned-old',
          userId: user.id,
          workspacePath: workspace.path,
          providerId: 'claude',
        },
        { provider },
      )

      expect(result?.toSdkSessionId).toBe('spawned-fresh')
      const segment = findChatSessionById(db, 'spawned-fresh')
      expect(segment?.scope).toBe('spawned')
      expect(segment?.workspaceId).toBe(workspace.id)
      expect(segment?.visibility).toBe('hidden')
      expect(segment?.continuedFromSessionId).toBe('spawned-old')
      // The listed identity row is untouched — the chain identity stays the
      // first segment; the Sessions panel opens the fold from its new head.
      expect(findChatSessionById(db, 'spawned-old')?.visibility).toBe('listed')
      const chain = resolveSessionChainTranscript(db, { userId: user.id, headSessionId: 'spawned-fresh' })
      expect(chain.messages.map((m) => m.body)).toEqual(['the mailing feature is half done'])
    })
  })

  it('AGENT colleague first turn: links the identity, keeps its listed identity segment visible', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const primary = seedPrimary(db, user.id, null, null, { scope: 'agent', scopeRef: 'reviewer' })
      // The colleague's first segment IS its listed identity row (its name in
      // the sessions panel) — the runner created it 'listed'.
      seedSegmentRow(db, {
        sessionId: 'agent-first',
        userId: user.id,
        workspaceId: null,
        scope: 'agent',
        visibility: 'listed',
        ...RELAXED,
      })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'agent-fresh', summary: USABLE_CARRY })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: null,
          effectiveSdkSessionId: 'agent-first',
          userId: user.id,
          workspacePath: '/tmp/vynel/global-root',
          providerId: 'claude',
        },
        { provider },
      )

      expect(result).toBeNull()
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('agent-first')
      expect(findChatSessionById(db, 'agent-first')?.visibility).toBe('listed')
    })
  })

  it('AGENT colleague under pressure: swaps to a hidden agent-scoped segment chained to its identity row', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'agent-old', { scope: 'agent', scopeRef: 'reviewer' })
      seedSegmentRow(db, {
        sessionId: 'agent-old',
        userId: user.id,
        workspaceId: workspace.id,
        scope: 'agent',
        visibility: 'listed',
        ...PRESSURED,
      })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'agent-fresh', summary: USABLE_CARRY })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: 'agent-old',
          effectiveSdkSessionId: 'agent-old',
          userId: user.id,
          workspacePath: workspace.path,
          providerId: 'claude',
        },
        { provider },
      )

      expect(result?.toSdkSessionId).toBe('agent-fresh')
      const segment = findChatSessionById(db, 'agent-fresh')
      expect(segment?.scope).toBe('agent')
      expect(segment?.workspaceId).toBe(workspace.id)
      expect(segment?.visibility).toBe('hidden')
      expect(segment?.continuedFromSessionId).toBe('agent-old')
    })
  })

  it('a foreign primary is NotFound — never linked, never bridged', async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser())
      const intruder = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const primary = seedPrimary(db, owner.id, workspace.id, 'sdk-old')
      const provider = new FakeAiAgentProvider({ seededSessionId: 'sdk-fresh', summary: USABLE_CARRY })

      await expect(
        applyPrimaryTurnContinuity(
          db,
          {
            primarySessionId: primary.id,
            priorSdkSessionId: null,
            effectiveSdkSessionId: 'sdk-other',
            userId: intruder.id,
            workspacePath: workspace.path,
            providerId: 'claude',
          },
          { provider },
        ),
      ).rejects.toThrow()
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-old')
    })
  })
})
