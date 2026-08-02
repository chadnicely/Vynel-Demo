// The panel's entry-list reads — one per scope. Thin wrappers over the
// repo (`listEntriesForWorkspace` / `listGlobalEntriesForUser`) that
// convert the API-side ISO-string cursor to the repo's `Date` cursor and
// return the `nextCursor` envelope. Recency-first, NULLS-LAST cursor
// pagination.

import {
  listEntriesForWorkspace,
  listGlobalEntriesForUser,
  type ListEntriesOptions,
  type MemoryEntry,
  type MemoryEntryKind,
} from '../repositories/index.js'
import type { Database } from '@vynel/db'

export type ListMemoryEntriesCursor = {
  lastMentionedAt: string | null
  id: string
}

type ListMemoryEntriesFilters = {
  kind?: MemoryEntryKind
  includeArchived?: boolean
  cursor?: ListMemoryEntriesCursor | null
  limit?: number
}

export type ListMemoryEntriesInput = ListMemoryEntriesFilters & {
  workspaceId: string
}

export type ListGlobalMemoryEntriesInput = ListMemoryEntriesFilters & {
  userId: string
}

export type ListMemoryEntriesResult = {
  entries: MemoryEntry[]
  nextCursor: ListMemoryEntriesCursor | null
}

const DEFAULT_PAGE_SIZE = 50

export function listMemoryEntriesForWorkspace(
  db: Database,
  input: ListMemoryEntriesInput,
): ListMemoryEntriesResult {
  return pageEntries(input, (options) => listEntriesForWorkspace(db, input.workspaceId, options))
}

// The GLOBAL surface's read — entries anchored to no workspace at all.
export function listGlobalMemoryEntriesForUser(
  db: Database,
  input: ListGlobalMemoryEntriesInput,
): ListMemoryEntriesResult {
  return pageEntries(input, (options) => listGlobalEntriesForUser(db, input.userId, options))
}

// The one home for the cursor translation + the nextCursor envelope; the
// two reads above differ only in which rows they page over.
function pageEntries(
  filters: ListMemoryEntriesFilters,
  read: (options: ListEntriesOptions) => MemoryEntry[],
): ListMemoryEntriesResult {
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE
  const cursor = filters.cursor
    ? {
        lastMentionedAt: filters.cursor.lastMentionedAt
          ? new Date(filters.cursor.lastMentionedAt)
          : null,
        id: filters.cursor.id,
      }
    : null

  // Conditional spread for optional fields — exactOptionalPropertyTypes
  // rejects `{ kind: filters.kind }` when filters.kind is `undefined`.
  const options: ListEntriesOptions = { cursor, limit }
  if (filters.kind !== undefined) options.kind = filters.kind
  if (filters.includeArchived !== undefined) options.includeArchived = filters.includeArchived

  const entries = read(options)

  // nextCursor is null when the result didn't fill the page (no more
  // rows behind us in the sort order).
  let nextCursor: ListMemoryEntriesCursor | null = null
  if (entries.length === limit) {
    const last = entries[entries.length - 1]!
    nextCursor = {
      lastMentionedAt: last.lastMentionedAt ? last.lastMentionedAt.toISOString() : null,
      id: last.id,
    }
  }
  return { entries, nextCursor }
}
