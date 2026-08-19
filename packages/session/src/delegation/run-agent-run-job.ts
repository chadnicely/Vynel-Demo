// `runAgentRunJob` — runs ONE claimed 'agent-run' job to a terminal state
// (persona-sessions): a `@agent` mention resumes that agent's COLLEAGUE
// session (`delegateToAgentSession` — the continuing scope-'agent' primary;
// persona + memory accumulate across mentions). Called by
// `runDelegationClaimAndRunTick` after the claim; the pool slot is reserved on
// the COLLEAGUE primary id (single-writer — two mentions of one colleague run
// FIFO), falling back to the job's own id for a legacy row.
//
// NO HARVEST — the leaf-era deterministic result→report conversion is RETIRED:
// a colleague has `send_message` and a real conversation, so its ack/updates/
// report are its OWN spoken words (the task-branch rule, now universal). The
// completed branch completes UNSURFACED (the direct-reply tweak): the spoken
// reply lands directly on the user's transcript with no notify turn, and the
// catch-up net is how the root learns of it on its next turn.
//
// Approvals: record-and-park (`buildRoutedApprovalHandler`) replaces the
// leaf's fail-closed denial — a colleague turn is a routed turn like any
// other. Settings resolve `job ?? agent.model ?? colleague row ?? DEFAULT`
// (session-hardening A5), the model fit-checked against the colleague's head.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  ApprovalWaitGate,
  completeDelegationJob,
  failDelegationJob,
  resolveThreadIdOf,
  routeRequest,
  type DelegationJob,
} from '@vynel/orchestration'
import type { AgentRow } from '@vynel/db/repositories/agents'
import { findWorkspaceById } from '@vynel/workspaces'
import { deriveDelegationTaskLabel } from '@vynel/contracts/chat/delegation-task-label'
import { resolveColleagueAgent } from './resolve-colleague-agent.js'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import { type ChatTurnEvent } from '@vynel/chat'
import { getOrCreateContinuingSession } from '../continuity/index.js'
import * as primarySessionsRepository from '../repositories/index.js'
import { delegateToAgentSession } from './delegate-to-agent-session.js'
import { settleFailedDelegationAttempt } from './settle-failed-delegation-attempt.js'
import { createDelegatedTurnCancelLever } from './delegated-turn-cancel-lever.js'
import { resolveBackgroundTurnSettings } from './resolve-background-turn-settings.js'
import {
  buildRoutedApprovalHandler,
  type RoutedApprovalHandler,
} from './build-routed-approval-handler.js'
import { traceChannelKey, type TurnEventBroadcaster } from './turn-event-broadcaster.js'
import type { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import type { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import {
  CONTINUATION_TASK_INSTRUCTIONS,
  type RoutedTurnMcpAttachment,
} from './routed-turn-provider-input.js'
import {
  beginDelegatedTurn,
  enqueueCheckpointContinuation,
} from './enqueue-checkpoint-continuation.js'

export interface RunAgentRunJobDeps {
  provider: AiAgentProvider
  logger: Logger
  activityFeed: SessionActivityFeed
  /** The turn-event pub/sub — the colleague turn publishes on its session +
   *  trace channels (Watch everywhere). Omit → no observers. */
  turnEvents?: TurnEventBroadcaster
  cancelRegistry?: DelegationCancelRegistry
  /** The hard cap on the colleague turn (ms) — resolved by the caller (the
   *  tick owns the default); past it the turn is interrupted and the run
   *  settles capped. */
  hardCapMs: number
  /** The delegated-turn MCP composition (the api edge binds it) — target
   *  'agent-session' composes the colleague's toolset + caller identity.
   *  Optional only for MCP-less test harnesses (the tick's contract). */
  composeWorkspaceMcpServers?: (input: {
    db: Database
    userId: string
    workspaceId: string | null
    target: 'workspace-root' | 'spawned-session' | 'agent-session'
    threadId?: string
    jobId?: string
    targetPrimarySessionId?: string
    requesterWorkspaceId?: string
    permissionMode?: string
  }) => RoutedTurnMcpAttachment
  /** The pressure threshold the model fit check honors (the env smoke knob). */
  pressureThreshold?: number
}

/** Run one claimed agent-run job to a terminal state. Always returns true (a
 *  job was processed); failures land on the row, never propagate. */
export async function runAgentRunJob(
  db: Database,
  deps: RunAgentRunJobDeps,
  claimed: DelegationJob,
): Promise<boolean> {
  const partialSessionId = claimed.partialSessionId ?? undefined

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
    { jobId: claimed.id, agentSlug: claimed.agentSlug, workspaceId: claimed.workspaceId },
    'agent-run: claimed — running the mentioned colleague turn',
  )

  // A colleague run announces on the liveness feed under its GROUNDING (the
  // session-target shape when global). Begun immediately before try
  // (zombie-turn doctrine); enrichment is pure/enqueue-time only.
  const feedThreadId = resolveThreadIdOf(claimed)
  const activityHandle = deps.activityFeed.begin({
    userId: claimed.userId,
    ...(claimed.workspaceId === null
      ? { scopeKind: 'global' as const }
      : { scopeKind: 'workspace' as const, workspaceId: claimed.workspaceId }),
    origin: 'delegation',
    jobId: claimed.id,
    ...(feedThreadId !== null ? { threadId: feedThreadId } : {}),
    ...(partialSessionId !== undefined ? { partialSessionId } : {}),
    ...(claimed.targetPrimarySessionId !== null
      ? { primarySessionId: claimed.targetPrimarySessionId }
      : {}),
    taskLabel: deriveDelegationTaskLabel(claimed.taskText),
    ...(claimed.workspaceName !== null ? { personaName: claimed.workspaceName } : {}),
  })
  // Hoisted so the failure paths can abandon any still-parked approval —
  // fail-closed, never a hanging SDK agent (the tick's shape).
  let approvalHandler: RoutedApprovalHandler | null = null
  try {
    // ── Resolution phase — a failure here (deleted agent, corrupt row) is a
    // FAILED ATTEMPT, not bookkeeping: it settles through the give-up push so
    // the requester hears about it (ack-first makes silent death a broken
    // promise). The outer catch below stays the plain-fail last resort.
    let resolved: {
      agentSlug: string
      runCwdPath: string
      agent: AgentRow
      colleague: primarySessionsRepository.PrimarySessionRow
    }
    try {
      const agentSlug = claimed.agentSlug
      if (agentSlug === null) {
        throw new Error('agent-run job has no agentSlug (corrupt row)')
      }
      const runCwdPath = claimed.workspacePath
      if (runCwdPath === null) {
        throw new Error('agent-run job has no run cwd (workspacePath is null — corrupt row)')
      }

      // Resolve the agent FRESH at claim time (workspace-then-user, the one
      // home). A deleted agent fails the attempt honestly.
      const agent = await resolveColleagueAgent(db, {
        userId: claimed.userId,
        workspaceId: claimed.workspaceId,
        slug: agentSlug,
      })
      if (agent === null) {
        throw new Error(`agent-run: no agent "${agentSlug}" resolves for this scope any more`)
      }

      // Resolve the COLLEAGUE primary: the enqueue-time stamp, verified; a
      // legacy/failed stamp falls back to get-or-create (idempotent — the same
      // identity the enqueue would have stamped).
      const stamped =
        claimed.targetPrimarySessionId !== null
          ? primarySessionsRepository.findPrimarySessionById(db, claimed.targetPrimarySessionId)
          : null
      const colleague =
        stamped !== null && stamped.userId === claimed.userId && stamped.scope === 'agent'
          ? stamped
          : await getOrCreateContinuingSession(db, {
              userId: claimed.userId,
              scope: 'agent',
              workspaceId: claimed.workspaceId,
              scopeRef: agentSlug,
            })
      resolved = { agentSlug, runCwdPath, agent, colleague }
    } catch (resolutionErr) {
      // The workspace status vocabulary's problem signal — first call wins,
      // the finally's clean end() no-ops after this.
      activityHandle.end('failed')
      settleFailedDelegationAttempt(
        db,
        claimed,
        resolutionErr instanceof Error ? resolutionErr.message : String(resolutionErr),
        {
          logger: deps.logger,
          queueLabel: 'agent-run',
          retryHint: `mention the agent again (@${claimed.agentSlug ?? 'agent'}) to retry it.`,
        },
      )
      return true
    }
    const { agentSlug, runCwdPath, agent, colleague } = resolved

    // The turn's settings — `job ?? agent.model ?? colleague row ?? DEFAULT`
    // (A5): the mention's stamped picks win, the agent's own configured model
    // backs a job that named none, then what the user chose for the colleague
    // conversation, then `auto`. Fit-checked against the colleague's head.
    const turnSettings = resolveBackgroundTurnSettings(db, {
      headSdkSessionId: colleague.currentSdkSessionId,
      job: claimed,
      fallbackModel: agent.model,
      ...(deps.pressureThreshold !== undefined ? { threshold: deps.pressureThreshold } : {}),
      logger: deps.logger,
      jobId: claimed.id,
    })

    // Surface-up: one gate + handler per job — record-and-park, the routed
    // shape (the leaf's fail-closed denier is retired with the leaf).
    const waitGate = new ApprovalWaitGate()
    const handler = buildRoutedApprovalHandler({
      db,
      logger: deps.logger,
      provider: deps.provider,
      workspaceName: agent.name,
      waitGate,
    })
    approvalHandler = handler

    // The colleague's MCP attachment — ALWAYS composed (both groundings): a
    // colleague has no bare-priming history, so its toolset is consistent from
    // turn 1, and `send_message` is how it speaks at all.

    const mcpAttachment = deps.composeWorkspaceMcpServers?.({
      db,
      userId: claimed.userId,
      workspaceId: colleague.workspaceId,
      target: 'agent-session',
      ...(feedThreadId !== null ? { threadId: feedThreadId } : {}),
      jobId: claimed.id,
      targetPrimarySessionId: colleague.id,
      ...(claimed.requesterWorkspaceId !== null
        ? { requesterWorkspaceId: claimed.requesterWorkspaceId }
        : {}),
      // The SAME mode the runner passes to the provider below (the tick's rule).
      permissionMode: turnSettings.permissionMode,
    })

    const turnEvents = deps.turnEvents
    // Auto-continue (session-continuity §4.6): a follow-up run CONTINUES the
    // colleague's own checkpoint (the guard keeps counting; the continuation
    // steer); a genuine mention resets the guard and drops a stale checkpoint.
    const delegatedTurn = beginDelegatedTurn(
      db,
      claimed,
      { logger: deps.logger },
      { primarySessionId: colleague.id },
    )
    const outcome = await routeRequest(
      {
        userId: claimed.userId,
        parentSessionId: claimed.parentSessionId,
        targetWorkspaceId: colleague.id,
        targetWorkspacePath: runCwdPath,
        taskText: claimed.taskText,
        hardCapMs: deps.hardCapMs,
      },
      {
        delegate: (delegationInput) =>
          delegateToAgentSession(db, deps.provider, {
            parentSessionId: delegationInput.parentSessionId,
            userId: delegationInput.userId,
            targetPrimarySessionId: colleague.id,
            runCwdPath,
            agentSlug,
            agentName: agent.name,
            agentPrompt: agent.prompt,
            agentAllowedTools: agent.allowedTools ?? [],
            agentDisallowedTools: agent.disallowedTools ?? [],
            taskText: delegationInput.taskText,
            // A mention is the USER speaking DIRECTLY into the colleague's
            // conversation (live-tracking redesign, Case 3) — the inbound row
            // reads "You · from <origin scope>", never as relayed by Claude or
            // the manager.
            userAttribution: {
              userSourceKind: 'user',
              // The origin scope's display name. The agent-run row's
              // `workspaceName` column carries the AGENT's name (column reuse),
              // so a workspace grounding resolves its name at run time.
              userSourceLabel:
                claimed.workspaceId === null
                  ? 'Global'
                  : (findWorkspaceById(db, claimed.workspaceId)?.name ?? 'Workspace'),
            },
            providerId: DEFAULT_PROVIDER_ID,
            ...(partialSessionId !== undefined ? { partialSessionId } : {}),
            ...(feedThreadId !== null ? { threadId: feedThreadId } : {}),
            permissionMode: turnSettings.permissionMode,
            ...(turnSettings.model !== undefined ? { model: turnSettings.model } : {}),
            ...(turnSettings.thinkingEffort !== undefined
              ? { thinkingEffort: turnSettings.thinkingEffort }
              : {}),
            autoBuildout: turnSettings.autoBuildout,
            ...(delegatedTurn.continuation !== null
              ? { steerInstructions: CONTINUATION_TASK_INSTRUCTIONS }
              : {}),
            ...(mcpAttachment !== undefined ? { mcpAttachment } : {}),
            approvalHandler: handler,
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
              activityHandle.sessionResolved(sdkSessionId)
            },
            logger: deps.logger,
          }),
        logger: deps.logger,
        waitGate,
        onHardCap: cancelLever.interrupt,
      },
    )

    if (outcome.status === 'completed' && cancelHandle?.isCancelRequested()) {
      // Stop always wins at terminal time (the task-tick policy, kept coherent).
      await approvalHandler.abandonParked()
      failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
      deps.logger.info(
        { jobId: claimed.id },
        'agent-run: stopped by the user at terminal time',
      )
    } else if (outcome.status === 'completed') {
      // NO HARVEST (the task-branch rule): the colleague's spoken send_message
      // is the only report path. The row completes UNSURFACED (the direct-
      // reply tweak revises invariant 5 for mention runs): the colleague's
      // reply lands directly on the user's transcript with NO notify turn, so
      // the catch-up net is how the root LEARNS of it — the next root turn
      // absorbs it (presented "already shown — do not restate") and marks it
      // surfaced exactly-once there.
      completeDelegationJob(db, claimed.id, outcome.result, new Date())
      deps.logger.info(
        { jobId: claimed.id, resultPreview: outcome.result.slice(0, 120) },
        'agent-run: completed — the colleague speaks for itself (no harvest)',
      )
      // The colleague checkpointed mid-task: enqueue the follow-up run that
      // continues it on the fresh head. Best-effort — the job is complete.
      try {
        enqueueCheckpointContinuation(
          db,
          claimed,
          { logger: deps.logger },
          { primarySessionId: colleague.id },
        )
      } catch (err) {
        deps.logger.warn(
          { err, jobId: claimed.id },
          'failed to enqueue the checkpoint continuation (the run is still completed)',
        )
      }
    } else if (outcome.status === 'capped') {
      // The colleague turn ran past the hard cap, was interrupted, and has
      // SETTLED (the tick's shape): Stop still wins; otherwise settle records
      // the honest terminal failure + the give-up push, never a requeue. A
      // colleague that already SPOKE settles quietly and stays UNSURFACED
      // there — its reply always delivered DIRECTLY, and the net's reported
      // branch is how the root absorbs it.
      await approvalHandler.abandonParked()
      if (cancelHandle?.isCancelRequested()) {
        failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
        deps.logger.warn({ jobId: claimed.id }, 'agent-run job stopped by the user (past its cap)')
      } else {
        activityHandle.end('failed')
        settleFailedDelegationAttempt(db, claimed, outcome.message, {
          logger: deps.logger,
          queueLabel: 'agent-run',
          retryHint: `mention the agent again (@${agentSlug}) to retry it.`,
          neverRequeue: true,
        })
      }
    } else if (cancelHandle?.isCancelRequested()) {
      // The interrupted turn throws by design — the user's action, not a failure.
      await approvalHandler.abandonParked()
      failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
      deps.logger.warn({ jobId: claimed.id }, 'agent-run job stopped by the user')
    } else {
      activityHandle.end('failed')
      await approvalHandler.abandonParked()
      settleFailedDelegationAttempt(db, claimed, outcome.message, {
        logger: deps.logger,
        queueLabel: 'agent-run',
        retryHint: `mention the agent again (@${agentSlug}) to retry it.`,
      })
    }
    return true
  } catch (err) {
    // An unexpected throw must never leave the job stuck `claimed`.
    activityHandle.end('failed')
    await approvalHandler?.abandonParked()
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'agent-run job run threw unexpectedly')
    return true
  } finally {
    cancelHandle?.end()
    activityHandle.end()
  }
}
