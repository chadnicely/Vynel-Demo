// The api-side `delegation` service — the in-process loop that drains the durable
// delegation-jobs queue (brain-tree Chapter 1, async core). On a ~1s poll it claims one
// pending job and runs it to terminal via `runDelegationClaimAndRunTick`. The THIRD
// inhabitant of `apps/local-api/src/services/` (after channels + schedules).
//
// SERIAL (an in-flight guard) — UNLIKE channels/schedules, whose ticks are short. A
// delegation tick runs a full workspace turn (minutes); an unguarded `setInterval` would
// start a fresh concurrent turn every second, fanning out N live provider sessions. The
// guard makes the loop process ONE job at a time. (The atomic DB claim already prevents
// two ticks claiming the SAME job; the guard prevents N DIFFERENT jobs running at once.)
//
// SYNC (no async) — unlike channels/schedules it does NOT compose `@vynel/mcp`: the
// workspace turn runs through the injected `AiAgentProvider` directly (via
// `delegateToWorkspaceRoot`), not an MCP-equipped chat turn. Started from `server.ts`
// after `createApp(...)`, stopped on shutdown.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { AiAgentProvider } from '@vynel/providers'
import { failOrphanedClaimedDelegations } from '@vynel/orchestration'
import { runDelegationClaimAndRunTick } from '@vynel/session/delegation'
import type { TurnEventBroadcaster } from '@vynel/session/delegation'

const DELEGATION_POLL_INTERVAL_MS = 1_000

export interface DelegationServiceOptions {
  db: Database
  logger: Logger
  provider: AiAgentProvider
  /** The turn-event pub/sub shared with the api routes — routed turns publish
   *  their live events for the SSE observe stream. */
  turnEvents?: TurnEventBroadcaster
}

export function startDelegationService(options: DelegationServiceOptions): { stop: () => void } {
  const { db, logger, provider, turnEvents } = options

  // Reclaim jobs orphaned in `claimed` by a prior crash/restart mid-run: mark them FAILED — NOT
  // re-run (exactly-once preserved; the Ch1 decision was no-RE-EXECUTE, not no-cleanup). At
  // startup nothing is running yet, so any `claimed` row is orphaned; leaving them claimed made
  // them linger forever as "in-flight" (visible in the Ch3.5 processing indicator).
  const reclaimed = failOrphanedClaimedDelegations(db, new Date())
  if (reclaimed > 0) {
    logger.warn(
      { reclaimed },
      'delegation service: reclaimed orphaned "claimed" jobs at startup (marked failed; a prior crash/restart left them mid-run)',
    )
  }

  // Serial: never start a second tick while one is in flight (a tick is minutes-long).
  let inFlight = false
  const pollTimer = setInterval(() => {
    if (inFlight) return
    inFlight = true
    runDelegationClaimAndRunTick(db, { provider, logger, ...(turnEvents !== undefined ? { turnEvents } : {}) })
      .catch((err) => logger.error({ err }, 'delegation claim-and-run tick failed'))
      .finally(() => {
        inFlight = false
      })
  }, DELEGATION_POLL_INTERVAL_MS)

  logger.info({}, 'delegation service started (poll 1s, serial)')

  return { stop: () => clearInterval(pollTimer) }
}
