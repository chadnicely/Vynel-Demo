// `listFileHistory` — cursor-paginated activity for one (workspaceId,
// relativePath) tuple. Same envelope shape as listRecentActivity;
// powers the per-file history surface in the apps/web panel.
//
// Named `list*` (not `get*`) — this returns
// `{ activities: [], nextCursor: null }` on no matches; `get*` is
// reserved for throwing variants (Gate-3 N1).

import type { Database } from '@vynel/db'
import {
  listFileActivitiesForPath,
  type FileActivity,
} from '@vynel/db/repositories/files'
import type { FileActivityCursor } from './files-types.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export type ListFileHistoryInput = {
  workspaceId: string
  relativePath: string
  limit?: number
  cursor?: FileActivityCursor
}

export type ListFileHistoryResult = {
  activities: FileActivity[]
  nextCursor: FileActivityCursor | null
}

export function listFileHistory(db: Database, input: ListFileHistoryInput): ListFileHistoryResult {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const rows = listFileActivitiesForPath(db, input.workspaceId, input.relativePath, {
    limit: limit + 1,
    ...(input.cursor !== undefined
      ? {
          cursor: {
            occurredAt: new Date(input.cursor.occurredAt),
            id: input.cursor.id,
          },
        }
      : {}),
  })
  const hasMore = rows.length > limit
  const activities = hasMore ? rows.slice(0, limit) : rows
  const last = activities.at(-1)
  const nextCursor: FileActivityCursor | null =
    hasMore && last ? { occurredAt: last.occurredAt.toISOString(), id: last.id } : null
  return { activities, nextCursor }
}
