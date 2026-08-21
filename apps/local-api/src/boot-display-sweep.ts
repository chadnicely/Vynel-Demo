// The Display's boot pass — take down every card whose `expiresAt` fell while
// the app was closed, before the first window can read a board. Without it a
// self-cleaning card ("today's runs") survives every night the machine spent
// asleep, and `expiresAt` only means anything to a process that stayed up.
//
// A MODULE rather than five lines inline: `boot()` opens a listener, so nothing
// written inside it can be exercised — here the pass runs against a real
// database in `boot-display-sweep.test.ts`.
//
// Best-effort like every sibling recovery pass (the tool-call reap, the turn
// reap): a board that failed to tidy itself is one stale card, never a machine
// that refuses to start.

import { sweepExpiredDisplayWidgets } from '@vynel/display'
import type { Database } from '@vynel/db'

type StructuralLogger = {
  info(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

export function sweepExpiredDisplayWidgetsAtBoot(
  db: Database,
  input: { logger: StructuralLogger },
): void {
  try {
    // Process-wide (no user, no scope): the sweep publishes nothing in this
    // mode, which is right — no window is connected yet to hear a frame.
    const { sweptCount } = sweepExpiredDisplayWidgets(db)
    if (sweptCount > 0) {
      input.logger.info({ sweptCount }, 'boot display sweep removed expired widgets')
    }
  } catch (err) {
    input.logger.error({ err }, 'boot display sweep failed')
  }
}
