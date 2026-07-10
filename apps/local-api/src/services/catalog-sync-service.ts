// Keeps the local cloud-catalog cache fresh from the hub. Runs only when a
// hub is configured. Each tick fetches /catalog through the hub session
// (which self-restores from the vault) and REPLACES the cache. Failure is
// decided by the session's own verdict: no session (signed-out/locked/not-
// configured) → CLEAR the cache (a signed-out user sees bundled items only);
// offline → KEEP it (offline browse). Same start/stop shape as the other boot
// services.

import type { Logger } from 'pino'
import type { HubSession } from '@vynel/hub-account'
import type { Database } from '@vynel/db'
import { syncCloudCatalog, clearCachedCloudCatalog } from '@vynel/marketplace'

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000

export interface CatalogSyncService {
  stop(): void
}

export function startCatalogSyncService(options: {
  readonly hubSession: HubSession
  readonly db: Database
  readonly logger: Logger
  readonly intervalMs?: number
}): CatalogSyncService {
  const sync = async (): Promise<void> => {
    try {
      const items = await options.hubSession.fetchCatalog()
      syncCloudCatalog(options.db, items, new Date())
      options.logger.info({ count: items.length }, 'cloud catalog synced')
    } catch (error) {
      // CLEAR only on a DEFINITIVE no-session verdict. A transient failure
      // (network / hub 5xx / timeout) doesn't trigger a restore, so status
      // stays 'signed-in' — treating that as "no session" would wipe the
      // offline cache exactly when the hub blips. Keep on signed-in/offline.
      const status = options.hubSession.getStatus().kind
      if (status === 'signed-out' || status === 'locked') {
        clearCachedCloudCatalog(options.db)
        options.logger.info({ status }, 'cloud catalog cleared (no hub session)')
        return
      }
      options.logger.warn(
        { status, error: error instanceof Error ? error.message : String(error) },
        'cloud catalog sync skipped — keeping cache',
      )
    }
  }

  void sync()
  const interval = setInterval(() => void sync(), options.intervalMs ?? DEFAULT_INTERVAL_MS)
  return {
    stop() {
      clearInterval(interval)
    },
  }
}
