// `purgeSoftDeletedMemoryEntries` — worker core op. Daily cron at
// 03:00 host-local. Hard-deletes `memory_entries` rows whose
// `deletedAt` is past the 30-day retention window. The CASCADE on
// memory_entry_mentions handles mention cleanup automatically; vec0
// rows were dropped at softDelete time inside `deleteMemoryEntry`
// (vec0 ignores SQL triggers, so vec cleanup is explicit at every
// delete site).
//
// Emits one `memory.entry-hard-deleted` outbox event per purge tick
// summarizing the affected entries (used by Phase 1.5+ consumers
// for analytics / cross-device sync).

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { hardDeleteEntriesDeletedBefore } from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { MEMORY_ENTRY_HARD_DELETED, type MemoryEntryHardDeletedPayload } from '../memory-events.js'
import type { StructuralLogger } from '../memory-types.js'

const RETENTION_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

export type PurgeSoftDeletedMemoryEntriesResult = {
  purgedCount: number
}

export function purgeSoftDeletedMemoryEntries(
  db: Database,
  deps: { logger?: StructuralLogger; now?: () => Date } = {},
): PurgeSoftDeletedMemoryEntriesResult {
  const now = (deps.now ?? (() => new Date()))()
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY)

  const purgedCount = withTransaction(db, (tx) => {
    const count = hardDeleteEntriesDeletedBefore(tx, cutoff)
    // Phase 1.5 consumers (knowledge-graph, sync) want a coarse signal —
    // emit the event with the count when anything was purged. The exact
    // entry ids aren't surfaced (the entries are gone; recovering ids
    // would require a SELECT before DELETE in the same tx, doubling
    // round-trips). Consumers reconcile via their own bookkeeping.
    if (count > 0) {
      // Coarse signal — entryIds empty + userId/workspaceId omitted
      // entirely (the purge sweep spans tenants in Phase 2; the worker
      // doesn't SELECT-before-DELETE just to surface ids). Consumers
      // reconcile via their own bookkeeping. See memory-events.ts.
      // (code-reviewer WARN 2026-05-25 — replaced the typed-but-empty
      // strings with field omission to match the optional contract.)
      const payload: MemoryEntryHardDeletedPayload = {
        entryIds: [],
        hardDeletedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: MEMORY_ENTRY_HARD_DELETED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    }
    return count
  })

  if (purgedCount > 0) {
    deps.logger?.info(
      { purgedCount, cutoff },
      'purgeSoftDeletedMemoryEntries: hard-deleted aged rows',
    )
  }
  return { purgedCount }
}
