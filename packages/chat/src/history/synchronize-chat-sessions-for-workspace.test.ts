// Tests for synchronize-chat-sessions-for-workspace's pure-data helper.
//
// The outer `synchronizeChatSessionsForWorkspace` calls
// `resolveAiAgentProvider` which is hard to mock at the registry layer
// (the providers domain doesn't expose a test-only registry-setter, and
// `vi.mock` of the whole @vynel/providers module is invasive). The fix:
// the loop + filter + insert logic is exported as the pure-data helper
// `importPersistedSessions(db, records, input)` — testable directly.
//
// The outer shell (one provider call + delegate to the helper) is covered
// by the manual smoke at ship (same waiver as start-chat-turn /
// interrupt-chat-session).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  findChatSessionById,
  listChatSessionsForWorkspace,
  type NewChatSession,
} from '../repositories/index.js'
import type { AiAgentProviderId, PersistedSessionRecord } from '@vynel/providers'
import { importPersistedSessions } from './synchronize-chat-sessions-for-workspace.js'

const PROVIDER_ID: AiAgentProviderId = 'claude'

function makeUser() {
  return {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeWorkspace(userId: string, path: string = `/tmp/vynel/${randomUUID()}`) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'WS',
    kind: 'personal' as const,
    path,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makePersistedRecord(
  overrides: Partial<PersistedSessionRecord> = {},
): PersistedSessionRecord {
  return {
    providerId: PROVIDER_ID,
    sessionId: `session-${randomUUID()}`,
    workspacePath: '/tmp/vynel/default',
    startedAt: new Date('2026-04-01T00:00:00Z'),
    lastModifiedAt: new Date('2026-04-15T00:00:00Z'),
    firstUserMessagePreview: 'Find me a flight to Tokyo',
    turnCount: 5,
    hasUnresolvedToolUse: false,
    ...overrides,
  }
}

function makeExistingSession(userId: string, workspaceId: string, id: string): NewChatSession {
  const now = new Date()
  return {
    id,
    userId,
    workspaceId,
    providerId: PROVIDER_ID,
    title: 'Existing',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  }
}

describe('importPersistedSessions', () => {
  it('inserts only records matching the workspace path; skips others; reports the count', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id, '/tmp/vynel/match')
      insertWorkspace(db, ws)

      const result = importPersistedSessions(
        db,
        [
          makePersistedRecord({ sessionId: 's-match-1', workspacePath: '/tmp/vynel/match' }),
          makePersistedRecord({ sessionId: 's-other', workspacePath: '/tmp/vynel/other' }),
          makePersistedRecord({ sessionId: 's-match-2', workspacePath: '/tmp/vynel/match' }),
        ],
        { workspaceId: ws.id, workspacePath: ws.path, userId: user.id, providerId: PROVIDER_ID },
      )

      expect(result.importedCount).toBe(2)
      expect(findChatSessionById(db, 's-match-1')).not.toBeNull()
      expect(findChatSessionById(db, 's-match-2')).not.toBeNull()
      expect(findChatSessionById(db, 's-other')).toBeNull()
    })
  })

  it('skips records whose sessionId already exists in chat_sessions (idempotent re-sync)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id, '/tmp/vynel/idemp')
      insertWorkspace(db, ws)
      insertChatSession(db, makeExistingSession(user.id, ws.id, 's-already-here'))

      const result = importPersistedSessions(
        db,
        [
          makePersistedRecord({ sessionId: 's-already-here', workspacePath: ws.path }),
          makePersistedRecord({ sessionId: 's-new-here', workspacePath: ws.path }),
        ],
        { workspaceId: ws.id, workspacePath: ws.path, userId: user.id, providerId: PROVIDER_ID },
      )

      expect(result.importedCount).toBe(1)
      const newOne = findChatSessionById(db, 's-new-here')
      expect(newOne).not.toBeNull()
      // Existing row's title was NOT overwritten.
      const existing = findChatSessionById(db, 's-already-here')
      expect(existing?.title).toBe('Existing')
    })
  })

  it('uses firstUserMessagePreview as the title; falls back to "Imported session" when null', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id, '/tmp/vynel/titles')
      insertWorkspace(db, ws)

      importPersistedSessions(
        db,
        [
          makePersistedRecord({
            sessionId: 's-preview',
            workspacePath: ws.path,
            firstUserMessagePreview: 'Plan a 3-day Lisbon trip',
          }),
          makePersistedRecord({
            sessionId: 's-empty',
            workspacePath: ws.path,
            firstUserMessagePreview: null,
          }),
        ],
        { workspaceId: ws.id, workspacePath: ws.path, userId: user.id, providerId: PROVIDER_ID },
      )

      expect(findChatSessionById(db, 's-preview')?.title).toBe('Plan a 3-day Lisbon trip')
      expect(findChatSessionById(db, 's-empty')?.title).toBe('Imported session')
    })
  })

  it('mirrors turnCount → totalMessageCount + lastModifiedAt → lastMessageAt + startedAt → startedAt', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id, '/tmp/vynel/fields')
      insertWorkspace(db, ws)
      const startedAt = new Date('2026-03-01T00:00:00Z')
      const lastModifiedAt = new Date('2026-04-15T00:00:00Z')

      importPersistedSessions(
        db,
        [
          makePersistedRecord({
            sessionId: 's-fields',
            workspacePath: ws.path,
            turnCount: 42,
            startedAt,
            lastModifiedAt,
          }),
        ],
        { workspaceId: ws.id, workspacePath: ws.path, userId: user.id, providerId: PROVIDER_ID },
      )

      const inserted = findChatSessionById(db, 's-fields')
      expect(inserted?.totalMessageCount).toBe(42)
      expect(inserted?.startedAt.toISOString()).toBe(startedAt.toISOString())
      expect(inserted?.lastMessageAt.toISOString()).toBe(lastModifiedAt.toISOString())
      expect(inserted?.totalInputTokens).toBe(0)
      expect(inserted?.totalOutputTokens).toBe(0)
    })
  })

  it('returns importedCount=0 for an empty records array', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id, '/tmp/vynel/empty')
      insertWorkspace(db, ws)

      const result = importPersistedSessions(db, [], {
        workspaceId: ws.id,
        workspacePath: ws.path,
        userId: user.id,
        providerId: PROVIDER_ID,
      })

      expect(result.importedCount).toBe(0)
      expect(listChatSessionsForWorkspace(db, ws.id)).toHaveLength(0)
    })
  })
})
