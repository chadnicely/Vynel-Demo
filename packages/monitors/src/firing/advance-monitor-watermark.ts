// Move a monitor's watermark forward after a tick window that produced no
// match. No outbox event — "nothing happened" is not a state change anyone
// subscribes to, and emitting one per armed monitor per tick would bury the
// table in noise (and give a monitor watching `monitor.*` a genuine feedback
// loop to chew on).
//
// Split from `recordMonitorFired` deliberately: that op means "this fired",
// this one means "considered, nothing matched". Folding them into one call with
// a nullable event id would make every caller decide which mode it is in.

import * as monitorsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Monitor } from '../repositories/index.js'

export function advanceMonitorWatermark(
  db: Database,
  input: { monitorId: string; checkedThrough: Date; now: Date },
): Monitor {
  return monitorsRepository.updateMonitor(db, input.monitorId, {
    lastCheckedAt: input.checkedThrough,
    updatedAt: input.now,
  })
}
