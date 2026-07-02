// Functional repository for the `knowledge_documents` table. `db` is the
// first argument (per foundation §2 row 3 + coding-standard "Structure /
// patterns"). Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// Cursor pagination on listForWorkspace uses keyset on
// (indexedAt DESC NULLS LAST, id DESC) per D21 — mirrors memory D22's
// shape (the NULLS-LAST branch handles the cross-over from indexed
// rows to pending/parsing rows).
//
// Spec: `docs/blueprints/knowledge/blueprint.md §1` + `coding.md §6.1`.

import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  knowledgeDocuments,
  type KnowledgeDocumentRow,
  type NewKnowledgeDocumentRow,
  type DocumentKind,
  type ParseStatus,
} from '../schema/documents.js'

export type {
  KnowledgeDocumentRow,
  NewKnowledgeDocumentRow,
  DocumentKind,
  ParseStatus,
} from '../schema/documents.js'

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

export function findKnowledgeDocumentBySourcePath(
  db: Database,
  sourceId: string,
  relativePath: string,
): KnowledgeDocumentRow | null {
  const [row] = db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.sourceId, sourceId),
        eq(knowledgeDocuments.relativePath, relativePath),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

// Workspace-scoped exact-path lookup — used by the Files "Indexed" badge (list
// `?path=`). NOT the indexing key (that's findKnowledgeDocumentBySourcePath); a
// workspace can hold several sources, so this returns the first match.
export function findKnowledgeDocumentByWorkspacePath(
  db: Database,
  workspaceId: string,
  relativePath: string,
): KnowledgeDocumentRow | null {
  const [row] = db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.workspaceId, workspaceId),
        eq(knowledgeDocuments.relativePath, relativePath),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function findKnowledgeDocumentById(db: Database, id: string): KnowledgeDocumentRow | null {
  const [row] = db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .limit(1)
    .all()
  return row ?? null
}

export type ListForWorkspaceOptions = {
  documentKind?: DocumentKind
  cursor?: { indexedAt: Date | null; id: string } | null
  limit?: number
}

export function listKnowledgeDocumentsForWorkspace(
  db: Database,
  workspaceId: string,
  options: ListForWorkspaceOptions = {},
): KnowledgeDocumentRow[] {
  const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const conditions = [eq(knowledgeDocuments.workspaceId, workspaceId)]
  if (options.documentKind) {
    conditions.push(eq(knowledgeDocuments.documentKind, options.documentKind))
  }

  // Cursor pagination on (indexedAt DESC NULLS LAST, id DESC).
  // Same shape as memory D22 — see memory-entries.ts for the full
  // NULLS-LAST branching explanation.
  if (options.cursor) {
    const { indexedAt: cAt, id: cId } = options.cursor
    if (cAt === null) {
      conditions.push(and(isNull(knowledgeDocuments.indexedAt), lt(knowledgeDocuments.id, cId))!)
    } else {
      conditions.push(
        or(
          lt(knowledgeDocuments.indexedAt, cAt),
          and(eq(knowledgeDocuments.indexedAt, cAt), lt(knowledgeDocuments.id, cId)),
          isNull(knowledgeDocuments.indexedAt),
        )!,
      )
    }
  }

  return db
    .select()
    .from(knowledgeDocuments)
    .where(and(...conditions))
    .orderBy(
      // NULLS LAST emulation in SQLite — flips IS NULL to a boolean (0/1)
      // for the primary sort; non-null rows sort first.
      sql`${knowledgeDocuments.indexedAt} IS NULL`,
      desc(knowledgeDocuments.indexedAt),
      desc(knowledgeDocuments.id),
    )
    .limit(limit)
    .all()
}

export function insertKnowledgeDocument(db: Database, row: NewKnowledgeDocumentRow): void {
  db.insert(knowledgeDocuments).values(row).run()
}

export type UpdatePatch = Partial<
  Omit<KnowledgeDocumentRow, 'id' | 'userId' | 'workspaceId' | 'sourceId' | 'scope' | 'createdAt'>
>

export function updateKnowledgeDocument(db: Database, id: string, patch: UpdatePatch): void {
  db.update(knowledgeDocuments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(knowledgeDocuments.id, id))
    .run()
}

export function hardDeleteKnowledgeDocument(db: Database, id: string): void {
  db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)).run()
}

export function markAllKnowledgeDocumentsPendingForWorkspace(
  db: Database,
  workspaceId: string,
): void {
  db.update(knowledgeDocuments)
    .set({ parseStatus: 'pending', updatedAt: new Date() })
    .where(eq(knowledgeDocuments.workspaceId, workspaceId))
    .run()
}

export type IndexerStatus = {
  workspaceId: string
  totalDocuments: number
  parsedDocuments: number
  pendingDocuments: number
  parsingDocuments: number
  failedDocuments: number
  skippedDocuments: number
  unindexedChunks: number
  lastIndexedAt: Date | null
}

export function getKnowledgeIndexerStatusForWorkspace(
  db: Database,
  workspaceId: string,
): IndexerStatus {
  // Roll up counts via one query with conditional SUM. lastIndexedAt is
  // the MAX(indexedAt) across all 'parsed' documents in the workspace.
  const [row] = db
    .select({
      totalDocuments: sql<number>`COUNT(*)`,
      parsedDocuments: sql<number>`SUM(CASE WHEN ${knowledgeDocuments.parseStatus} = 'parsed' THEN 1 ELSE 0 END)`,
      pendingDocuments: sql<number>`SUM(CASE WHEN ${knowledgeDocuments.parseStatus} = 'pending' THEN 1 ELSE 0 END)`,
      parsingDocuments: sql<number>`SUM(CASE WHEN ${knowledgeDocuments.parseStatus} = 'parsing' THEN 1 ELSE 0 END)`,
      failedDocuments: sql<number>`SUM(CASE WHEN ${knowledgeDocuments.parseStatus} = 'failed' THEN 1 ELSE 0 END)`,
      skippedDocuments: sql<number>`SUM(CASE WHEN ${knowledgeDocuments.parseStatus} = 'skipped' THEN 1 ELSE 0 END)`,
      lastIndexedAt: sql<number | null>`MAX(${knowledgeDocuments.indexedAt})`,
    })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.workspaceId, workspaceId))
    .all()

  // unindexedChunks is reported via the chunks repo (separate concern);
  // this status function returns 0 here so the seam is one shape — the
  // core op `getIndexerStatus` adds the chunks figure before returning.
  return {
    workspaceId,
    totalDocuments: Number(row?.totalDocuments ?? 0),
    parsedDocuments: Number(row?.parsedDocuments ?? 0),
    pendingDocuments: Number(row?.pendingDocuments ?? 0),
    parsingDocuments: Number(row?.parsingDocuments ?? 0),
    failedDocuments: Number(row?.failedDocuments ?? 0),
    skippedDocuments: Number(row?.skippedDocuments ?? 0),
    unindexedChunks: 0,
    lastIndexedAt: row?.lastIndexedAt != null ? new Date(row.lastIndexedAt) : null,
  }
}
