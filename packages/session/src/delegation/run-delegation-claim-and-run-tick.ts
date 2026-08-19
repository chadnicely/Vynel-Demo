// `runDelegationClaimAndRunTick` — claims ONE pending delegation job and runs it to a
// terminal state (brain-tree Chapter 1, async core). The CONSUMER half of the durable
// queue: the in-process `delegation-service` calls this on a poll; it claims atomically,
// runs the routed turn, and marks the job done/failed. On completion the report travels
// UP to the CREATOR's conversation as a QUEUED NOTIFY TURN (session-comms — a
// 'report-delivery' job this same tick later claims and runs via
// `runReportDeliveryJob`; the creator is the spawning workspace's primary for a
// workspace-spawned session target — Slice ④b — or the global root otherwise). Mirrors
// the core precedent `runScheduleClaimAndFireTick`; the apps/local-api
// `delegation-service` poll loop is its only production caller.
//
// THIS FILE IS THE CLAIM + THE KIND DISPATCH (session-hardening A6): the pool key,
// the lease heartbeat, and the branch to the runner each kind owns —
// `runAgentRunJob` (a `@mention` colleague turn), `runReportDeliveryJob` (a
// report / update / direct / global-note NOTIFY turn on the requester), and
// `runTaskJob` (a routed task or targeted note on a workspace root / spawned
// session / colleague). Each runner reuses the same shape: `routeRequest` (the
// coordinator) + a delegate runner + persist through the shared pipeline.
//
// THE TICK SETTLES ONLY WHEN THE TURN SETTLES (session-hardening A1): the pool
// releases the target's single-writer key on the tick's settlement, so the bound
// is a HARD CAP on the turn itself — past `hardCapMs` the cap interrupts the SDK
// session (the Stop path's lever), the coordinator awaits the turn's end, and the
// job settles `failed: exceeded the N-minute cap` with the honest failure
// delivery. Nothing ever runs unlocked.
//
// LEASE (A2): the claim stamps `leaseExpiresAt`; this tick heartbeats it forward
// every `heartbeatMs` for the run's life, so the service's sweeper can tell a
// crashed/wedged claim (lease expired) from a long live one.
//
// Swap-safe delivery: the creator conversation may compaction-swap between enqueue and
// completion, so the report-delivery job targets the creator by IDENTITY (workspace id /
// the global root) and the notify runner resolves its CURRENT session at run time — never
// the job's enqueue-time `parentSessionId`. Every runner guards its whole post-claim body
// so an unexpected throw marks the job failed rather than leaving it stuck `claimed`.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  claimNextPendingDelegationJob,
  GLOBAL_ROOT_DELIVERY_TARGET_KEY,
  isDeliveryJobKind,
  type DelegationJob,
} from '@vynel/orchestration'
import type { AiAgentProvider } from '@vynel/providers'
import { runAgentRunJob } from './run-agent-run-job.js'
import { runReportDeliveryJob, type RunGlobalRootReportTurn } from './run-report-delivery-tick.js'
import { runTaskJob, type RoutedTurnMcpComposer } from './run-task-job.js'
import type { TurnEventBroadcaster } from './turn-event-broadcaster.js'
import type { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import type { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { startDelegationLeaseHeartbeat } from './delegation-lease-heartbeat.js'

// The bounds' package-side defaults — the SAME values `apps/local-api/src/env.ts`
// defaults its knobs to (D5): the api edge forwards the env-resolved values, a
// test harness or another caller gets identical behaviour without them.
/** A delegated turn's hard cap on WORKING time (suspended while parked). */
export const DEFAULT_DELEGATED_TURN_HARD_CAP_MS = 60 * 60 * 1000
/** The claim lease + the heartbeat that extends it. */
export const DEFAULT_DELEGATION_LEASE_MS = 3 * 60 * 1000
export const DEFAULT_DELEGATION_HEARTBEAT_MS = 30 * 1000

export interface RunDelegationTickDeps {
  provider: AiAgentProvider
  logger: Logger
  /** The per-user liveness feed — a claimed run announces itself (origin
   *  'delegation') so every open UI learns the workspace is mid-task without
   *  Watching. REQUIRED (the runGlobalRootTurn precedent): a background turn
   *  invisible to the feed is against the trust doctrine. */
  activityFeed: SessionActivityFeed
  /** The in-process turn-event pub/sub — the routed turn publishes to its trace
   *  channel so the SSE observe route streams it live. Omit → no observers. */
  turnEvents?: TurnEventBroadcaster
  /** The user-stop bridge: each claimed run registers here so the stop route
   *  can flag it cancelled + interrupt its session. Omit → no stop reach. */
  cancelRegistry?: DelegationCancelRegistry
  /** The hard cap on one job's turn (ms; suspended while its approvals are
   *  parked) — past it the turn is interrupted and the job fails honestly.
   *  Defaults to DEFAULT_DELEGATED_TURN_HARD_CAP_MS. */
  hardCapMs?: number
  /** The claim lease + its heartbeat cadence (ms). Defaults to the package
   *  constants above; the api edge forwards the env knobs. */
  leaseMs?: number
  heartbeatMs?: number
  /** Context-pressure threshold override for the runners' boundary continuity
   *  step (the env smoke knob) — forwarded so delegated turns swap at the same
   *  point the interactive streams do. Omit for the production default. */
  pressureThreshold?: number
  /** Targets with a live run this process — the claim skips them (the pool's
   *  same-target exclusion; single-writer per conversation). A target key is
   *  the job's workspaceId OR its targetPrimarySessionId (Slice ④). */
  excludeTargetKeys?: ReadonlySet<string>
  /** Fires SYNCHRONOUSLY the moment a job is claimed (before any await) — the
   *  service's pool uses it to reserve the target slot for the run's life.
   *  `targetKey` = targetPrimarySessionId ?? workspaceId. */
  onRunStarted?: (run: { jobId: string; targetKey: string }) => void
  /** The delegated-turn MCP composition (the api edge binds it per target —
   *  see `RoutedTurnMcpComposer`). REQUIRED for production wiring: a routed
   *  turn that attaches no MCP servers strips the resumed session's deferred
   *  tools — the CLI then tells the model the whole Vynel server DISCONNECTED
   *  (the 2026-07-21 live bug). Optional only so MCP-less test harnesses keep
   *  composing nothing. */
  composeWorkspaceMcpServers?: RoutedTurnMcpComposer
  /** The GLOBAL-root notify runner for report-delivery jobs (session-comms) —
   *  the api edge binds `runGlobalRootTurn` with report attribution + steer.
   *  REQUIRED in production; a global delivery claims and fails cleanly
   *  without it (optional only for MCP-less test harnesses). */
  runGlobalRootReportTurn?: RunGlobalRootReportTurn
}

/** Claim the next pending delegation job and run it to a terminal state. Returns true if
 *  a job was processed, false if the queue was empty. A failed / capped / throwing job
 *  is recorded as `failed` on the row, not propagated (the service's tick also guards). */
export async function runDelegationClaimAndRunTick(
  db: Database,
  deps: RunDelegationTickDeps,
): Promise<boolean> {
  const claimed = claimNextPendingDelegationJob(db, new Date(), {
    leaseMs: deps.leaseMs ?? DEFAULT_DELEGATION_LEASE_MS,
    ...(deps.excludeTargetKeys !== undefined && deps.excludeTargetKeys.size > 0
      ? { excludeTargetKeys: [...deps.excludeTargetKeys] }
      : {}),
  })
  if (claimed === null) return false
  // The pool's exclusion key: the session-target primary id (a spawned session
  // OR an agent colleague — persona-sessions: two mentions of one colleague run
  // FIFO on its primary id), the workspace id for a workspace target, the
  // SHARED synthetic key for a global-requester DELIVERY row (session-comms:
  // the global root is one conversation — at most one notify turn runs; the
  // claim skips the rest while the key is busy, so they wait as PENDING instead
  // of burning budget in the root-lock queue). An agent-run row's grounding
  // `workspaceId` is NOT a conversation it resumes, so it never reserves that
  // slot (the claim's agent-run exemption); a legacy agent-run row without a
  // stamped colleague keys on its own id. The job id is otherwise a defensive
  // fallback for a targetless TASK row (the enqueue ops preclude it).
  const claimedKind = claimed.jobKind ?? 'task'
  // A both-null 'note' row targets the GLOBAL conversation (voice-session arc)
  // — it rides the DELIVERY rail below and shares the global single-writer
  // key; a targeted note keeps the task rail unchanged.
  const isGlobalNoteDelivery =
    claimedKind === 'note' &&
    claimed.targetPrimarySessionId === null &&
    claimed.workspaceId === null
  const targetKey =
    claimedKind === 'agent-run'
      ? (claimed.targetPrimarySessionId ?? claimed.id)
      : (claimed.targetPrimarySessionId ??
        claimed.workspaceId ??
        (isDeliveryJobKind(claimed.jobKind) || isGlobalNoteDelivery
          ? GLOBAL_ROOT_DELIVERY_TARGET_KEY
          : claimed.id))
  deps.onRunStarted?.({ jobId: claimed.id, targetKey })
  const heartbeat = startDelegationLeaseHeartbeat(db, {
    jobId: claimed.id,
    leaseMs: deps.leaseMs ?? DEFAULT_DELEGATION_LEASE_MS,
    heartbeatMs: deps.heartbeatMs ?? DEFAULT_DELEGATION_HEARTBEAT_MS,
    logger: deps.logger,
  })
  try {
    return await runClaimedJob(db, deps, claimed, {
      claimedKind,
      isGlobalNoteDelivery,
      targetKey,
    })
  } finally {
    heartbeat.stop()
  }
}

/** Run ONE claimed job to a terminal state under the pool slot + lease the
 *  caller holds. Branches on the KIND: agent-run / delivery / task-or-note. */
async function runClaimedJob(
  db: Database,
  deps: RunDelegationTickDeps,
  claimed: DelegationJob,
  run: {
    claimedKind: NonNullable<DelegationJob['jobKind']>
    /** A both-null 'note' row — delivers on the GLOBAL conversation. */
    isGlobalNoteDelivery: boolean
    /** The pool's exclusion key for this run. */
    targetKey: string
  },
): Promise<boolean> {
  const { claimedKind, isGlobalNoteDelivery, targetKey } = run
  const runnerDeps = {
    provider: deps.provider,
    logger: deps.logger,
    activityFeed: deps.activityFeed,
    ...(deps.turnEvents !== undefined ? { turnEvents: deps.turnEvents } : {}),
    ...(deps.cancelRegistry !== undefined ? { cancelRegistry: deps.cancelRegistry } : {}),
    hardCapMs: deps.hardCapMs ?? DEFAULT_DELEGATED_TURN_HARD_CAP_MS,
    ...(deps.composeWorkspaceMcpServers !== undefined
      ? { composeWorkspaceMcpServers: deps.composeWorkspaceMcpServers }
      : {}),
    ...(deps.pressureThreshold !== undefined ? { pressureThreshold: deps.pressureThreshold } : {}),
  }

  // Persona-sessions: an 'agent-run' row resumes the mentioned agent's
  // COLLEAGUE session; its spoken send_message is the only report path.
  if (claimedKind === 'agent-run') {
    return runAgentRunJob(db, runnerDeps, claimed)
  }

  // Session-comms + persona-sessions: a DELIVERY row (report or update) runs
  // the NOTIFY branch — a real turn on the requester's conversation with the
  // child's message as the attributed inbound. The runner branches on the kind
  // internally (marker + steer); the exclusion key came out above for free.
  // NULL = 'task' (every legacy row). A both-null note delivers on the global
  // conversation through the same notify machinery.
  if (isDeliveryJobKind(claimed.jobKind) || isGlobalNoteDelivery) {
    return runReportDeliveryJob(
      db,
      {
        ...runnerDeps,
        ...(deps.runGlobalRootReportTurn !== undefined
          ? { runGlobalRootReportTurn: deps.runGlobalRootReportTurn }
          : {}),
      },
      claimed,
    )
  }

  // A routed TASK, or a targeted NOTE (the lateral kind rides the task rails
  // under the absorb voice — see `runTaskJob`).
  return runTaskJob(db, runnerDeps, claimed, { isNote: claimedKind === 'note', targetKey })
}
