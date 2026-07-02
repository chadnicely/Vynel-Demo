// The `knowledge_documents` table for the `knowledge` domain — one
// row per indexed file on the workspace's disk. Holds file metadata
// (relative path, size, mtime), parse lifecycle (pending / parsing /
// parsed / failed / skipped), content hash (SHA-256 over parsed
// text — drives the hash-skip optimization per D4), chunk count
// denorm, and `indexedAt` (the cursor key for
// `listDocumentsForWorkspace` per D21).
//
// NO `deletedAt` — hard-delete + cascade per D13 (workspaces-D13
// carve-out; documents are 100% re-derivable from disk).
//
// Phase 1 SYNC discipline applies (per D18).
//
// See `docs/blueprints/knowledge/blueprint.md §3.1` + `decisions.md`
// D13 + D18 + D21 + D22.

import { table, id, text, integer, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'
import { knowledgeSources, type KnowledgeSourceScope } from './sources.js'

export type DocumentKind =
  | 'markdown'
  | 'plain-text'
  | 'pdf'
  | 'docx'
  | 'html'
  | 'csv'
  | 'json'
  | 'unsupported'

export type ParseStatus =
  | 'pending' // detected; the parse hasn't started
  | 'parsing' // the parse is in flight
  | 'parsed' // success terminal state
  | 'failed' // parse threw; parseErrorMessage populated
  | 'skipped' // deliberately skipped (too-large / unsupported-format / in-skipped-folder)

export const knowledgeDocuments = table(
  'knowledge_documents',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: non-null for a workspace-scoped document, NULL for a global one.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // The source (registered directory) this document belongs to. Cascade so
    // removing a source removes its indexed documents.
    sourceId: id().references(() => knowledgeSources.id, { onDelete: 'cascade' }),
    // 'workspace' | 'global'. Additive: pre-existing rows backfill to 'workspace'.
    scope: text().$type<KnowledgeSourceScope>().notNull().default('workspace'),

    // Forward-slash-normalized; per decisions.md D3. Unique per source.
    relativePath: text().notNull(),

    // Derived from extension on insert via `deriveDocumentKindFromPath`.
    documentKind: text().$type<DocumentKind>().notNull(),

    // SHA-256 over parsed text (NOT raw bytes); drives the hash-skip
    // optimization per D4. Empty string for skipped documents.
    contentHash: text().notNull(),

    fileSizeBytes: integer().notNull(),
    fileModifiedAt: timestamp().notNull(),

    // Denormalized — saves a join on the documents-list view.
    chunkCount: integer().notNull(),

    parseStatus: text().$type<ParseStatus>().notNull(),

    // Non-null only when parseStatus === 'failed'. Surfaced in the
    // Activity tab.
    parseErrorMessage: text(),

    // Null while pending; set when parseStatus → 'parsed'. Cursor key
    // for listDocumentsForWorkspace per D21.
    indexedAt: timestamp(),

    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userIdIdx: index('idx_knowledge_documents_user').on(t.userId),
    byWorkspaceIdx: index('idx_knowledge_documents_workspace').on(t.workspaceId),
    byWorkspaceStatusIdx: index('idx_knowledge_documents_workspace_status').on(
      t.workspaceId,
      t.parseStatus,
    ),
    // Cursor key per D21: (indexedAt DESC NULLS LAST, id DESC).
    byWorkspaceIndexedAtIdx: index('idx_knowledge_documents_workspace_indexed_at').on(
      t.workspaceId,
      t.indexedAt,
    ),
    bySourceIdx: index('idx_knowledge_documents_source').on(t.sourceId),
    // Uniqueness moved from (workspaceId, relativePath) to (sourceId, relativePath):
    // a path is relative to its SOURCE directory now, and global docs have no workspace.
    bySourcePathUniqueIdx: uniqueIndex('uniq_knowledge_documents_source_path').on(
      t.sourceId,
      t.relativePath,
    ),
  }),
)

export type KnowledgeDocumentRow = typeof knowledgeDocuments.$inferSelect
export type NewKnowledgeDocumentRow = typeof knowledgeDocuments.$inferInsert
