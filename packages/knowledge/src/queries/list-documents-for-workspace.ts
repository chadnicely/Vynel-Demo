// `listDocumentsForWorkspace` — sync core op. Thin wrapper over the
// repo's `listKnowledgeDocumentsForWorkspace` keyset-cursor function;
// adds the ISO ↔ Date conversion at the API boundary and computes
// `nextCursor` from the last row of the result page. Per blueprint
// §8.3 + D21 (cursor on `(indexedAt DESC NULLS LAST, id DESC)`).
//
// The cursor envelope `{ documents, nextCursor }` matches memory's
// listMemoryEntriesForWorkspace shape — the panel paginates with
// the same `nextCursor` round-trip.

import type { Database } from '@vynel/db'
import {
  findKnowledgeDocumentByPath,
  listKnowledgeDocumentsForWorkspace as listKnowledgeDocumentsForWorkspaceFromRepo,
} from '@vynel/db/repositories/knowledge'
import type { DocumentKind, KnowledgeDocumentRow } from '@vynel/db/schema/knowledge'
import type { ListDocumentsCursor } from '../knowledge-types.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export type ListDocumentsForWorkspaceInput = {
  workspaceId: string
  documentKind?: DocumentKind
  limit?: number
  cursor?: ListDocumentsCursor
  // Exact workspace-relative path. When set, returns the 0/1 matching
  // document (cursor/kind/limit ignored) — the Files UI uses this to
  // resolve one file's index status for the Indexed badge.
  path?: string
}

export type ListDocumentsForWorkspaceResult = {
  documents: KnowledgeDocumentRow[]
  nextCursor: ListDocumentsCursor | null
}

export function listDocumentsForWorkspace(
  db: Database,
  input: ListDocumentsForWorkspaceInput,
): ListDocumentsForWorkspaceResult {
  // Exact-path lookup short-circuits the cursor list — used by the Files
  // UI to read one file's parse status (the Indexed badge).
  if (input.path !== undefined) {
    const document = findKnowledgeDocumentByPath(db, input.workspaceId, input.path)
    return { documents: document ? [document] : [], nextCursor: null }
  }

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

  const rows = listKnowledgeDocumentsForWorkspaceFromRepo(db, input.workspaceId, {
    ...(input.documentKind !== undefined ? { documentKind: input.documentKind } : {}),
    ...(input.cursor !== undefined
      ? {
          cursor: {
            indexedAt: input.cursor.indexedAt !== null ? new Date(input.cursor.indexedAt) : null,
            id: input.cursor.id,
          },
        }
      : {}),
    limit: limit + 1,
  })

  const hasMore = rows.length > limit
  const documents = hasMore ? rows.slice(0, limit) : rows
  const last = documents.at(-1)
  const nextCursor: ListDocumentsCursor | null =
    hasMore && last
      ? {
          indexedAt: last.indexedAt?.toISOString() ?? null,
          id: last.id,
        }
      : null
  return { documents, nextCursor }
}
