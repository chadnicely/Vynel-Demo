// `runAgentRunJob` — runs ONE claimed 'agent-run' job to a terminal state
// (chat-mentions): a `@agent` mention became this row; the leaf runs FRESH
// (`delegateToLeafSession` — its own SDK session, recorded hidden, safety
// backstop inherited, carded tools fail-closed DENIED) on the user's message,
// and the leaf's clean result is delivered DETERMINISTICALLY to the
// ORIGINATING chat as a report-delivery job. Called by
// `runDelegationClaimAndRunTick` after the claim (pool slot already reserved
// on the job's OWN id — a leaf resumes no conversation, so it holds no
// single-writer key).
//
// WHY deterministic delivery (vs the task branch's no-harvest rule): a leaf
// has no send_message and no conversation — `resultText` IS its designed
// return value (the delegateToLeafSession contract: "the root absorbs only
// the clean result"). Capturing it here is not harvesting a chat reply; it is
// the only way the result exists at all.

import { withTransaction, type Database } from '@vynel/db'
import type { Logger } from 'pino'
import {
  completeDelegationJob,
  enqueueReportDelivery,
  failDelegationJob,
  markDelegationsSurfacedToRoot,
  resolveThreadIdOf,
  routeRequest,
  type DelegationJob,
} from '@vynel/orchestration'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import { delegateToLeafSession } from './delegate-to-leaf-session.js'
import {
  resolveJobReportRequester,
  settleFailedDelegationAttempt,
} from './settle-failed-delegation-attempt.js'
import type { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import type { SessionActivityFeed } from '../runtime/session-activity-feed.js'

export interface RunAgentRunJobDeps {
  provider: AiAgentProvider
  logger: Logger
  activityFeed: SessionActivityFeed
  cancelRegistry?: DelegationCancelRegistry
  /** Resolved by the caller (the tick owns the default). */
  budgetMs: number
}

/** Run one claimed agent-run job to a terminal state. Always returns true (a
 *  job was processed); failures land on the row, never propagate. */
export async function runAgentRunJob(
  db: Database,
  deps: RunAgentRunJobDeps,
  claimed: DelegationJob,
): Promise<boolean> {
  const partialSessionId = claimed.partialSessionId ?? undefined
  // The enqueue-time agent display name (column reuse — the report label).
  const agentLabel = claimed.workspaceName ?? claimed.agentSlug ?? 'Agent'

  const cancelHandle =
    deps.cancelRegistry !== undefined && partialSessionId !== undefined
      ? deps.cancelRegistry.begin(partialSessionId)
      : null

  deps.logger.info(
    { jobId: claimed.id, agentSlug: claimed.agentSlug, workspaceId: claimed.workspaceId },
    'agent-run: claimed — running the mentioned agent leaf',
  )

  // A leaf run is global-scoped on the liveness feed when ungrounded (the
  // session-target shape); workspace-scoped when the mention came from a
  // workspace chat. Begun immediately before try (zombie-turn doctrine).
  const activityHandle = deps.activityFeed.begin({
    userId: claimed.userId,
    ...(claimed.workspaceId === null
      ? { scopeKind: 'global' as const }
      : { scopeKind: 'workspace' as const, workspaceId: claimed.workspaceId }),
    origin: 'delegation',
  })
  try {
    const agentSlug = claimed.agentSlug
    if (agentSlug === null) {
      throw new Error('agent-run job has no agentSlug (corrupt row)')
    }
    const runCwdPath = claimed.workspacePath
    if (runCwdPath === null) {
      throw new Error('agent-run job has no run cwd (workspacePath is null — corrupt row)')
    }

    // The same timeout-raced, never-reject coordination task jobs get. The
    // delegate closure captures its own grounding; leaf approvals are
    // fail-closed auto-denied inside `createLeafSession` (no waitGate needed —
    // nothing ever parks).
    const groundingWorkspaceId = claimed.workspaceId
    const outcome = await routeRequest(
      {
        userId: claimed.userId,
        parentSessionId: claimed.parentSessionId,
        targetWorkspaceId: groundingWorkspaceId ?? claimed.id,
        targetWorkspacePath: runCwdPath,
        taskText: claimed.taskText,
        timeoutMs: deps.budgetMs,
      },
      {
        delegate: (delegationInput) =>
          delegateToLeafSession(db, deps.provider, {
            parentSessionId: delegationInput.parentSessionId,
            userId: delegationInput.userId,
            workspaceId: groundingWorkspaceId,
            workspacePath: runCwdPath,
            agentSlug,
            taskText: delegationInput.taskText,
            providerId: DEFAULT_PROVIDER_ID,
            ...(claimed.model !== null ? { model: claimed.model } : {}),
          }),
        logger: deps.logger,
      },
    )

    if (outcome.status === 'completed' && cancelHandle?.isCancelRequested()) {
      // Stop always wins at terminal time (the task-tick policy, kept coherent).
      failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
      deps.logger.info(
        { jobId: claimed.id },
        'agent-run: stopped by the user at terminal time (report suppressed)',
      )
    } else if (outcome.status === 'completed') {
      // A silent leaf still completed — deliver an honest stub so the user
      // learns the run finished (enqueueReportDelivery rejects empty bodies).
      const reportBody =
        outcome.result.trim() !== ''
          ? outcome.result
          : `${agentLabel} finished the mentioned run without producing a text result.`
      const threadId = resolveThreadIdOf(claimed)
      // complete + surfaced-mark + report co-commit (invariant 5): the result
      // exists ONLY here, so "completed but no report queued" must be
      // impossible — one transaction makes the three states move together.
      withTransaction(db, (tx) => {
        completeDelegationJob(tx, claimed.id, outcome.result, new Date())
        markDelegationsSurfacedToRoot(tx, [claimed.id], new Date())
        enqueueReportDelivery(tx, {
          ...(threadId !== null ? { threadId } : {}),
          userId: claimed.userId,
          reporterSessionId: outcome.reference,
          reporterLabel: agentLabel,
          reportBody,
          requester: resolveJobReportRequester(tx, claimed),
        })
      })
      deps.logger.info(
        { jobId: claimed.id, resultPreview: outcome.result.slice(0, 120) },
        'agent-run: completed — result report enqueued for the originating chat',
      )
    } else if (outcome.status === 'timed-out') {
      failDelegationJob(db, claimed.id, `timed-out after ${outcome.timeoutMs}ms`, new Date())
      deps.logger.warn(
        { jobId: claimed.id, timeoutMs: outcome.timeoutMs },
        'agent-run job timed out (the leaf keeps running in its own session)',
      )
    } else if (cancelHandle?.isCancelRequested()) {
      // The interrupted turn throws by design — the user's action, not a failure.
      failDelegationJob(db, claimed.id, 'stopped by the user', new Date())
      deps.logger.warn({ jobId: claimed.id }, 'agent-run job stopped by the user')
    } else {
      settleFailedDelegationAttempt(db, claimed, outcome.message, {
        logger: deps.logger,
        queueLabel: 'agent-run',
        retryHint: `mention the agent again (@${agentSlug}) to retry it.`,
      })
    }
    return true
  } catch (err) {
    // An unexpected throw must never leave the job stuck `claimed`.
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'agent-run job run threw unexpectedly')
    return true
  } finally {
    cancelHandle?.end()
    activityHandle.end()
  }
}
