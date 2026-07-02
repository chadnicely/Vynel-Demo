// `listRecentActivity` — cursor-paginated activity feed for one
// workspace. Thin wrapper over the repo's
// listFileActivitiesForWorkspace; adds the ISO ↔ Date conversion at
// the API boundary and computes `nextCursor` from the last row of
// the page. The cursor envelope matches knowledge's
// listDocumentsForWorkspace shape — same UI pagination contract.

import type { Database } from '@vynel/db'
import {
  listFileActivitiesForWorkspace,
  type FileActivity,
} from '@vynel/db/repositories/files'
import type { FileActivityCursor } from './files-types.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export type ListRecentActivityInput = {
  workspaceId: string
  limit?: number
  cursor?: FileActivityCursor
}

export type ListRecentActivityResult = {
  activities: FileActivity[]
  nextCursor: FileActivityCursor | null
}

export function listRecentActivity(
  db: Database,
  input: ListRecentActivityInput,
): ListRecentActivityResult {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const rows = listFileActivitiesForWorkspace(db, input.workspaceId, {
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
