// Functional repository for the `memory_tags` table. `db` first arg,
// Phase 1 SYNC. Tag strings arrive pre-normalized (memory-tags.ts is the
// one normalization gate — the core ops call it before reaching here).

import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { randomUUID } from 'node:crypto'
import { memoryTags, type MemoryTagRow } from '../schema/memory-tags.js'
import { memoryEntries, type MemoryEntry } from '../schema/memory-entries.js'

export type { MemoryTagRow, NewMemoryTagRow } from '../schema/memory-tags.js'

export function insertMemoryTags(
  db: Database,
  memoryEntryId: string,
  tags: string[],
  createdAt: Date,
): void {
  if (tags.length === 0) return
  db.insert(memoryTags)
    .values(tags.map((tag) => ({ id: randomUUID(), memoryEntryId, tag, createdAt })))
    .run()
}

export function deleteMemoryTagsForEntry(db: Database, memoryEntryId: string): void {
  db.delete(memoryTags).where(eq(memoryTags.memoryEntryId, memoryEntryId)).run()
}

/** Tags per entry for a page of entries — one query, grouped in app code. */
export function listMemoryTagsForEntries(
  db: Database,
  memoryEntryIds: string[],
): Map<string, string[]> {
  if (memoryEntryIds.length === 0) return new Map()
  const rows = db
    .select({ memoryEntryId: memoryTags.memoryEntryId, tag: memoryTags.tag })
    .from(memoryTags)
    .where(inArray(memoryTags.memoryEntryId, memoryEntryIds))
    .orderBy(memoryTags.tag)
    .all()
  const byEntry = new Map<string, string[]>()
  for (const row of rows) {
    const list = byEntry.get(row.memoryEntryId) ?? []
    list.push(row.tag)
    byEntry.set(row.memoryEntryId, list)
  }
  return byEntry
}

/** Every distinct tag in use across a workspace's live entries — the picker read. */
export function listDistinctMemoryTagsForWorkspace(db: Database, workspaceId: string): string[] {
  const rows = db
    .selectDistinct({ tag: memoryTags.tag })
    .from(memoryTags)
    .innerJoin(memoryEntries, eq(memoryTags.memoryEntryId, memoryEntries.id))
    .where(and(eq(memoryEntries.workspaceId, workspaceId), isNull(memoryEntries.deletedAt)))
    .orderBy(memoryTags.tag)
    .all()
  return rows.map((row) => row.tag)
}

/** The workspace's live entries wearing a given tag, freshest first — the
 *  `context` session-start read. */
export function listEntriesByTag(
  db: Database,
  input: { workspaceId: string; tag: string; limit: number },
): MemoryEntry[] {
  const rows = db
    .select({ entry: memoryEntries })
    .from(memoryTags)
    .innerJoin(memoryEntries, eq(memoryTags.memoryEntryId, memoryEntries.id))
    .where(
      and(
        eq(memoryTags.tag, input.tag),
        eq(memoryEntries.workspaceId, input.workspaceId),
        eq(memoryEntries.isArchived, false),
        isNull(memoryEntries.deletedAt),
      ),
    )
    .orderBy(desc(memoryEntries.updatedAt))
    .limit(input.limit)
    .all()
  return rows.map((row) => row.entry)
}
