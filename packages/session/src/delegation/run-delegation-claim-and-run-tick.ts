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
  failDelegationJob,
  GLOBAL_ROOT_DELIVERY_TARGET_KEY,
  isDeliveryJobKind,
  isWorkJobKind,
  listDelegationJobsByThread,
  markDelegationsSurfacedToRoot,
  resolveThreadIdOf,
  routeRequest,
  type DelegateForRouting,
  type DelegationJob,
} from '@vynel/orchestration'
import {
  hasDeliveredFinalReport,
  settleFailedDelegationAttempt,
} from './settle-failed-delegation-attempt.js'
import { type ChatTurnEvent } from '@vynel/chat'
import { findWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { findChannelById, enqueueChannelReply } from '@vynel/channels'
import { deriveDelegationTaskLabel } from '@vynel/contracts/chat/delegation-task-label'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import * as primarySessionsRepository from '../repositories/index.js'
import { resolveColleagueAgent } from './resolve-colleague-agent.js'
import { delegateToWorkspaceRoot } from './delegate-to-workspace-root.js'
import type { RoutedTurnMcpAttachment } from './routed-turn-provider-input.js'
import { delegateToSpawnedSession } from './delegate-to-spawned-session.js'
import { delegateToAgentSession } from './delegate-to-agent-session.js'
import { runAgentRunJob } from './run-agent-run-job.js'
import { runReportDeliveryJob, type RunGlobalRootReportTurn } from './run-report-delivery-tick.js'
import { resolveSpawnedSessionDisplayName } from './resolve-spawned-session-name.js'
import {
  buildRoutedApprovalHandler,
  type RoutedApprovalHandler,
  type RoutedApprovalOrigin,
} from './build-routed-approval-handler.js'
import { traceChannelKey, type TurnEventBroadcaster } from './turn-event-broadcaster.js'
import { publishTurnActivityStep } from '../runtime/activity-turn-steps.js'
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
    /** The mode this turn runs under, stamped on the job at enqueue. The
     *  desktop feature maps it to how an approved plan acquires authority —
     *  auto/bypass authorize the plan's apps FOR THE TURN, so a card-free
     *  desktop task doesn't have to mint permanent grants instead. Absent
     *  (channel origin / pre-mode job) keeps the conservative floor. */
    permissionMode?: string
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
  const targetKey =
    claimedKind === 'agent-run'
      ? (claimed.targetPrimarySessionId ?? claimed.id)
      : (claimed.targetPrimarySessionId ??
        claimed.workspaceId ??
        (isDeliveryJobKind(claimed.jobKind) ? GLOBAL_ROOT_DELIVERY_TARGET_KEY : claimed.id))
  deps.onRunStarted?.({ jobId: claimed.id, targetKey })

  // Persona-sessions: an 'agent-run' row resumes the mentioned agent's
  // COLLEAGUE session; its spoken send_message is the only report path.
  if (claimedKind === 'agent-run') {
    return runAgentRunJob(
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
      },
      claimed,
    )
  }

  // Session-comms + persona-sessions: a DELIVERY row (report or update) runs
  // the NOTIFY branch — a real turn on the requester's conversation with the
  // child's message as the attributed inbound. The runner branches on the kind
  // internally (marker + steer); the exclusion key came out above for free.
  // NULL = 'task' (every legacy row).
  if (isDeliveryJobKind(claimed.jobKind)) {
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
    taskLabel: deriveDelegationTaskLabel(claimed.taskText),
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
    // Persona-sessions: a session target may be an agent COLLEAGUE — resolved
    // here so the delegate + MCP target branch on it below.
    let colleagueAgent: {
      slug: string
      name: string
      prompt: string
      allowedTools: string[]
      disallowedTools: string[]
      model: string | null
    } | null = null
    if (claimed.targetPrimarySessionId !== null) {
      const targetPrimary = primarySessionsRepository.findPrimarySessionById(
        db,
        claimed.targetPrimarySessionId,
      )
      spawnedTargetWorkspaceId = targetPrimary?.workspaceId ?? null
      if (targetPrimary?.scope === 'agent') {
        // A colleague target: resolve its agent fresh (workspace-then-user,
        // the one home). A gone agent or a missing scopeRef is a FAILED
        // ATTEMPT, not bookkeeping — it settles through the give-up push so
        // the requester hears about it (the agent-run resolution-phase rule).
        const slug = targetPrimary.scopeRef
        const agent =
          slug !== null
            ? await resolveColleagueAgent(db, {
                userId: claimed.userId,
                workspaceId: targetPrimary.workspaceId,
                slug,
              })
            : null
        if (slug === null || agent === null) {
          settleFailedDelegationAttempt(
            db,
            claimed,
            slug === null
              ? 'agent-scope target has no scopeRef (corrupt colleague row)'
              : `no agent "${slug}" resolves for the targeted colleague any more`,
            {
              logger: deps.logger,
              queueLabel: 'delegation',
              retryHint: 're-send the task with send_message if it should be retried.',
            },
          )
          return true
        }
        colleagueAgent = {
          slug,
          name: agent.name,
          prompt: agent.prompt,
          allowedTools: agent.allowedTools ?? [],
          disallowedTools: agent.disallowedTools ?? [],
          model: agent.model,
        }
        targetName = agent.name
        managerName = undefined
      } else {
        targetName = resolveSpawnedSessionDisplayName(db, targetPrimary)
        managerName = undefined
      }
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
            // this turn land there instead of the global root.
            ...(claimed.requesterWorkspaceId !== null
              ? { requesterWorkspaceId: claimed.requesterWorkspaceId }
              : {}),
            // The turn's mode — the SAME value the runner passes to the
            // provider below, so the desktop plan envelope and the approval
            // floor can never disagree about what this turn may do.
            ...(claimed.permissionMode !== null
              ? { permissionMode: claimed.permissionMode }
              : {}),
          })
        : undefined

    // The pieces both target runners share verbatim: mode, trace observing, and
    // the stop/liveness session hookup.
    const sharedRunnerOptions = {
      providerId: DEFAULT_PROVIDER_ID,
      ...(partialSessionId !== undefined ? { partialSessionId } : {}),
      ...(claimedThreadId !== null ? { threadId: claimedThreadId } : {}),
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
      // The observer now does TWO things, and the activity half is
      // UNCONDITIONAL — it must not depend on anyone watching.
      //
      // 1. Turn steps onto the activity feed. A spawned session can now drive
      //    the DESKTOP (`DESKTOP_CAPABLE_DELEGATED_TARGETS`), and the attention
      //    overlay folds `mcp__desktop__*` steps off this feed. Without this the
      //    job announces "busy" and then moves the user's mouse behind a DARK
      //    overlay — the same class of hole the subagent mapping closed
      //    (`activity-turn-steps.ts`): who inside a turn drives the machine is
      //    irrelevant to whether the user gets to see it. It also closes the
      //    recorded "delegated turns publish NO narration steps" gap.
      // 2. Trace-channel publishing, as before — only when someone attached.
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
      // The stop bridge learns the RUNNING session id so a user Stop can
      // interrupt exactly this turn; the liveness feed learns it for the
      // turn-updated frame (the UI keys its thread poll on the session).
      onSessionResolved: (sdkSessionId: string) => {
        cancelHandle?.sessionResolved(sdkSessionId)
        activityHandle.sessionResolved(sdkSessionId)
      },
      logger: deps.logger,
    }

    // Branch on the target (Slice ④ + persona-sessions): an agent-scope
    // session job resumes the COLLEAGUE's continuing conversation; a spawned
    // session job resumes the spawned primary's; a workspace job is
    // byte-for-byte the pre-slice path. Captured for closure narrowing.
    const spawnedTargetId = claimed.targetPrimarySessionId
    const agentTarget = colleagueAgent
    // The task anchor row's honest origin (redesign Phase-2b): a mention-routed
    // job carries its requester workspace; everything else was asked at the
    // global root. Renders as "Claude · from <label>".
    const originScopeLabel =
      claimed.requesterWorkspaceId !== null
        ? (findWorkspaceById(db, claimed.requesterWorkspaceId)?.name ?? 'Workspace')
        : 'Global'
    const delegate: DelegateForRouting =
      spawnedTargetId !== null && agentTarget !== null
        ? (delegationInput) =>
            delegateToAgentSession(db, deps.provider, {
              parentSessionId: delegationInput.parentSessionId,
              userId: delegationInput.userId,
              targetPrimarySessionId: spawnedTargetId,
              runCwdPath,
              agentSlug: agentTarget.slug,
              agentName: agentTarget.name,
              agentPrompt: agentTarget.prompt,
              agentAllowedTools: agentTarget.allowedTools,
              agentDisallowedTools: agentTarget.disallowedTools,
              taskText: delegationInput.taskText,
              // The sender reads as Claude relaying the ask, labeled with its
              // honest origin scope (redesign Phase-2b).
              userAttribution: {
                userSourceKind: 'global-root',
                userSourceLabel: originScopeLabel,
              },
              ...sharedRunnerOptions,
              // The agent's own model backs the job's pick (job pick wins).
              ...(claimed.model === null && agentTarget.model !== null
                ? { model: agentTarget.model }
                : {}),
            })
        : spawnedTargetId !== null
          ? (delegationInput) =>
              delegateToSpawnedSession(db, deps.provider, {
                parentSessionId: delegationInput.parentSessionId,
                userId: delegationInput.userId,
                targetPrimarySessionId: spawnedTargetId,
                runCwdPath,
                sessionName: targetName,
                taskText: delegationInput.taskText,
                userSourceLabel: originScopeLabel,
                ...sharedRunnerOptions,
              })
          : (delegationInput) =>
              delegateToWorkspaceRoot(db, deps.provider, {
                ...delegationInput,
                workspaceName: targetName,
                ...(managerName !== undefined ? { managerName } : {}),
                userSourceLabel: originScopeLabel,
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
      // learn the task died. ONE exception (kind `direct_to_user`): a final
      // answer that went straight to the user runs NO notify turn, so the row
      // stays UNSURFACED — the net is how the root learns it (presented
      // "already shown — absorb silently", never an echo).
      const wentDirect = finalReportWentDirect(db, claimed)
      try {
        withTransaction(db, (tx) => {
          completeDelegationJob(tx, claimed.id, outcome.result, new Date())
          if (!wentDirect) markDelegationsSurfacedToRoot(tx, [claimed.id], new Date())
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
          if (!wentDirect) markDelegationsSurfacedToRoot(db, [claimed.id], new Date())
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
      // A turn that already SPOKE its report must not resurface as "couldn't
      // complete" through the pull net (B2's timeout half) — the requester has
      // the result; the timeout is bookkeeping. Deliberately NOT routed through
      // settle: 'timed-out' matches the recoverable patterns, and a requeue
      // would re-run a turn that is still running. Direct-kind exception: a
      // `direct_to_user` answer's absorb happens THROUGH the net (the reported
      // branch of the collector) — marking it surfaced would hide a displayed
      // reply from the root.
      if (hasDeliveredFinalReport(db, claimed)) {
        if (!finalReportWentDirect(db, claimed)) {
          markDelegationsSurfacedToRoot(db, [claimed.id], new Date())
        }
        deps.logger.warn(
          { jobId: claimed.id, timeoutMs: outcome.timeoutMs },
          'delegation job timed out AFTER its report was sent — the requester already has the result',
        )
      } else {
        deps.logger.warn(
          { jobId: claimed.id, timeoutMs: outcome.timeoutMs },
          'delegation job timed out (the workspace turn keeps running in its own session)',
        )
      }
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
    await approvalHandler?.abandonParked()
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'delegation job run threw unexpectedly')
    return true
  } finally {
    cancelHandle?.end()
    activityHandle.end()
  }
}

/** True when THIS work row's final report was sent kind `direct_to_user`: the
 *  row is reported AND a 'direct-delivery' hop exists in ITS OWN delivery
 *  window — after this hop, before the chain's NEXT work hop. A continued
 *  chain holds one work hop per task (the run-stats pairing rule), so a
 *  chain-wide scan would falsely absorb a LATER normally-narrated report just
 *  because an earlier task on the thread went direct (the Gate-3 catch). Such
 *  a row stays UNSURFACED at terminal time — the catch-up net is how the root
 *  learns of a reply that ran no notify turn (presented absorb-silently). */
function finalReportWentDirect(db: Database, claimed: DelegationJob): boolean {
  if (!hasDeliveredFinalReport(db, claimed)) return false
  const threadId = resolveThreadIdOf(claimed)
  if (threadId === null) return false
  const chain = listDelegationJobsByThread(db, {
    userId: claimed.userId,
    threadId,
    unbounded: true,
  })
  const startsAt = claimed.createdAt.getTime()
  const nextWorkAt = chain.find(
    (job) =>
      job.id !== claimed.id &&
      isWorkJobKind(job.jobKind) &&
      job.createdAt.getTime() > startsAt,
  )?.createdAt
  return chain.some(
    (job) =>
      job.jobKind === 'direct-delivery' &&
      job.createdAt.getTime() >= startsAt &&
      (nextWorkAt === undefined || job.createdAt.getTime() < nextWorkAt.getTime()),
  )
}

