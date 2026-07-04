// Integration tests for `bridgePrimarySession`. Real SQLite via
// `withTestDatabase`; the provider interactions (summarize + start-seeded) are
// injected mocks (the SDK boundary). Proves the swap orchestration: distill →
// fresh seeded session → repoint primary + record superseded → emit
// session.swapped. Spec: `docs/agent-base/session-continuity.md`.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertPrimarySession,
  findPrimarySessionById,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import {
  bridgePrimarySession,
  bridgePrimarySessionIfUnderPressure,
} from './bridge-primary-session.js'
import {
  SESSION_SWAPPED_EVENT_TYPE,
  type SessionSwappedEventPayload,
} from './session-continuity-events.js'

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

function seedPrimary(
  db: Parameters<typeof insertPrimarySession>[0],
  userId: string,
  workspaceId: string,
  currentSdkSessionId: string | null,
) {
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

describe('bridgePrimarySession', () => {
  it('distills, starts a fresh seeded session, repoints the primary, and emits session.swapped', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-old')

      const summarizeSession = vi.fn().mockResolvedValue('GOAL: ship. NEXT: continue.')
      const startSeededSession = vi.fn().mockResolvedValue('sdk-new')

      const result = await bridgePrimarySession(
        db,
        { primarySessionId: primary.id, userId: user.id },
        { summarizeSession, startSeededSession },
      )

      expect(result).toEqual({
        fromSdkSessionId: 'sdk-old',
        toSdkSessionId: 'sdk-new',
        summary: 'GOAL: ship. NEXT: continue.',
      })
      // The provider summarized the OLD session; the fresh session was seeded
      // with the carry.
      expect(summarizeSession).toHaveBeenCalledWith('sdk-old')
      expect(startSeededSession).toHaveBeenCalledWith('GOAL: ship. NEXT: continue.')

      // Primary repointed to the fresh session; the superseded one recorded.
      const reloaded = findPrimarySessionById(db, primary.id)
      expect(reloaded?.currentSdkSessionId).toBe('sdk-new')
      expect(reloaded?.supersededFromSdkSessionId).toBe('sdk-old')

      // session.swapped emitted for the future monitor.
      const events = listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as SessionSwappedEventPayload
      expect(payload.fromSdkSessionId).toBe('sdk-old')
      expect(payload.toSdkSessionId).toBe('sdk-new')
      expect(payload.primarySessionId).toBe(primary.id)
      // The event carries the tenant (data-standard — outbox payloads carry userId + workspaceId).
      expect(payload.userId).toBe(user.id)
      expect(payload.workspaceId).toBe(workspace.id)
      // The swap event carries the continuing-session kind (voice-jarvis piece 1).
      expect(payload.scope).toBe('workspace')
    })
  })

  it('carries scope on the swap event when bridging a non-primary (voice) continuing-session', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      // A voice continuing-session: scope 'voice', no workspace (voice-jarvis piece 1).
      const now = new Date()
      const voice = insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: null,
        scope: 'voice',
        currentSdkSessionId: 'sdk-voice-old',
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })

      await bridgePrimarySession(
        db,
        { primarySessionId: voice.id, userId: user.id },
        {
          summarizeSession: vi.fn().mockResolvedValue('GOAL: keep listening.'),
          startSeededSession: vi.fn().mockResolvedValue('sdk-voice-new'),
        },
      )

      const events = listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as SessionSwappedEventPayload
      expect(payload.scope).toBe('voice')
      expect(payload.workspaceId).toBeNull()
      expect(payload.primarySessionId).toBe(voice.id)
    })
  })

  it('aborts (returns null, no repoint, no event) when no carry summary is produced', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-old')

      const startSeededSession = vi.fn()
      const result = await bridgePrimarySession(
        db,
        { primarySessionId: primary.id, userId: user.id },
        { summarizeSession: vi.fn().mockResolvedValue(null), startSeededSession },
      )

      expect(result).toBeNull()
      // No fresh session started; primary unchanged; nothing emitted.
      expect(startSeededSession).not.toHaveBeenCalled()
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-old')
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(0)
    })
  })

  it('throws when the primary has no current SDK session to swap from', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, null)

      await expect(
        bridgePrimarySession(
          db,
          { primarySessionId: primary.id, userId: user.id },
          { summarizeSession: vi.fn(), startSeededSession: vi.fn() },
        ),
      ).rejects.toThrow(ValidationError)
    })
  })

  it('throws NotFoundError identically for an unknown primary id AND a primary owned by another user (no enumeration leak)', async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const primary = seedPrimary(db, owner.id, workspace.id, 'sdk-old')
      const deps = { summarizeSession: vi.fn(), startSeededSession: vi.fn() }

      // Unknown id → NotFoundError.
      await expect(
        bridgePrimarySession(db, { primarySessionId: randomUUID(), userId: owner.id }, deps),
      ).rejects.toThrow(NotFoundError)

      // Owned by another user → the SAME NotFoundError (not a distinct
      // "forbidden" — the existence of the primary never leaks).
      await expect(
        bridgePrimarySession(db, { primarySessionId: primary.id, userId: stranger.id }, deps),
      ).rejects.toThrow(NotFoundError)
    })
  })
})

describe('bridgePrimarySessionIfUnderPressure (the turn-boundary trigger)', () => {
  it('does nothing when the turn is below the pressure threshold', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-old')
      const summarizeSession = vi.fn()

      const result = await bridgePrimarySessionIfUnderPressure(
        db,
        {
          primarySessionId: primary.id,
          userId: user.id,
          measurement: { usedTokens: 10_000, contextWindow: 200_000 },
        },
        { summarizeSession, startSeededSession: vi.fn() },
      )

      expect(result).toBeNull()
      expect(summarizeSession).not.toHaveBeenCalled()
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-old')
    })
  })

  it('bridges when the turn crosses the pressure threshold', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-old')

      const result = await bridgePrimarySessionIfUnderPressure(
        db,
        {
          primarySessionId: primary.id,
          userId: user.id,
          measurement: { usedTokens: 190_000, contextWindow: 200_000 },
        },
        {
          summarizeSession: vi.fn().mockResolvedValue('GOAL: x. NEXT: y.'),
          startSeededSession: vi.fn().mockResolvedValue('sdk-new'),
        },
      )

      expect(result?.toSdkSessionId).toBe('sdk-new')
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-new')
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(1)
    })
  })
})
