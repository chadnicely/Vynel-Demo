// Core op — disarm a watch. sync. Update + `monitor.stopped` co-commit in ONE
// transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import * as monitorsRepository from '../repositories/index.js'
import { MONITOR_STOPPED, type MonitorStoppedPayload } from '../monitors-events.js'
import type { Database } from '@vynel/db'
import type { Monitor } from '../repositories/index.js'
import type { StructuralLogger } from '../monitors-types.js'

export function stopMonitor(
  db: Database,
  input: { userId: string; monitorId: string },
  deps: { logger?: StructuralLogger; now?: () => Date } = {},
): Monitor {
  const existing = monitorsRepository.findMonitorById(db, input.monitorId)
  // Unknown and not-owned are the SAME NotFound — a monitor id must not be
  // confirmable by probing (the get_delegated_task precedent).
  if (existing === null || existing.userId !== input.userId) {
    throw new NotFoundError('Monitor not found')
  }
  if (existing.status !== 'armed') {
    throw new ValidationError(
      `That monitor is already ${existing.status} — only an armed monitor can be stopped.`,
    )
  }

  const now = (deps.now ?? (() => new Date()))()
  const monitor = withTransaction(db, (tx) => {
    const updated = monitorsRepository.updateMonitor(tx, existing.id, {
      status: 'stopped',
      updatedAt: now,
    })
    const payload: MonitorStoppedPayload = {
      monitorId: updated.id,
      userId: updated.userId,
      workspaceId: updated.workspaceId,
      stoppedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: MONITOR_STOPPED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return updated
  })

  deps.logger?.info({ monitorId: monitor.id }, 'monitor stopped')
  return monitor
}
