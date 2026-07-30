// The interactive turns' `onModelsDiscovered` callback — persists the model
// roster the engine reports at session start (feeds `GET /providers/:id/models`
// and the composer's picker). One home for both interactive streams (the
// workspace chat turn + the global root turn). Best-effort by contract: a
// bookkeeping failure must never touch the user's turn.

import { recordDiscoveredModels } from '@vynel/provider-preferences'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { DiscoveredProviderModel } from '@vynel/providers'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

export function buildRecordDiscoveredModels(
  db: Database,
  userId: string,
  logger: Logger,
): (models: DiscoveredProviderModel[]) => void {
  return (models) => {
    try {
      recordDiscoveredModels(db, { userId, providerId: DEFAULT_PROVIDER_ID, models })
    } catch (err) {
      logger.warn({ err }, 'failed to persist the discovered model roster')
    }
  }
}
