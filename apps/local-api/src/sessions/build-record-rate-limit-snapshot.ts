// The interactive turns' `onRateLimitReported` callback — persists the
// account's latest limit reading per window (feeds `GET /providers/:id/limits`
// and the account popup's Limits tab). One home for both interactive streams
// (the workspace chat turn + the global root turn), the
// build-record-discovered-models shape. Best-effort by contract: a
// bookkeeping failure must never touch the user's turn.

import { recordRateLimitSnapshot } from '@vynel/provider-preferences'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { ProviderRateLimitReading } from '@vynel/providers'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

export function buildRecordRateLimitSnapshot(
  db: Database,
  userId: string,
  logger: Logger,
): (reading: ProviderRateLimitReading) => void {
  return (reading) => {
    try {
      recordRateLimitSnapshot(db, {
        userId,
        providerId: DEFAULT_PROVIDER_ID,
        snapshot: {
          windowKind: reading.windowKind,
          status: reading.status,
          utilization: reading.utilization,
          resetsAt: reading.resetsAt?.toISOString() ?? null,
        },
      })
    } catch (err) {
      logger.warn({ err }, 'failed to persist the rate-limit reading')
    }
  }
}
