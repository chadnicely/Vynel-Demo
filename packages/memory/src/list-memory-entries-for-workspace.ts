// `listMemoryEntriesForWorkspace` — read op for the panel's entry
// list view. Thin wrapper over `listEntriesForWorkspace` (repo)
// that converts the API-side ISO-string cursor to the repo's `Date`
// cursor + returns the `nextCursor` envelope. Recency-first,
// NULLS-LAST cursor pagination.

import {
  listEntriesForWorkspace,
  type MemoryEntry,
  type MemoryEntryKind,
} from '@vynel/db/repositories/memory'
import type { Database } from '@vynel/db'

export type ListMemoryEntriesCursor = {
  lastMentionedAt: string | null
  id: string
}

export type ListMemoryEntriesInput = {
  workspaceId: string
  kind?: MemoryEntryKind
  includeArchived?: boolean
  cursor?: ListMemoryEntriesCursor | null
  limit?: number
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
  const limit = input.limit ?? DEFAULT_PAGE_SIZE
  const cursor = input.cursor
    ? {
        lastMentionedAt: input.cursor.lastMentionedAt
          ? new Date(input.cursor.lastMentionedAt)
          : null,
        id: input.cursor.id,
      }
    : null

  // Conditional spread for optional fields — exactOptionalPropertyTypes
  // rejects `{ kind: input.kind }` when input.kind is `undefined`.
  const options: Parameters<typeof listEntriesForWorkspace>[2] = {
    cursor,
    limit,
  }
  if (input.kind !== undefined) options.kind = input.kind
  if (input.includeArchived !== undefined) options.includeArchived = input.includeArchived

  const entries = listEntriesForWorkspace(db, input.workspaceId, options)

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
