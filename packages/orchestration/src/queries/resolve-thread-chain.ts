// `resolveThreadChain` — every hop of one task chain, oldest first. The read
// `partialSessionId` could never answer: that key is per-HOP by design, so a
// two-hop delegation produced four unrelated keys with nothing linking them.
//
// Each hop still resolves to its own full trace via
// `resolveDelegationTrace(hop.partialSessionId)` (session tier) — this read is
// the SPINE, not a replacement. It stays in orchestration because it reads only
// `delegation_jobs`; composing the chat messages on top is the session tier's
// job, exactly as the single-hop trace already is.

import type { Database } from '@vynel/db'
import {
  listDelegationJobsByThread,
  findDelegationJobByPartialSessionId,
  type DelegationJobStatus,
} from '../repositories/index.js'
import { resolveThreadIdOf } from '../routing/resolve-thread-id.js'
import { isDeliveryJobKind } from '../schema/delegation-jobs.js'

export interface ThreadChainHop {
  jobId: string
  /** This hop's own trace key — the handle for the per-hop message trace. */
  partialSessionId: string | null
  /** 'task' = work sent down; 'note' = plain communication carried across
   *  (never work); 'report-delivery' = a result carried back up;
   *  'update-delivery' = interim status carried up (persona-sessions);
   *  'direct-delivery' = a final answer carried straight to the user. */
  kind: 'task' | 'note' | 'report-delivery' | 'update-delivery' | 'direct-delivery'
  status: DelegationJobStatus
  /** The OTHER PARTY on this hop — kind-dependent, and deliberately NOT always
   *  the destination: a 'task' hop names where the work went, but a delivery
   *  hop AND a 'note' hop name the SENDER whose message they carry (both row
   *  shapes reuse `workspaceName` for the sender's label). Read it as "who",
   *  never as "where it went" — the routing route shipped a `deliveredTo` that
   *  made exactly that substitution and reported a sender's own name back to
   *  it. */
  target: string
  createdAt: Date
}

export interface ThreadChain {
  threadId: string
  hops: ThreadChainHop[]
}

/** Resolve a chain from ANY hop's correlation key — the caller usually holds a
 *  `partialSessionId` (that is what every existing surface carries), not the
 *  thread id, so accept the hop key and walk outward from it. Unknown or
 *  foreign keys yield an empty chain — the same no-enumeration-leak contract
 *  `resolveDelegationTrace` already keeps. */
export function resolveThreadChain(
  db: Database,
  input: { userId: string; partialSessionId: string },
): ThreadChain | null {
  const anchor = findDelegationJobByPartialSessionId(db, input.partialSessionId)
  if (anchor === null || anchor.userId !== input.userId) return null

  const threadId = resolveThreadIdOf(anchor)
  if (threadId === null) return null

  return {
    threadId,
    hops: listDelegationJobsByThread(db, { userId: input.userId, threadId }).map((job) => ({
      jobId: job.id,
      partialSessionId: job.partialSessionId,
      kind: isDeliveryJobKind(job.jobKind) ? job.jobKind : job.jobKind === 'note' ? 'note' : 'task',
      status: job.status,
      target: job.workspaceName ?? 'Session',
      createdAt: job.createdAt,
    })),
  }
}
