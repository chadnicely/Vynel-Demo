// `updateMemoryEntry` — patches a memory entry's mutable fields
// (title, body, kind, isArchived). When `body` changes, resets the
// embedding to null so the embedding worker re-computes it on its
// next cron tick. Co-commits a `memory.entry-updated` outbox event.
// Throws `NotFoundError('memory-entry', id)` when no row matches.

import { randomUUID } from 'node:crypto'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import {
  findEntryById,
  updateEntry,
  deleteMemoryTagsForEntry,
  insertMemoryTags,
  type MemoryEntry,
  type MemoryEntryKind,
} from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { signalEmbeddingWorker } from '../indexing/embedding-worker-signal.js'
import { normalizeMemoryTags } from '../memory-tags.js'
import { MEMORY_ENTRY_UPDATED, type MemoryEntryUpdatedPayload } from '../memory-events.js'

export type UpdateMemoryEntryInput = {
  title?: string
  body?: string
  kind?: MemoryEntryKind
  isArchived?: boolean
  /** REPLACE semantics: the entry's tags become exactly this list. */
  tags?: string[]
}

export function updateMemoryEntry(
  db: Database,
  entryId: string,
  input: UpdateMemoryEntryInput,
): MemoryEntry {
  const willChangeBody = input.body !== undefined
  const updatedFields = Object.keys(input)
  const replacementTags = input.tags !== undefined ? normalizeMemoryTags(input.tags) : undefined
  const result = withTransaction(db, (tx) => {
    const before = findEntryById(tx, entryId)
    if (!before) throw new NotFoundError('memory-entry', entryId)

    if (replacementTags !== undefined) {
      deleteMemoryTagsForEntry(tx, entryId)
      insertMemoryTags(tx, entryId, replacementTags, new Date())
    }

    // Conditional spread for optional fields (exactOptionalPropertyTypes).
    const patch: Parameters<typeof updateEntry>[2] = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.body !== undefined) patch.body = input.body
    if (input.kind !== undefined) patch.kind = input.kind
    if (input.isArchived !== undefined) patch.isArchived = input.isArchived
    if (willChangeBody) {
      patch.embedding = null
      patch.embeddingModelVersion = null
    }

    const updated = updateEntry(tx, entryId, patch)
    if (!updated) throw new NotFoundError('memory-entry', entryId)

    const payload: MemoryEntryUpdatedPayload = {
      entryId: updated.id,
      userId: updated.userId,
      workspaceId: updated.workspaceId,
      updatedFields,
      updatedAt: updated.updatedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: MEMORY_ENTRY_UPDATED,
      payload,
      createdAt: updated.updatedAt,
      processedAt: null,
    })
    return updated
  })
  if (willChangeBody) signalEmbeddingWorker()
  return result
}
