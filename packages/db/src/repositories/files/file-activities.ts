// Functional repository for the `file_activities` table. `db` is the
// first argument (per `docs/foundation.md §2 row 3` +
// `.claude/rules/coding-standard.md`). Spec:
// `docs/blueprints/files/blueprint.md §5`.
//
// Phase 1 SYNC return values — required by the better-sqlite3 transaction
// contract per `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// Reads filter on `workspaceId` at the caller level — there is no
// soft-delete column on this table (D1: pure-retention audit log).
// `purgeOldFileActivities` worker hard-deletes rows older than 90 days
// per D13.

import { and, desc, eq, gte, lt, or } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  fileActivities,
  type FileActivity,
  type NewFileActivity,
} from '../../schema/files/file-activities.js'

export type {
  FileActivity,
  NewFileActivity,
  FileActivityKind,
  FileActivityEditor,
} from '../../schema/files/file-activities.js'

// Defensive caps on listFileActivities* per coding-standard.md "Structure
// / patterns" — every list* that scales with tenant data is capped at the
// repo layer (the Zod schema also clamps at the HTTP boundary).
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

export type ListFileActivitiesOptions = {
  limit?: number
  cursor?: { occurredAt: Date; id: string }
}

export function insertFileActivity(db: Database, row: NewFileActivity): FileActivity {
  const [inserted] = db.insert(fileActivities).values(row).returning().all()
  if (!inserted) throw new Error('insertFileActivity: no row returned')
  return inserted
}

export function listFileActivitiesForWorkspace(
  db: Database,
  workspaceId: string,
  options: ListFileActivitiesOptions = {},
): FileActivity[] {
  const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(fileActivities.workspaceId, workspaceId)]
  if (options.cursor) {
    // Keyset cursor on (occurredAt DESC, id DESC). The compound
    // predicate is: occurredAt < cursor.occurredAt OR (occurredAt =
    // cursor AND id < cursor.id). Drizzle's expressions emit
    // dialect-portable SQL — same shape works in Postgres.
    filters.push(
      or(
        lt(fileActivities.occurredAt, options.cursor.occurredAt),
        and(
          eq(fileActivities.occurredAt, options.cursor.occurredAt),
          lt(fileActivities.id, options.cursor.id),
        ),
      )!,
    )
  }
  return db
    .select()
    .from(fileActivities)
    .where(and(...filters))
    .orderBy(desc(fileActivities.occurredAt), desc(fileActivities.id))
    .limit(limit)
    .all()
}

export function listFileActivitiesForPath(
  db: Database,
  workspaceId: string,
  relativePath: string,
  options: ListFileActivitiesOptions = {},
): FileActivity[] {
  const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [
    eq(fileActivities.workspaceId, workspaceId),
    eq(fileActivities.relativePath, relativePath),
  ]
  if (options.cursor) {
    filters.push(
      or(
        lt(fileActivities.occurredAt, options.cursor.occurredAt),
        and(
          eq(fileActivities.occurredAt, options.cursor.occurredAt),
          lt(fileActivities.id, options.cursor.id),
        ),
      )!,
    )
  }
  return db
    .select()
    .from(fileActivities)
    .where(and(...filters))
    .orderBy(desc(fileActivities.occurredAt), desc(fileActivities.id))
    .limit(limit)
    .all()
}

// The dedup helper used by FilesFileWatcherService (blueprint §6a) — returns
// the most recent `editor: 'self'` row for the given (workspaceId,
// relativePath) within `sinceMs` of `now`, or null. The 5-second default
// matches D16's window; the watcher consumer supplies the value.
export function findRecentSelfActivityForPath(
  db: Database,
  workspaceId: string,
  relativePath: string,
  options: { now: Date; sinceMs: number },
): FileActivity | null {
  const threshold = new Date(options.now.getTime() - options.sinceMs)
  const [row] = db
    .select()
    .from(fileActivities)
    .where(
      and(
        eq(fileActivities.workspaceId, workspaceId),
        eq(fileActivities.relativePath, relativePath),
        eq(fileActivities.editor, 'self'),
        gte(fileActivities.occurredAt, threshold),
      ),
    )
    .orderBy(desc(fileActivities.occurredAt), desc(fileActivities.id))
    .limit(1)
    .all()
  return row ?? null
}

export function hardDeleteFileActivitiesOccurredBefore(db: Database, cutoff: Date): number {
  const deleted = db
    .delete(fileActivities)
    .where(lt(fileActivities.occurredAt, cutoff))
    .returning()
    .all()
  return deleted.length
}
