// Repository integration tests for the `memory_entries` table. Real
// SQLite via the local `withTestDatabase` helper (per `foundation.md
// §2 row 12` — no DB mocking). Spec: blueprint §4.1.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import {
  findEntryById,
  listEntriesForWorkspace,
  listEntriesForKindBundle,
  findEntriesNeedingEmbedding,
  insertEntry,
  insertManyEntries,
  updateEntry,
  updateEntryEmbedding,
  touchEntryMentionedAt,
  softDeleteEntry,
  hardDeleteEntriesDeletedBefore,
  nullSourceMessageIdsForMessageIds,
  type NewMemoryEntry,
  type MemoryEntryKind,
} from './memory-entries.js'

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
    kind: 'person' as MemoryEntryKind,
    title: 'Sarah Chen',
    body: 'Head of partnerships at Acme.',
    category: 'memory',
    section: 'Key contacts',
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

describe('memory-entries repository', () => {
  describe('findEntryById', () => {
    it('returns the row when present', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertEntry(db, makeEntry(user.id, workspace.id))
        const found = findEntryById(db, inserted.id)
        expect(found?.id).toBe(inserted.id)
        expect(found?.title).toBe('Sarah Chen')
      })
    })

    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        expect(findEntryById(db, 'nonexistent')).toBeNull()
      })
    })
  })

  describe('listEntriesForWorkspace', () => {
    it('filters out archived + soft-deleted by default', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertEntry(db, makeEntry(user.id, workspace.id, { title: 'visible' }))
        insertEntry(db, makeEntry(user.id, workspace.id, { title: 'archived', isArchived: true }))
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { title: 'deleted', deletedAt: new Date() }),
        )
        const entries = listEntriesForWorkspace(db, workspace.id)
        expect(entries.map((e) => e.title)).toEqual(['visible'])
      })
    })

    it('returns archived entries when includeArchived=true', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertEntry(db, makeEntry(user.id, workspace.id, { title: 'visible' }))
        insertEntry(db, makeEntry(user.id, workspace.id, { title: 'archived', isArchived: true }))
        const entries = listEntriesForWorkspace(db, workspace.id, { includeArchived: true })
        const titles = entries.map((e) => e.title).sort()
        expect(titles).toEqual(['archived', 'visible'])
      })
    })

    it('filters by kind when provided', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'person', title: 'p' }))
        insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'note', title: 'n' }))
        const entries = listEntriesForWorkspace(db, workspace.id, { kind: 'note' })
        expect(entries.map((e) => e.title)).toEqual(['n'])
      })
    })

    it('paginates by (lastMentionedAt DESC NULLS LAST, id DESC) per D22', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        // Three buckets to exercise NULLS-LAST + within-bucket id ordering:
        //   - 2 with lastMentionedAt = t1 (newer)
        //   - 2 with lastMentionedAt = t0 (older)
        //   - 2 with lastMentionedAt = null (NULL — sorts last)
        const t0 = new Date('2026-05-01T00:00:00Z')
        const t1 = new Date('2026-05-15T00:00:00Z')
        // Use sortable UUIDs by hand so id ordering is predictable.
        const seq = (suffix: string) => `00000000-0000-0000-0000-00000000000${suffix}`
        const ids = ['1', '2', '3', '4', '5', '6'].map(seq)
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[0]!, lastMentionedAt: t1, title: 'newer-a' }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[1]!, lastMentionedAt: t1, title: 'newer-b' }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[2]!, lastMentionedAt: t0, title: 'older-a' }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[3]!, lastMentionedAt: t0, title: 'older-b' }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[4]!, lastMentionedAt: null, title: 'null-a' }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[5]!, lastMentionedAt: null, title: 'null-b' }),
        )

        const all = listEntriesForWorkspace(db, workspace.id, { limit: 10 })
        // Expected order: newer (DESC id) → older (DESC id) → null (DESC id)
        expect(all.map((e) => e.title)).toEqual([
          'newer-b',
          'newer-a',
          'older-b',
          'older-a',
          'null-b',
          'null-a',
        ])
      })
    })

    it('keyset cursor crosses from non-null section into NULL tail correctly', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const t0 = new Date('2026-05-01T00:00:00Z')
        const seq = (s: string) => `00000000-0000-0000-0000-00000000000${s}`
        const ids = ['1', '2', '3', '4'].map(seq)
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[0]!, lastMentionedAt: t0, title: 'older-a' }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[1]!, lastMentionedAt: t0, title: 'older-b' }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[2]!, lastMentionedAt: null, title: 'null-a' }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { id: ids[3]!, lastMentionedAt: null, title: 'null-b' }),
        )

        // Page 1 — page size 2; should return [older-b, older-a].
        const page1 = listEntriesForWorkspace(db, workspace.id, { limit: 2 })
        expect(page1.map((e) => e.title)).toEqual(['older-b', 'older-a'])

        // Cursor at the last row of page 1 — `older-a` (non-null lastMentionedAt).
        // Page 2 MUST include the null rows (the bug-prone branch).
        const last1 = page1.at(-1)!
        const page2 = listEntriesForWorkspace(db, workspace.id, {
          limit: 2,
          cursor: { lastMentionedAt: last1.lastMentionedAt, id: last1.id },
        })
        expect(page2.map((e) => e.title)).toEqual(['null-b', 'null-a'])

        // Cursor at the last row of page 2 — `null-a` (null lastMentionedAt).
        // Page 3 should be empty (no more rows).
        const last2 = page2.at(-1)!
        const page3 = listEntriesForWorkspace(db, workspace.id, {
          limit: 2,
          cursor: { lastMentionedAt: last2.lastMentionedAt, id: last2.id },
        })
        expect(page3).toHaveLength(0)
      })
    })
  })

  describe('listEntriesForKindBundle', () => {
    it('returns top-N for the kind, archived/deleted excluded', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const t1 = new Date('2026-05-15T00:00:00Z')
        const t0 = new Date('2026-05-01T00:00:00Z')
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { kind: 'person', title: 'p1', lastMentionedAt: t1 }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { kind: 'person', title: 'p2', lastMentionedAt: t0 }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, {
            kind: 'person',
            title: 'p3',
            lastMentionedAt: t0,
            isArchived: true,
          }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { kind: 'note', title: 'n1', lastMentionedAt: t1 }),
        )

        const persons = listEntriesForKindBundle(db, workspace.id, 'person', 10)
        expect(persons.map((e) => e.title)).toEqual(['p1', 'p2']) // p3 archived
      })
    })
  })

  describe('findEntriesNeedingEmbedding', () => {
    it('returns only rows with null embedding (excludes soft-deleted)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertEntry(db, makeEntry(user.id, workspace.id, { title: 'pending' }))
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, {
            title: 'embedded',
            embedding: Buffer.alloc(16, 1),
            embeddingModelVersion: 'v1',
          }),
        )
        insertEntry(
          db,
          makeEntry(user.id, workspace.id, { title: 'pending-but-deleted', deletedAt: new Date() }),
        )

        const pending = findEntriesNeedingEmbedding(db)
        expect(pending.map((e) => e.title)).toEqual(['pending'])
      })
    })
  })

  describe('insertEntry / insertManyEntries', () => {
    it('insertEntry persists every column + returns the row', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const buf = Buffer.alloc(1536, 7)
        const inserted = insertEntry(
          db,
          makeEntry(user.id, workspace.id, {
            title: 'with-embedding',
            embedding: buf,
            embeddingModelVersion: 'all-MiniLM-L6-v2/v1',
            sourceMessageId: 'msg_abc',
          }),
        )
        expect(inserted.title).toBe('with-embedding')
        expect(inserted.embedding).toEqual(buf)
        expect(inserted.embeddingModelVersion).toBe('all-MiniLM-L6-v2/v1')
        expect(inserted.sourceMessageId).toBe('msg_abc')
      })
    })

    it('insertManyEntries bulk-inserts + returns all rows', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const rows = insertManyEntries(db, [
          makeEntry(user.id, workspace.id, { title: 'a' }),
          makeEntry(user.id, workspace.id, { title: 'b' }),
          makeEntry(user.id, workspace.id, { title: 'c' }),
        ])
        expect(rows.map((r) => r.title).sort()).toEqual(['a', 'b', 'c'])
      })
    })

    it('insertManyEntries with empty array returns empty', async () => {
      await withTestDatabase((db) => {
        expect(insertManyEntries(db, [])).toEqual([])
      })
    })
  })

  describe('updateEntry', () => {
    it('patches columns + touches updatedAt', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const original = insertEntry(db, makeEntry(user.id, workspace.id))
        // Avoid sub-ms timing collisions in the assertion.
        const before = original.updatedAt.getTime()
        const updated = updateEntry(db, original.id, { title: 'changed' })
        expect(updated?.title).toBe('changed')
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
      })
    })

    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        expect(updateEntry(db, 'nonexistent', { title: 'x' })).toBeNull()
      })
    })
  })

  describe('updateEntryEmbedding', () => {
    it('writes the buffer + model version', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const original = insertEntry(db, makeEntry(user.id, workspace.id))
        expect(original.embedding).toBeNull()
        const buf = Buffer.alloc(1536, 3)
        updateEntryEmbedding(db, original.id, buf, 'all-MiniLM-L6-v2/v1')
        const after = findEntryById(db, original.id)
        expect(after?.embedding).toEqual(buf)
        expect(after?.embeddingModelVersion).toBe('all-MiniLM-L6-v2/v1')
      })
    })
  })

  describe('touchEntryMentionedAt', () => {
    it('sets the lastMentionedAt cache', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const original = insertEntry(db, makeEntry(user.id, workspace.id))
        expect(original.lastMentionedAt).toBeNull()
        const at = new Date('2026-05-25T11:00:00Z')
        touchEntryMentionedAt(db, original.id, at)
        const after = findEntryById(db, original.id)
        expect(after?.lastMentionedAt?.getTime()).toBe(at.getTime())
      })
    })
  })

  describe('softDeleteEntry', () => {
    it('returns true once, false on re-call', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const original = insertEntry(db, makeEntry(user.id, workspace.id))
        const first = softDeleteEntry(db, original.id, new Date())
        const second = softDeleteEntry(db, original.id, new Date())
        expect(first).toBe(true)
        expect(second).toBe(false) // already deleted; the IS NULL guard kicks in
        const after = findEntryById(db, original.id)
        expect(after?.deletedAt).toBeInstanceOf(Date)
      })
    })
  })

  describe('hardDeleteEntriesDeletedBefore', () => {
    it('purges past-retention rows + returns count', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const expired = insertEntry(
          db,
          makeEntry(user.id, workspace.id, {
            title: 'expired',
            deletedAt: new Date('2026-04-01T00:00:00Z'),
          }),
        )
        const recent = insertEntry(
          db,
          makeEntry(user.id, workspace.id, {
            title: 'recent',
            deletedAt: new Date('2026-05-20T00:00:00Z'),
          }),
        )
        const cutoff = new Date('2026-05-10T00:00:00Z')
        const count = hardDeleteEntriesDeletedBefore(db, cutoff)
        expect(count).toBe(1)
        expect(findEntryById(db, expired.id)).toBeNull()
        expect(findEntryById(db, recent.id)).not.toBeNull()
      })
    })
  })

  describe('nullSourceMessageIdsForMessageIds', () => {
    it('nulls matching sourceMessageId + returns count', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertEntry(db, makeEntry(user.id, workspace.id, { title: 'a', sourceMessageId: 'msg_1' }))
        insertEntry(db, makeEntry(user.id, workspace.id, { title: 'b', sourceMessageId: 'msg_2' }))
        insertEntry(db, makeEntry(user.id, workspace.id, { title: 'c', sourceMessageId: 'msg_3' }))
        const count = nullSourceMessageIdsForMessageIds(db, ['msg_1', 'msg_3'])
        expect(count).toBe(2)
        const all = listEntriesForWorkspace(db, workspace.id)
        const byTitle = Object.fromEntries(all.map((e) => [e.title, e.sourceMessageId]))
        expect(byTitle.a).toBeNull()
        expect(byTitle.b).toBe('msg_2')
        expect(byTitle.c).toBeNull()
      })
    })

    it('returns 0 for empty messageIds (no SQL emitted)', async () => {
      await withTestDatabase((db) => {
        const count = nullSourceMessageIdsForMessageIds(db, [])
        expect(count).toBe(0)
      })
    })
  })
})
