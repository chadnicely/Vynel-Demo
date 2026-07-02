// `removeKnowledgeSource` — de-register a knowledge source. Stops its watcher,
// purges its vec rows (sqlite-vec isn't FK-cascaded), then deletes the source —
// which cascades its documents + chunks relationally. Idempotent: a no-op when
// the source doesn't exist.

import { withTransaction, type Database } from '@vynel/db'
import {
  findKnowledgeSourceById,
  deleteKnowledgeSource,
  deleteVectorIndexForSource,
} from '@vynel/db/repositories/knowledge'
import { FileWatcherService } from '../indexing/file-watcher.js'
import type { StructuralLogger } from '../knowledge-types.js'

export async function removeKnowledgeSource(
  db: Database,
  sourceId: string,
  deps: { fileWatcher: FileWatcherService; logger?: StructuralLogger },
): Promise<void> {
  const source = findKnowledgeSourceById(db, sourceId)
  if (!source) return

  await deps.fileWatcher.stopWatchingSource(sourceId)
  withTransaction(db, (tx) => {
    // Purge vec rows first (not FK-cascaded), then delete the source (cascades
    // its documents + chunks via the FKs).
    deleteVectorIndexForSource(tx, sourceId)
    deleteKnowledgeSource(tx, sourceId)
  })
  deps.logger?.info({ sourceId }, 'removeKnowledgeSource: source removed')
}
