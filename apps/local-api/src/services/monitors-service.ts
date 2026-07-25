// The api-side `monitors` service — the loop that turns armed watches into
// woken sessions. Without it `create_monitor` arms something that never fires.
//
// The delegation-service shape, plus an IN-FLIGHT GUARD. A pass reads the
// outbox, enqueues wakes and advances watermarks; two overlapping passes would
// both see the same window and could double-wake, since the watermark only
// moves at the end of a monitor's turn through the loop. The guard is cheaper
// and clearer than making the pass itself re-entrant.
//
// The interval is deliberately short. A monitor exists so an agent does not
// have to poll, so the delay between "the thing happened" and "you were told"
// is the whole user-visible quality of the feature.

import { runMonitorTick } from '@vynel/session/monitors'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { resolveSpawnedSessionRunCwd } from '../sessions/spawned-session-ground.js'

const MONITOR_TICK_INTERVAL_MS = 10_000

export interface MonitorsServiceOptions {
  db: Database
  logger: Logger
}

export function startMonitorsService(options: MonitorsServiceOptions): { stop: () => void } {
  const { db, logger } = options
  let inFlight = false

  const timer = setInterval(() => {
    if (inFlight) return
    inFlight = true
    runMonitorTick(db, {
      logger,
      // The one-home cwd resolver (deleted-workspace fallback included) lives
      // here at the app tier, so the tick takes it as a dep.
      resolveSpawnedRunCwd: (spawned) => resolveSpawnedSessionRunCwd(db, spawned),
    })
      .catch((err: unknown) => logger.error({ err }, 'monitor tick failed'))
      .finally(() => {
        inFlight = false
      })
  }, MONITOR_TICK_INTERVAL_MS)

  logger.info({ intervalMs: MONITOR_TICK_INTERVAL_MS }, 'monitors service started')

  return { stop: () => clearInterval(timer) }
}
