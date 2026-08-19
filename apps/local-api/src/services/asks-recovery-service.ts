// The api-side `asks recovery` service — the 60 s reaper for pending `ask_user`
// rows older than the interactive bound (session-hardening D5: "interactive
// ask 2 h + a 60 s reaper"). Approvals had a running reaper; asks had boot
// recovery only, so a row whose waiter was gone (the tool call interrupted
// before its handler parked, a timer that never armed) stayed `pending` for the
// process lifetime — a zombie wizard in the UI and a `needs_input` light on a
// thread nothing was waiting on. A LIVE waiter expires itself at the same bound
// through its own timer, so this reaper only ever meets orphans; boot keeps its
// all-pending sweep. The approvals-recovery-service shape (interval, no
// in-flight guard — a pass is short and idempotent).

import { expireAskRequests } from '@vynel/asks'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

const RECOVERY_INTERVAL_MS = 60_000

export interface AsksRecoveryServiceOptions {
  db: Database
  logger: Logger
  /** The interactive ask bound (`VYNEL_INTERACTIVE_ASK_MAX_MS`) — a pending row
   *  older than this has outlived every waiter that could answer it. */
  maxAgeMs: number
  /** Test seam — the reap cadence. */
  intervalMs?: number
}

export function reapStaleAskRequests(
  db: Database,
  input: { maxAgeMs: number; now?: Date },
  deps: { logger: Logger },
): { expiredCount: number } {
  const cutoff = new Date((input.now ?? new Date()).getTime() - input.maxAgeMs)
  return expireAskRequests(db, { pendingBefore: cutoff }, { logger: deps.logger })
}

export function startAsksRecoveryService(options: AsksRecoveryServiceOptions): { stop: () => void } {
  const { db, logger, maxAgeMs } = options

  const timer = setInterval(() => {
    try {
      reapStaleAskRequests(db, { maxAgeMs }, { logger })
    } catch (err) {
      logger.error({ err }, 'asks recovery tick failed')
    }
  }, options.intervalMs ?? RECOVERY_INTERVAL_MS)
  // Never hold the process open for the reaper alone.
  timer.unref?.()

  logger.info({ maxAgeMs }, 'asks recovery service started (60s reaper)')

  return { stop: () => clearInterval(timer) }
}
