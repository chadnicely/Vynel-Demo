// Core op — the daily purge of TERMINAL channel rows past the retention
// window (30 days). channels has no `deletedAt` (hard-delete + cascade,
// D16); this keeps the child tables' terminal-status rows from growing
// unbounded. sync. Active rows (pending/routed inbound;
// pending/sending/failed-retry queue) are never purged.
//
// Loop body lives HERE (core); the worker file is a thin (db, logger)
// delegator per `docs/foundation.md §2 row 1` + structure-standard.md.
//
// Spec: `docs/blueprints/channels/blueprint.md §7`.

import * as channelsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../channels-types.js'

const DEFAULT_RETENTION_DAYS = 30
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

export interface PurgeTerminalChannelRowsInput {
  /** Override the 30-day default (mainly for tests + future tuning). */
  readonly retentionDays?: number
}

export interface PurgeTerminalChannelRowsResult {
  readonly inboundDeleted: number
  readonly outboundDeleted: number
}

export function purgeTerminalChannelRows(
  db: Database,
  input: PurgeTerminalChannelRowsInput = {},
  deps: { logger?: StructuralLogger } = {},
): PurgeTerminalChannelRowsResult {
  const retentionDays = input.retentionDays ?? DEFAULT_RETENTION_DAYS
  const cutoff = new Date(Date.now() - retentionDays * MILLIS_PER_DAY)

  const inboundDeleted = channelsRepository.hardDeleteInboundMessagesBefore(db, {
    statuses: ['completed', 'ignored'],
    before: cutoff,
  })
  const outboundDeleted = channelsRepository.hardDeleteOutboundMessagesBefore(db, {
    statuses: ['sent', 'failed-give-up'],
    before: cutoff,
  })

  deps.logger?.info(
    { inboundDeleted, outboundDeleted, retentionDays, cutoffIso: cutoff.toISOString() },
    'purge-terminal-channel-rows: completed',
  )

  return { inboundDeleted, outboundDeleted }
}
