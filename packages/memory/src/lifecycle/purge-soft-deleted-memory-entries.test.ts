import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findEntryById, insertEntry } from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { purgeSoftDeletedMemoryEntries } from './purge-soft-deleted-memory-entries.js'
import { MEMORY_ENTRY_HARD_DELETED } from '../memory-events.js'

function seedWorld(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

function seedDeletedEntry(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspaceId: string,
  deletedAt: Date,
) {
  const now = new Date()
  return insertEntry(db, {
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
    updatedAt: deletedAt,
    lastMentionedAt: null,
    deletedAt,
  })
}

describe('purgeSoftDeletedMemoryEntries', () => {
  it('hard-deletes entries whose deletedAt is past the 30-day retention', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const now = new Date('2026-06-01T00:00:00Z')
      // Long-ago soft-delete — past retention.
      const expired = seedDeletedEntry(db, user.id, workspace.id, new Date('2026-04-01T00:00:00Z'))
      // Recent soft-delete — within retention.
      const recent = seedDeletedEntry(db, user.id, workspace.id, new Date('2026-05-20T00:00:00Z'))

      const result = purgeSoftDeletedMemoryEntries(db, { now: () => now })
      expect(result.purgedCount).toBe(1)
      expect(findEntryById(db, expired.id)).toBeNull()
      expect(findEntryById(db, recent.id)).not.toBeNull()
    })
  })

  it('emits memory.entry-hard-deleted exactly once when something was purged', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const now = new Date('2026-06-01T00:00:00Z')
      seedDeletedEntry(db, user.id, workspace.id, new Date('2026-04-01T00:00:00Z'))
      seedDeletedEntry(db, user.id, workspace.id, new Date('2026-04-15T00:00:00Z'))

      purgeSoftDeletedMemoryEntries(db, { now: () => now })

      const events = listOutboxEventsByType(db, MEMORY_ENTRY_HARD_DELETED)
      expect(events).toHaveLength(1) // one coarse event per purge tick
    })
  })

  it('emits no event when nothing was purged', async () => {
    await withTestDatabase((db) => {
      const result = purgeSoftDeletedMemoryEntries(db, { now: () => new Date() })
      expect(result.purgedCount).toBe(0)
      expect(listOutboxEventsByType(db, MEMORY_ENTRY_HARD_DELETED)).toHaveLength(0)
    })
  })
})
