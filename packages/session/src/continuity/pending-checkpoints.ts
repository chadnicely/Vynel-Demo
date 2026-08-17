// Pending CHECKPOINTS — the model said "I am stopping here to swap; continue
// with this" (the `checkpoint` tool, docs/module-notes/session-continuity.md
// §4.6). Keyed by the continuing identity (the primary id); consumed exactly
// once by whoever runs the continuation after the boundary swap.
//
// A process-wide register, not a table (deliberate v1): a checkpoint is a
// minutes-scale intent between one turn's end and the swap that follows it in
// the same process, and the tool call itself is already recorded on the chat
// row (every MCP call persists), so the audit trail exists. A durable column
// becomes worth its migration only if a checkpoint ever has to survive a
// restart — recorded as the follow-up, not slipped in.
//
// The continuation DEPTH guards the runaway case (a model that checkpoints
// every turn): each automatic continuation deepens it, a genuine (user- or
// job-started) turn resets it, and the runners refuse to continue past the cap.

export const MAX_CONSECUTIVE_CONTINUATIONS = 3

export type PendingCheckpoint = {
  primarySessionId: string
  /** The single next step the model named — what the continuation is asked to do. */
  nextStep: string
  /** How many automatic continuations preceded this checkpoint since the last genuine turn. */
  continuationDepth: number
  checkpointedAt: Date
}

const pendingByPrimaryId = new Map<string, PendingCheckpoint>()
const continuationDepthByPrimaryId = new Map<string, number>()

/** The model checkpointed: remember the next step for this identity (a second
 *  call before the swap replaces the first — the latest intent wins). */
export function markPendingCheckpoint(
  primarySessionId: string,
  nextStep: string,
  deps: { now?: () => Date } = {},
): PendingCheckpoint {
  const checkpoint: PendingCheckpoint = {
    primarySessionId,
    nextStep,
    continuationDepth: continuationDepthByPrimaryId.get(primarySessionId) ?? 0,
    checkpointedAt: (deps.now ?? (() => new Date()))(),
  }
  pendingByPrimaryId.set(primarySessionId, checkpoint)
  return checkpoint
}

export function peekPendingCheckpoint(primarySessionId: string): PendingCheckpoint | null {
  return pendingByPrimaryId.get(primarySessionId) ?? null
}

/** Consume the checkpoint (exactly once) — the caller is about to run the
 *  continuation, or decided not to. Null when none is pending. */
export function takePendingCheckpoint(primarySessionId: string): PendingCheckpoint | null {
  const checkpoint = pendingByPrimaryId.get(primarySessionId) ?? null
  if (checkpoint !== null) pendingByPrimaryId.delete(primarySessionId)
  return checkpoint
}

/** Whether a taken checkpoint may run as an automatic continuation, and the
 *  bookkeeping if it does. Past the cap the caller stops and lets the user
 *  (or the next job) drive — the guard against a model that checkpoints forever. */
export function beginContinuation(checkpoint: PendingCheckpoint): boolean {
  if (checkpoint.continuationDepth >= MAX_CONSECUTIVE_CONTINUATIONS) return false
  continuationDepthByPrimaryId.set(checkpoint.primarySessionId, checkpoint.continuationDepth + 1)
  return true
}

/** A GENUINE turn is starting on this identity (a user message, a new
 *  delegated job): the runaway guard starts over, and a checkpoint left
 *  pending by an earlier turn that never got its continuation (a client that
 *  disconnected mid-turn, a process that skipped it) is dropped — returned so
 *  the caller can log it — rather than hijacking this turn's end with a stale
 *  "next step". */
export function beginGenuineTurn(primarySessionId: string): PendingCheckpoint | null {
  continuationDepthByPrimaryId.delete(primarySessionId)
  return takePendingCheckpoint(primarySessionId)
}

/** Test/reset seam — everything remembered for this identity. */
export function clearPendingCheckpoint(primarySessionId: string): void {
  pendingByPrimaryId.delete(primarySessionId)
  continuationDepthByPrimaryId.delete(primarySessionId)
  for (const [jobId, checkpoint] of continuationJobsById) {
    if (checkpoint.primarySessionId === primarySessionId) continuationJobsById.delete(jobId)
  }
}

// The DELEGATED half's follow-up jobs: a job that continues a checkpoint is a
// plain queue row (no column marks it), so its claim would read as a GENUINE
// turn — resetting the runaway guard on every hop and never engaging the cap.
// The enqueue remembers the follow-up's id here; the tick reads it once at
// claim time (the guard keeps counting, the run gets the continuation steer).
// In-process by design, like the checkpoints: after a restart the follow-up
// simply runs as a genuine turn — the guard resets, and its anchor row still
// names the step.
const continuationJobsById = new Map<string, PendingCheckpoint>()

/** Remember that `jobId` is the automatic continuation of `checkpoint`. */
export function markContinuationJob(jobId: string, checkpoint: PendingCheckpoint): void {
  continuationJobsById.set(jobId, checkpoint)
}

/** The checkpoint a claimed job continues — consumed once; null for a genuine job. */
export function takeContinuationJob(jobId: string): PendingCheckpoint | null {
  const checkpoint = continuationJobsById.get(jobId) ?? null
  if (checkpoint !== null) continuationJobsById.delete(jobId)
  return checkpoint
}
