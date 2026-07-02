// The `knowledge_sources` table — the registry of directories the user has
// registered to index, at WORKSPACE or GLOBAL scope. Replaces the old
// "auto-index the workspace folder only" model: on `workspace.created` the
// workspace folder is auto-registered as a `'workspace'` source; the user adds
// more (workspace or global) via the add-to-knowledge tool / routes.
//
// `userId` is the tenant boundary (FK → users.id, cascade). `workspaceId` is a
// NULLABLE FK → workspaces.id (cascade): non-null for a workspace source, NULL
// for a global (user-level) source. Uses `text().references(...)` rather than
// `id()` because `id()` is NOT NULL by dialect contract (the `root_sessions` /
// `agents` nullable-FK precedent). Two partial unique indexes: one workspace
// source per (workspace, path); one global source per (user, path) — SQLite
// treats NULLs as distinct, so a plain unique on (workspace_id, path) cannot pin
// the NULL-workspace global sources.
//
// See `docs/module-notes/knowledge-scope-sources.md`.

import { sql } from 'drizzle-orm'
import { table, id, text, timestamp, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type KnowledgeSourceScope = 'workspace' | 'global'

export const knowledgeSources = table(
  'knowledge_sources',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: non-null for a workspace source, NULL for a global source.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    scope: text().$type<KnowledgeSourceScope>().notNull(),
    // The absolute directory path on disk this source indexes.
    absolutePath: text().notNull(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    byUser: index('idx_knowledge_sources_user').on(t.userId),
    byWorkspace: index('idx_knowledge_sources_workspace').on(t.workspaceId),
    // One workspace source per (workspace, path). Partial so global sources
    // (NULL workspace) don't collide here.
    uniqueWorkspacePath: uniqueIndex('uniq_knowledge_sources_workspace_path')
      .on(t.workspaceId, t.absolutePath)
      .where(sql`${t.scope} = 'workspace'`),
    // One global source per (user, path). Scope-gated because the workspace
    // index above can't pin NULL-workspace rows (SQLite NULLs are distinct).
    uniqueGlobalPath: uniqueIndex('uniq_knowledge_sources_global_path')
      .on(t.userId, t.absolutePath)
      .where(sql`${t.scope} = 'global'`),
  }),
)

export type KnowledgeSourceRow = typeof knowledgeSources.$inferSelect
export type NewKnowledgeSourceRow = typeof knowledgeSources.$inferInsert
