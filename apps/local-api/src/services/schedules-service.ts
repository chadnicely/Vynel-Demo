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
// over appRequest; the shared target locks; the delegated cap and the
// concurrency knob from env) are built once via the shared
// `buildScheduleFireDeps` helper so the poll service and the `fire-now` routes
// drive the SAME turn machinery (background-turns BT1–BT3).
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.6` + coding.md §1.1.

import { runScheduleClaimAndFireTick } from '@vynel/schedules'
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
}

export async function startSchedulesService(
  options: SchedulesServiceOptions,
): Promise<{ stop: () => void }> {
  const { db, logger, appRequest, activityFeed, targetLocks, turnEvents, readEnabledFeatureKeys } =
    options

  const fireDeps = await buildScheduleFireDeps({
    appRequest,
    logger,
    activityFeed,
    targetLocks,
    ...(turnEvents !== undefined ? { turnEvents } : {}),
    ...(readEnabledFeatureKeys !== undefined ? { readEnabledFeatureKeys } : {}),
  })

  const pollTimer = setInterval(() => {
    runScheduleClaimAndFireTick(db, fireDeps).catch((err) =>
      logger.error({ err }, 'schedule poll tick failed'),
    )
  }, SCHEDULE_POLL_INTERVAL_MS)

  logger.info(
    { maxConcurrentFires: fireDeps.maxConcurrentFires ?? null },
    'schedules service started (poll 60s, bounded concurrent fires)',
  )

  return { stop: () => clearInterval(pollTimer) }
}
