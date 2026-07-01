// `file_activities` table for the `files` domain. Append-only audit
// data; pure retention (no `deletedAt`) — `purgeOldFileActivities`
// worker hard-deletes rows older than 90 days per
// `docs/blueprints/files/decisions.md` D13.
//
// Spec: `docs/blueprints/files/blueprint.md §3.1`.
//
// Dual-write model: user-manager ops insert `editor: 'self'`
// synchronously; `FilesFileWatcherService` inserts `editor:
// 'external'` from chokidar events with a 5-second dedup window via
// `findRecentSelfActivityForPath`. Locked at D16 + D17.
//
// All `id()` columns are UUID-shaped text PKs/FKs (per
// `data-standard.md` "Helper contracts"). `userId` is the tenant
// boundary; `workspaceId` is the domain scope.
//
// Phase 1 SYNC discipline applies — repo functions over this table
// return T, not Promise<T>.

import { table, id, text, integer, timestamp, index } from '@vynel/db/dialect'
import { users } from '../users/users.js'
import { workspaces } from '../workspaces/workspaces.js'

export type FileActivityKind =
  | 'file-created'
  | 'file-edited'
  | 'file-moved'      // covers rename (same parent) + move (different parent)
  | 'file-deleted'
  | 'folder-created'
  | 'folder-deleted'

// Who caused the change. 'self' = the Vynel files manager (the user
// clicked a button); 'external' = anything else (Claude's SDK
// Write/Edit, an outside editor, a script). A finer split into
// 'agent' vs 'external' is deferred-with-trigger per D16.
export type FileActivityEditor = 'self' | 'external'

export const fileActivities = table(
  'file_activities',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),
    activityKind: text().$type<FileActivityKind>().notNull(),
    editor: text().$type<FileActivityEditor>().notNull(),
    // Forward-slash, workspace-relative (the knowledge D3 path convention).
    relativePath: text().notNull(),
    // Previous path for 'file-moved' (rename/move); NULL otherwise.
    fromPath: text(),
    // Byte size at the time of a create/edit; NULL for moves/deletes.
    fileSizeBytes: integer(),
    occurredAt: timestamp().notNull(),
  },
  (t) => ({
    workspaceOccurredAtIdx: index('idx_file_activities_workspace_occurred_at').on(
      t.workspaceId,
      t.occurredAt,
    ),
    workspacePathOccurredAtIdx: index('idx_file_activities_workspace_path_occurred_at').on(
      t.workspaceId,
      t.relativePath,
      t.occurredAt,
    ),
    userIdIdx: index('idx_file_activities_user').on(t.userId),
  }),
)

export type FileActivity = typeof fileActivities.$inferSelect
export type NewFileActivity = typeof fileActivities.$inferInsert
