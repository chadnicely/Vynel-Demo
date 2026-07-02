// Functional repository for the `knowledge_sources` table — the registry of
// directories indexed at workspace or global scope. `db` first arg, Phase 1 SYNC.
// A workspace's in-scope sources = that workspace's own sources PLUS the user's
// global sources (available across all their workspaces). See
// `docs/module-notes/knowledge-scope-sources.md`.

import { and, eq, or } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  knowledgeSources,
  type KnowledgeSourceRow,
  type NewKnowledgeSourceRow,
} from '../schema/sources.js'

export type {
  KnowledgeSourceRow,
  NewKnowledgeSourceRow,
  KnowledgeSourceScope,
} from '../schema/sources.js'

export function insertKnowledgeSource(db: Database, row: NewKnowledgeSourceRow): void {
  db.insert(knowledgeSources).values(row).run()
}

export function findKnowledgeSourceById(db: Database, id: string): KnowledgeSourceRow | null {
  const [row] = db.select().from(knowledgeSources).where(eq(knowledgeSources.id, id)).limit(1).all()
  return row ?? null
}

export function findWorkspaceSourceByPath(
  db: Database,
  input: { workspaceId: string; absolutePath: string },
): KnowledgeSourceRow | null {
  const [row] = db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.workspaceId, input.workspaceId),
        eq(knowledgeSources.absolutePath, input.absolutePath),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

// This workspace's own sources + the user's global sources.
export function listKnowledgeSourcesForWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string },
): KnowledgeSourceRow[] {
  return db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.userId, input.userId),
        or(eq(knowledgeSources.workspaceId, input.workspaceId), eq(knowledgeSources.scope, 'global')),
      ),
    )
    .all()
}

export function listGlobalKnowledgeSourcesForUser(
  db: Database,
  userId: string,
): KnowledgeSourceRow[] {
  return db
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.userId, userId), eq(knowledgeSources.scope, 'global')))
    .all()
}

// The source ids a search at `workspaceId` should span: the workspace's sources
// fused with the user's global sources.
export function listInScopeSourceIds(
  db: Database,
  input: { userId: string; workspaceId: string },
): string[] {
  return listKnowledgeSourcesForWorkspace(db, input).map((source) => source.id)
}

export function deleteKnowledgeSource(db: Database, id: string): void {
  db.delete(knowledgeSources).where(eq(knowledgeSources.id, id)).run()
}
