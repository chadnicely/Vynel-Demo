// Functional repository for the `memory_entries` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3` + `.claude/rules/
// coding-standard.md`). Spec: `docs/blueprints/memory/blueprint.md §4.1`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// Cursor pagination on the entry-list reads uses keyset on
// (lastMentionedAt DESC NULLS LAST, id DESC) per D22. The cursor's
// NULLS-LAST branch handles the cross-over from non-null entries to
// NULL ones — see the comment block at the cursor logic for the
// reasoning; blueprint §4.1's example code was missing the `OR
// isNull` branch (a pre-rule-era drift; corrected here).

import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  memoryEntries,
  type MemoryEntry,
  type MemoryEntryKind,
  type NewMemoryEntry,
} from '../schema/memory-entries.js'

export type {
  MemoryEntry,
  NewMemoryEntry,
  MemoryEntryKind,
  MemoryEntryCreatedSource,
  MemoryEntryCategory,
} from '../schema/memory-entries.js'

// Defensive caps on the entry-list reads per coding-standard.md
// "Structure / patterns" — every list* that scales with tenant data
// is capped at the repo layer too (the Zod schema also clamps at the
// HTTP boundary).
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

export function findEntryById(db: Database, entryId: string): MemoryEntry | null {
  const [row] = db.select().from(memoryEntries).where(eq(memoryEntries.id, entryId)).limit(1).all()
  return row ?? null
}

export type ListEntriesOptions = {
  kind?: MemoryEntryKind
  includeArchived?: boolean
  cursor?: { lastMentionedAt: Date | null; id: string } | null
  limit?: number
}

// This workspace's entries.
export function listEntriesForWorkspace(
  db: Database,
  workspaceId: string,
  options: ListEntriesOptions = {},
): MemoryEntry[] {
  return listEntriesInScope(db, eq(memoryEntries.workspaceId, workspaceId), options)
}

// The user's GLOBAL entries — the ones anchored to no workspace at all.
// The global memory surface's read; a workspace surface uses the sibling
// above.
//
// SCHEMA CEILING: `workspaceId` is declared with `id()`, which is NOT NULL by
// dialect contract, so no global entry can be written today and this read is
// always empty. It is still the correct read for the settled "Global =
// workspaceId IS NULL" rule, and starts returning rows unchanged the moment
// the column goes nullable and a global write path lands. (knowledge_sources
// took the other branch — `text().references(...)` — for exactly this.)
export function listGlobalEntriesForUser(
  db: Database,
  userId: string,
  options: ListEntriesOptions = {},
): MemoryEntry[] {
  return listEntriesInScope(
    db,
    and(eq(memoryEntries.userId, userId), isNull(memoryEntries.workspaceId))!,
    options,
  )
}

// The one home for the entry-list read: filters + the NULLS-LAST keyset
// pagination. Callers differ only in which rows are in scope.
function listEntriesInScope(
  db: Database,
  scopeCondition: SQL,
  options: ListEntriesOptions,
): MemoryEntry[] {
  const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const conditions = [scopeCondition, isNull(memoryEntries.deletedAt)]
  if (!options.includeArchived) conditions.push(eq(memoryEntries.isArchived, false))
  if (options.kind) conditions.push(eq(memoryEntries.kind, options.kind))

  // Cursor pagination on (lastMentionedAt DESC NULLS LAST, id DESC).
  //
  // The cursor sits at the LAST returned row of the previous page; we want
  // every row that sorts STRICTLY AFTER it in the global ordering.
  //
  //   Cursor at non-null lastMentionedAt X (we're in the non-null section):
  //     - rows with lastMentionedAt < X  (further into the non-null section)
  //     - rows with lastMentionedAt = X and id < cursor.id  (same bucket, later id)
  //     - rows with lastMentionedAt IS NULL  (all the way past, in the null tail)
  //
  //   Cursor at NULL lastMentionedAt (we've crossed into the null tail):
  //     - rows with lastMentionedAt IS NULL and id < cursor.id
  //     - (no non-null rows can sort after a null row under NULLS LAST)
  //
  // Blueprint §4.1's example was missing the `OR IS NULL` branch in the
  // non-null cursor case — would cause NULL rows to never paginate in. Fixed
  // here per D22 + the actual NULLS-LAST semantics.
  if (options.cursor) {
    const { lastMentionedAt: cAt, id: cId } = options.cursor
    if (cAt === null) {
      conditions.push(and(isNull(memoryEntries.lastMentionedAt), lt(memoryEntries.id, cId))!)
    } else {
      conditions.push(
        or(
          lt(memoryEntries.lastMentionedAt, cAt),
          and(eq(memoryEntries.lastMentionedAt, cAt), lt(memoryEntries.id, cId)),
          isNull(memoryEntries.lastMentionedAt),
        )!,
      )
    }
  }

  return db
    .select()
    .from(memoryEntries)
    .where(and(...conditions))
    .orderBy(
      // NULLS LAST emulation in SQLite — primary sort flips IS NULL to a
      // boolean (0/1); non-null rows sort first.
      sql`${memoryEntries.lastMentionedAt} IS NULL`,
      desc(memoryEntries.lastMentionedAt),
      desc(memoryEntries.id),
    )
    .limit(limit)
    .all()
}

export function listEntriesForKindBundle(
  db: Database,
  workspaceId: string,
  kind: MemoryEntryKind,
  limit: number,
): MemoryEntry[] {
  // Used by session-context loading — top-N-per-kind, no cursor (bounded).
  // Defensive cap matches the workspace list; the caller's `topN` defaults
  // to 10 in blueprint §5.5.
  const cappedLimit = Math.min(limit, MAX_LIST_LIMIT)
  return db
    .select()
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.workspaceId, workspaceId),
        eq(memoryEntries.kind, kind),
        eq(memoryEntries.isArchived, false),
        isNull(memoryEntries.deletedAt),
      ),
    )
    .orderBy(desc(memoryEntries.lastMentionedAt), desc(memoryEntries.updatedAt))
    .limit(cappedLimit)
    .all()
}

export function findEntriesNeedingEmbedding(
  db: Database,
  options: { limit?: number } = {},
): MemoryEntry[] {
  return db
    .select()
    .from(memoryEntries)
    .where(and(isNull(memoryEntries.embedding), isNull(memoryEntries.deletedAt)))
    .limit(options.limit ?? DEFAULT_LIST_LIMIT)
    .all()
}

export function insertEntry(db: Database, newEntry: NewMemoryEntry): MemoryEntry {
  const [inserted] = db.insert(memoryEntries).values(newEntry).returning().all()
  if (!inserted) throw new Error('insertEntry: no row returned')
  return inserted
}

export function insertManyEntries(db: Database, newEntries: NewMemoryEntry[]): MemoryEntry[] {
  if (newEntries.length === 0) return []
  return db.insert(memoryEntries).values(newEntries).returning().all()
}

export type UpdateEntryPatch = Partial<
  Omit<MemoryEntry, 'id' | 'userId' | 'workspaceId' | 'createdAt'>
>

export function updateEntry(
  db: Database,
  entryId: string,
  patch: UpdateEntryPatch,
): MemoryEntry | null {
  const [updated] = db
    .update(memoryEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(memoryEntries.id, entryId))
    .returning()
    .all()
  return updated ?? null
}

export function updateEntryEmbedding(
  db: Database,
  entryId: string,
  embedding: Buffer,
  modelVersion: string,
): void {
  db.update(memoryEntries)
    .set({
      embedding,
      embeddingModelVersion: modelVersion,
      updatedAt: new Date(),
    })
    .where(eq(memoryEntries.id, entryId))
    .run()
}

export function touchEntryMentionedAt(db: Database, entryId: string, at: Date): void {
  db.update(memoryEntries).set({ lastMentionedAt: at }).where(eq(memoryEntries.id, entryId)).run()
}

export function softDeleteEntry(db: Database, entryId: string, at: Date): boolean {
  const result = db
    .update(memoryEntries)
    .set({ deletedAt: at, updatedAt: at })
    .where(and(eq(memoryEntries.id, entryId), isNull(memoryEntries.deletedAt)))
    .run()
  return (result.changes ?? 0) > 0
}

export function hardDeleteEntriesDeletedBefore(db: Database, before: Date): number {
  const result = db.delete(memoryEntries).where(lt(memoryEntries.deletedAt, before)).run()
  return result.changes ?? 0
}

export function nullSourceMessageIdsForMessageIds(db: Database, messageIds: string[]): number {
  if (messageIds.length === 0) return 0
  const result = db
    .update(memoryEntries)
    .set({ sourceMessageId: null, updatedAt: new Date() })
    .where(inArray(memoryEntries.sourceMessageId, messageIds))
    .run()
  return result.changes ?? 0
}
