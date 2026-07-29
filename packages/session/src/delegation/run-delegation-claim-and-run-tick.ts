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
// REUSES, UNCHANGED, the synchronous delegation path — `routeRequest` (the timeout-raced
// coordinator) + `delegateToWorkspaceRoot` (run + workspace-side persist). The sync drain
// was only a problem because the ROUTE awaited it (blocking the user's turn); a background
// runner awaiting it is exactly right. The bound is on WAITING, not the turn: on timeout
// the workspace turn keeps running in its own SDK session — we just stop waiting on it.
//
// Swap-safe delivery: the creator conversation may compaction-swap between enqueue and
// completion, so the report-delivery job targets the creator by IDENTITY (workspace id /
// the global root) and the notify runner resolves its CURRENT session at run time — never
// the job's enqueue-time `parentSessionId`. The whole post-claim body is guarded so an
// unexpected throw marks the job failed rather than leaving it stuck `claimed` (Ch1 does
// not auto-reclaim stuck jobs — see `delegation-service.ts`).

import { withTransaction, type Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  ApprovalWaitGate,
  claimNextPendingDelegationJob,
  completeDelegationJob,
  enqueueReportDelivery,
  failDelegationJob,
  GLOBAL_ROOT_DELIVERY_TARGET_KEY,
  markDelegationsSurfacedToRoot,
  resolveThreadIdOf,
  routeRequest,
  type DelegateForRouting,
  type DelegationJob,
} from '@vynel/orchestration'
import {
  extractEmbeddedErrorCode,
  requeueIfRecoverable,
} from './classify-turn-failure.js'
import { type ChatTurnEvent } from '@vynel/chat'
import { findWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { findChannelById, enqueueChannelReply } from '@vynel/channels'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import * as primarySessionsRepository from '../repositories/index.js'
import { delegateToWorkspaceRoot } from './delegate-to-workspace-root.js'
import type { RoutedTurnMcpAttachment } from './routed-turn-provider-input.js'
import { delegateToSpawnedSession } from './delegate-to-spawned-session.js'
import { runReportDeliveryJob, type RunGlobalRootReportTurn } from './run-report-delivery-tick.js'
import { resolveSpawnedSessionDisplayName } from './resolve-spawned-session-name.js'
import {
  buildRoutedApprovalHandler,
  type RoutedApprovalHandler,
  type RoutedApprovalOrigin,
} from './build-routed-approval-handler.js'
import { traceChannelKey, type TurnEventBroadcaster } from './turn-event-broadcaster.js'
import type { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import type { SessionActivityFeed } from '../runtime/session-activity-feed.js'

// Generous — the bound is on WAITING, not the turn (which keeps running in its own SDK
// session). 120s was sized for an HTTP request waiting on a result; a background job
// nobody waits on gets a longer leash, so a timeout means genuinely-stuck work.
const DELEGATION_RUN_BUDGET_MS = 600_000

// A report at or under this length is already user-sized — deliver it as-is and skip
// the distill call (no wasted tokens on "Done, the file is fixed."-class reports).
const REPORT_DISTILL_MIN_LENGTH = 700

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
  /** Wait budget for one job's turn (ms). Defaults to DELEGATION_RUN_BUDGET_MS. */
  budgetMs?: number
  /** Targets with a live run this process — the claim skips them (the pool's
   *  same-target exclusion; single-writer per conversation). A target key is
   *  the job's workspaceId OR its targetPrimarySessionId (Slice ④). */
  excludeTargetKeys?: ReadonlySet<string>
  /** Fires SYNCHRONOUSLY the moment a job is claimed (before any await) — the
   *  service's pool uses it to reserve the target slot for the run's life.
   *  `targetKey` = targetPrimarySessionId ?? workspaceId. */
  onRunStarted?: (run: { jobId: string; targetKey: string }) => void
  /** The delegated-turn MCP composition (the api edge binds it per target:
   *  a WORKSPACE-ROOT turn gets the interactive descriptor — session-routing
   *  trio included, Chad's 2026-07-21 re-decision of the ④b pin — while a
   *  SPAWNED-SESSION target keeps the plain set; the schedules `FireScheduleDeps`
   *  precedent, core never imports @vynel/mcp). REQUIRED for production wiring:
   *  a routed turn that attaches no MCP servers strips the resumed session's
   *  deferred tools — the CLI then tells the model the whole Vynel server
   *  DISCONNECTED (the 2026-07-21 live bug). Optional only so MCP-less test
   *  harnesses keep composing nothing. */
  composeWorkspaceMcpServers?: (input: {
    db: Database
    userId: string
    workspaceId: string | null
    target: 'workspace-root' | 'spawned-session'
    threadId?: string
    jobId?: string
    /** The spawned primary a 'spawned-session' target resumes — the api edge
     *  stamps the caller-identity header from it so `report_to_requester`
     *  resolves the SESSION (not just its grounding workspace) and can never
     *  mis-address (session-comms fork 2). Absent for workspace-root targets. */
    targetPrimarySessionId?: string
  }) => RoutedTurnMcpAttachment
  /** The GLOBAL-root notify runner for report-delivery jobs (session-comms) —
   *  the api edge binds `runGlobalRootTurn` with report attribution + steer.
   *  REQUIRED in production; a global delivery claims and fails cleanly
   *  without it (optional only for MCP-less test harnesses). */
  runGlobalRootReportTurn?: RunGlobalRootReportTurn
}

/** Resolve a job's origin channel to a DELIVERABLE address — the shared guard for the
 *  approval push (mid-turn) and the report delivery (completion): the origin columns are
 *  set as a unit; the channel must exist, be enabled, and be owned by the delegation's
 *  user (tenant defense-in-depth — the origin traces to a header read at the boundary). */
function resolveDeliverableOrigin(db: Database, claimed: DelegationJob): RoutedApprovalOrigin | null {
  if (
    claimed.originChannelId === null ||
    claimed.originExternalSenderId === null ||
    claimed.originExternalChatContextId === null
  ) {
    return null
  }
  const channel = findChannelById(db, claimed.originChannelId)
  if (channel === null || !channel.isEnabled || channel.userId !== claimed.userId) return null
  return {
    channel,
    externalRecipientId: claimed.originExternalSenderId,
    externalChatContextId: claimed.originExternalChatContextId,
  }
}

/** Claim the next pending delegation job and run it to a terminal state. Returns true if
 *  a job was processed, false if the queue was empty. A failed / timed-out / throwing job
 *  is recorded as `failed` on the row, not propagated (the service's tick also guards). */
export async function runDelegationClaimAndRunTick(
  db: Database,
  deps: RunDelegationTickDeps,
): Promise<boolean> {
  const claimed = claimNextPendingDelegationJob(db, new Date(), {
    ...(deps.excludeTargetKeys !== undefined && deps.excludeTargetKeys.size > 0
      ? { excludeTargetKeys: [...deps.excludeTargetKeys] }
      : {}),
  })
  if (claimed === null) return false
  // The pool's exclusion key: the spawned primary id for a session target, the
  // workspace id for a workspace target, the SHARED synthetic key for a
  // global-requester report-delivery row (session-comms: the global root is
  // one conversation — at most one notify turn runs; the claim skips the rest
  // while the key is busy, so they wait as PENDING instead of burning budget
  // in the root-lock queue). The job id is a defensive fallback for a
  // targetless TASK row (the enqueue ops preclude it) — it excludes nothing
  // real.
  const targetKey =
    claimed.targetPrimarySessionId ??
    claimed.workspaceId ??
    ((claimed.jobKind ?? 'task') === 'report-delivery'
      ? GLOBAL_ROOT_DELIVERY_TARGET_KEY
      : claimed.id)
  deps.onRunStarted?.({ jobId: claimed.id, targetKey })

  // Session-comms: a 'report-delivery' row runs the NOTIFY branch — a real turn
  // on the requester's conversation with the child's report as the inbound
  // message. Its exclusion key came out above for free: the requester
  // workspace's id (single-writer with task jobs on the same primary), or the
  // job id for the global root (nothing to exclude — the root-turn lock
  // serializes those). NULL = 'task' (every legacy row).
  if ((claimed.jobKind ?? 'task') === 'report-delivery') {
    return runReportDeliveryJob(
      db,
      {
        provider: deps.provider,
        logger: deps.logger,
        activityFeed: deps.activityFeed,
        ...(deps.turnEvents !== undefined ? { turnEvents: deps.turnEvents } : {}),
        ...(deps.cancelRegistry !== undefined ? { cancelRegistry: deps.cancelRegistry } : {}),
        budgetMs: deps.budgetMs ?? DELEGATION_RUN_BUDGET_MS,
        ...(deps.composeWorkspaceMcpServers !== undefined
          ? { composeWorkspaceMcpServers: deps.composeWorkspaceMcpServers }
          : {}),
        ...(deps.runGlobalRootReportTurn !== undefined
          ? { runGlobalRootReportTurn: deps.runGlobalRootReportTurn }
          : {}),
      },
      claimed,
    )
  }

  // The request's correlation key (brain-tree Chapter 2) — threaded into BOTH taggers
  // (the workspace-side task + reply via the delegate closure, the pushed report below)
  // so the whole chain shares it. `null` row value → `undefined` for the conditional
  // spreads (exactOptionalPropertyTypes: absent, not present-with-undefined).
  const partialSessionId = claimed.partialSessionId ?? undefined
  const turnEvents = deps.turnEvents

  // Register with the stop bridge for the run's whole life — a user Stop flags
  // this handle + interrupts the session it has learned. Ended in the OUTER
  // finally so no terminal path (complete/fail/throw) leaks the entry.
  const cancelHandle =
    deps.cancelRegistry !== undefined && partialSessionId !== undefined
      ? deps.cancelRegistry.begin(partialSessionId)
      : null

  // Lifecycle visibility (Ch3.5 diagnostics): a delegation runs a full provider turn that
  // can take a while — and may PARK on a human approval (surface-up); log the claim + the
  // terminal outcome so a slow/parked job is visible in the server console.
  deps.logger.info(
    {
      jobId: claimed.id,
      target: claimed.workspaceName ?? claimed.targetPrimarySessionId,
      task: claimed.taskText.slice(0, 100),
    },
    'delegation: claimed — running the delegated turn',
  )

  // Hoisted so the failure paths (failed envelope + the outer catch) can abandon any
  // still-parked approval — fail-closed, never a hanging SDK agent.
  let approvalHandler: RoutedApprovalHandler | null = null

  // Announce on the liveness feed so every open UI sees the target go busy
  // (presence dot, thread poll, banner). Immediately before try/finally —
  // anything throwable in between would leak a process-lifetime zombie turn.
  // A SESSION target is global-grounded: scopeKind 'global', no workspaceId
  // (the Sessions panel's working dot keys on the resolved session id).
  const activityHandle = deps.activityFeed.begin({
    userId: claimed.userId,
    ...(claimed.targetPrimarySessionId !== null || claimed.workspaceId === null
      ? { scopeKind: 'global' as const }
      : { scopeKind: 'workspace' as const, workspaceId: claimed.workspaceId }),
    origin: 'delegation',
  })
  try {
    // The run cwd — one column, one reading ("where this job's turn runs"): the
    // workspace folder for a workspace target, the spawned session's cwd for a
    // session target. Both enqueue ops always write it; null = a corrupt row.
    const runCwdPath = claimed.workspacePath
    if (runCwdPath === null) {
      throw new Error('delegation job has no run cwd (workspacePath is null — corrupt row)')
    }

    // Resolve the target's persona ONCE — one fresh read per run.
    // WORKSPACE target (brain-tree Ch5): manager name + CURRENT workspace name,
    // falling back to the enqueue-time name if the workspace was deleted.
    // SESSION target (Slice ④): the spawned session's NAME plays the manager
    // role (v1, recorded) — the shared display-name reading (one home with the
    // in-flight chip's label, see resolve-spawned-session-name.ts).
    let targetName: string
    let managerName: string | undefined
    // Slice ④b: a SESSION target's own workspace grounding (null for a
    // global-spawned target and every workspace-target job) — picks the MCP
    // attachment's grounding workspace below.
    let spawnedTargetWorkspaceId: string | null = null
    if (claimed.targetPrimarySessionId !== null) {
      const targetPrimary = primarySessionsRepository.findPrimarySessionById(
        db,
        claimed.targetPrimarySessionId,
      )
      spawnedTargetWorkspaceId = targetPrimary?.workspaceId ?? null
      targetName = resolveSpawnedSessionDisplayName(db, targetPrimary)
      managerName = undefined
    } else {
      const workspace =
        claimed.workspaceId !== null ? findWorkspaceById(db, claimed.workspaceId) : null
      targetName = workspace?.name ?? claimed.workspaceName ?? 'Workspace'
      managerName = workspace ? resolveManagerName(workspace) : undefined
    }

    // Surface-up: one gate + handler per job. The shared pipeline RECORDS each carded
    // tool's approval (web notifier always) and parks; the handler pushes the card to
    // the origin channel and suspends the wait budget until the decision (decision C).
    const waitGate = new ApprovalWaitGate()
    const approvalOrigin = resolveDeliverableOrigin(db, claimed)
    const handler = buildRoutedApprovalHandler({
      db,
      logger: deps.logger,
      provider: deps.provider,
      workspaceName: targetName,
      waitGate,
      ...(approvalOrigin !== null ? { origin: approvalOrigin } : {}),
    })
    approvalHandler = handler

    // The routed turn's MCP attachment — the target's grounding workspace picks
    // it: the job's workspace for a workspace target, the spawned primary's own
    // workspaceId for a workspace-grounded session target (Slice ④b). A
    // global-grounded session target composes NOTHING — bare is CONSISTENT
    // there (its priming attached nothing, so no deferred tools exist to
    // strip); every workspace-grounded turn MUST attach, or the resumed
    // session's deferred tools get stripped ("server disconnected").
    const mcpGroundingWorkspaceId =
      claimed.targetPrimarySessionId !== null ? spawnedTargetWorkspaceId : claimed.workspaceId
    // The chain this turn belongs to — every hop its tools make continues it.
    const claimedThreadId = resolveThreadIdOf(claimed)
    const mcpAttachment =
      deps.composeWorkspaceMcpServers !== undefined &&
      (mcpGroundingWorkspaceId !== null || claimed.targetPrimarySessionId !== null)
        ? deps.composeWorkspaceMcpServers({
            db,
            userId: claimed.userId,
            ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
            jobId: claimed.id,
            workspaceId: mcpGroundingWorkspaceId,
            target: claimed.targetPrimarySessionId !== null ? 'spawned-session' : 'workspace-root',
            // The caller identity for `report_to_requester` (session-comms): a
            // spawned target's tool calls must resolve as the SESSION, not its
            // grounding workspace.
            ...(claimed.targetPrimarySessionId !== null
              ? { targetPrimarySessionId: claimed.targetPrimarySessionId }
              : {}),
          })
        : undefined

    // The pieces both target runners share verbatim: mode, trace observing, and
    // the stop/liveness session hookup.
    const sharedRunnerOptions = {
      providerId: DEFAULT_PROVIDER_ID,
      ...(partialSessionId !== undefined ? { partialSessionId } : {}),
      // The delegating turn's mode, stamped on the job at enqueue (surface-up step 1).
      // Null (pre-mode job / channel origin) → the runner's bypass default.
      ...(claimed.permissionMode !== null ? { permissionMode: claimed.permissionMode } : {}),
      // The root's model/effort picks for this delegated turn, stamped on the job at
      // enqueue. Null → the provider defaults (absent, exactOptionalPropertyTypes).
      ...(claimed.model !== null ? { model: claimed.model } : {}),
      ...(claimed.thinkingEffort !== null ? { thinkingEffort: claimed.thinkingEffort } : {}),
      ...(mcpAttachment !== undefined ? { mcpAttachment } : {}),
      approvalHandler: handler,
      // Live observing: publish the turn's events on its trace channel; the end
      // closes any attached observe stream (drained or threw alike). The same
      // broadcaster also feeds the session-keyed channel (Watch everywhere).
      ...(turnEvents !== undefined ? { turnEvents } : {}),
      ...(turnEvents !== undefined && partialSessionId !== undefined
        ? {
            observer: {
              onTurnEvent: (event: ChatTurnEvent) =>
                turnEvents.publish(traceChannelKey(partialSessionId), event),
              onTurnEnded: () => turnEvents.end(traceChannelKey(partialSessionId)),
            },
          }
        : {}),
      // The stop bridge learns the RUNNING session id so a user Stop can
      // interrupt exactly this turn; the liveness feed learns it for the
      // turn-updated frame (the UI keys its thread poll on the session).
      onSessionResolved: (sdkSessionId: string) => {
        cancelHandle?.sessionResolved(sdkSessionId)
        activityHandle.sessionResolved(sdkSessionId)
      },
      logger: deps.logger,
    }

    // Branch on the target (Slice ④): a session job resumes the spawned
    // primary's continuing conversation; a workspace job is byte-for-byte the
    // pre-slice path. Captured for closure narrowing.
    const spawnedTargetId = claimed.targetPrimarySessionId
    const delegate: DelegateForRouting =
      spawnedTargetId !== null
        ? (delegationInput) =>
            delegateToSpawnedSession(db, deps.provider, {
              parentSessionId: delegationInput.parentSessionId,
              userId: delegationInput.userId,
              targetPrimarySessionId: spawnedTargetId,
              runCwdPath,
              sessionName: targetName,
              taskText: delegationInput.taskText,
              ...sharedRunnerOptions,
            })
        : (delegationInput) =>
            delegateToWorkspaceRoot(db, deps.provider, {
              ...delegationInput,
              workspaceName: targetName,
              ...(managerName !== undefined ? { managerName } : {}),
              ...sharedRunnerOptions,
            })

    const outcome = await routeRequest(
      {
        userId: claimed.userId,
        parentSessionId: claimed.parentSessionId,
        // For a session target this is the target KEY (routeRequest only threads
        // it to the delegate + its log lines; the session closure captures its
        // own target and ignores the threaded id).
        targetWorkspaceId: targetKey,
        targetWorkspacePath: runCwdPath,
        taskText: claimed.taskText,
        timeoutMs: deps.budgetMs ?? DELEGATION_RUN_BUDGET_MS,
      },
      { delegate, logger: deps.logger, waitGate },
    )

    if (outcome.status === 'completed' && cancelHandle?.isCancelRequested()) {
      // Stop always wins at terminal time — the route already told the user
      // 'stopping', so a turn that outran its interrupt (the flag-only window
      // before a session id exists, a mid-swap miss) must NOT go green or push
      // its report. Coherent policy over an undetectable three-way race.
      await approvalHandler.abandonParked()
      failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
      deps.logger.info(
        { jobId: claimed.id },
        'delegation: stopped by the user at terminal time (report suppressed)',
      )
    } else if (outcome.status === 'completed') {
      // Resolved FRESH at completion (not the claim-time resolve) — the channel may have
      // changed mid-run. Shared by the distill target below and the delivery further down.
      const reportOrigin =
        claimed.originChannelId !== null ? resolveDeliverableOrigin(db, claimed) : null

      // The distill serves the CHANNEL delivery ONLY (session-comms pipeline,
      // Chad locked 2026-07-27: the chat reply is never captured as a report —
      // reports travel exclusively via send_message). A channel user still
      // gets a short reply in the manager's voice; without a driving channel
      // there is nothing to distill FOR, so skip the model call entirely.
      // Fail-open: a failed/unsupported distill (or an already-short reply)
      // delivers the full text — the channel user never loses the answer.
      let userReply = outcome.result
      if (reportOrigin !== null && outcome.result.length > REPORT_DISTILL_MIN_LENGTH) {
        // The contract says never-throw, but fail-open must not depend on a
        // provider honoring it — a distill throw would otherwise fail a
        // COMPLETED job through the outer catch, losing the user's answer.
        const distilled = await deps.provider
          .summarizeReport({
            workspacePath: runCwdPath,
            taskText: claimed.taskText,
            reportText: outcome.result,
            // For a session target: the session's name (v1 — the distill and the
            // label both speak as the session).
            workspaceName: targetName,
            deliveryTarget: reportOrigin?.channel.channelKind ?? 'chat',
            logger: deps.logger,
          })
          .catch((err: unknown) => {
            deps.logger.warn({ err, jobId: claimed.id }, 'delegation report distill threw')
            return null
          })
        if (distilled !== null && distilled.length > 0) userReply = distilled
        else {
          deps.logger.warn(
            { jobId: claimed.id },
            'delegation report distill unavailable — delivering the full report',
          )
        }
      }

      // NO HARVEST (session-comms pipeline, Chad locked 2026-07-27, reversing
      // the earlier silence-is-worse stance): the chat reply is NEVER captured
      // and delivered as a report — reports travel exclusively via the
      // send_message tool, sent deliberately by the one who did the work. The
      // reply still lives on the job row (resultText — the trace/status truth)
      // and in the child's own transcript, one Watch-click away.
      //
      // complete + mark-surfaced CO-COMMIT (invariant 5): completed rows are
      // ALWAYS surfaced now — the root's catch-up net injects resultText,
      // which would be the capture leaking back through another door. A
      // silent child therefore delivers nothing; the chip settles and
      // get_background_run answers status pulls. FAILED rows keep the
      // catch-up: a failure note is status, not capture, and the root must
      // learn the task died.
      try {
        withTransaction(db, (tx) => {
          completeDelegationJob(tx, claimed.id, outcome.result, new Date())
          markDelegationsSurfacedToRoot(tx, [claimed.id], new Date())
        })
      } catch (completionErr) {
        deps.logger.warn(
          { err: completionErr, jobId: claimed.id },
          'delegation completion co-commit failed — completing alone',
        )
        completeDelegationJob(db, claimed.id, outcome.result, new Date())
        // Retry the mark ALONE: an unsurfaced completed row would let the
        // root's catch-up inject resultText — the capture leaking back. If
        // the mark itself is what keeps throwing, that one terminal window
        // accepts the echo (awareness over policy, logged loud).
        try {
          markDelegationsSurfacedToRoot(db, [claimed.id], new Date())
        } catch (markErr) {
          deps.logger.warn(
            { err: markErr, jobId: claimed.id },
            'delegation surfaced-mark retry failed — the next root turn may echo the reply',
          )
        }
      }

      // Ch4 (channel-aware OUTPUT): if a CHANNEL drove this delegation, deliver the reply
      // back to that channel — closing the loop (channel → root → delegate → report → channel).
      // KEPT AT TASK COMPLETION (session-comms channel-delivery choice — the smaller safe
      // change): the channel user gets the distilled report immediately, on the path that is
      // already pinned end-to-end; the notify turn above is the chat/awareness path only and
      // never re-sends to channels (its steer says so). Best-effort: the job already
      // completed, so a delivery failure is logged, never re-fails the job.
      if (claimed.originChannelId !== null) {
        try {
          if (reportOrigin !== null) {
            enqueueChannelReply(db, {
              channel: reportOrigin.channel,
              message: {
                externalSenderId: reportOrigin.externalRecipientId,
                externalChatContextId: reportOrigin.externalChatContextId,
              },
              body: userReply,
            })
          } else {
            deps.logger.warn(
              { jobId: claimed.id, channelId: claimed.originChannelId },
              'delegation report channel delivery skipped — origin channel gone, disabled, or not owned',
            )
          }
        } catch (err) {
          deps.logger.warn(
            { err, jobId: claimed.id },
            'delegation report channel delivery failed (the job is still completed)',
          )
        }
      }

      deps.logger.info(
        { jobId: claimed.id, resultPreview: userReply.slice(0, 120) },
        'delegation: completed — report delivery enqueued for the creator conversation',
      )
    } else if (outcome.status === 'timed-out') {
      failDelegationJob(db, claimed.id, `timed-out after ${outcome.timeoutMs}ms`, new Date())
      deps.logger.warn(
        { jobId: claimed.id, timeoutMs: outcome.timeoutMs },
        'delegation job timed out (the workspace turn keeps running in its own session)',
      )
    } else {
      // The turn threw mid-run — deny anything still parked so the SDK agent isn't
      // left hanging on an unanswerable Promise (best-effort; reaper-backed).
      await approvalHandler.abandonParked()
      // A user Stop lands here (the interrupted turn throws by design) — record
      // it as the user's action, not a provider failure. Never retried.
      if (cancelHandle?.isCancelRequested()) {
        failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
        deps.logger.warn({ jobId: claimed.id }, 'delegation job stopped by the user')
      } else {
        settleFailedDelegationAttempt(db, claimed, outcome.message, deps)
      }
    }
    return true
  } catch (err) {
    // An unexpected throw (e.g. a DB error in the push or the complete) must never leave
    // the job stuck `claimed` (Ch1 does not auto-reclaim) — nor a parked approval hanging.
    // Terminal, never retried: a throw from THIS body is our own bookkeeping (a corrupt
    // row would loop forever on requeue), not a transient provider failure.
    await approvalHandler?.abandonParked()
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'delegation job run threw unexpectedly')
    return true
  } finally {
    cancelHandle?.end()
    activityHandle.end()
  }
}

/** A failed (non-stopped) attempt: a transient failure requeues with backoff;
 *  the terminal failure is PUSHED to the global root as a report delivery — a
 *  real notify turn telling the user it failed and that re-sending retries it.
 *  Before this, failures sat in the pull-only next-turn catch-up net. */
function settleFailedDelegationAttempt(
  db: Database,
  claimed: DelegationJob,
  errorMessage: string,
  deps: RunDelegationTickDeps,
): void {
  if (requeueIfRecoverable(db, claimed, errorMessage, deps.logger, 'delegation')) return

  const attemptCount = (claimed.attemptCount ?? 0) + 1
  failDelegationJob(db, claimed.id, errorMessage, new Date(), {
    ...(extractEmbeddedErrorCode(errorMessage) !== null
      ? { errorCode: extractEmbeddedErrorCode(errorMessage)! }
      : {}),
  })
  deps.logger.warn(
    { jobId: claimed.id, attemptCount, message: errorMessage },
    'delegation job failed terminally',
  )

  // Give-up push for TASK rows only (a failed report-delivery must never spawn
  // another delivery — the anti-cascade invariant).
  if ((claimed.jobKind ?? 'task') !== 'task') return
  try {
    const taskPreview =
      claimed.taskText.length > 160 ? `${claimed.taskText.slice(0, 160)}…` : claimed.taskText
    const threadId = resolveThreadIdOf(claimed)
    enqueueReportDelivery(db, {
      ...(threadId !== null ? { threadId } : {}),
      userId: claimed.userId,
      reporterSessionId:
        claimed.targetPrimarySessionId ?? claimed.workspaceId ?? claimed.parentSessionId,
      reporterLabel: claimed.workspaceName ?? 'Background task',
      reportBody:
        `The background task "${taskPreview}" failed` +
        `${attemptCount > 1 ? ` after ${attemptCount} attempts` : ''}: ${errorMessage}. ` +
        'Tell the user it failed, and re-send the task with send_message if it should be retried.',
      requester: { kind: 'global-root' },
    })
    // Surfaced via the push — keep the pull net from repeating it next turn.
    markDelegationsSurfacedToRoot(db, [claimed.id], new Date())
  } catch (err) {
    // The failed row stays in the root catch-up net — the user still learns of
    // it on their next turn even when the push could not be enqueued.
    deps.logger.error(
      { err, jobId: claimed.id },
      'failed to enqueue the delegation-failure report',
    )
  }
}
