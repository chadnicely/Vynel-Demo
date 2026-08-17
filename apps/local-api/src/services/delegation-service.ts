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
// two ticks claiming the SAME job.) The held-target state lives in the injected
// SessionTargetLocks — SHARED with the session-turn route (Slice ③a) so a user turn
// into a spawned session and a delegated run to it can never overlap.
//
// MCP: every routed turn attaches the BACKGROUND workspace set via the injected
// `composeWorkspaceMcpServers` (built by `buildWorkspaceBackgroundMcpComposer` in
// `server.ts` — the schedules precedent). It used to attach NOTHING, which made the
// SDK's deferred-tool reconciliation strip the resumed session's `mcp__vynel*`
// tools and tell the model the whole Vynel server DISCONNECTED (2026-07-21 bug).
// Started from `server.ts` after `createApp(...)`, stopped on shutdown.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { AiAgentProvider } from '@vynel/providers'
import {
  failOrphanedClaimedDelegations,
  isWorkJobKind,
  requeueOrphanedClaimedReportDeliveries,
} from '@vynel/orchestration'
import {
  runDelegationClaimAndRunTick,
  enqueueJobFailureDelivery,
  previewTaskText,
  jobRetryHint,
} from '@vynel/session/delegation'
import type {
  TurnEventBroadcaster,
  DelegationCancelRegistry,
  RunGlobalRootReportTurn,
  SessionTargetLocks,
} from '@vynel/session/delegation'
import type { SessionActivityFeed } from '@vynel/session/runtime'
import type { DelegatedTurnMcpComposer } from '../sessions/build-workspace-background-mcp.js'

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
  /** The delegated-turn MCP composition (target-aware: workspace-root gets the
   *  interactive set, spawned-session the plain one) — REQUIRED so a routed
   *  turn never runs bare against a session that has the vynel tools (the
   *  deferred-tool "server disconnected" class). */
  composeWorkspaceMcpServers: DelegatedTurnMcpComposer
  /** The GLOBAL-root notify runner for report-delivery jobs (session-comms) —
   *  `buildGlobalRootReportTurnRunner` in server.ts. REQUIRED: a global
   *  delivery without it fails cleanly but delivers nothing. */
  runGlobalRootReportTurn: RunGlobalRootReportTurn
  /** The process-wide single-writer lock per target — SHARED with the api
   *  routes (sessions-surface Slice ③a): a user turn into a spawned session
   *  holds the same key a delegated run to it would claim, so the two can
   *  never write one resumed SDK session concurrently. REQUIRED: the pool's
   *  same-target exclusion reads `busyKeys()` and every claimed run holds its
   *  key for the run's life. */
  targetLocks: SessionTargetLocks
  /** Context-pressure threshold override for the delegated runners' boundary
   *  continuity step (the env smoke knob) — the same value the interactive
   *  streams honor, so every runner swaps at one point. Omit = 0.85. */
  pressureThreshold?: number
}

export function startDelegationService(options: DelegationServiceOptions): { stop: () => void } {
  const {
    db,
    logger,
    provider,
    activityFeed,
    turnEvents,
    cancelRegistry,
    composeWorkspaceMcpServers,
    runGlobalRootReportTurn,
    targetLocks,
    pressureThreshold,
  } = options

  // Report deliveries orphaned mid-delivery REQUEUE instead of failing: the
  // report body is the ONLY copy of a child's result, so destroying a claimed
  // delivery at boot silently lost it forever (session-review B1). At startup
  // nothing is running, so re-delivery is safe at-least-once.
  const requeuedDeliveries = requeueOrphanedClaimedReportDeliveries(db, new Date())
  if (requeuedDeliveries.length > 0) {
    logger.warn(
      { requeued: requeuedDeliveries.length },
      'delegation service: requeued orphaned "claimed" report deliveries at startup (re-delivery is at-least-once; the report is the only copy)',
    )
  }
  // Reclaim the REST of the jobs orphaned in `claimed` by a prior crash/restart mid-run: mark
  // them FAILED — NOT re-run (exactly-once preserved; the Ch1 decision was no-RE-EXECUTE, not
  // no-cleanup). At startup nothing is running yet, so any `claimed` row is orphaned; leaving
  // them claimed made them linger forever as "in-flight" (visible in the Ch3.5 processing
  // indicator).
  const reclaimed = failOrphanedClaimedDelegations(db, new Date())
  if (reclaimed.length > 0) {
    logger.warn(
      { reclaimed: reclaimed.length },
      'delegation service: reclaimed orphaned "claimed" jobs at startup (marked failed; a prior crash/restart left them mid-run)',
    )
  }
  // Persona-sessions restart parity: with acknowledge-first, silent orphan
  // death breaks the child's spoken "will report when done" — push an honest
  // failure delivery for each orphaned WORK row (task/agent-run), POSITIVELY:
  // delivery orphans stay silent (anti-cascade: a delivery must never spawn
  // one) and an orphaned NOTE is communication nobody awaits — pushing "your
  // note failed" would manufacture the tracking the kind refuses. A push
  // failure never blocks boot.
  for (const orphan of reclaimed) {
    if (!isWorkJobKind(orphan.jobKind)) continue
    try {
      enqueueJobFailureDelivery(
        db,
        orphan,
        `The background task "${previewTaskText(orphan.taskText)}" was interrupted by a ` +
          `restart and did not finish. Tell the user, and ${jobRetryHint(orphan)}`,
      )
    } catch (err) {
      logger.error(
        { err, jobId: orphan.id },
        'delegation service: failed to enqueue the restart-failure delivery for an orphan',
      )
    }
  }

  // The pool's run count lives here; WHICH targets are held lives in the
  // SHARED `targetLocks` (a target key is a workspace id or a spawned primary
  // id, Slice ④ — and, since Slice ③a, a key a user turn may hold too).
  // In-process only — same trust level as the old serial guard; the Phase-2
  // multi-process swap point is a DB-side lease.
  let activeRunCount = 0

  const pollTimer = setInterval(() => {
    // Fill free capacity each tick. The claim (and its onRunStarted) executes
    // SYNCHRONOUSLY inside the tick call — before its first await — so a
    // successful claim reserves its slot before the next loop iteration reads
    // the count, and an empty claim breaks without reserving anything.
    while (activeRunCount < MAX_CONCURRENT_DELEGATIONS) {
      let claimedTargetKey: string | null = null
      let releaseTargetLock: (() => void) | null = null
      let releaseWanted = false
      void runDelegationClaimAndRunTick(db, {
        provider,
        logger,
        activityFeed,
        composeWorkspaceMcpServers,
        runGlobalRootReportTurn,
        // Snapshot read synchronously per launch — `acquire` below registers a
        // claimed key synchronously, so the next loop iteration (and the next
        // poll) sees it excluded, exactly like the old in-closure Set.
        excludeTargetKeys: targetLocks.busyKeys(),
        onRunStarted: ({ targetKey }) => {
          claimedTargetKey = targetKey
          activeRunCount += 1
          // The claim excluded every busy key, so the lock is FREE here:
          // `acquire` registers the holder synchronously inside this call
          // (the pool's sync-claim contract holds); only the release fn
          // arrives on a microtask — always ahead of the run's `.finally`,
          // which was queued after it.
          void targetLocks.acquire(targetKey).then((release) => {
            if (releaseWanted) release()
            else releaseTargetLock = release
          })
        },
        ...(turnEvents !== undefined ? { turnEvents } : {}),
        ...(cancelRegistry !== undefined ? { cancelRegistry } : {}),
        ...(pressureThreshold !== undefined ? { pressureThreshold } : {}),
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
            if (releaseTargetLock !== null) {
              releaseTargetLock()
            } else {
              // Should be unreachable (see the acquire comment) — self-heal by
              // releasing the moment the fn arrives, and log loudly: a held
              // key would silently starve that target forever.
              releaseWanted = true
              logger.error(
                { targetKey: claimedTargetKey },
                'delegation pool: run settled before its target lock resolved (sync-claim contract regressed) — releasing on arrival',
              )
            }
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
