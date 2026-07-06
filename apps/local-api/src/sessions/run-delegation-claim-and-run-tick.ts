// `runDelegationClaimAndRunTick` — claims ONE pending delegation job and runs it to a
// terminal state (brain-tree Chapter 1, async core). The CONSUMER half of the durable
// queue: the in-process `delegation-service` calls this on a poll; it claims atomically,
// runs the workspace-root turn, pushes the report UP to the global root, and marks the
// job done/failed. Mirrors the core precedent `runScheduleClaimAndFireTick`, but lives in
// apps/local-api because it reuses the api-resident `delegateToWorkspaceRoot`.
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
import { findPrimaryConversation } from '@vynel/session/continuity'
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

// Generous — the bound is on WAITING, not the turn (which keeps running in its own SDK
// session). 120s was sized for an HTTP request waiting on a result; a background job
// nobody waits on gets a longer leash, so a timeout means genuinely-stuck work.
const DELEGATION_RUN_BUDGET_MS = 600_000

export interface RunDelegationTickDeps {
  provider: AiAgentProvider
  logger: Logger
  /** The in-process turn-event pub/sub — the routed turn publishes to its trace
   *  channel so the SSE observe route streams it live. Omit → no observers. */
  turnEvents?: TurnEventBroadcaster
  /** Wait budget for one job's turn (ms). Defaults to DELEGATION_RUN_BUDGET_MS. */
  budgetMs?: number
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
  const claimed = claimNextPendingDelegationJob(db, new Date())
  if (claimed === null) return false

  // The request's correlation key (brain-tree Chapter 2) — threaded into BOTH taggers
  // (the workspace-side task + reply via the delegate closure, the pushed report below)
  // so the whole chain shares it. `null` row value → `undefined` for the conditional
  // spreads (exactOptionalPropertyTypes: absent, not present-with-undefined).
  const partialSessionId = claimed.partialSessionId ?? undefined
  const turnEvents = deps.turnEvents

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

    if (outcome.status === 'completed') {
      // Swap-safe: re-resolve the CURRENT global root at push time (it may have swapped
      // between enqueue and now) — NOT the job's enqueue-time parentSessionId.
      const globalSessionId = findPrimaryConversation(db, {
        userId: claimed.userId,
      })?.currentSdkSessionId
      if (globalSessionId) {
        const pushed = recordPushedReportMessage(db, {
          globalRootSessionId: globalSessionId,
          body: outcome.result,
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

      // Ch4 (channel-aware OUTPUT): if a CHANNEL drove this delegation, also deliver the report
      // back to that channel — closing the loop (channel → root → delegate → report → channel).
      // Best-effort: the job already completed + the transcript push ran, so a delivery failure
      // (channel gone/disabled, or an insert error) is logged, never re-fails the job. Resolved
      // FRESH here (not the claim-time resolve) — the channel may have changed mid-run.
      if (claimed.originChannelId !== null) {
        try {
          const reportOrigin = resolveDeliverableOrigin(db, claimed)
          if (reportOrigin !== null) {
            enqueueChannelReply(db, {
              channel: reportOrigin.channel,
              message: {
                externalSenderId: reportOrigin.externalRecipientId,
                externalChatContextId: reportOrigin.externalChatContextId,
              },
              body: outcome.result,
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
        { jobId: claimed.id, resultPreview: outcome.result.slice(0, 120) },
        'delegation: completed — report pushed to the global root',
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
      failDelegationJob(db, claimed.id, outcome.message, new Date())
      deps.logger.warn({ jobId: claimed.id, message: outcome.message }, 'delegation job failed')
    }
    return true
  } catch (err) {
    // An unexpected throw (e.g. a DB error in the push or the complete) must never leave
    // the job stuck `claimed` (Ch1 does not auto-reclaim) — nor a parked approval hanging.
    await approvalHandler?.abandonParked()
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'delegation job run threw unexpectedly')
    return true
  }
}
