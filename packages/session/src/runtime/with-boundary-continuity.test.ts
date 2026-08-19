// Integration tests for `withBoundaryContinuity` — real SQLite + the fake
// provider. Pins the visible-swap contract every runner now shares: the turn's
// events pass through untouched; at pressure the stream grows
// `context-patching` → (a real seed-fresh swap) → `context-patched`; below
// pressure nothing is added; a failed swap reports "stayed" (`toSessionId`
// null); a thrown inner stream propagates with no continuity attempted; the
// swapping register is held exactly for the swap.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { ChatTurnEvent } from '@vynel/chat'
import { insertChatSession, findChatSessionById } from '@vynel/chat/repositories'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { insertPrimarySession, findPrimarySessionById } from '../repositories/index.js'
import { isPrimarySwapping, SESSION_SWAPPING_EVENT_TYPE, SESSION_SWAPPED_EVENT_TYPE } from '../continuity/index.js'
import { FakeAiAgentProvider } from './test-support/fake-ai-agent-provider.js'
import { withBoundaryContinuity } from './with-boundary-continuity.js'

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

function seedPrimary(db: Database, userId: string, workspaceId: string, currentSdkSessionId: string) {
  const now = new Date()
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    currentSdkSessionId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

// A persisted segment the way the consumer leaves it after a turn.
function seedSegment(
  db: Database,
  row: { sessionId: string; userId: string; workspaceId: string; lastContextTokens: number; model: string; lastContextWindow?: number },
) {
  const now = new Date()
  return insertChatSession(db, {
    id: row.sessionId,
    userId: row.userId,
    workspaceId: row.workspaceId,
    providerId: 'claude',
    title: 'Continued conversation',
    visibility: 'hidden',
    lastContextTokens: row.lastContextTokens,
    model: row.model,
    lastContextWindow: row.lastContextWindow ?? null,
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

const USABLE_CARRY =
  'GOAL: ship the launcher. DONE: test environment green end-to-end. NEXT: continue the migration rehearsal. FACTS: codename BLUEHERON.'

async function* turnEvents(sessionId: string): AsyncIterable<ChatTurnEvent> {
  yield { kind: 'text-chunk', messageId: 'm-1', textDelta: 'hello' }
  yield { kind: 'session-completed', sessionId }
}

async function collect(stream: AsyncIterable<ChatTurnEvent>): Promise<ChatTurnEvent[]> {
  const out: ChatTurnEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

describe('withBoundaryContinuity', () => {
  it('under pressure: passes the turn through, then announces the swap around a real seed-fresh swap', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg-a')
      // 0.95 of Haiku's window — over the threshold.
      seedSegment(db, { sessionId: 'seg-a', userId: user.id, workspaceId: workspace.id, lastContextTokens: 190_000, model: 'claude-haiku-4-5' })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'seg-b', summary: USABLE_CARRY })
      let swappingWhilePatching: boolean | null = null

      const events: ChatTurnEvent[] = []
      for await (const event of withBoundaryContinuity(
        turnEvents('seg-a'),
        { primarySessionId: primary.id, priorSdkSessionId: 'seg-a', userId: user.id, workspacePath: workspace.path, providerId: 'claude' },
        { db, provider },
      )) {
        events.push(event)
        // While `context-patching` is out and the swap runs, the register says so.
        if (event.kind === 'context-patching') swappingWhilePatching = isPrimarySwapping(primary.id)
      }

      expect(events.map((e) => e.kind)).toEqual([
        'text-chunk',
        'session-completed',
        'context-patching',
        'context-patched',
      ])
      expect(events[2]).toEqual({ kind: 'context-patching', sessionId: 'seg-a', primarySessionId: primary.id })
      expect(events[3]).toEqual({ kind: 'context-patched', sessionId: 'seg-a', primarySessionId: primary.id, toSessionId: 'seg-b' })
      // The swap really happened: primary repointed, chained segment, both signals emitted.
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('seg-b')
      expect(findChatSessionById(db, 'seg-b')?.continuedFromSessionId).toBe('seg-a')
      expect(listOutboxEventsByType(db, SESSION_SWAPPING_EVENT_TYPE)).toHaveLength(1)
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(1)
      // The generator yields `context-patching` BEFORE the swap starts, so the
      // register is not yet set at that yield — and it is clear once done.
      expect(swappingWhilePatching).toBe(false)
      expect(isPrimarySwapping(primary.id)).toBe(false)
    })
  })

  it('below pressure: the stream is exactly the turn — no announcement, no swap', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg-a')
      seedSegment(db, { sessionId: 'seg-a', userId: user.id, workspaceId: workspace.id, lastContextTokens: 10_000, model: 'claude-haiku-4-5' })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'seg-b', summary: USABLE_CARRY })

      const events = await collect(
        withBoundaryContinuity(
          turnEvents('seg-a'),
          { primarySessionId: primary.id, priorSdkSessionId: 'seg-a', userId: user.id, workspacePath: workspace.path, providerId: 'claude' },
          { db, provider },
        ),
      )
      expect(events.map((e) => e.kind)).toEqual(['text-chunk', 'session-completed'])
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('seg-a')
    })
  })

  it('a small-model turn on a big-window chain does not swap — the persisted denominator, not the last-ran model, is measured against', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg-a')
      // 190k would be 0.95 of Haiku's window — but the chain is DRIVEN on a 1M
      // model (the consumer wrote that denominator); the visitor changes nothing.
      seedSegment(db, {
        sessionId: 'seg-a',
        userId: user.id,
        workspaceId: workspace.id,
        lastContextTokens: 190_000,
        model: 'claude-haiku-4-5',
        lastContextWindow: 1_000_000,
      })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'seg-b', summary: USABLE_CARRY })

      const events = await collect(
        withBoundaryContinuity(
          turnEvents('seg-a'),
          { primarySessionId: primary.id, priorSdkSessionId: 'seg-a', userId: user.id, workspacePath: workspace.path, providerId: 'claude' },
          { db, provider },
        ),
      )
      expect(events.map((e) => e.kind)).toEqual(['text-chunk', 'session-completed'])
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('seg-a')
    })
  })

  it('a swap that aborts (no usable carry) still announces — and reports the conversation stayed', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg-a')
      seedSegment(db, { sessionId: 'seg-a', userId: user.id, workspaceId: workspace.id, lastContextTokens: 190_000, model: 'claude-haiku-4-5' })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'seg-b', summary: null })

      const events = await collect(
        withBoundaryContinuity(
          turnEvents('seg-a'),
          { primarySessionId: primary.id, priorSdkSessionId: 'seg-a', userId: user.id, workspacePath: workspace.path, providerId: 'claude' },
          { db, provider },
        ),
      )
      expect(events.at(-2)?.kind).toBe('context-patching')
      expect(events.at(-1)).toEqual({ kind: 'context-patched', sessionId: 'seg-a', primarySessionId: primary.id, toSessionId: null })
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('seg-a')
      expect(isPrimarySwapping(primary.id)).toBe(false)
    })
  })

  it('a first turn (no prior segment) links the fresh segment the stream created — the segment named by session-created', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const now = new Date()
      const primary = insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        currentSdkSessionId: null,
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      const fresh = seedSegment(db, { sessionId: 'seg-fresh', userId: user.id, workspaceId: workspace.id, lastContextTokens: 1_000, model: 'claude-haiku-4-5' })
      async function* firstTurn(): AsyncIterable<ChatTurnEvent> {
        yield { kind: 'session-created', session: fresh }
        yield { kind: 'session-completed', sessionId: 'seg-fresh' }
      }
      const events = await collect(
        withBoundaryContinuity(
          firstTurn(),
          { primarySessionId: primary.id, priorSdkSessionId: null, userId: user.id, workspacePath: workspace.path, providerId: 'claude' },
          { db, provider: new FakeAiAgentProvider({}) },
        ),
      )
      expect(events.map((e) => e.kind)).toEqual(['session-created', 'session-completed'])
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('seg-fresh')
    })
  })

  it('a thrown inner stream propagates untouched — no continuity is attempted', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg-a')
      seedSegment(db, { sessionId: 'seg-a', userId: user.id, workspaceId: workspace.id, lastContextTokens: 190_000, model: 'claude-haiku-4-5' })
      async function* broken(): AsyncIterable<ChatTurnEvent> {
        yield { kind: 'text-chunk', messageId: 'm-1', textDelta: 'hi' }
        throw new Error('consumer died')
      }
      const provider = new FakeAiAgentProvider({ seededSessionId: 'seg-b', summary: USABLE_CARRY })
      await expect(
        collect(
          withBoundaryContinuity(
            broken(),
            { primarySessionId: primary.id, priorSdkSessionId: 'seg-a', userId: user.id, workspacePath: workspace.path, providerId: 'claude' },
            { db, provider },
          ),
        ),
      ).rejects.toThrow('consumer died')
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('seg-a')
      expect(listOutboxEventsByType(db, SESSION_SWAPPING_EVENT_TYPE)).toHaveLength(0)
    })
  })
})
