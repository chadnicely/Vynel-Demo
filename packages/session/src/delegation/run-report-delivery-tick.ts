// `runReportDeliveryJob` — runs ONE claimed 'report-delivery' job to a terminal
// state (session-comms, the revert flow). The notify half of the queue: a
// child's finished report becomes a REAL TURN on the REQUESTER's conversation —
// the report is the attributed inbound message ("from" the child), the steer is
// the report-delivery variant (absorb, act if needed, report up / answer the
// user — never re-run the work), and the parent model processes the real data
// in its own flow. Called by `runDelegationClaimAndRunTick` after the claim
// (which already fired `onRunStarted` — pool slot reserved).
//
// TWO requester shapes:
//   - WORKSPACE primary (`workspaceId` set): the same `delegateToWorkspaceRoot`
//     machinery a task job uses — single-writer holds for free (the pool's
//     exclusion key is the workspaceId, shared with task jobs), the interactive
//     MCP set attaches (so `report_to_requester` exists → the upward cascade),
//     approvals card + park like any routed turn.
//   - GLOBAL root (both targets null): the injected `runGlobalRootReportTurn`
//     (the api edge binds `runGlobalRootTurn` — root-turn lock, routing
//     toolset, delegation catch-up, feed announce all included). At most ONE
//     global notify turn runs at a time: the pool key is the SHARED
//     `GLOBAL_ROOT_DELIVERY_TARGET_KEY`, so the rest wait as PENDING instead
//     of burning their budget queued on the root-turn lock (a timed-out
//     delivery would lose its report).
//
// ANTI-CASCADE INVARIANT: a completed report-delivery job NEVER enqueues a
// further delivery — the parent's own "report up" happens via the
// `report_to_requester` tool INSIDE the notify turn (upward-only + the tree
// topology bound the chain; it terminates at the global root).

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  ApprovalWaitGate,
  completeDelegationJob,
  failDelegationJob,
  routeRequest,
  type DelegationJob,
} from '@vynel/orchestration'
import type { ChatTurnEvent } from '@vynel/chat'
import { findWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import { delegateToWorkspaceRoot } from './delegate-to-workspace-root.js'
import { REPORT_DELIVERY_INSTRUCTIONS } from './routed-turn-provider-input.js'
import type { RoutedTurnMcpAttachment } from './routed-turn-provider-input.js'
import {
  buildRoutedApprovalHandler,
  type RoutedApprovalHandler,
} from './build-routed-approval-handler.js'
import { traceChannelKey, type TurnEventBroadcaster } from './turn-event-broadcaster.js'
import type { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import type { SessionActivityFeed } from '../runtime/session-activity-feed.js'

/** The GLOBAL-root notify runner the api edge injects (it owns the env-coupled
 *  target resolve + the routing MCP composition — `runGlobalRootTurn` with the
 *  report attribution + steer). Returns the turn's sdk session id + reply. */
export type RunGlobalRootReportTurn = (input: {
  userId: string
  /** The child's report — the notify turn's inbound message. */
  reportBody: string
  /** The child's composed display label — the inbound row's sourceLabel. */
  sourceLabel: string
  /** The delivery job's own trace key — stamped on the notify turn's rows. */
  partialSessionId?: string
}) => Promise<{ sessionId: string; resultText: string }>

export interface RunReportDeliveryDeps {
  provider: AiAgentProvider
  logger: Logger
  activityFeed: SessionActivityFeed
  turnEvents?: TurnEventBroadcaster
  cancelRegistry?: DelegationCancelRegistry
  /** Resolved by the caller (the tick owns the default). */
  budgetMs: number
  composeWorkspaceMcpServers?: (input: {
    db: Database
    userId: string
    workspaceId: string
    target: 'workspace-root' | 'spawned-session'
    threadId?: string
    jobId?: string
    targetPrimarySessionId?: string
  }) => RoutedTurnMcpAttachment
  runGlobalRootReportTurn?: RunGlobalRootReportTurn
}

/** Run one claimed report-delivery job to a terminal state. Always returns true
 *  (a job was processed); failures land on the row, never propagate. */
export async function runReportDeliveryJob(
  db: Database,
  deps: RunReportDeliveryDeps,
  claimed: DelegationJob,
): Promise<boolean> {
  const partialSessionId = claimed.partialSessionId ?? undefined
  const reportBody = claimed.taskText
  // The CHILD's label, resolved at enqueue by the same one-home helpers the
  // push used ('Session' only on a corrupt row — the enqueue op always writes it).
  const sourceLabel = claimed.workspaceName ?? 'Session'
  // Captured once for narrowing: null = the GLOBAL root is the requester.
  const requesterWorkspaceId = claimed.workspaceId
  const isGlobalRequester = requesterWorkspaceId === null

  const cancelHandle =
    deps.cancelRegistry !== undefined && partialSessionId !== undefined
      ? deps.cancelRegistry.begin(partialSessionId)
      : null

  deps.logger.info(
    {
      jobId: claimed.id,
      requester: isGlobalRequester ? 'global-root' : claimed.workspaceId,
      from: sourceLabel,
    },
    'report-delivery: claimed — running the notify turn on the requester',
  )

  let approvalHandler: RoutedApprovalHandler | null = null

  // Feed announce for the WORKSPACE notify turn only — the injected global
  // runner announces its own turn (the runGlobalRootTurn contract); a second
  // begin here would double the working dot.
  const activityHandle =
    requesterWorkspaceId === null
      ? null
      : deps.activityFeed.begin({
          userId: claimed.userId,
          scopeKind: 'workspace',
          workspaceId: requesterWorkspaceId,
          origin: 'delegation',
        })
  try {
    const waitGate = new ApprovalWaitGate()
    let outcome
    if (requesterWorkspaceId === null) {
      const runGlobalRootReportTurn = deps.runGlobalRootReportTurn
      if (runGlobalRootReportTurn === undefined) {
        throw new Error(
          'report-delivery: no global notify runner wired (runGlobalRootReportTurn) — the api edge must inject it',
        )
      }
      // The routeRequest race gives the same never-reject + budget semantics
      // task jobs get; the delegate closure ignores the threaded target fields
      // (the session-target precedent). Approvals inside the global turn park
      // on the core's own canUseTool path (web notifier), not this waitGate.
      outcome = await routeRequest(
        {
          userId: claimed.userId,
          parentSessionId: claimed.parentSessionId,
          targetWorkspaceId: claimed.id,
          targetWorkspacePath: claimed.workspacePath ?? '',
          taskText: reportBody,
          timeoutMs: deps.budgetMs,
        },
        {
          delegate: async () => {
            const turn = await runGlobalRootReportTurn({
              userId: claimed.userId,
              reportBody,
              sourceLabel,
              ...(partialSessionId !== undefined ? { partialSessionId } : {}),
            })
            return { reference: turn.sessionId, resultText: turn.resultText }
          },
          logger: deps.logger,
          waitGate,
        },
      )
    } else {
      // WORKSPACE requester — resolve the target fresh (name/manager may have
      // changed since enqueue; the job row cascades away if the workspace was
      // deleted, so a claimed row's workspace normally still exists).
      const workspace = findWorkspaceById(db, requesterWorkspaceId)
      const workspaceName = workspace?.name ?? 'Workspace'
      const managerName = workspace ? resolveManagerName(workspace) : undefined
      const runCwdPath = claimed.workspacePath
      if (runCwdPath === null) {
        throw new Error('report-delivery job has no run cwd (workspacePath is null — corrupt row)')
      }

      const handler = buildRoutedApprovalHandler({
        db,
        logger: deps.logger,
        provider: deps.provider,
        workspaceName,
        waitGate,
        // No origin: report-delivery rows never carry channel columns (channel
        // delivery of the task's report happened at task completion).
      })
      approvalHandler = handler

      // The SAME interactive set a task job to this workspace attaches — the
      // primary's toolset must not flip per turn origin, and the set carries
      // `report_to_requester` (the upward cascade).
      const mcpAttachment =
        deps.composeWorkspaceMcpServers !== undefined
          ? deps.composeWorkspaceMcpServers({
              db,
              userId: claimed.userId,
              workspaceId: requesterWorkspaceId,
              target: 'workspace-root',
            })
          : undefined

      const turnEvents = deps.turnEvents
      outcome = await routeRequest(
        {
          userId: claimed.userId,
          parentSessionId: claimed.parentSessionId,
          targetWorkspaceId: requesterWorkspaceId,
          targetWorkspacePath: runCwdPath,
          taskText: reportBody,
          timeoutMs: deps.budgetMs,
        },
        {
          delegate: (delegationInput) =>
            delegateToWorkspaceRoot(db, deps.provider, {
              ...delegationInput,
              workspaceName,
              ...(managerName !== undefined ? { managerName } : {}),
              providerId: DEFAULT_PROVIDER_ID,
              ...(partialSessionId !== undefined ? { partialSessionId } : {}),
              ...(mcpAttachment !== undefined ? { mcpAttachment } : {}),
              approvalHandler: handler,
              // The notify variant: inbound row attributed FROM the child +
              // the report-delivery steer.
              inboundAttribution: { sourceKind: 'workspace-manager', sourceLabel },
              steerInstructions: REPORT_DELIVERY_INSTRUCTIONS,
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
              onSessionResolved: (sdkSessionId: string) => {
                cancelHandle?.sessionResolved(sdkSessionId)
                activityHandle?.sessionResolved(sdkSessionId)
              },
              logger: deps.logger,
            }),
          logger: deps.logger,
          waitGate,
        },
      )
    }

    if (outcome.status === 'completed' && cancelHandle?.isCancelRequested()) {
      // Stop always wins at terminal time (the task-tick policy, kept coherent).
      await approvalHandler?.abandonParked()
      failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
      deps.logger.info(
        { jobId: claimed.id },
        'report-delivery: stopped by the user at terminal time',
      )
    } else if (outcome.status === 'completed') {
      // Terminal: the notify turn's reply is the row's result. NO further
      // delivery is enqueued here — see the anti-cascade invariant above.
      completeDelegationJob(db, claimed.id, outcome.result, new Date())
      deps.logger.info(
        { jobId: claimed.id, replyPreview: outcome.result.slice(0, 120) },
        'report-delivery: completed — the requester absorbed the report in its own turn',
      )
    } else if (outcome.status === 'timed-out') {
      failDelegationJob(db, claimed.id, `timed-out after ${outcome.timeoutMs}ms`, new Date())
      deps.logger.warn(
        { jobId: claimed.id, timeoutMs: outcome.timeoutMs },
        'report-delivery job timed out (the notify turn keeps running in its own session)',
      )
    } else {
      await approvalHandler?.abandonParked()
      const reason = cancelHandle?.isCancelRequested() ? 'stopped by the user' : outcome.message
      failDelegationJob(db, claimed.id, reason, new Date())
      deps.logger.warn({ jobId: claimed.id, message: reason }, 'report-delivery job failed')
    }
    return true
  } catch (err) {
    await approvalHandler?.abandonParked()
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'report-delivery job run threw unexpectedly')
    return true
  } finally {
    cancelHandle?.end()
    activityHandle?.end()
  }
}
