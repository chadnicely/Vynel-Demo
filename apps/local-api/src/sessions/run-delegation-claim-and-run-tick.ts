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
  claimNextPendingDelegationJob,
  completeDelegationJob,
  failDelegationJob,
  routeRequest,
  type DelegateForRouting,
} from '@vynel/orchestration'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { recordPushedReportMessage } from '@vynel/chat'
import { findWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { findChannelById, enqueueChannelReply } from '@vynel/channels'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import { delegateToWorkspaceRoot } from './delegate-to-workspace-root.js'

// Generous — the bound is on WAITING, not the turn (which keeps running in its own SDK
// session). 120s was sized for an HTTP request waiting on a result; a background job
// nobody waits on gets a longer leash, so a timeout means genuinely-stuck work.
const DELEGATION_RUN_BUDGET_MS = 600_000

export interface RunDelegationTickDeps {
  provider: AiAgentProvider
  logger: Logger
  /** Wait budget for one job's turn (ms). Defaults to DELEGATION_RUN_BUDGET_MS. */
  budgetMs?: number
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

  // Lifecycle visibility (Ch3.5 diagnostics): a delegation runs a full provider turn that
  // can take a while; log the claim + the terminal outcome so a slow/stuck job is visible
  // in the server console (read-safe means a WRITE task is denied + may run long).
  deps.logger.info(
    { jobId: claimed.id, workspace: claimed.workspaceName, task: claimed.taskText.slice(0, 100) },
    'delegation: claimed — running the workspace turn (read-safe)',
  )

  try {
    // Resolve the workspace's persona ONCE (brain-tree Ch5) — both halves of the
    // "Mark · vynel" label come from this single fresh read: the manager name + the
    // CURRENT workspace name, falling back to the job's enqueue-time name if the
    // workspace was deleted between enqueue and now.
    const workspace = findWorkspaceById(db, claimed.workspaceId)
    const workspaceName = workspace?.name ?? claimed.workspaceName
    const managerName = workspace ? resolveManagerName(workspace) : undefined

    const delegate: DelegateForRouting = (delegationInput) =>
      delegateToWorkspaceRoot(db, deps.provider, {
        ...delegationInput,
        workspaceName,
        ...(managerName !== undefined ? { managerName } : {}),
        providerId: DEFAULT_PROVIDER_ID,
        ...(partialSessionId !== undefined ? { partialSessionId } : {}),
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
      { delegate, logger: deps.logger },
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
      // (channel gone/disabled, or an insert error) is logged, never re-fails the job. The origin
      // columns are set as a unit, so all three are present together.
      if (
        claimed.originChannelId !== null &&
        claimed.originExternalSenderId !== null &&
        claimed.originExternalChatContextId !== null
      ) {
        try {
          const originChannel = findChannelById(db, claimed.originChannelId)
          // Tenant-isolation guard: the origin traces to a header read at the /routing/delegate
          // boundary, so verify the channel is owned by the delegation's user before delivering
          // (defense-in-depth — Phase 1 is single-user, but this closes a Phase-2 cross-tenant gap).
          if (
            originChannel !== null &&
            originChannel.isEnabled &&
            originChannel.userId === claimed.userId
          ) {
            enqueueChannelReply(db, {
              channel: originChannel,
              message: {
                externalSenderId: claimed.originExternalSenderId,
                externalChatContextId: claimed.originExternalChatContextId,
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
      failDelegationJob(db, claimed.id, outcome.message, new Date())
      deps.logger.warn({ jobId: claimed.id, message: outcome.message }, 'delegation job failed')
    }
    return true
  } catch (err) {
    // An unexpected throw (e.g. a DB error in the push or the complete) must never leave
    // the job stuck `claimed` (Ch1 does not auto-reclaim).
    failDelegationJob(db, claimed.id, err instanceof Error ? err.message : String(err), new Date())
    deps.logger.error({ err, jobId: claimed.id }, 'delegation job run threw unexpectedly')
    return true
  }
}
