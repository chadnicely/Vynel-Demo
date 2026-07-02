import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findEntryById, searchEntries, upsertVectorIndex } from '@vynel/db/repositories/memory'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { createMemoryEntry } from './create-memory-entry.js'
import { deleteMemoryEntry } from './delete-memory-entry.js'
import { MEMORY_ENTRY_ARCHIVED } from './memory-events.js'

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

function unitVectorAt(idx: number): Buffer {
  const f = new Float32Array(384)
  f[idx] = 1
  return Buffer.from(f.buffer)
}

describe('deleteMemoryEntry', () => {
  it('throws NotFoundError when the entry does not exist', async () => {
    await withTestDatabase((db) => {
      expect(() => deleteMemoryEntry(db, 'nonexistent')).toThrowError(NotFoundError)
    })
  })

  it('throws NotFoundError when the entry is already soft-deleted', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const entry = createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'note',
        body: 'gone',
        category: 'memory',
        section: 'Things to remember',
        createdSource: 'user-manual',
      })
      deleteMemoryEntry(db, entry.id)
      expect(() => deleteMemoryEntry(db, entry.id)).toThrowError(NotFoundError)
    })
  })

  it('soft-deletes the entry + removes its vec0 row + emits memory.entry-archived', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const entry = createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'note',
        body: 'will be deleted',
        category: 'memory',
        section: 'Things to remember',
        createdSource: 'user-manual',
      })
      // Simulate the embedding worker having indexed this entry.
      upsertVectorIndex(db, entry.id, workspace.id, unitVectorAt(0))
      const beforeVec = searchEntries(db, {
        workspaceId: workspace.id,
        embeddingQuery: unitVectorAt(0),
        mode: 'semantic',
      })
      expect(beforeVec).toHaveLength(1)

      deleteMemoryEntry(db, entry.id)

      // Soft-delete: row exists with deletedAt set.
      const after = findEntryById(db, entry.id)
      expect(after?.deletedAt).toBeInstanceOf(Date)
      // vec0 row removed.
      const afterVec = searchEntries(db, {
        workspaceId: workspace.id,
        embeddingQuery: unitVectorAt(0),
        mode: 'semantic',
      })
      expect(afterVec).toHaveLength(0)
      // Outbox event emitted.
      const events = listOutboxEventsByType(db, MEMORY_ENTRY_ARCHIVED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        userId: user.id,
        workspaceId: workspace.id,
        count: 1,
      })
    })
  })
})
