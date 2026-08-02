// `createMemoryEntry` — the panel POST + onboarding-seed entry point.
// Co-commits the entry row + a `memory.entry-created` outbox event in
// one transaction; signals the embedding worker after the tx commits
// (no-op stub Phase 1).

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import {
  insertEntry,
  insertMemoryTags,
  type MemoryEntry,
  type MemoryEntryKind,
  type MemoryEntryCreatedSource,
} from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { deriveTitleFromBody } from './derive-title-from-body.js'
import { signalEmbeddingWorker } from '../indexing/embedding-worker-signal.js'
import { normalizeMemoryTags } from '../memory-tags.js'
import { MEMORY_ENTRY_CREATED, type MemoryEntryCreatedPayload } from '../memory-events.js'

export type CreateMemoryEntryInput = {
  userId: string
  /** Null anchors the entry at the USER level — a global memory, owned by the
   *  person rather than by any one workspace. */
  workspaceId: string | null
  kind: MemoryEntryKind
  title?: string
  body: string
  category: 'user' | 'preferences' | 'memory'
  section: string
  sourceMessageId?: string
  createdSource: MemoryEntryCreatedSource
  /** Open topical labels + the behavioral `context` tag — normalized here. */
  tags?: string[]
}

export function createMemoryEntry(db: Database, input: CreateMemoryEntryInput): MemoryEntry {
  const now = new Date()
  const tags = normalizeMemoryTags(input.tags)
  const entry = withTransaction(db, (tx) => {
    const row = insertEntry(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      title: input.title?.trim() || deriveTitleFromBody(input.body),
      body: input.body,
      category: input.category,
      section: input.section,
      sourceMessageId: input.sourceMessageId ?? null,
      createdSource: input.createdSource,
      embedding: null,
      embeddingModelVersion: null,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      lastMentionedAt: null,
      deletedAt: null,
    })
    insertMemoryTags(tx, row.id, tags, now)
    const payload: MemoryEntryCreatedPayload = {
      entryId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      kind: row.kind,
      category: row.category,
      section: row.section,
      createdSource: row.createdSource,
      createdAt: row.createdAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: MEMORY_ENTRY_CREATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return row
  })
  signalEmbeddingWorker()
  return entry
}
