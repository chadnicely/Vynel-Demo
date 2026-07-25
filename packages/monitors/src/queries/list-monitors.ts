// The two list reads — one per door. Thin over the repo, shaped for the tool:
// what is being watched, whether it is still live, and how often it has hit.

import type { Database } from '@vynel/db'
import * as monitorsRepository from '../repositories/index.js'
import type { Monitor, MonitorStatus } from '../repositories/index.js'

export function listMonitors(
  db: Database,
  input: { userId: string; workspaceId: string; status?: MonitorStatus; limit?: number },
): Monitor[] {
  return monitorsRepository.listMonitorsForWorkspace(db, input)
}

/** The GLOBAL scope's monitors — workspaceId IS NULL only, never the user's
 *  whole set. A global list that quietly included workspace rows would make
 *  "stop that monitor" ambiguous about which one the user meant. */
export function listMonitorsForUser(
  db: Database,
  input: { userId: string; status?: MonitorStatus; limit?: number },
): Monitor[] {
  return monitorsRepository.listGlobalMonitorsForUser(db, input)
}
