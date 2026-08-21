// `runTaskJob` — runs ONE claimed TASK (or targeted NOTE) job to a terminal
// state: the routed turn on the target's continuing conversation — a workspace
// root, a spawned session, or an agent colleague — under the job's settings,
// the hard cap, and the surface-up approval handler. Called by
// `runDelegationClaimAndRunTick` after the claim (pool slot + lease held by
// the caller); split out of the tick at the kind branch (session-hardening
// A6, behaviour-neutral) beside `runAgentRunJob` / `runReportDeliveryJob`.
//
// Session-comms, the lateral kind: a 'note' row rides this path — the target
// resolution and the delegate wiring are identical (a note reaches all three
// target shapes) — under the note steer, with its marker-prefixed body as the
// inbound and none of the work semantics: no task label, no give-up push,
// always surfaced at terminal time. The claim-time reads live in
// `resolve-task-target.ts`, the delegate closure in `build-task-delegate.ts`,
// the completed branch in `settle-completed-task.ts`.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  ApprovalWaitGate,
  failDelegationJob,
  resolveThreadIdOf,
  routeRequest,
  type DelegationJob,
} from '@vynel/orchestration'
import { type ChatTurnEvent } from '@vynel/chat'
import { deriveDelegationTaskLabel } from '@vynel/contracts/chat/delegation-task-label'
import type { AiAgentProvider } from '@vynel/providers'
import type { RoutedTurnMcpAttachment } from './routed-turn-provider-input.js'
import { buildTaskDelegate } from './build-task-delegate.js'
import { settleFailedDelegationAttempt } from './settle-failed-delegation-attempt.js'
import { settleCompletedTask } from './settle-completed-task.js'
import { resolveDeliverableOrigin, resolveTaskTarget } from './resolve-task-target.js'
import { resolveBackgroundTurnSettings } from './resolve-background-turn-settings.js'
import {
  buildRoutedApprovalHandler,
  type RoutedApprovalHandler,
} from './build-routed-approval-handler.js'
import { traceChannelKey, type TurnEventBroadcaster } from './turn-event-broadcaster.js'
import { publishTurnActivityStep } from '../runtime/activity-turn-steps.js'
import type { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import type { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { createDelegatedTurnCancelLever } from './delegated-turn-cancel-lever.js'

/** The delegated-turn MCP composition (the api edge binds it per target: a
 *  WORKSPACE-ROOT turn gets the interactive descriptor — session-routing trio
 *  included, Chad's 2026-07-21 re-decision of the ④b pin — while a
 *  SPAWNED-SESSION target keeps the plain set; the schedules `FireScheduleDeps`
 *  precedent, core never imports @vynel/mcp). */
export type RoutedTurnMcpComposer = (input: {
  db: Database
  userId: string
  workspaceId: string | null
  target: 'workspace-root' | 'spawned-session' | 'agent-session'
  threadId?: string
  jobId?: string
  /** The spawned primary a 'spawned-session' target resumes — the api edge
   *  stamps the caller-identity header from it so `report_to_requester`
   *  resolves the SESSION (not just its grounding workspace) and can never
   *  mis-address (session-comms fork 2). Absent for workspace-root targets. */
  targetPrimarySessionId?: string
  /** The ORIGINATING chat's workspace (chat-mentions) — the api edge stamps
   *  the requester-override header from it so this turn's
   *  `report_to_requester` lands in the chat that asked, not the global
   *  root. Absent = the pre-mentions topology. */
  requesterWorkspaceId?: string
  /** The mode this turn runs under (resolved `job ?? target row ?? DEFAULT`).
   *  The desktop feature maps it to how an approved plan acquires authority —
   *  auto/bypass authorize the plan's apps FOR THE TURN, so a card-free
   *  desktop task doesn't have to mint permanent grants instead. */
  permissionMode?: string
}) => RoutedTurnMcpAttachment

export interface RunTaskJobDeps {
  provider: AiAgentProvider
  logger: Logger
  activityFeed: SessionActivityFeed
  turnEvents?: TurnEventBroadcaster
  cancelRegistry?: DelegationCancelRegistry
  /** The hard cap on the turn (ms) — resolved by the caller (the tick owns
   *  the default). */
  hardCapMs: number
  pressureThreshold?: number
  composeWorkspaceMcpServers?: RoutedTurnMcpComposer
}

/** Run one claimed task/note job to a terminal state. Always returns true (a
 *  job was processed); failures land on the row, never propagate. */
export async function runTaskJob(
  db: Database,
  deps: RunTaskJobDeps,
  claimed: DelegationJob,
  run: {
    /** A 'note' row (the lateral kind) — the same rails, the absorb voice. */
    isNote: boolean
    /** The pool's exclusion key for this run (routeRequest's threaded id). */
    targetKey: string
  },
): Promise<boolean> {
  const { isNote, targetKey } = run
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
  // The hard cap's lever (A1): interrupts the SDK session this run learns —
  // the same provider interrupt the Stop route uses, minus the "stopped by
  // the user" flag, so the terminal branch can tell a cap from a Stop.
  const cancelLever = createDelegatedTurnCancelLever({
    provider: deps.provider,
    logger: deps.logger,
    jobId: claimed.id,
  })

  // Lifecycle visibility (Ch3.5 diagnostics): a delegation runs a full provider turn that
  // can take a while — and may PARK on a human approval (surface-up); log the claim + the
  // terminal outcome so a slow/parked job is visible in the server console.
  deps.logger.info(
    {
      jobId: claimed.id,
      kind: claimed.jobKind ?? 'task',
      // A note row's `workspaceName` carries the SENDER's label (the delivery
      // reading), so its target reads off the target columns instead.
      target: isNote
        ? (claimed.targetPrimarySessionId ?? claimed.workspaceId)
        : (claimed.workspaceName ?? claimed.targetPrimarySessionId),
      task: claimed.taskText.slice(0, 100),
    },
    isNote
      ? 'note: claimed — delivering the note turn on the target'
      : 'delegation: claimed — running the delegated turn',
  )

  // Hoisted so the failure paths (failed envelope + the outer catch) can abandon any
  // still-parked approval — fail-closed, never a hanging SDK agent.
  let approvalHandler: RoutedApprovalHandler | null = null

  // The chain this turn belongs to — hoisted for the feed enrichment below
  // AND the MCP composition inside try (one resolve, pure on the row).
  const claimedThreadId = resolveThreadIdOf(claimed)
  // Announce on the liveness feed so every open UI sees the target go busy
  // (presence dot, thread poll, banner). Immediately before try/finally —
  // anything throwable in between would leak a process-lifetime zombie turn.
  // A SESSION target is global-grounded: scopeKind 'global', no workspaceId
  // (the Sessions panel's working dot keys on the resolved session id).
  // Enrichment (persona-sessions): everything pure/enqueue-time — labels
  // resolved from the row, never a DB read that could throw pre-try.
  const activityHandle = deps.activityFeed.begin({
    userId: claimed.userId,
    ...(claimed.targetPrimarySessionId !== null || claimed.workspaceId === null
      ? { scopeKind: 'global' as const }
      : { scopeKind: 'workspace' as const, workspaceId: claimed.workspaceId }),
    origin: 'delegation',
    jobId: claimed.id,
    ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
    ...(partialSessionId !== undefined ? { partialSessionId } : {}),
    ...(claimed.targetPrimarySessionId !== null
      ? { primarySessionId: claimed.targetPrimarySessionId }
      : {}),
    // A note body is not a task (the delivery precedent) — no taskLabel; the
    // persona line carries the SENDER's label, which is what `workspaceName`
    // holds on a note row.
    ...(isNote ? {} : { taskLabel: deriveDelegationTaskLabel(claimed.taskText) }),
    ...(claimed.workspaceName !== null ? { personaName: claimed.workspaceName } : {}),
  })
  try {
    // The run cwd — one column, one reading ("where this job's turn runs"): the
    // workspace folder for a workspace target, the spawned session's cwd for a
    // session target. Both enqueue ops always write it; null = a corrupt row.
    const runCwdPath = claimed.workspacePath
    if (runCwdPath === null) {
      throw new Error('delegation job has no run cwd (workspacePath is null — corrupt row)')
    }

    const resolvedTarget = await resolveTaskTarget(db, claimed)
    if (!resolvedTarget.ok) {
      // A gone agent / corrupt colleague row is a FAILED ATTEMPT, not
      // bookkeeping — it settles through the give-up push so the requester
      // hears about it (the agent-run resolution-phase rule).
      activityHandle.end('failed')
      settleFailedDelegationAttempt(db, claimed, resolvedTarget.errorMessage, {
        logger: deps.logger,
        queueLabel: 'delegation',
        retryHint: 're-send the task with send_message if it should be retried.',
      })
      return true
    }
    const { targetName, spawnedTargetWorkspaceId, targetHeadSdkSessionId, colleagueAgent } =
      resolvedTarget.target

    // The turn's settings — `job ?? target row ?? DEFAULT` (A5, decisions
    // D3/D4): the job's stamped picks (the creator's resolved mode, a tool-arg
    // model/effort) win; else what the target conversation's user chose for
    // it; else `auto`. A colleague's own configured model backs a job that
    // named none. The model is fit-checked against the head segment. Resolved
    // ONCE here so the MCP composition and the runner never disagree about
    // the mode this turn runs under.
    const turnSettings = resolveBackgroundTurnSettings(db, {
      headSdkSessionId: targetHeadSdkSessionId,
      job: claimed,
      fallbackModel: colleagueAgent?.model ?? null,
      ...(deps.pressureThreshold !== undefined ? { threshold: deps.pressureThreshold } : {}),
      logger: deps.logger,
      jobId: claimed.id,
    })

    // Surface-up: one gate + handler per job. The shared pipeline RECORDS each carded
    // tool's approval (web notifier always) and parks; the handler pushes the card to
    // the origin channel and suspends the cap clock until the decision (decision C).
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
    const mcpAttachment =
      deps.composeWorkspaceMcpServers !== undefined &&
      (mcpGroundingWorkspaceId !== null || claimed.targetPrimarySessionId !== null)
        ? deps.composeWorkspaceMcpServers({
            db,
            userId: claimed.userId,
            ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
            jobId: claimed.id,
            workspaceId: mcpGroundingWorkspaceId,
            target:
              claimed.targetPrimarySessionId !== null
                ? colleagueAgent !== null
                  ? 'agent-session'
                  : 'spawned-session'
                : 'workspace-root',
            // The caller identity for `report_to_requester` (session-comms): a
            // spawned target's tool calls must resolve as the SESSION, not its
            // grounding workspace.
            ...(claimed.targetPrimarySessionId !== null
              ? { targetPrimarySessionId: claimed.targetPrimarySessionId }
              : {}),
            // The originating chat's workspace (chat-mentions) — reports from
            // this turn land there instead of the global root. NEVER stamped on
            // a note turn: there, the column holds the lateral SENDER's
            // workspace, and no upward send is legitimate mid-note — a stamp's
            // only possible effect would be rerouting a steer-disobeying
            // report to a workspace that never asked (review catch,
            // 2026-08-17). Unstamped, a stray upward send falls back to the
            // receiver's own grounding — its real parent.
            ...(claimed.requesterWorkspaceId !== null && !isNote
              ? { requesterWorkspaceId: claimed.requesterWorkspaceId }
              : {}),
            // The turn's mode — the SAME value the runner passes to the
            // provider below, so the desktop plan envelope and the approval
            // floor can never disagree about what this turn may do.
            permissionMode: turnSettings.permissionMode,
          })
        : undefined

    // The delegate closure — the target branch over the shared runner options
    // (see `buildTaskDelegate`). Live observing does TWO things, and the
    // activity half is UNCONDITIONAL — it must not depend on anyone watching:
    // 1. Turn steps onto the activity feed. A spawned session can now drive
    //    the DESKTOP (`DESKTOP_CAPABLE_DELEGATED_TARGETS`), and the attention
    //    overlay folds `mcp__desktop__*` steps off this feed. Without this the
    //    job announces "busy" and then moves the user's mouse behind a DARK
    //    overlay — the same class of hole the subagent mapping closed
    //    (`activity-turn-steps.ts`): who inside a turn drives the machine is
    //    irrelevant to whether the user gets to see it. It also closes the
    //    recorded "delegated turns publish NO narration steps" gap.
    // 2. Trace-channel publishing — only when someone attached.
    // The stop bridge learns the RUNNING session id so a user Stop can
    // interrupt exactly this turn; the cap lever + the liveness feed learn it
    // too (the UI keys its thread poll on the session).
    const delegate = buildTaskDelegate(db, deps.provider, {
      claimed,
      target: resolvedTarget.target,
      isNote,
      runCwdPath,
      ...(deps.pressureThreshold !== undefined ? { pressureThreshold: deps.pressureThreshold } : {}),
      settings: turnSettings,
      mcpAttachment,
      approvalHandler: handler,
      partialSessionId,
      threadId: claimedThreadId,
      turnEvents,
      observer: {
        onTurnEvent: (event: ChatTurnEvent) => {
          publishTurnActivityStep(activityHandle, event)
          if (turnEvents !== undefined && partialSessionId !== undefined) {
            turnEvents.publish(traceChannelKey(partialSessionId), event)
          }
        },
        onTurnEnded: () => {
          if (turnEvents !== undefined && partialSessionId !== undefined) {
            turnEvents.end(traceChannelKey(partialSessionId))
          }
        },
      },
      onSessionResolved: (sdkSessionId: string) => {
        cancelHandle?.sessionResolved(sdkSessionId)
        cancelLever.sessionResolved(sdkSessionId)
        activityHandle.sessionResolved(sdkSessionId)
      },
      logger: deps.logger,
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
        hardCapMs: deps.hardCapMs,
      },
      { delegate, logger: deps.logger, waitGate, onHardCap: cancelLever.interrupt },
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
      settleCompletedTask(db, deps, claimed, { result: outcome.result, isNote })
    } else if (outcome.status === 'capped') {
      // The turn ran past the hard cap, was interrupted, and has SETTLED — the
      // run is over (the lock is only released when this returns). Stop still
      // wins if the user pressed it meanwhile; otherwise the cap is an honest
      // terminal failure: settle records it, pushes the failure delivery for a
      // WORK row (or nothing for a note), and never requeues — a second hour
      // on the same lock is not a retry anyone asked for. A turn that already
      // spoke its report settles quietly there too.
      await approvalHandler.abandonParked()
      if (cancelHandle?.isCancelRequested()) {
        failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
        deps.logger.warn({ jobId: claimed.id }, 'delegation job stopped by the user (past its cap)')
      } else {
        activityHandle.end('failed')
        settleFailedDelegationAttempt(db, claimed, outcome.message, {
          logger: deps.logger,
          queueLabel: 'delegation',
          retryHint: 're-send the task with send_message if it should be retried.',
          neverRequeue: true,
        })
      }
    } else {
      // The turn threw mid-run — deny anything still parked so the SDK agent isn't
      // left hanging on an unanswerable Promise (best-effort; reaper-backed).
      await approvalHandler.abandonParked()
      // A user Stop lands here (the interrupted turn throws by design) — record
      // it as the user's action, not a provider failure. Never retried.
      if (cancelHandle?.isCancelRequested()) {
        // A user Stop is a clean end — stopping work is not a problem light.
        failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
        deps.logger.warn({ jobId: claimed.id }, 'delegation job stopped by the user')
      } else {
        activityHandle.end('failed')
        settleFailedDelegationAttempt(db, claimed, outcome.message, {
          logger: deps.logger,
          queueLabel: 'delegation',
          retryHint: 're-send the task with send_message if it should be retried.',
        })
      }
    }
    return true
  } catch (err) {
    // An unexpected throw (e.g. a DB error in the push or the complete) must never leave
    // the job stuck `claimed` (Ch1 does not auto-reclaim) — nor a parked approval hanging.
    // Terminal, never retried: a throw from THIS body is our own bookkeeping (a corrupt
    // row would loop forever on requeue), not a transient provider failure.
    activityHandle.end('failed')
    await approvalHandler?.abandonParked()
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'delegation job run threw unexpectedly')
    return true
  } finally {
    cancelHandle?.end()
    activityHandle.end()
  }
}
