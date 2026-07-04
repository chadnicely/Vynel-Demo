// `purgeOldFileActivities` — worker core op. Hard-deletes
// `file_activities` rows older than the 90-day retention window per
// D13. Sync (Phase 1 SYNC transactions; the underlying repo is also
// sync); the worker file is a 3-line delegator per the worker
// thin-delegator precedent.

import type { Database } from '@vynel/db'
import { hardDeleteFileActivitiesOccurredBefore } from '@vynel/db/repositories/files'
import type { StructuralLogger } from '../files-types.js'

// 90 days per D13. Lives here so the worker file (a thin delegator)
// doesn't need to carry the number itself.
const RETENTION_DAYS = 90

export type PurgeOldFileActivitiesResult = {
  deletedCount: number
  cutoff: Date
}

export function purgeOldFileActivities(
  db: Database,
  deps: { logger?: StructuralLogger; now?: Date } = {},
): PurgeOldFileActivitiesResult {
  const now = deps.now ?? new Date()
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const deletedCount = hardDeleteFileActivitiesOccurredBefore(db, cutoff)
  if (deletedCount > 0) {
    deps.logger?.info(
      { job: 'purge-old-file-activities', deletedCount, cutoff: cutoff.toISOString() },
      'purged old file_activities rows',
    )
  }
  return { deletedCount, cutoff }
}
