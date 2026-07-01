// Repository integration tests for the `memory_entry_mentions`
// table. Spec: blueprint §4.2.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertEntry } from './memory-entries.js'
import {
  insertMention,
  insertManyMentions,
  listRecentMentionsForEntry,
  countMentionsForEntry,
  deleteMentionsForSessionIds,
  type NewMemoryEntryMention,
} from './memory-entry-mentions.js'

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

function makeEntry(userId: string, workspaceId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    kind: 'person' as const,
    title: 'Sarah Chen',
    body: 'Head of partnerships at Acme.',
    category: 'memory' as const,
    section: 'Key contacts',
    sourceMessageId: null,
    createdSource: 'user-manual' as const,
    embedding: null,
    embeddingModelVersion: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastMentionedAt: null,
    deletedAt: null,
  }
}

function makeMention(
  memoryEntryId: string,
  overrides: Partial<NewMemoryEntryMention> = {},
): NewMemoryEntryMention {
  return {
    id: randomUUID(),
    memoryEntryId,
    sessionId: `session-${randomUUID()}`,
    messageId: `message-${randomUUID()}`,
    mentionKind: 'session-context-load',
    mentionedAt: new Date(),
    ...overrides,
  }
}

describe('memory-entry-mentions repository', () => {
  describe('insertMention', () => {
    it('persists the row + returns it', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const entry = insertEntry(db, makeEntry(user.id, workspace.id))
        const inserted = insertMention(db, makeMention(entry.id, { mentionKind: 'agent-citation' }))
        expect(inserted.memoryEntryId).toBe(entry.id)
        expect(inserted.mentionKind).toBe('agent-citation')
      })
    })
  })

  describe('insertManyMentions', () => {
    it('bulk-inserts + returns all rows', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const entry = insertEntry(db, makeEntry(user.id, workspace.id))
        const rows = insertManyMentions(db, [
          makeMention(entry.id),
          makeMention(entry.id, { mentionKind: 'tool-output' }),
          makeMention(entry.id, { mentionKind: 'agent-citation' }),
        ])
        expect(rows).toHaveLength(3)
      })
    })

    it('returns empty for empty input', async () => {
      await withTestDatabase((db) => {
        expect(insertManyMentions(db, [])).toEqual([])
      })
    })
  })

  describe('listRecentMentionsForEntry', () => {
    it('orders DESC by mentionedAt + respects limit', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const entry = insertEntry(db, makeEntry(user.id, workspace.id))
        const t0 = new Date('2026-05-01T00:00:00Z')
        const t1 = new Date('2026-05-10T00:00:00Z')
        const t2 = new Date('2026-05-20T00:00:00Z')
        insertMention(db, makeMention(entry.id, { mentionedAt: t0, sessionId: 's-old' }))
        insertMention(db, makeMention(entry.id, { mentionedAt: t1, sessionId: 's-mid' }))
        insertMention(db, makeMention(entry.id, { mentionedAt: t2, sessionId: 's-new' }))

        const recent = listRecentMentionsForEntry(db, entry.id, { limit: 2 })
        expect(recent.map((m) => m.sessionId)).toEqual(['s-new', 's-mid'])
      })
    })
  })

  describe('countMentionsForEntry', () => {
    it('returns the count', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const entry = insertEntry(db, makeEntry(user.id, workspace.id))
        expect(countMentionsForEntry(db, entry.id)).toBe(0)
        insertManyMentions(db, [makeMention(entry.id), makeMention(entry.id)])
        expect(countMentionsForEntry(db, entry.id)).toBe(2)
      })
    })
  })

  describe('deleteMentionsForSessionIds', () => {
    it('removes rows by sessionId batch + returns count', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const entry = insertEntry(db, makeEntry(user.id, workspace.id))
        insertMention(db, makeMention(entry.id, { sessionId: 's-1' }))
        insertMention(db, makeMention(entry.id, { sessionId: 's-2' }))
        insertMention(db, makeMention(entry.id, { sessionId: 's-3' }))

        const count = deleteMentionsForSessionIds(db, ['s-1', 's-3'])
        expect(count).toBe(2)
        const remaining = listRecentMentionsForEntry(db, entry.id)
        expect(remaining.map((m) => m.sessionId)).toEqual(['s-2'])
      })
    })

    it('returns 0 for empty sessionIds (no SQL emitted)', async () => {
      await withTestDatabase((db) => {
        expect(deleteMentionsForSessionIds(db, [])).toBe(0)
      })
    })
  })
})
