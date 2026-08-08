// Enriches DELIVERED colleague rows (a report/update/direct message landing in
// the requester's thread) with the PRODUCING run's stats — the info-icon hover
// card: which model ran, how many tool calls, tokens, and how long it took.
// `attachDelegationTaskLabels`' sibling: the row's `partialSessionId` names the
// DELIVERY hop; the stats live on the chain's WORK hop (the colleague's actual
// run) and its message trace.
//
// Lives HERE because it composes chat rows with orchestration jobs (the
// delegation-lift home). Loose-ref serve-time read — no schema change.

import type { Database } from '@vynel/db'
import {
  findDelegationJobByPartialSessionId,
  listDelegationJobsByThread,
  isWorkJobKind,
  resolveThreadIdOf,
} from '@vynel/orchestration'
import {
  listChatMessagesByPartialSessionId,
  listChatToolCallsForMessage,
  findChatSessionById,
} from '@vynel/chat/repositories'
import type { DeliveredRunStatsResponse } from '@vynel/contracts/chat/chat-http'

function resolveRunStats(
  db: Database,
  deliveryKey: string,
): DeliveredRunStatsResponse | null {
  const delivery = findDelegationJobByPartialSessionId(db, deliveryKey)
  if (delivery === null) return null
  const threadId = resolveThreadIdOf(delivery)
  if (threadId === null) return null
  // The producing run: the LATEST work hop enqueued before this delivery —
  // a continued colleague chain holds one work hop per task, and each
  // delivery reports for the one just before it (the chain is oldest-first).
  const work = listDelegationJobsByThread(db, {
    userId: delivery.userId,
    threadId,
    unbounded: true,
  })
    .filter(
      (job) =>
        isWorkJobKind(job.jobKind) &&
        job.createdAt.getTime() <= delivery.createdAt.getTime(),
    )
    .at(-1)
  if (work === undefined || work.partialSessionId === null) return null

  let toolCallCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let hasTokens = false
  let model = work.model
  for (const row of listChatMessagesByPartialSessionId(db, work.partialSessionId)) {
    if (row.role !== 'assistant') continue
    toolCallCount += listChatToolCallsForMessage(db, row.id).length
    if (row.inputTokens !== null) {
      inputTokens += row.inputTokens
      hasTokens = true
    }
    if (row.outputTokens !== null) {
      outputTokens += row.outputTokens
      hasTokens = true
    }
    // No override on the job — the run used its session's model.
    if (model === null) model = findChatSessionById(db, row.sessionId)?.model ?? null
  }

  const finishedAt = work.reportedAt ?? work.completedAt
  return {
    model,
    toolCallCount,
    inputTokens: hasTokens ? inputTokens : null,
    outputTokens: hasTokens ? outputTokens : null,
    durationMs:
      work.claimedAt !== null && finishedAt !== null
        ? Math.max(0, finishedAt.getTime() - work.claimedAt.getTime())
        : null,
  }
}

export function attachDeliveredRunStats<
  TMessage extends {
    role: string
    sourceKind?: string | null
    partialSessionId?: string | null
  },
>(
  db: Database,
  messages: TMessage[],
): (TMessage & { runStats?: DeliveredRunStatsResponse })[] {
  // Several rows can share one delivery key (marker row + replies) — resolve
  // each key once per read.
  const cache = new Map<string, DeliveredRunStatsResponse | null>()
  return messages.map((message) => {
    const isDelivered =
      message.role === 'user' &&
      (message.sourceKind === 'agent' || message.sourceKind === 'workspace-manager') &&
      message.partialSessionId != null
    if (!isDelivered) return message
    const key = message.partialSessionId!
    let stats = cache.get(key)
    if (stats === undefined) {
      stats = resolveRunStats(db, key)
      cache.set(key, stats)
    }
    return stats === null ? message : { ...message, runStats: stats }
  })
}
