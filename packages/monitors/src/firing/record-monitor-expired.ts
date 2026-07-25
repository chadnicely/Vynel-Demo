// Expire every armed monitor past its deadline, co-committing one
// `monitor.expired` per row. Called at the top of each tick.
//
// WHY AN EVENT PER EXPIRY: a watch that quietly vanished is the failure mode
// this whole leaf exists to avoid — an agent that armed a monitor and never
// heard back cannot tell "still waiting" from "died an hour ago". The event is
// the audit trail, and it carries `firedCount` so a 0 says the watch never hit
// once.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as monitorsRepository from '../repositories/index.js'
import { MONITOR_EXPIRED, type MonitorExpiredPayload } from '../monitors-events.js'
import type { Database } from '@vynel/db'
import type { Monitor } from '../repositories/index.js'
import type { StructuralLogger } from '../monitors-types.js'

export function recordMonitorExpired(
  db: Database,
  input: { now: Date },
  deps: { logger?: StructuralLogger } = {},
): Monitor[] {
  const expired = withTransaction(db, (tx) => {
    const rows = monitorsRepository.expireArmedMonitorsDueBy(tx, input.now)
    for (const row of rows) {
      const payload: MonitorExpiredPayload = {
        monitorId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        firedCount: row.firedCount,
        expiredAt: input.now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: MONITOR_EXPIRED,
        payload,
        createdAt: input.now,
        processedAt: null,
      })
    }
    return rows
  })

  if (expired.length > 0) {
    deps.logger?.info({ expiredCount: expired.length }, 'monitors expired')
  }
  return expired
}
