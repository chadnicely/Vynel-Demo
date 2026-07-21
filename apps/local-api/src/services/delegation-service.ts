// The api-side `delegation` service — the in-process loop that drains the durable
// delegation-jobs queue (brain-tree Chapter 1, async core). On a ~1s poll it claims
// pending jobs and runs each to terminal via `runDelegationClaimAndRunTick`. The THIRD
// inhabitant of `apps/local-api/src/services/` (after channels + schedules).
//
// BOUNDED POOL (session-library Slice ②) — a delegation tick runs a full workspace turn
// (minutes), so an unguarded `setInterval` would fan out N live provider sessions. The
// pool caps live runs at MAX_CONCURRENT_DELEGATIONS and adds the invariant the cap alone
// can't give: NEVER two live runs against the same workspace (a workspace's primary
// conversation is a single SDK session — single-writer, the workspace-side analogue of
// the root-turn-lock). Parallelism happens across workspaces only; FIFO holds within
// each workspace via the claim's exclusion filter. (The atomic DB claim still prevents
// two ticks claiming the SAME job.)
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
import type { TurnEventBroadcaster, DelegationCancelRegistry } from '@vynel/session/delegation'
import type { SessionActivityFeed } from '@vynel/session/runtime'

const DELEGATION_POLL_INTERVAL_MS = 1_000

// Each run is a live Claude SDK subprocess — real memory + API streaming. The ONE home
// for the cap: Chad's plan makes this a user-facing setting later ("how many sessions
// Claude can run"); the settings arc swaps this constant for a stored preference
// without touching the pool mechanics.
const MAX_CONCURRENT_DELEGATIONS = 3

export interface DelegationServiceOptions {
  db: Database
  logger: Logger
  provider: AiAgentProvider
  /** The per-user liveness feed shared with the api routes — every claimed run
   *  announces itself (origin 'delegation') so open UIs see the workspace go
   *  busy. REQUIRED: a background turn invisible to the feed is against the
   *  trust doctrine. */
  activityFeed: SessionActivityFeed
  /** The turn-event pub/sub shared with the api routes — routed turns publish
   *  their live events for the SSE observe stream. */
  turnEvents?: TurnEventBroadcaster
  /** The stop bridge shared with the api routes — each claimed run registers
   *  so the stop route can cancel it. */
  cancelRegistry?: DelegationCancelRegistry
}

export function startDelegationService(options: DelegationServiceOptions): { stop: () => void } {
  const { db, logger, provider, activityFeed, turnEvents, cancelRegistry } = options

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

  // The pool state: how many runs live, and WHICH targets they hold (the
  // same-target exclusion — a target key is a workspace id or a spawned
  // primary id, Slice ④). In-process only — same trust level as the old
  // serial guard; the Phase-2 multi-process swap point is a DB-side lease.
  let activeRunCount = 0
  const activeTargetKeys = new Set<string>()

  const pollTimer = setInterval(() => {
    // Fill free capacity each tick. The claim (and its onRunStarted) executes
    // SYNCHRONOUSLY inside the tick call — before its first await — so a
    // successful claim reserves its slot before the next loop iteration reads
    // the count, and an empty claim breaks without reserving anything.
    while (activeRunCount < MAX_CONCURRENT_DELEGATIONS) {
      let claimedTargetKey: string | null = null
      void runDelegationClaimAndRunTick(db, {
        provider,
        logger,
        activityFeed,
        excludeTargetKeys: activeTargetKeys,
        onRunStarted: ({ targetKey }) => {
          claimedTargetKey = targetKey
          activeRunCount += 1
          activeTargetKeys.add(targetKey)
        },
        ...(turnEvents !== undefined ? { turnEvents } : {}),
        ...(cancelRegistry !== undefined ? { cancelRegistry } : {}),
      })
        .catch((err) => logger.error({ err }, 'delegation claim-and-run tick failed'))
        .finally(() => {
          // Attached to EVERY launch (not just claimed ones): if the tick's
          // sync-claim contract ever regressed, a late claim would otherwise
          // reserve a slot after the break skipped the release — a permanent
          // leak that silently starves all delegations. Re-checking here turns
          // that failure mode into a correctly-freed slot.
          if (claimedTargetKey !== null) {
            activeRunCount -= 1
            activeTargetKeys.delete(claimedTargetKey)
          }
        })
      if (claimedTargetKey === null) break // queue empty, or every pending target is busy
    }
  }, DELEGATION_POLL_INTERVAL_MS)

  logger.info(
    { maxConcurrent: MAX_CONCURRENT_DELEGATIONS },
    'delegation service started (poll 1s, bounded pool)',
  )

  return { stop: () => clearInterval(pollTimer) }
}
