import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertEntry, type NewMemoryEntry } from '../repositories/index.js'
import {
  listGlobalMemoryEntriesForUser,
  listMemoryEntriesForWorkspace,
} from './list-memory-entries-for-workspace.js'

function seedUser(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}
function seedWorkspace(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0], userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}
function makeEntry(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewMemoryEntry> = {},
): NewMemoryEntry {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    kind: 'note',
    title: 'T',
    body: 'B',
    category: 'memory',
    section: 'Things to remember',
    sourceMessageId: null,
    createdSource: 'user-manual',
    embedding: null,
    embeddingModelVersion: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastMentionedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

describe('listMemoryEntriesForWorkspace', () => {
  it('returns null nextCursor when result is shorter than limit', async () => {
    await withTestDatabase((db) => {
      const u = seedUser(db)
      const w = seedWorkspace(db, u.id)
      insertEntry(db, makeEntry(u.id, w.id, { title: 'a' }))
      insertEntry(db, makeEntry(u.id, w.id, { title: 'b' }))
      const result = listMemoryEntriesForWorkspace(db, { workspaceId: w.id, limit: 50 })
      expect(result.entries).toHaveLength(2)
      expect(result.nextCursor).toBeNull()
    })
  })

  it('returns a non-null nextCursor when result fills the page', async () => {
    await withTestDatabase((db) => {
      const u = seedUser(db)
      const w = seedWorkspace(db, u.id)
      const t1 = new Date('2026-05-20T00:00:00Z')
      insertEntry(db, makeEntry(u.id, w.id, { title: 'a', lastMentionedAt: t1 }))
      insertEntry(db, makeEntry(u.id, w.id, { title: 'b', lastMentionedAt: t1 }))
      insertEntry(db, makeEntry(u.id, w.id, { title: 'c' }))
      const result = listMemoryEntriesForWorkspace(db, { workspaceId: w.id, limit: 2 })
      expect(result.entries).toHaveLength(2)
      expect(result.nextCursor).not.toBeNull()
      expect(result.nextCursor?.id).toBe(result.entries[1]!.id)
    })
  })

  it('round-trips a non-null lastMentionedAt cursor (ISO string ↔ Date)', async () => {
    await withTestDatabase((db) => {
      const u = seedUser(db)
      const w = seedWorkspace(db, u.id)
      const t1 = new Date('2026-05-20T00:00:00Z')
      const t0 = new Date('2026-05-10T00:00:00Z')
      const seq = (s: string) => `00000000-0000-0000-0000-00000000000${s}`
      insertEntry(db, makeEntry(u.id, w.id, { id: seq('1'), title: 'newer', lastMentionedAt: t1 }))
      insertEntry(db, makeEntry(u.id, w.id, { id: seq('2'), title: 'older', lastMentionedAt: t0 }))

      // Page 1
      const page1 = listMemoryEntriesForWorkspace(db, { workspaceId: w.id, limit: 1 })
      expect(page1.entries[0]?.title).toBe('newer')
      expect(page1.nextCursor?.lastMentionedAt).toBe(t1.toISOString())

      // Page 2 (using the ISO cursor from page 1)
      const page2 = listMemoryEntriesForWorkspace(db, {
        workspaceId: w.id,
        limit: 1,
        cursor: page1.nextCursor,
      })
      expect(page2.entries[0]?.title).toBe('older')
    })
  })

  it('passes through kind filter + includeArchived flag', async () => {
    await withTestDatabase((db) => {
      const u = seedUser(db)
      const w = seedWorkspace(db, u.id)
      insertEntry(db, makeEntry(u.id, w.id, { kind: 'note', title: 'a' }))
      insertEntry(db, makeEntry(u.id, w.id, { kind: 'person', title: 'b' }))
      insertEntry(db, makeEntry(u.id, w.id, { kind: 'note', title: 'c', isArchived: true }))

      const notes = listMemoryEntriesForWorkspace(db, { workspaceId: w.id, kind: 'note' })
      expect(notes.entries.map((e) => e.title)).toEqual(['a'])

      const withArchived = listMemoryEntriesForWorkspace(db, {
        workspaceId: w.id,
        kind: 'note',
        includeArchived: true,
      })
      expect(withArchived.entries.map((e) => e.title).sort()).toEqual(['a', 'c'])
    })
  })
})

describe('listGlobalMemoryEntriesForUser', () => {
  // See the SCHEMA CEILING note on the repo's `listGlobalEntriesForUser`
  // test: `workspace_id` is NOT NULL today, so the global set is always
  // empty. What this pins is that a workspace's entries never surface on the
  // global read, and that the empty page still answers in the paged envelope.
  it("answers the paged envelope without any workspace's entries", async () => {
    await withTestDatabase((db) => {
      const u = seedUser(db)
      const w = seedWorkspace(db, u.id)
      insertEntry(db, makeEntry(u.id, w.id, { title: 'a' }))

      expect(listGlobalMemoryEntriesForUser(db, { userId: u.id })).toEqual({
        entries: [],
        nextCursor: null,
      })
    })
  })
})
