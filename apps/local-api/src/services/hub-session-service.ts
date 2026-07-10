// The hub boot-check service: restore the vaulted session at daemon start
// (cloud-api.md §4 — the account-status check) and re-check while the daemon
// runs. The cadence is ADAPTIVE: a settled verdict re-checks daily, but
// `offline` retries every minute — a wifi blip at boot must not strand a
// signed-in user on the offline card for a day (the UI's "will retry
// automatically" copy depends on this). Same start/stop shape as the other
// boot services in server.ts.

import type { Logger } from 'pino'
import type { HubSession } from '@vynel/hub-account'

const SETTLED_RECHECK_MS = 24 * 60 * 60 * 1000
const OFFLINE_RETRY_MS = 60 * 1000

export interface HubSessionService {
  stop(): void
}

export function startHubSessionService(options: {
  readonly hubSession: HubSession
  readonly logger: Logger
  readonly settledRecheckMs?: number
  readonly offlineRetryMs?: number
}): HubSessionService {
  const settledRecheckMs = options.settledRecheckMs ?? SETTLED_RECHECK_MS
  const offlineRetryMs = options.offlineRetryMs ?? OFFLINE_RETRY_MS
  let stopped = false
  let timer: NodeJS.Timeout | undefined

  const scheduleNext = (statusKind: string): void => {
    if (stopped) return
    const delay = statusKind === 'offline' ? offlineRetryMs : settledRecheckMs
    timer = setTimeout(runCheck, delay)
  }

  const runCheck = (): void => {
    void options.hubSession
      .restore()
      .then((status) => {
        options.logger.info({ status: status.kind }, 'hub session check')
        scheduleNext(status.kind)
      })
      .catch((error: unknown) => {
        options.logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'hub session check failed',
        )
        scheduleNext('offline')
      })
  }

  // Boot check runs async — the daemon must not block its listen on an
  // unreachable hub (offline is a valid state).
  runCheck()

  return {
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}
