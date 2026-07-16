// The api-side outbox relay service — drives the generic dispatch
// (`dispatchOutboxEvents` over `OUTBOX_CONSUMERS`) on a short interval. The
// desktop app runs no `apps/worker` (the relay's originally-planned home), so
// without this every published cross-domain event sat unprocessed forever:
// the schedules→channels delivery consumer was dormant since it landed, and
// the ask-nudge consumer would have joined it. Wired 2026-07-17 (the ask
// module's deferred slice).
//
// 5s cadence: the relay's consumers ENQUEUE channel messages (the channels
// delivery loop sends them at its own 2s cadence), so sub-minute is what makes
// a nudge feel live; the dispatch query is cheap (indexed unprocessed read,
// registered types only).

import { dispatchOutboxEvents, skipStaleOutboxEvents } from '@vynel/core/_shared'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

const RELAY_TICK_INTERVAL_MS = 5_000

export interface OutboxRelayServiceOptions {
  db: Database
  logger: Logger
  /** Test seam — production uses the default. */
  tickIntervalMs?: number
}

export function startOutboxRelayService(options: OutboxRelayServiceOptions): { stop: () => void } {
  const { db, logger } = options
  const tickIntervalMs = options.tickIntervalMs ?? RELAY_TICK_INTERVAL_MS

  // The relay shipped after producers had published for weeks — skip the
  // stale pre-relay backlog ONCE so the first boot doesn't flood the user's
  // channel with ancient deliveries (age-bounded: a crash-window event still
  // delivers). `ask.created` skips REGARDLESS of age: boot recovery just
  // expired every pending ask, so a post-boot nudge always points at nothing.
  skipStaleOutboxEvents(db, { logger, allOfTypes: ['ask.created'] })

  const runTick = (): void => {
    try {
      const result = dispatchOutboxEvents(db, { logger })
      if (result.dispatched > 0 || result.failed > 0) {
        logger.info(result, 'outbox relay tick')
      }
    } catch (err) {
      logger.error({ err }, 'outbox relay tick failed')
    }
  }

  const timer = setInterval(runTick, tickIntervalMs)
  // First pass right away — a restart shouldn't defer overdue events a tick.
  runTick()

  logger.info({ tickIntervalMs }, 'outbox relay service started')

  return {
    stop: () => {
      clearInterval(timer)
    },
  }
}
