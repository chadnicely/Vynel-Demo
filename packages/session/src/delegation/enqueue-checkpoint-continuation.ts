// The DELEGATED half of auto-continue (docs/module-notes/session-continuity.md
// §4.6). A routed job's turn is the delegated runners' unit of work, so when
// the model checkpointed during it ("I stopped here to swap; continue with
// this"), the continuation is ANOTHER queue turn — a follow-up job of the same
// shape (same target, same chain, same mode/model/effort, same channel origin
// and requester) whose task text is the short anchor row ("Continuing after
// patching context — next: …") — rather than the interactive streams' in-place
// loop. The tick claims it next (FIFO on the same target key), AFTER the
// boundary swap that ran inside the finished turn, so it resumes the fresh
// head; the pending checkpoint is HANDED to the follow-up on the identity's
// own row (durable — a restart between the enqueue and the claim changes
// nothing), so its claim reads as a CONTINUATION (the runaway guard keeps
// counting; the run gets the continuation steer, `CONTINUATION_TASK_INSTRUCTIONS`),
// never as a genuine turn. The ticks call both halves: `beginDelegatedTurn`
// before the turn, `enqueueCheckpointContinuation` after a completed one.

import type { Database } from '@vynel/db'
import { withTransaction } from '@vynel/db'
import type { StructuralLogger } from '@vynel/logger'
import {
  enqueueAgentRun,
  enqueueSessionDelegation,
  enqueueWorkspaceDelegation,
  resolveThreadIdOf,
  type DelegationJob,
} from '@vynel/orchestration'
import {
  beginContinuation,
  beginGenuineTurn,
  dropPendingCheckpoint,
  findPrimaryConversation,
  markContinuationJob,
  peekPendingCheckpoint,
  takeContinuationJob,
  type PendingCheckpoint,
} from '../continuity/index.js'
import { composeContinuationTurn } from '../runtime/continuation-turn.js'

/** The continuing identity a job's turn runs on: a session target (a spawned
 *  session, a colleague, an agent run) IS the target primary; a workspace
 *  target resolves to the workspace's primary (null before the runner
 *  get-or-creates it — nothing could be pending under it yet). An agent-run
 *  row's `workspaceId` is its GROUNDING, never its identity. */
export function resolveDelegatedJobIdentity(db: Database, job: DelegationJob): string | null {
  if (job.targetPrimarySessionId !== null) return job.targetPrimarySessionId
  if (job.jobKind === 'agent-run' || job.workspaceId === null) return null
  return findPrimaryConversation(db, { userId: job.userId, workspaceId: job.workspaceId })?.id ?? null
}

export type DelegatedTurnStart = {
  /** The checkpoint this job CONTINUES (a follow-up job) — null for a genuine turn. */
  continuation: PendingCheckpoint | null
}

/** A turn is beginning for a claimed job. A follow-up job continues its
 *  checkpoint (the guard keeps counting); a genuine job resets the runaway
 *  guard and DROPS a checkpoint still pending from before — visibly, with a
 *  note on the thread. Why drop rather than continue it: on the delegated rail
 *  a checkpoint without its follow-up job means the run that planned it never
 *  completed (it failed, timed out, or died in a restart), and that failure is
 *  the tick's / boot recovery's to report — resurrecting its next step after
 *  an unrelated job would redo work the requester was told had failed.
 *  `primarySessionId` overrides the row-derived identity when the runner
 *  resolved it itself (an agent run's colleague primary). */
export function beginDelegatedTurn(
  db: Database,
  job: DelegationJob,
  deps: { logger: StructuralLogger },
  options: { primarySessionId?: string } = {},
): DelegatedTurnStart {
  const continuation = takeContinuationJob(db, job.id)
  if (continuation !== null) return { continuation }
  const primarySessionId = options.primarySessionId ?? resolveDelegatedJobIdentity(db, job)
  if (primarySessionId === null) return { continuation: null }
  if (beginGenuineTurn(db, primarySessionId) !== null) {
    dropPendingCheckpoint(db, primarySessionId, { reason: 'left-behind', logger: deps.logger })
  }
  return { continuation: null }
}

/**
 * After a COMPLETED work job: when the model checkpointed during it, enqueue
 * the follow-up job that continues the work. Returns the new job id, or null
 * when nothing was pending, the runaway cap was reached, or the job is a NOTE
 * (never work — a checkpoint left by one is dropped, not continued).
 * `primarySessionId` overrides the row-derived identity when the runner
 * resolved it itself (an agent run's colleague primary).
 *
 * One transaction: the depth bookkeeping, the follow-up row and the hand-over
 * land together or not at all — a restart can never leave a follow-up without
 * its mark (a genuine claim that would reset the guard) or a mark without its
 * follow-up (a checkpoint nobody would ever claim).
 */
export function enqueueCheckpointContinuation(
  db: Database,
  job: DelegationJob,
  deps: { logger: StructuralLogger },
  options: { primarySessionId?: string } = {},
): string | null {
  const primarySessionId = options.primarySessionId ?? resolveDelegatedJobIdentity(db, job)
  if (primarySessionId === null) return null
  const checkpoint = peekPendingCheckpoint(db, primarySessionId)
  if (checkpoint === null) return null
  if (job.jobKind === 'note') {
    dropPendingCheckpoint(db, primarySessionId, { reason: 'delivery-turn', logger: deps.logger })
    return null
  }
  const followUpJobId = withTransaction(db, (tx) => {
    if (!beginContinuation(tx, checkpoint)) {
      dropPendingCheckpoint(tx, primarySessionId, { reason: 'cap-reached', logger: deps.logger })
      return null
    }
    const enqueuedJobId = enqueueFollowUpJob(tx, job, primarySessionId, checkpoint)
    if (enqueuedJobId === null) {
      // A row shape no follow-up can be built from (a legacy agent-run without
      // its slug): nothing continues, and nothing must look continuable.
      dropPendingCheckpoint(tx, primarySessionId, { reason: 'left-behind', logger: deps.logger })
      return null
    }
    markContinuationJob(tx, enqueuedJobId, checkpoint)
    return enqueuedJobId
  })
  if (followUpJobId === null) return null
  deps.logger.info(
    {
      jobId: job.id,
      followUpJobId,
      primarySessionId,
      depth: checkpoint.continuationDepth + 1,
      nextStep: checkpoint.nextStep,
    },
    'continuing after a checkpoint — follow-up job enqueued',
  )
  return followUpJobId
}

/** The same-shape follow-up row per job kind: exactly one target is set (the
 *  row invariant) — the branch narrows the types. */
function enqueueFollowUpJob(
  db: Database,
  job: DelegationJob,
  primarySessionId: string,
  checkpoint: PendingCheckpoint,
): string | null {
  const threadId = resolveThreadIdOf(job)
  const shared = {
    ...(threadId !== null ? { threadId } : {}),
    userId: job.userId,
    parentSessionId: job.parentSessionId,
    // The short anchor row — the runners persist the task text verbatim, so
    // the thread reads exactly like the interactive half's continuation; the
    // fuller instruction rides the run's steer.
    taskText: composeContinuationTurn(checkpoint).persistedBody,
    ...(job.permissionMode !== null ? { permissionMode: job.permissionMode } : {}),
    ...(job.model !== null ? { model: job.model } : {}),
    ...(job.requesterWorkspaceId !== null ? { requesterWorkspaceId: job.requesterWorkspaceId } : {}),
  }
  const origin =
    job.originChannelId !== null &&
    job.originExternalSenderId !== null &&
    job.originExternalChatContextId !== null
      ? {
          origin: {
            channelId: job.originChannelId,
            externalSenderId: job.originExternalSenderId,
            externalChatContextId: job.originExternalChatContextId,
          },
        }
      : {}
  const thinkingEffort = job.thinkingEffort !== null ? { thinkingEffort: job.thinkingEffort } : {}
  if (job.jobKind === 'agent-run') {
    if (job.agentSlug === null) return null
    return enqueueAgentRun(db, {
      ...shared,
      agentSlug: job.agentSlug,
      agentName: job.workspaceName ?? job.agentSlug,
      workspaceId: job.workspaceId,
      runCwdPath: job.workspacePath ?? '',
      targetPrimarySessionId: primarySessionId,
    })
  }
  if (job.targetPrimarySessionId !== null) {
    return enqueueSessionDelegation(db, {
      ...shared,
      ...origin,
      ...thinkingEffort,
      targetPrimarySessionId: job.targetPrimarySessionId,
      runCwdPath: job.workspacePath ?? '',
    })
  }
  if (job.workspaceId !== null) {
    return enqueueWorkspaceDelegation(db, {
      ...shared,
      ...origin,
      ...thinkingEffort,
      workspaceId: job.workspaceId,
      workspacePath: job.workspacePath ?? '',
      workspaceName: job.workspaceName ?? '',
    })
  }
  return null
}
