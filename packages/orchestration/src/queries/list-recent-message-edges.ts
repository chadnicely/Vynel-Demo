// `listRecentMessageEdges` — who spoke to whom, just now.
//
// One delegation row is always the same shape regardless of what it carries:
// `parentSessionId` enqueued it, and it targets a session, a workspace, or the
// global root. `jobKind` only decides which WAY the payload is travelling —
// work handed down, or a result carried back up. That uniformity is why this
// read needs no cross-package lookup: every endpoint it reports is a column on
// the row itself.
//
// It reports endpoints and never resolves them. A drawing surface matches the
// ids against whatever it happens to be showing — workspaces on the fleet,
// conversations inside one project — and an endpoint it cannot match is the
// global root, which is the centre of that picture anyway.

import type { Database } from '@vynel/db'
import {
  listDelegationJobsByThread,
  listDelegationJobsSince,
} from '../repositories/index.js'
import { isDeliveryJobKind, type DelegationJob } from '../schema/delegation-jobs.js'
import { resolveThreadIdOf } from '../routing/resolve-thread-id.js'

/** Which way the payload travelled. `ask` is work handed down; `reply` is a
 *  child's message carried back up — what `send_message` enqueues. */
export type MessageEdgeDirection = 'ask' | 'reply'

export interface MessageEdge {
  /** The delegation row — stable across polls, so a drawing surface can tell a
   *  message it has already animated from a new one. */
  jobId: string
  direction: MessageEdgeDirection
  /** The conversation that sent it. Never null — every row records its sender. */
  fromSessionId: string
  /** The conversation it was addressed to, when the target was a session. */
  toSessionId: string | null
  /** The sender's workspace, when the row recorded one (work rows carry it so
   *  the result can find its way home). */
  fromWorkspaceId: string | null
  /** The workspace it was addressed to, when the target was a workspace. */
  toWorkspaceId: string | null
  /** ISO-8601 — when it was sent. */
  at: string
}

// A reply knows who it is FOR (`workspaceId` is the requester) but not where it
// came FROM: `requesterWorkspaceId` is a work-row column, and a delivery row
// only records the reporting session. The thread is what closes that gap — the
// ask that started the chain names the workspace the child ran in, so the reply
// travels back along the line the ask drew. Without this a reply could only be
// drawn as arriving from nowhere.
function senderWorkspaceOfReply(
  db: Database,
  userId: string,
  job: DelegationJob,
): string | null {
  const threadId = resolveThreadIdOf(job)
  if (threadId === null) return null
  const askedIn = listDelegationJobsByThread(db, { userId, threadId }).find(
    (hop) => !isDeliveryJobKind(hop.jobKind) && hop.workspaceId !== null,
  )
  return askedIn?.workspaceId ?? null
}

export function listRecentMessageEdges(
  db: Database,
  input: { userId: string; since: Date; limit?: number },
): MessageEdge[] {
  return listDelegationJobsSince(db, input).map((job) => {
    const isReply = isDeliveryJobKind(job.jobKind)
    return {
      jobId: job.id,
      direction: isReply ? ('reply' as const) : ('ask' as const),
      fromSessionId: job.parentSessionId,
      toSessionId: job.targetPrimarySessionId,
      fromWorkspaceId: isReply
        ? senderWorkspaceOfReply(db, input.userId, job)
        : job.requesterWorkspaceId,
      toWorkspaceId: job.workspaceId,
      at: job.createdAt.toISOString(),
    }
  })
}
