// Core op — record that a monitor fired. sync. The status/counter update and
// the `monitor.fired` event co-commit in ONE transaction.
//
// The app tier enqueues the WAKE (those queues live outside this leaf) and
// passes the resulting job id here, so the row and the event both carry the
// chain: monitor → matched event → the job that wakes the owner.
//
// ORDER MATTERS at the call site: enqueue the wake FIRST, then call this. The
// inverse loses the wake if the process dies between them — a monitor marked
// fired with nobody woken is silent, and silence is indistinguishable from
// "nothing happened yet". A duplicate wake is merely noise.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as monitorsRepository from '../repositories/index.js'
import { MONITOR_FIRED, type MonitorFiredPayload } from '../monitors-events.js'
import type { Database } from '@vynel/db'
import type { Monitor } from '../repositories/index.js'

export function recordMonitorFired(
  db: Database,
  input: {
    monitor: Monitor
    matchedEventId: string
    matchedEventType: string
    /** The wake this firing enqueued — already committed by the caller. */
    enqueuedJobId: string
    /** The tick's window end — the watermark advances here, matched or not. */
    checkedThrough: Date
    firedAt: Date
  },
): Monitor {
  const { monitor, firedAt } = input
  return withTransaction(db, (tx) => {
    const updated = monitorsRepository.updateMonitor(tx, monitor.id, {
      // A `once` monitor is spent; a `recurring` one stays armed until it
      // expires or is stopped.
      status: monitor.mode === 'once' ? 'fired' : 'armed',
      firedCount: monitor.firedCount + 1,
      lastFiredAt: firedAt,
      lastCheckedAt: input.checkedThrough,
      updatedAt: firedAt,
    })
    const payload: MonitorFiredPayload = {
      monitorId: updated.id,
      userId: updated.userId,
      workspaceId: updated.workspaceId,
      ownerKind: updated.ownerKind,
      matchedEventId: input.matchedEventId,
      matchedEventType: input.matchedEventType,
      enqueuedJobId: input.enqueuedJobId,
      firedAt: firedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: MONITOR_FIRED,
      payload,
      createdAt: firedAt,
      processedAt: null,
    })
    return updated
  })
}
