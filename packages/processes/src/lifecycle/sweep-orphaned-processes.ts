// Boot sweep — settle every row a crash/restart left `running`. The children
// themselves are gone (or headless); what matters is that the ROW tells the
// truth and the failure EVENT still fires, so a session whose monitor was
// waiting on `pnpm test` learns "interrupted by a restart" instead of waiting
// on a completion that can never come. The delegation service's orphan
// reclaim, for OS processes.

import { settleBackgroundProcess } from './settle-background-process.js'
import * as processesRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../processes-types.js'

/** Returns how many rows were settled. Call at boot, BEFORE the runner takes
 *  new work — at startup nothing is running, so every `running` row is an
 *  orphan by definition. */
export function sweepOrphanedBackgroundProcesses(
  db: Database,
  deps: { logger?: StructuralLogger; now?: () => Date } = {},
): number {
  const orphans = processesRepository.listRunningBackgroundProcesses(db)
  for (const orphan of orphans) {
    settleBackgroundProcess(
      db,
      { processId: orphan.id, exitCode: null, failureReason: 'restart', outputTail: '' },
      deps,
    )
  }
  if (orphans.length > 0) {
    deps.logger?.warn(
      { settled: orphans.length },
      'background processes: settled rows a restart left running (their events still fired)',
    )
  }
  return orphans.length
}
