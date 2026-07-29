// Which turn failures deserve another attempt. The delegation queue only sees
// prose by the time a job fails (the runners embed the provider errorCode in
// the thrown message — `the routed turn errored (<code>): <message>`), so the
// classifier works on that string. Transient provider/infrastructure shapes
// retry; everything else (bad input, missing workspace, logic errors) fails
// terminally on the first attempt.

import { requeueDelegationJob, type DelegationJob } from '@vynel/orchestration'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

// Backoff per completed attempt: first retry after 30s, second after 5m.
export const DELEGATION_RETRY_BACKOFF_SECONDS = [30, 300] as const

// Total attempts (the first run + retries). A background turn is expensive —
// two retries is the ceiling before the failure is pushed to the requester.
export const DELEGATION_MAX_ATTEMPTS = 3

const RECOVERABLE_PATTERNS =
  /rate.?limit|too many requests|overloaded|\b429\b|\b5\d{2}\b|internal server error|timed?.?out|timeout|network|econnreset|econnrefused|etimedout|enotfound|socket hang up|fetch failed|connection (?:closed|reset|refused|error)|provider_start_timeout|api error/i

export function isRecoverableTurnFailure(errorMessage: string): boolean {
  return RECOVERABLE_PATTERNS.test(errorMessage)
}

/** The structured code the delegate runners embed in their thrown message —
 *  `the routed turn errored (<code>): …` — recovered for the row's errorCode. */
export function extractEmbeddedErrorCode(errorMessage: string): string | null {
  const match = /errored \(([\w-]+)\)/.exec(errorMessage)
  return match?.[1] ?? null
}

/** Requeue the job for another attempt when the failure is transient and
 *  attempts remain. Returns true when requeued — the caller stops there;
 *  false means the failure is terminal and the caller fails the row. */
export function requeueIfRecoverable(
  db: Database,
  job: DelegationJob,
  errorMessage: string,
  logger: Logger,
  label: string,
): boolean {
  const attemptCount = (job.attemptCount ?? 0) + 1
  if (!isRecoverableTurnFailure(errorMessage) || attemptCount >= DELEGATION_MAX_ATTEMPTS) {
    return false
  }
  const nextAttemptAt = new Date(Date.now() + nextAttemptDelayMs(attemptCount))
  requeueDelegationJob(db, job.id, {
    errorMessage,
    errorCode: extractEmbeddedErrorCode(errorMessage),
    attemptCount,
    nextAttemptAt,
  })
  logger.warn(
    { jobId: job.id, attemptCount, nextAttemptAt, message: errorMessage },
    `${label}: recoverable failure — requeued with backoff`,
  )
  return true
}

/** The backoff deadline for the attempt that just failed (1-based). */
export function nextAttemptDelayMs(attemptCount: number): number {
  const index = Math.min(
    Math.max(attemptCount - 1, 0),
    DELEGATION_RETRY_BACKOFF_SECONDS.length - 1,
  )
  return DELEGATION_RETRY_BACKOFF_SECONDS[index]! * 1000
}
