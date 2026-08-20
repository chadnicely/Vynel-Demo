// `reconcileContinuationJobs` — the hand-over slot's safety net (audit r2
// R2-H(d)).
//
// When a completed job's model checkpointed, `enqueueCheckpointContinuation`
// HANDS the checkpoint to the follow-up job it enqueues: the id lands on the
// identity's row and the slot becomes invisible to peek/take until that job's
// claim consumes it (`beginDelegatedTurn`). That is exactly right while the
// job is alive — and a dangling promise the moment it is not. A follow-up that
// settles by ANY other route (the lease sweeper, the boot pass, the user's
// Stop, a run that died before its `beginDelegatedTurn`, a row shape the tick
// failed on) leaves the slot held by a job that will never claim it: the work
// is neither continued nor dropped, the user is told nothing, and the identity
// cannot even mark a new checkpoint over it.
//
// So: every live slot whose job is TERMINAL or GONE is dropped, visibly. The
// predicate is deliberately terminal-or-missing rather than "not pending" —
// terminal is a latch and a claim in flight is benign (if `beginDelegatedTurn`
// already ran, the slot is empty and this finds nothing).
//
// It rides `settleOrphanedDelegationClaims`' two readers — the api's boot pass
// and its 60 s lease sweep — so no settle path needs to remember it; the Stop
// route additionally drops its own slot at once, because that user is watching.

import type { Database } from '@vynel/db'
import type { StructuralLogger } from '@vynel/logger'
import { findDelegationJobById } from '@vynel/orchestration'
import { dropContinuationJobCheckpoint } from '../continuity/index.js'
import * as primarySessionsRepository from '../repositories/index.js'

export type ReconcileContinuationJobsDeps = {
  logger?: StructuralLogger
}

/** Drop every handed-over checkpoint whose follow-up job can no longer claim
 *  it. Returns how many were dropped. */
export function reconcileContinuationJobs(
  db: Database,
  deps: ReconcileContinuationJobsDeps = {},
): number {
  let dropped = 0
  for (const row of primarySessionsRepository.listPrimarySessionsWithHandedOverCheckpoint(db)) {
    const jobId = row.pendingCheckpointJobId
    if (jobId === null) continue
    const job = findDelegationJobById(db, jobId)
    if (job !== null && (job.status === 'pending' || job.status === 'claimed')) continue
    if (
      dropContinuationJobCheckpoint(db, jobId, {
        reason: 'left-behind',
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      }) !== null
    ) {
      dropped += 1
    }
  }
  if (dropped > 0) {
    deps.logger?.warn(
      { dropped },
      'released checkpoint slots whose follow-up job settled without claiming them',
    )
  }
  return dropped
}
