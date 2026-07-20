// `runDelegationClaimAndRunTick` — claims ONE pending delegation job and runs it to a
// terminal state (brain-tree Chapter 1, async core). The CONSUMER half of the durable
// queue: the in-process `delegation-service` calls this on a poll; it claims atomically,
// runs the workspace-root turn, pushes the report UP to the global root, and marks the
// job done/failed. Mirrors the core precedent `runScheduleClaimAndFireTick`; the
// apps/local-api `delegation-service` poll loop is its only production caller.
//
// REUSES, UNCHANGED, the synchronous delegation path — `routeRequest` (the timeout-raced
// coordinator) + `delegateToWorkspaceRoot` (run + workspace-side persist). The sync drain
// was only a problem because the ROUTE awaited it (blocking the user's turn); a background
// runner awaiting it is exactly right. The bound is on WAITING, not the turn: on timeout
// the workspace turn keeps running in its own SDK session — we just stop waiting on it.
//
// Swap-safe push: the global root may compaction-swap between enqueue and completion, so
// the report targets the CURRENT global-root session (re-resolved here), not the job's
// enqueue-time `parentSessionId`. The whole post-claim body is guarded so an unexpected
// throw marks the job failed rather than leaving it stuck `claimed` (Ch1 does not
// auto-reclaim stuck jobs — see `delegation-service.ts`).

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  ApprovalWaitGate,
  claimNextPendingDelegationJob,
  completeDelegationJob,
  failDelegationJob,
  routeRequest,
  type DelegateForRouting,
  type DelegationJob,
} from '@vynel/orchestration'
import { findPrimaryConversation } from '../continuity/index.js'
import { recordPushedReportMessage } from '@vynel/chat'
import { findWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { findChannelById, enqueueChannelReply } from '@vynel/channels'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import { delegateToWorkspaceRoot } from './delegate-to-workspace-root.js'
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
  /** Workspaces with a live run this process — the claim skips them (the
   *  pool's same-workspace exclusion; single-writer per conversation). */
  excludeWorkspaceIds?: ReadonlySet<string>
  /** Fires SYNCHRONOUSLY the moment a job is claimed (before any await) — the
   *  service's pool uses it to reserve the workspace slot for the run's life. */
  onRunStarted?: (run: { jobId: string; workspaceId: string }) => void
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
    ...(deps.excludeWorkspaceIds !== undefined && deps.excludeWorkspaceIds.size > 0
      ? { excludeWorkspaceIds: [...deps.excludeWorkspaceIds] }
      : {}),
  })
  if (claimed === null) return false
  deps.onRunStarted?.({ jobId: claimed.id, workspaceId: claimed.workspaceId })

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
    { jobId: claimed.id, workspace: claimed.workspaceName, task: claimed.taskText.slice(0, 100) },
    'delegation: claimed — running the workspace turn',
  )

  // Hoisted so the failure paths (failed envelope + the outer catch) can abandon any
  // still-parked approval — fail-closed, never a hanging SDK agent.
  let approvalHandler: RoutedApprovalHandler | null = null

  // Announce on the liveness feed so every open UI sees the workspace go
  // busy (presence dot, thread poll, banner). Immediately before try/finally —
  // anything throwable in between would leak a process-lifetime zombie turn.
  const activityHandle = deps.activityFeed.begin({
    userId: claimed.userId,
    scopeKind: 'workspace',
    workspaceId: claimed.workspaceId,
    origin: 'delegation',
  })
  try {
    // Resolve the workspace's persona ONCE (brain-tree Ch5) — both halves of the
    // "Mark · vynel" label come from this single fresh read: the manager name + the
    // CURRENT workspace name, falling back to the job's enqueue-time name if the
    // workspace was deleted between enqueue and now.
    const workspace = findWorkspaceById(db, claimed.workspaceId)
    const workspaceName = workspace?.name ?? claimed.workspaceName
    const managerName = workspace ? resolveManagerName(workspace) : undefined

    // Surface-up: one gate + handler per job. The shared pipeline RECORDS each carded
    // tool's approval (web notifier always) and parks; the handler pushes the card to
    // the origin channel and suspends the wait budget until the decision (decision C).
    const waitGate = new ApprovalWaitGate()
    const approvalOrigin = resolveDeliverableOrigin(db, claimed)
    const handler = buildRoutedApprovalHandler({
      db,
      logger: deps.logger,
      provider: deps.provider,
      workspaceName,
      waitGate,
      ...(approvalOrigin !== null ? { origin: approvalOrigin } : {}),
    })
    approvalHandler = handler

    const delegate: DelegateForRouting = (delegationInput) =>
      delegateToWorkspaceRoot(db, deps.provider, {
        ...delegationInput,
        workspaceName,
        ...(managerName !== undefined ? { managerName } : {}),
        providerId: DEFAULT_PROVIDER_ID,
        ...(partialSessionId !== undefined ? { partialSessionId } : {}),
        // The delegating turn's mode, stamped on the job at enqueue (surface-up step 1).
        // Null (pre-mode job / channel origin) → the runner's bypass default.
        ...(claimed.permissionMode !== null ? { permissionMode: claimed.permissionMode } : {}),
        approvalHandler: handler,
        // Live observing: publish the turn's events on its trace channel; the end
        // closes any attached observe stream (drained or threw alike).
        ...(turnEvents !== undefined && partialSessionId !== undefined
          ? {
              observer: {
                onTurnEvent: (event) =>
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
      })

    const outcome = await routeRequest(
      {
        userId: claimed.userId,
        parentSessionId: claimed.parentSessionId,
        targetWorkspaceId: claimed.workspaceId,
        targetWorkspacePath: claimed.workspacePath,
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

      // The workspace reported to global — global composes what the user reads: a short
      // reply in the manager's voice, formatted for where it lands (the global thread, or
      // the originating channel). The FULL report stays on the job row + the workspace
      // trace, one Watch-click away. Fail-open: a failed/unsupported distill (or an
      // already-short report) delivers the full report — the user never loses the answer.
      let userReply = outcome.result
      if (outcome.result.length > REPORT_DISTILL_MIN_LENGTH) {
        // The contract says never-throw, but fail-open must not depend on a
        // provider honoring it — a distill throw would otherwise fail a
        // COMPLETED job through the outer catch, losing the user's answer.
        const distilled = await deps.provider
          .summarizeReport({
            workspacePath: claimed.workspacePath,
            taskText: claimed.taskText,
            reportText: outcome.result,
            workspaceName,
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

      // Swap-safe: re-resolve the CURRENT global root at push time (it may have swapped
      // between enqueue and now) — NOT the job's enqueue-time parentSessionId.
      const globalSessionId = findPrimaryConversation(db, {
        userId: claimed.userId,
      })?.currentSdkSessionId
      if (globalSessionId) {
        const pushed = recordPushedReportMessage(db, {
          globalRootSessionId: globalSessionId,
          body: userReply,
          workspaceName,
          ...(managerName !== undefined ? { managerName } : {}),
          ...(partialSessionId !== undefined ? { partialSessionId } : {}),
        })
        if (!pushed) {
          deps.logger.warn(
            { jobId: claimed.id },
            'delegation report push skipped — global-root session row missing',
          )
        }
      } else {
        deps.logger.warn(
          { jobId: claimed.id },
          'delegation report push skipped — no live global-root session',
        )
      }
      completeDelegationJob(db, claimed.id, outcome.result, new Date())

      // Ch4 (channel-aware OUTPUT): if a CHANNEL drove this delegation, also deliver the reply
      // back to that channel — closing the loop (channel → root → delegate → report → channel).
      // Best-effort: the job already completed + the transcript push ran, so a delivery failure
      // (channel gone/disabled, or an insert error) is logged, never re-fails the job.
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
        'delegation: completed — reply pushed to the global root',
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
      // it as the user's action, not a provider failure.
      const reason = cancelHandle?.isCancelRequested()
        ? 'stopped by the user'
        : outcome.message
      failDelegationJob(db, claimed.id, reason, new Date())
      deps.logger.warn({ jobId: claimed.id, message: reason }, 'delegation job failed')
    }
    return true
  } catch (err) {
    // An unexpected throw (e.g. a DB error in the push or the complete) must never leave
    // the job stuck `claimed` (Ch1 does not auto-reclaim) — nor a parked approval hanging.
    await approvalHandler?.abandonParked()
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'delegation job run threw unexpectedly')
    return true
  } finally {
    cancelHandle?.end()
    activityHandle.end()
  }
}
