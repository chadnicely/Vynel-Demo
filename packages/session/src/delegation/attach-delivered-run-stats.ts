// Enriches DELIVERED colleague rows (a report/update/direct message landing in
// the requester's thread) with the PRODUCING run's stats — the info-icon hover
// card: which model ran, how many tool calls, tokens, and how long it took.
// `attachDelegationTaskLabels`' sibling: the row's `partialSessionId` names the
// DELIVERY hop; the stats live on the chain's WORK hop (the colleague's actual
// run) and its message trace.
//
// Lives HERE because it composes chat rows with orchestration jobs (the
// delegation-lift home). Loose-ref serve-time read — no schema change.

import type { Database } from "@vynel/db";
import {
  findDelegationJobByPartialSessionId,
  listDelegationJobsByThread,
  isWorkJobKind,
  resolveThreadIdOf,
} from "@vynel/orchestration";
import {
  listChatMessagesByPartialSessionId,
  listChatToolCallsForMessage,
  findChatSessionById,
  findPriorContextOccupancy,
} from "@vynel/chat/repositories";
import type { DeliveredRunStatsResponse } from "@vynel/contracts/chat/chat-http";

function resolveRunStats(
  db: Database,
  deliveryKey: string,
): DeliveredRunStatsResponse | null {
  const delivery = findDelegationJobByPartialSessionId(db, deliveryKey);
  if (delivery === null) return null;
  const threadId = resolveThreadIdOf(delivery);
  if (threadId === null) return null;
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
    .at(-1);
  if (work === undefined || work.partialSessionId === null) return null;

  let toolCallCount = 0;
  let contextTokens: number | null = null;
  let outputTokens = 0;
  let hasOutput = false;
  let model = work.model;
  let firstUsageRow: { sessionId: string; startedAt: Date } | null = null;
  let lastUsageSessionId: string | null = null;
  for (const row of listChatMessagesByPartialSessionId(
    db,
    work.partialSessionId,
  )) {
    if (row.role !== "assistant") continue;
    toolCallCount += listChatToolCallsForMessage(db, row.id).length;
    // A row's inputTokens is the request's WHOLE context occupancy (see the
    // chat_messages column note) — the run ENDS at the last row's value, and
    // "what it added" is that minus the session's occupancy before it.
    // Output is per-generation fresh tokens: summing is correct.
    if (row.inputTokens !== null) {
      contextTokens = row.inputTokens;
      firstUsageRow ??= { sessionId: row.sessionId, startedAt: row.startedAt };
      lastUsageSessionId = row.sessionId;
    }
    if (row.outputTokens !== null) {
      outputTokens += row.outputTokens;
      hasOutput = true;
    }
    // No override on the job — the run used its session's model.
    if (model === null)
      model = findChatSessionById(db, row.sessionId)?.model ?? null;
  }

  // The fresh-input delta: final occupancy minus the pre-run baseline. Not
  // derivable when occupancy SHRANK (a compaction swap mid-run) or when the
  // run spans SEGMENTS (final occupancy and baseline live in different
  // sessions — the subtraction would be confidently wrong, the reviewer's
  // climb-back case); the context row still tells the story.
  let inputTokens: number | null = null;
  if (
    contextTokens !== null &&
    firstUsageRow !== null &&
    lastUsageSessionId === firstUsageRow.sessionId
  ) {
    const baseline =
      findPriorContextOccupancy(
        db,
        firstUsageRow.sessionId,
        firstUsageRow.startedAt,
      ) ?? 0;
    inputTokens = contextTokens >= baseline ? contextTokens - baseline : null;
  }

  const finishedAt = work.reportedAt ?? work.completedAt;
  return {
    model,
    toolCallCount,
    inputTokens,
    outputTokens: hasOutput ? outputTokens : null,
    contextTokens,
    durationMs:
      work.claimedAt !== null && finishedAt !== null
        ? Math.max(0, finishedAt.getTime() - work.claimedAt.getTime())
        : null,
  };
}

export function attachDeliveredRunStats<
  TMessage extends {
    role: string;
    sourceKind?: string | null;
    partialSessionId?: string | null;
  },
>(
  db: Database,
  messages: TMessage[],
): (TMessage & { runStats?: DeliveredRunStatsResponse })[] {
  // Several rows can share one delivery key (marker row + replies) — resolve
  // each key once per read.
  const cache = new Map<string, DeliveredRunStatsResponse | null>();
  return messages.map((message) => {
    const isDelivered =
      message.role === "user" &&
      (message.sourceKind === "agent" ||
        message.sourceKind === "workspace-manager") &&
      message.partialSessionId != null;
    if (!isDelivered) return message;
    const key = message.partialSessionId!;
    let stats = cache.get(key);
    if (stats === undefined) {
      stats = resolveRunStats(db, key);
      cache.set(key, stats);
    }
    return stats === null ? message : { ...message, runStats: stats };
  });
}
