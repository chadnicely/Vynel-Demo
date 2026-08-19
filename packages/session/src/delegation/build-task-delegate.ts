// `buildTaskDelegate` — the `DelegateForRouting` closure a TASK/NOTE job hands
// `routeRequest` (split from `run-task-job.ts`, session-hardening A6,
// behaviour-neutral): branch on the target (Slice ④ + persona-sessions) — an
// agent-scope session job resumes the COLLEAGUE's continuing conversation, a
// spawned session job resumes the spawned primary's, a workspace job is the
// pre-slice path — over the pieces all three runners share verbatim (settings,
// MCP attachment, approval handler, trace observing, the stop/liveness hookup).

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { DelegateForRouting, DelegationJob, DelegationPermissionMode } from '@vynel/orchestration'
import type { ChatTurnEvent } from '@vynel/chat'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import { findWorkspaceById } from '@vynel/workspaces'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import { delegateToWorkspaceRoot } from './delegate-to-workspace-root.js'
import { delegateToSpawnedSession } from './delegate-to-spawned-session.js'
import { delegateToAgentSession } from './delegate-to-agent-session.js'
import {
  CONTINUATION_TASK_INSTRUCTIONS,
  NOTE_DELIVERY_INSTRUCTIONS,
  type RoutedTurnMcpAttachment,
} from './routed-turn-provider-input.js'
import { beginDelegatedTurn } from './enqueue-checkpoint-continuation.js'
import type { RoutedApprovalHandler } from './build-routed-approval-handler.js'
import type { TurnEventBroadcaster } from './turn-event-broadcaster.js'
import type { TaskTarget } from './resolve-task-target.js'

export interface BuildTaskDelegateInput {
  claimed: DelegationJob
  target: TaskTarget
  /** A 'note' row — the absorb voice, the sender's label, no context nudge. */
  isNote: boolean
  runCwdPath: string
  pressureThreshold?: number
  /** The resolved settings (`job ?? target row ?? DEFAULT`); absent
   *  model/effort = the provider defaults (exactOptionalPropertyTypes). */
  settings: {
    permissionMode: DelegationPermissionMode
    model: string | undefined
    thinkingEffort: ThinkingEffortLevel | undefined
    autoBuildout: boolean
  }
  mcpAttachment: RoutedTurnMcpAttachment | undefined
  approvalHandler: RoutedApprovalHandler
  /** The delegation trace key (per hop) + the chain key. */
  partialSessionId: string | undefined
  threadId: string | null
  turnEvents: TurnEventBroadcaster | undefined
  /** Live observing — the trace channel + the activity feed (the runner
   *  narrates every turn step, watched or not). */
  observer: { onTurnEvent: (event: ChatTurnEvent) => void; onTurnEnded: () => void }
  /** The RUNNING session id, as learned — the stop bridge, the cap lever, and
   *  the liveness feed all read it. */
  onSessionResolved: (sdkSessionId: string) => void
  logger: Logger
}

export function buildTaskDelegate(
  db: Database,
  provider: AiAgentProvider,
  input: BuildTaskDelegateInput,
): DelegateForRouting {
  const { claimed, target, isNote, runCwdPath, settings } = input
  const pressure =
    input.pressureThreshold !== undefined ? { pressureThreshold: input.pressureThreshold } : {}

  // The pieces all three target runners share verbatim: settings, trace
  // observing, and the stop/liveness session hookup.
  const sharedRunnerOptions = {
    providerId: DEFAULT_PROVIDER_ID,
    ...(input.partialSessionId !== undefined ? { partialSessionId: input.partialSessionId } : {}),
    ...(input.threadId !== null ? { threadId: input.threadId } : {}),
    permissionMode: settings.permissionMode,
    ...(settings.model !== undefined ? { model: settings.model } : {}),
    ...(settings.thinkingEffort !== undefined ? { thinkingEffort: settings.thinkingEffort } : {}),
    autoBuildout: settings.autoBuildout,
    ...(input.mcpAttachment !== undefined ? { mcpAttachment: input.mcpAttachment } : {}),
    approvalHandler: input.approvalHandler,
    // Live observing: publish the turn's events on its trace channel; the end
    // closes any attached observe stream (drained or threw alike). The same
    // broadcaster also feeds the session-keyed channel (Watch everywhere).
    ...(input.turnEvents !== undefined ? { turnEvents: input.turnEvents } : {}),
    observer: input.observer,
    onSessionResolved: input.onSessionResolved,
    logger: input.logger,
  }

  // Captured for closure narrowing.
  const spawnedTargetId = claimed.targetPrimarySessionId
  const agentTarget = target.colleagueAgent
  // The task anchor row's honest origin (redesign Phase-2b): a mention-routed
  // job carries its requester workspace; everything else was asked at the
  // global root. Renders as "Claude · from <label>".
  const originScopeLabel =
    claimed.requesterWorkspaceId !== null
      ? (findWorkspaceById(db, claimed.requesterWorkspaceId)?.name ?? 'Workspace')
      : 'Global'
  // A NOTE's inbound speaks as its SENDER (the delivery precedent): the row's
  // `workspaceName` carries the sender's enqueue-time label, and the steer
  // swaps to the absorb voice. Tasks keep the shipped shape byte-for-byte.
  const noteSenderLabel = claimed.workspaceName ?? 'A session'
  const noteSteer = isNote ? { steerInstructions: NOTE_DELIVERY_INSTRUCTIONS } : {}
  // Auto-continue (session-continuity §4.6): a follow-up job CONTINUES its
  // checkpoint (the runaway guard keeps counting; the run gets the
  // continuation steer over the routed one); a genuine job resets the guard
  // and drops a stale checkpoint. A note is never work — no context nudge.
  const delegatedTurn = beginDelegatedTurn(db, claimed, { logger: input.logger })
  const continuationSteer =
    delegatedTurn.continuation !== null
      ? { steerInstructions: CONTINUATION_TASK_INSTRUCTIONS }
      : {}
  const nudgeArming = isNote ? { armContextNudge: false } : {}

  if (spawnedTargetId !== null && agentTarget !== null) {
    return (delegationInput) =>
      delegateToAgentSession(db, provider, {
        parentSessionId: delegationInput.parentSessionId,
        userId: delegationInput.userId,
        targetPrimarySessionId: spawnedTargetId,
        runCwdPath,
        ...pressure,
        agentSlug: agentTarget.slug,
        agentName: agentTarget.name,
        agentPrompt: agentTarget.prompt,
        agentAllowedTools: agentTarget.allowedTools,
        agentDisallowedTools: agentTarget.disallowedTools,
        taskText: delegationInput.taskText,
        // The sender reads as Claude relaying the ask, labeled with its
        // honest origin scope (redesign Phase-2b); a note speaks as the
        // peer that sent it.
        userAttribution: isNote
          ? { userSourceKind: 'workspace-manager', userSourceLabel: noteSenderLabel }
          : { userSourceKind: 'global-root', userSourceLabel: originScopeLabel },
        ...noteSteer,
        ...continuationSteer,
        ...nudgeArming,
        ...sharedRunnerOptions,
      })
  }
  if (spawnedTargetId !== null) {
    return (delegationInput) =>
      delegateToSpawnedSession(db, provider, {
        parentSessionId: delegationInput.parentSessionId,
        userId: delegationInput.userId,
        targetPrimarySessionId: spawnedTargetId,
        runCwdPath,
        ...pressure,
        sessionName: target.targetName,
        taskText: delegationInput.taskText,
        ...(isNote
          ? {
              inboundAttribution: {
                sourceKind: 'workspace-manager' as const,
                sourceLabel: noteSenderLabel,
              },
            }
          : { userSourceLabel: originScopeLabel }),
        ...noteSteer,
        ...continuationSteer,
        ...nudgeArming,
        ...sharedRunnerOptions,
      })
  }
  return (delegationInput) =>
    delegateToWorkspaceRoot(db, provider, {
      ...delegationInput,
      workspaceName: target.targetName,
      ...pressure,
      ...(target.managerName !== undefined ? { managerName: target.managerName } : {}),
      ...(isNote
        ? {
            inboundAttribution: {
              sourceKind: 'workspace-manager' as const,
              sourceLabel: noteSenderLabel,
            },
          }
        : { userSourceLabel: originScopeLabel }),
      ...noteSteer,
      ...continuationSteer,
      ...nudgeArming,
      ...sharedRunnerOptions,
    })
}
