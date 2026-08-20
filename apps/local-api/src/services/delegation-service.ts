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
// BOUNDS (session-hardening arc, 2026-08-19): a claimed run holds its target key
// for its WHOLE run — the tick settles only when the turn does — so the bound
// is a hard cap ON the turn (`VYNEL_DELEGATED_TURN_MAX_MS`: interrupt, then
// settle failed with an honest delivery). Every claim carries a LEASE
// (`VYNEL_DELEGATION_LEASE_MS`) the tick heartbeats (`VYNEL_DELEGATION_HEARTBEAT_MS`);
// the 60 s sweeper here settles lapsed leases by kind exactly like the boot pass
// (`settleOrphanedDelegationClaims` — one policy, two readers).
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
import { runDelegationClaimAndRunTick } from '@vynel/session/delegation'
import type {
  TurnEventBroadcaster,
  DelegationCancelRegistry,
  RunGlobalRootReportTurn,
  SessionTargetLocks,
} from '@vynel/session/delegation'
import type { SessionActivityFeed } from '@vynel/session/runtime'
import type { DelegatedTurnMcpComposer } from '../sessions/build-workspace-background-mcp.js'
import { loadEnv } from '../env.js'
import { settleOrphanedDelegationClaims } from './delegation-orphan-settlement.js'
import { createSuspendAwareSweep } from './suspend-aware-lease-sweep.js'

const DELEGATION_POLL_INTERVAL_MS = 1_000
// The lease sweeper's cadence — the approvals reaper's 60 s, the app's
// standing "how often do we look for the dead" answer.
const LEASE_SWEEP_INTERVAL_MS = 60_000

// Each run is a live Claude SDK subprocess — real memory + API streaming. The ONE home
// for the cap's DEFAULT: Chad's plan makes this a user-facing setting later ("how many
// sessions Claude can run"); the settings arc swaps it for a stored preference without
// touching the pool mechanics. Until then `VYNEL_MAX_CONCURRENT_DELEGATIONS` (env.ts →
// `maxConcurrentDelegations`) overrides it for a machine that can carry more runs.
const DEFAULT_MAX_CONCURRENT_DELEGATIONS = 3

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
  /** How many delegated runs may live at once (child sessions, routed tasks,
   *  agent runs — the user's own interactive turns are outside the pool).
   *  Omit = DEFAULT_MAX_CONCURRENT_DELEGATIONS. */
  maxConcurrentDelegations?: number
  /** The bounds (D5). Omit = the env knobs (`VYNEL_DELEGATED_TURN_MAX_MS`,
   *  `VYNEL_DELEGATION_LEASE_MS`, `VYNEL_DELEGATION_HEARTBEAT_MS`). */
  hardCapMs?: number
  leaseMs?: number
  heartbeatMs?: number
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
  const maxConcurrentDelegations =
    options.maxConcurrentDelegations ?? DEFAULT_MAX_CONCURRENT_DELEGATIONS
  const env = loadEnv()
  const hardCapMs = options.hardCapMs ?? env.VYNEL_DELEGATED_TURN_MAX_MS
  const leaseMs = options.leaseMs ?? env.VYNEL_DELEGATION_LEASE_MS
  const heartbeatMs = options.heartbeatMs ?? env.VYNEL_DELEGATION_HEARTBEAT_MS

  // The BOOT pass: at startup nothing is running yet, so EVERY `claimed` row is
  // an orphan of a prior crash/restart — settled by kind (message kinds requeue,
  // work kinds fail + one honest failure delivery each). Leaving them claimed
  // made them linger forever as "in-flight" (the Ch3.5 processing indicator).
  settleOrphanedDelegationClaims(db, logger, {})
  // The LEASE sweeper: the same policy for a claim whose lease lapsed at
  // runtime — a run this process lost track of, or a crash the next boot pass
  // has not seen yet. Live runs heartbeat their lease well inside it.
  // Fronted by the suspend guard (audit R2-L): the first tick after the machine
  // slept longer than the lease would otherwise reap every LIVE run at once.
  // The BOOT pass above stays ungated — at boot nothing is running, so a stale
  // heartbeat there really is an orphan.
  const leaseSweep = createSuspendAwareSweep({
    intervalMs: LEASE_SWEEP_INTERVAL_MS,
    sweep: () => settleOrphanedDelegationClaims(db, logger, { onlyExpiredLeases: true }),
    logger,
  })
  const sweepTimer = setInterval(() => {
    try {
      leaseSweep.tick()
    } catch (err) {
      logger.error({ err }, 'delegation lease sweep failed')
    }
  }, LEASE_SWEEP_INTERVAL_MS)

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
    while (activeRunCount < maxConcurrentDelegations) {
      let claimedTargetKey: string | null = null
      let releaseTargetLock: (() => void) | null = null
      let releaseWanted = false
      void runDelegationClaimAndRunTick(db, {
        provider,
        logger,
        activityFeed,
        composeWorkspaceMcpServers,
        runGlobalRootReportTurn,
        hardCapMs,
        leaseMs,
        heartbeatMs,
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
    { maxConcurrent: maxConcurrentDelegations, hardCapMs, leaseMs, heartbeatMs },
    'delegation service started (poll 1s, bounded pool, 60s lease sweep)',
  )

  return {
    stop: () => {
      clearInterval(pollTimer)
      clearInterval(sweepTimer)
    },
  }
}
