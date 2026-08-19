// `runReportDeliveryJob` — runs ONE claimed DELIVERY job (kind
// 'report-delivery' OR 'update-delivery' — persona-sessions) to a terminal
// state. The notify half of the queue: a child's message becomes a REAL TURN
// on the REQUESTER's conversation — the attributed inbound ("from" the child)
// under the KIND's marker + steer: a report is the FINAL result (absorb, act
// if needed, report up / answer the user — never re-run the work); an update
// is interim status (absorb quietly, the task is NOT done, never cascade
// routine status). Called by `runDelegationClaimAndRunTick` after the claim
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
//     of burning their cap queued on the root-turn lock.
//
// BOUNDS (session-hardening A1/A3): the notify turn runs under the same hard
// cap every delegated turn gets — suspended while one of ITS approvals is
// parked (both branches mark the wait gate now: the workspace branch through
// the routed handler, the global branch through the injected runner's
// approval events). A CAPPED delivery is RECOVERABLE — it requeues with
// backoff while attempts remain, then fails: the message body is the only
// copy, so a run that could not finish in time goes round again instead of
// dropping out of every recovery net.
//
// ANTI-CASCADE INVARIANT: a completed report-delivery job NEVER enqueues a
// further delivery — the parent's own "report up" happens via the
// `report_to_requester` tool INSIDE the notify turn (upward-only + the tree
// topology bound the chain; it terminates at the global root).

import { withTransaction, type Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  ApprovalWaitGate,
  completeDelegationJob,
  failDelegationJob,
  isSystemReporterSessionId,
  listDelegationJobsByThread,
  requeueDelegationJob,
  resolveThreadIdOf,
  routeRequest,
  type DelegationJob,
} from '@vynel/orchestration'
import { recordDirectReplyMessage, type ChatTurnEvent } from '@vynel/chat'
import {
  dropPendingCheckpoint,
  findPrimaryConversation,
  peekPendingCheckpoint,
} from '../continuity/index.js'
import { isRootTurnLockBusy, rootTurnLockKey } from '../runtime/root-turn-lock.js'
import { findWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import {
  composeDirectMessageMarker,
  composeReportMessageMarker,
  composeSystemMessageMarker,
  composeUpdateMessageMarker,
} from '@vynel/contracts/chat/report-message-marker'
import { delegateToWorkspaceRoot } from './delegate-to-workspace-root.js'
import { requeueForAnotherAttempt, requeueIfRecoverable } from './classify-turn-failure.js'
import { createDelegatedTurnCancelLever } from './delegated-turn-cancel-lever.js'
import { resolveBackgroundTurnSettings } from './resolve-background-turn-settings.js'
import {
  DIRECT_DELIVERY_INSTRUCTIONS,
  REPORT_DELIVERY_INSTRUCTIONS,
  SYSTEM_DELIVERY_INSTRUCTIONS,
  UPDATE_DELIVERY_INSTRUCTIONS,
  NOTE_DELIVERY_INSTRUCTIONS,
} from './routed-turn-provider-input.js'
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
/** How soon a global delivery that yielded to a busy root lock becomes claimable
 *  again — long enough not to spin the poll, short enough that a report lands
 *  moments after the interactive turn ends. */
const GLOBAL_ROOT_BUSY_YIELD_MS = 5_000

export type RunGlobalRootReportTurn = (input: {
  userId: string
  /** The child's report — the notify turn's inbound message. */
  reportBody: string
  /** The child's composed display label — the inbound row's sourceLabel. */
  sourceLabel: string
  /** The inbound row's attribution kind — 'system' for a machine notification
   *  (a synthetic task:/schedule:/monitor: reporter); omitted = the shipped
   *  'workspace-manager' delivered-report shape. */
  sourceKind?: 'workspace-manager' | 'system'
  /** The delivery job's own trace key — stamped on the notify turn's rows. */
  partialSessionId?: string
  /** The delegation CHAIN key — stamped beside the trace key (persona-sessions). */
  threadId?: string
  /** The delivery variant's steer — the UPDATE steer for an interim ack/progress
   *  delivery. Omitted = the report steer (the shipped default). */
  steerInstructions?: string
  /** The delivery queue row — the notify turn's liveness enrichment. */
  jobId?: string
  /** The stable inbound-row id for this delivery (its job id): a retried notify
   *  turn re-uses the report row it already landed (A3c). */
  inboundMessageId?: string
  /** The delivery's cap clock (A3): the runner marks it parked/resolved from
   *  the turn's own approval events, so a card the human takes 12 minutes to
   *  answer never counts against the cap — the workspace branch's parity. */
  waitGate?: Pick<ApprovalWaitGate, 'markParked' | 'markResolved'>
  /** The RUNNING SDK session id, as the turn learns it (and re-learns it on a
   *  mid-turn swap) — the hard cap's interrupt lever + the Stop bridge read it. */
  onSessionResolved?: (sdkSessionId: string) => void
}) => Promise<{ sessionId: string; resultText: string }>

export interface RunReportDeliveryDeps {
  provider: AiAgentProvider
  logger: Logger
  activityFeed: SessionActivityFeed
  turnEvents?: TurnEventBroadcaster
  cancelRegistry?: DelegationCancelRegistry
  /** The hard cap on the notify turn (ms) — resolved by the caller (the tick
   *  owns the default). */
  hardCapMs: number
  composeWorkspaceMcpServers?: (input: {
    db: Database
    userId: string
    workspaceId: string
    target: 'workspace-root' | 'spawned-session' | 'agent-session'
    threadId?: string
    jobId?: string
    targetPrimarySessionId?: string
    permissionMode?: string
  }) => RoutedTurnMcpAttachment
  runGlobalRootReportTurn?: RunGlobalRootReportTurn
  /** The pressure threshold the model fit check honors (the env smoke knob). */
  pressureThreshold?: number
}

/** Run one claimed report-delivery job to a terminal state. Always returns true
 *  (a job was processed); failures land on the row, never propagate. */
export async function runReportDeliveryJob(
  db: Database,
  deps: RunReportDeliveryDeps,
  claimed: DelegationJob,
): Promise<boolean> {
  const partialSessionId = claimed.partialSessionId ?? undefined
  const claimedThreadId = resolveThreadIdOf(claimed)
  // The delivery VARIANT (persona-sessions): an update-delivery row is the
  // interim sibling — same notify machinery, the update marker + steer, and
  // the requester must NOT treat the task as finished. A direct-delivery row
  // (kind `direct_to_user`) is a final answer addressed to the USER — it
  // skips the notify turn entirely below; its marker + steer matter on the
  // fallback path only.
  const isUpdate = claimed.jobKind === 'update-delivery'
  const isDirect = claimed.jobKind === 'direct-delivery'
  // A 'note' row reaches this runner ONLY in the both-null GLOBAL shape
  // (voice-session arc — the claim tick keeps targeted notes on the task
  // rail): plain communication the global conversation absorbs, never work.
  const isNote = claimed.jobKind === 'note'
  // A mention chain's reply is direct-natured whatever kind it spoke (the
  // floor) — computed up here so the notify FALLBACK also runs under the
  // direct steer, never narrating a reply the user was addressed with.
  const isMentionChainReply =
    claimedThreadId !== null &&
    listDelegationJobsByThread(db, {
      userId: claimed.userId,
      threadId: claimedThreadId,
      unbounded: true,
    }).some((job) => job.jobKind === 'agent-run')
  const queueLabel = claimed.jobKind ?? 'report-delivery'
  // A SYSTEM producer (the synthetic task:/schedule:/monitor: reporter — the
  // load-bearing prefix convention): its delivery is a machine notification,
  // not a delegated result — it swaps the marker, the steer, AND the row's
  // sourceKind so the UI renders a quiet system notice instead of a
  // participant message (Kafi's 2026-08-18 smoke).
  const isSystemNotification =
    !isUpdate && !isDirect && !isNote && isSystemReporterSessionId(claimed.parentSessionId ?? '')
  const steerInstructions = isNote
    ? NOTE_DELIVERY_INSTRUCTIONS
    : isUpdate
    ? UPDATE_DELIVERY_INSTRUCTIONS
    : isDirect || isMentionChainReply
      ? DIRECT_DELIVERY_INSTRUCTIONS
      : isSystemNotification
        ? SYSTEM_DELIVERY_INSTRUCTIONS
        : REPORT_DELIVERY_INSTRUCTIONS
  // The CHILD's label, resolved at enqueue by the same one-home helpers the
  // push used ('Session' only on a corrupt row — the enqueue op always writes it).
  const sourceLabel = claimed.workspaceName ?? 'Session'
  // The report becomes a USER-role inbound, and the system steer alone does
  // not hold attribution (the 2026-07-27 smoke: the workspace reasoned "the
  // user is reporting back…" and answered the user instead of relaying up).
  // The marker rides ON the message so the model always sees who sent it; the
  // report card strips it for display (and reads its badge off it).
  const reportBody = isNote
    ? claimed.taskText
    : `${
    isUpdate
      ? composeUpdateMessageMarker(sourceLabel)
      : isDirect
        ? composeDirectMessageMarker(sourceLabel)
        : isSystemNotification
          ? composeSystemMessageMarker(sourceLabel)
          : composeReportMessageMarker(sourceLabel)
  }\n\n${claimed.taskText}`
  const inboundSourceKind = isSystemNotification ? ('system' as const) : ('workspace-manager' as const)
  // Captured once for narrowing: null = the GLOBAL root is the requester.
  const requesterWorkspaceId = claimed.workspaceId
  const isGlobalRequester = requesterWorkspaceId === null

  // DIRECT-REPLY mode (live-tracking redesign): the message IS for the user,
  // so it persists straight onto the root's transcript (the box is the
  // answer: no notify turn, no re-narration, no root-lock wait). Two doors:
  // a 'direct-delivery' row — the sender chose kind `direct_to_user` — and
  // any delivery whose chain's WORK job is an agent-run (a colleague
  // answering the user's @MENTION delivers direct whatever kind it spoke).
  // The root absorbs it silently on its next turn via the catch-up net (the
  // chain's work row stays unsurfaced until then, presented "already shown —
  // do not restate"). The momentary feed announce below carries no narration —
  // it exists so every open window's turn-ended invalidation lands the new
  // row live.
  if (isGlobalRequester && !isNote && (isDirect || isMentionChainReply)) {
    const root = findPrimaryConversation(db, { userId: claimed.userId })
    let persisted = false
    if (root?.currentSdkSessionId != null) {
      // Persist + complete CO-COMMIT: both are plain DB writes, and a crash
      // between them would requeue the delivery and land the row twice
      // (the Gate-3 catch — the notify path tolerates at-least-once because
      // a provider turn sits in the middle; here nothing does).
      withTransaction(db, (tx) => {
        persisted = recordDirectReplyMessage(tx, {
          globalRootSessionId: root.currentSdkSessionId!,
          body: reportBody,
          sourceLabel,
          ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
          ...(partialSessionId !== undefined ? { partialSessionId } : {}),
        })
        if (persisted) completeDelegationJob(tx, claimed.id, 'delivered directly', new Date())
      })
    }
    if (persisted) {
      deps.activityFeed
        .begin({
          userId: claimed.userId,
          scopeKind: 'global',
          origin: 'delegation',
          jobId: claimed.id,
          ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
          ...(partialSessionId !== undefined ? { partialSessionId } : {}),
          personaName: sourceLabel,
        })
        .end()
      deps.logger.info(
        { jobId: claimed.id, from: sourceLabel, kind: queueLabel },
        `${queueLabel}: delivered DIRECTLY to the user (no notify turn)`,
      )
      return true
    }
    // No root session row to land on — fall through to the notify machinery,
    // which handles the no-session shapes honestly.
  }

  // A GLOBAL notify turn runs under the user's root-turn lock. While an
  // interactive global turn holds it, starting now would only park inside the
  // core and burn one of the few pool slots for as long as that turn lasts (up
  // to the cap — the audit's "a delivery burns its slot queued on the root
  // lock"). Yield instead: back to pending, due again in a moment, no attempt
  // spent — the slot goes to a job that can actually run right now.
  if (isGlobalRequester && isRootTurnLockBusy(rootTurnLockKey(claimed.userId, false))) {
    requeueDelegationJob(db, claimed.id, {
      errorMessage: claimed.errorMessage ?? 'waiting for the global root — yielded the slot',
      errorCode: claimed.errorCode ?? null,
      attemptCount: claimed.attemptCount ?? 0,
      nextAttemptAt: new Date(Date.now() + GLOBAL_ROOT_BUSY_YIELD_MS),
    })
    deps.logger.debug(
      { jobId: claimed.id, kind: queueLabel },
      `${queueLabel}: the global root is mid-turn — yielded the pool slot, due again shortly`,
    )
    return true
  }

  const cancelHandle =
    deps.cancelRegistry !== undefined && partialSessionId !== undefined
      ? deps.cancelRegistry.begin(partialSessionId)
      : null
  // The hard cap's lever (session-hardening A1) — the tick's shape.
  const cancelLever = createDelegatedTurnCancelLever({
    provider: deps.provider,
    logger: deps.logger,
    jobId: claimed.id,
  })

  deps.logger.info(
    {
      jobId: claimed.id,
      requester: isGlobalRequester ? 'global-root' : claimed.workspaceId,
      from: sourceLabel,
    },
    `${queueLabel}: claimed — running the notify turn on the requester`,
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
          jobId: claimed.id,
          ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
          ...(partialSessionId !== undefined ? { partialSessionId } : {}),
          // The notify turn SPEAKS AS the child whose message it delivers; a
          // delivery body is not a task, so no taskLabel (the labels rule).
          personaName: sourceLabel,
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
      // routeRequest gives the same never-reject + hard-cap semantics task jobs
      // get; the delegate closure ignores the threaded target fields (the
      // session-target precedent). Approvals inside the global turn park on
      // the core's own canUseTool path (web notifier) — the runner reports
      // their park/resolve edges onto this waitGate so the cap suspends.
      outcome = await routeRequest(
        {
          userId: claimed.userId,
          parentSessionId: claimed.parentSessionId,
          targetWorkspaceId: claimed.id,
          targetWorkspacePath: claimed.workspacePath ?? '',
          taskText: reportBody,
          hardCapMs: deps.hardCapMs,
        },
        {
          delegate: async () => {
            const turn = await runGlobalRootReportTurn({
              userId: claimed.userId,
              reportBody,
              sourceLabel,
              sourceKind: inboundSourceKind,
              ...(partialSessionId !== undefined ? { partialSessionId } : {}),
              ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
              steerInstructions,
              jobId: claimed.id,
              inboundMessageId: claimed.id,
              waitGate,
              onSessionResolved: (sdkSessionId) => {
                cancelHandle?.sessionResolved(sdkSessionId)
                cancelLever.sessionResolved(sdkSessionId)
              },
            })
            return { reference: turn.sessionId, resultText: turn.resultText }
          },
          logger: deps.logger,
          waitGate,
          onHardCap: cancelLever.interrupt,
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
      // The notify turn runs under the REQUESTER conversation's own settings
      // (`job ?? requester row ?? DEFAULT`, A5) — a delivery row carries no
      // picks of its own, so this is what the user chose for that workspace;
      // a note carries its sender's mode. No more hardcoded unattended mode.
      const turnSettings = resolveBackgroundTurnSettings(db, {
        headSdkSessionId:
          findPrimaryConversation(db, { userId: claimed.userId, workspaceId: requesterWorkspaceId })
            ?.currentSdkSessionId ?? null,
        job: claimed,
        ...(deps.pressureThreshold !== undefined ? { threshold: deps.pressureThreshold } : {}),
        logger: deps.logger,
        jobId: claimed.id,
      })

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
              permissionMode: turnSettings.permissionMode,
            })
          : undefined

      const turnEvents = deps.turnEvents
      // The notify turn's own start — a checkpoint pending from BEFORE it is
      // the user's restart survivor (durable register), never this turn's stray.
      const notifyTurnStartedAt = new Date()
      outcome = await routeRequest(
        {
          userId: claimed.userId,
          parentSessionId: claimed.parentSessionId,
          targetWorkspaceId: requesterWorkspaceId,
          targetWorkspacePath: runCwdPath,
          taskText: reportBody,
          hardCapMs: deps.hardCapMs,
        },
        {
          delegate: (delegationInput) =>
            delegateToWorkspaceRoot(db, deps.provider, {
              ...delegationInput,
              workspaceName,
              ...(managerName !== undefined ? { managerName } : {}),
              providerId: DEFAULT_PROVIDER_ID,
              ...(partialSessionId !== undefined ? { partialSessionId } : {}),
              ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
              ...(mcpAttachment !== undefined ? { mcpAttachment } : {}),
              permissionMode: turnSettings.permissionMode,
              ...(turnSettings.model !== undefined ? { model: turnSettings.model } : {}),
              ...(turnSettings.thinkingEffort !== undefined
                ? { thinkingEffort: turnSettings.thinkingEffort }
                : {}),
              autoBuildout: turnSettings.autoBuildout,
              approvalHandler: handler,
              // The notify variant: inbound row attributed FROM the child +
              // the kind's steer (report absorbs a RESULT; update absorbs
              // interim status without treating the task as done; a system
              // notification wears 'system' — the quiet UI row).
              inboundAttribution: { sourceKind: inboundSourceKind, sourceLabel },
              // The job id is the inbound row's id: a recoverable failure +
              // requeue re-uses the report row instead of appending it (A3c).
              inboundMessageId: claimed.id,
              steerInstructions,
              // A delivery is never work: no context nudge (nothing continues it).
              armContextNudge: false,
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
                cancelLever.sessionResolved(sdkSessionId)
                activityHandle?.sessionResolved(sdkSessionId)
              },
              logger: deps.logger,
            }),
          logger: deps.logger,
          waitGate,
          onHardCap: cancelLever.interrupt,
        },
      )
      // A checkpoint the model left ON THIS notify turn is dropped visibly: a
      // delivery never continues as work (session-continuity §4.6). A
      // checkpoint pending from BEFORE the turn is the user's own restart
      // survivor (the durable register) — it belongs to their next message and
      // is left alone (the interactive loop's rule for autoContinue:false).
      const primary = findPrimaryConversation(db, {
        userId: claimed.userId,
        workspaceId: requesterWorkspaceId,
      })
      const pending = primary !== null ? peekPendingCheckpoint(db, primary.id) : null
      if (primary !== null && pending !== null && pending.checkpointedAt >= notifyTurnStartedAt) {
        dropPendingCheckpoint(db, primary.id, { reason: 'never-continues', logger: deps.logger })
        deps.logger.warn(
          { jobId: claimed.id, primarySessionId: primary.id, nextStep: pending.nextStep },
          `${queueLabel}: checkpoint dropped — a delivery turn never continues as work`,
        )
      }
    }

    if (outcome.status === 'completed' && cancelHandle?.isCancelRequested()) {
      // Stop always wins at terminal time (the task-tick policy, kept coherent).
      await approvalHandler?.abandonParked()
      failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
      deps.logger.info(
        { jobId: claimed.id },
        `${queueLabel}: stopped by the user at terminal time`,
      )
    } else if (outcome.status === 'completed') {
      // Terminal: the notify turn's reply is the row's result. NO further
      // delivery is enqueued here — see the anti-cascade invariant above.
      completeDelegationJob(db, claimed.id, outcome.result, new Date())
      deps.logger.info(
        { jobId: claimed.id, replyPreview: outcome.result.slice(0, 120) },
        `${queueLabel}: completed — the requester absorbed it in its own turn`,
      )
    } else if (outcome.status === 'capped') {
      // The notify turn ran past the hard cap, was interrupted, and has
      // SETTLED. Stop wins; otherwise the delivery is RECOVERABLE (see the
      // header): another attempt while attempts remain, terminal failed at
      // the ceiling — never a first-strike terminal that drops the only copy
      // of the message out of every recovery net.
      await approvalHandler?.abandonParked()
      if (cancelHandle?.isCancelRequested()) {
        failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
        deps.logger.info({ jobId: claimed.id }, `${queueLabel}: stopped by the user (past its cap)`)
      } else {
        activityHandle?.end('failed')
        if (!requeueForAnotherAttempt(db, claimed, outcome.message, deps.logger, queueLabel)) {
          failDelegationJob(db, claimed.id, outcome.message, new Date())
          deps.logger.warn(
            { jobId: claimed.id, message: outcome.message },
            `${queueLabel} job failed — capped on its last attempt`,
          )
        }
      }
    } else {
      await approvalHandler?.abandonParked()
      const reason = cancelHandle?.isCancelRequested() ? 'stopped by the user' : outcome.message
      if (!cancelHandle?.isCancelRequested()) activityHandle?.end('failed')
      // A transient notify-turn failure (provider down, rate limit) requeues —
      // the report body is the ONLY copy of the child's result; before this a
      // failed delivery row was permanently invisible (excluded from both the
      // catch-up net and list_delegated_tasks). A stop never retries.
      if (
        cancelHandle?.isCancelRequested() ||
        !requeueIfRecoverable(db, claimed, reason, deps.logger, queueLabel)
      ) {
        failDelegationJob(db, claimed.id, reason, new Date())
        deps.logger.warn({ jobId: claimed.id, message: reason }, `${queueLabel} job failed`)
      }
    }
    return true
  } catch (err) {
    activityHandle?.end('failed')
    await approvalHandler?.abandonParked()
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, `${queueLabel} job run threw unexpectedly`)
    return true
  } finally {
    cancelHandle?.end()
    activityHandle?.end()
  }
}
