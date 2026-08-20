// The api-side `schedules` service — the long-lived per-minute poll that
// claims due schedules atomically and fires them IN-PROCESS: a workspace
// schedule via the workspace turn path (composeSessionMcpServers +
// startChatTurn), a global one via the global-root runner. Started from
// `server.ts` AFTER `createApp(...)`, stopped on shutdown.
//
// Lives in `apps/local-api`, NOT `apps/worker` (locked SCHED-1 / blueprint §2 +
// §5.6): the fired turn is MCP-intrinsic — it needs the in-process Vynel MCP
// server built from the api's own `app.request`, which only exists in the api
// process. (Cadence is NOT the driver — the per-minute poll is within reach of
// a worker cron; the MCP-intrinsic turn is what pins it here.)
//
// The fire deps (the turns + the settings/MCP/capability composition, closing
// over appRequest; the shared target locks; the delegated cap from env) are
// built once via the shared `buildScheduleFireDeps` helper so the poll service
// and the `fire-now` routes drive the SAME turn machinery (background-turns
// BT1–BT3). The fire POOL is handed IN, not built here: it is process-wide
// (`boot.ts` owns it, like `sessionTargetLocks`) and shared with the `fire-now`
// routes, so at most `maxConcurrentFires` fires run at once however the ticks
// and manual runs overlap — and a schedule already queued or running is never
// admitted twice, whichever door asks.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.6` + coding.md §1.1.

import {
  runScheduleClaimAndFireTick,
  type ScheduleFirePool,
  type ScheduleTickSummary,
} from '@vynel/schedules'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { SessionActivityFeed } from '@vynel/session/runtime'
import type { SessionTargetLocks, TurnEventBroadcaster } from '@vynel/session/delegation'
import type { HonoAppRequestFn } from '../factory.js'
import { buildScheduleFireDeps } from '../sessions/build-schedule-fire-deps.js'
import type { ReadEnabledFeatureKeys } from '../sessions/enabled-feature-keys.js'

const SCHEDULE_POLL_INTERVAL_MS = 60_000 // per-minute poll (NOT sub-minute — blueprint §2)

export interface SchedulesServiceOptions {
  db: Database
  logger: Logger
  appRequest: HonoAppRequestFn // from createApp(...) in server.ts (app.request.bind(app))
  activityFeed: SessionActivityFeed // shared turn-liveness registry (server.ts)
  /** The process-wide single-writer lock per target, SHARED with the
   *  delegation pool + the session-turn route (server.ts) — a fired workspace
   *  turn holds the workspace key for its whole run. REQUIRED so a forgotten
   *  wiring fails typecheck instead of silently locking in private. */
  targetLocks: SessionTargetLocks
  turnEvents?: TurnEventBroadcaster // shared live-turn pub/sub (Watch everywhere, Slice ③)
  /** Per-composition entitlement read (tier filtering). Absent = fail-open. */
  readEnabledFeatureKeys?: ReadEnabledFeatureKeys
  /** The process-wide bound on concurrent fires (BT3), SHARED with the
   *  `fire-now` routes via `createApp` — both doors admit through this ONE
   *  pool. REQUIRED so a forgotten wiring fails typecheck instead of silently
   *  bounding the poll in private while manual runs fire unbounded. */
  firePool: ScheduleFirePool
}

export async function startSchedulesService(
  options: SchedulesServiceOptions,
): Promise<{ stop: () => void }> {
  const {
    db,
    logger,
    appRequest,
    activityFeed,
    targetLocks,
    turnEvents,
    readEnabledFeatureKeys,
    firePool,
  } = options

  const fireDeps = await buildScheduleFireDeps({
    appRequest,
    logger,
    activityFeed,
    targetLocks,
    ...(turnEvents !== undefined ? { turnEvents } : {}),
    ...(readEnabledFeatureKeys !== undefined ? { readEnabledFeatureKeys } : {}),
  })
  const pollTimer = setInterval(() => {
    runScheduleClaimAndFireTick(db, fireDeps, firePool).then(
      (summary) => logTickSummary(logger, summary),
      (err: unknown) => logger.error({ err }, 'schedule poll tick failed'),
    )
  }, SCHEDULE_POLL_INTERVAL_MS)

  logger.info(
    { maxConcurrentFires: firePool.maxConcurrentFires },
    'schedules service started (poll 60s, one bounded fire pool per process)',
  )

  return { stop: () => clearInterval(pollTimer) }
}

// A fire that threw out of the executor has no run row to tell its story — the
// worker logged it once with the schedule id; the tick summary is the only
// other place it shows. A clean tick logs nothing (the per-fire lines suffice).
function logTickSummary(logger: Logger, summary: ScheduleTickSummary): void {
  if (summary.failedCount === 0) return
  logger.warn(summary, 'schedule poll tick: fire(s) threw before a run row could record them')
}
