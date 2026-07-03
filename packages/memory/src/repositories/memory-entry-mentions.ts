// Functional repository for the `memory_entry_mentions` table.
// Spec: `docs/blueprints/memory/blueprint.md §4.2`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// `memory_entry_mentions` carries NO `userId` column — it scopes via
// `memoryEntryId → memory_entries.userId` per the locked "userId on
// top-level user-owned tables only" rule. Cross-domain refs
// (sessionId, messageId) are loose `text()` per
// `cross-domain-loose-ref-with-outbox-mirror`.

import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  memoryEntryMentions,
  type MemoryEntryMention,
  type NewMemoryEntryMention,
} from '../schema/memory-entry-mentions.js'

export type {
  MemoryEntryMention,
  NewMemoryEntryMention,
  MentionKind,
} from '../schema/memory-entry-mentions.js'

// Defensive cap matches memory-entries.ts.
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 200

export function insertMention(db: Database, mention: NewMemoryEntryMention): MemoryEntryMention {
  const [inserted] = db.insert(memoryEntryMentions).values(mention).returning().all()
  if (!inserted) throw new Error('insertMention: no row returned')
  return inserted
}

export function insertManyMentions(
  db: Database,
  mentions: NewMemoryEntryMention[],
): MemoryEntryMention[] {
  if (mentions.length === 0) return []
  return db.insert(memoryEntryMentions).values(mentions).returning().all()
}

export function listRecentMentionsForEntry(
  db: Database,
  entryId: string,
  options: { limit?: number } = {},
): MemoryEntryMention[] {
  const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(memoryEntryMentions)
    .where(eq(memoryEntryMentions.memoryEntryId, entryId))
    .orderBy(desc(memoryEntryMentions.mentionedAt))
    .limit(limit)
    .all()
}

export function countMentionsForEntry(db: Database, entryId: string): number {
  const [row] = db
    .select({ value: count() })
    .from(memoryEntryMentions)
    .where(eq(memoryEntryMentions.memoryEntryId, entryId))
    .all()
  return Number(row?.value ?? 0)
}

export function deleteMentionsForSessionIds(db: Database, sessionIds: string[]): number {
  if (sessionIds.length === 0) return 0
  const result = db
    .delete(memoryEntryMentions)
    .where(inArray(memoryEntryMentions.sessionId, sessionIds))
    .run()
  return result.changes ?? 0
}
