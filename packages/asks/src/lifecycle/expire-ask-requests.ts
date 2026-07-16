// Core op — mark pending asks `expired`, in two modes:
//   - BOOT RECOVERY (no askIds): every pending row process-wide. The waiter
//     registry died with the previous process, so a pending row is
//     unanswerable — expiring it keeps the UI from showing a zombie wizard
//     (the approvals recover-stale precedent).
//   - SCOPE CANCEL (askIds given): the rows whose waiters a turn's `finally`
//     just cancelled (interrupt/disconnect while an ask was open).
// Each expiry co-commits its `ask.resolved` event in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as asksRepository from '../repositories/index.js'
import { ASK_RESOLVED, type AskResolvedPayload } from '../asks-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../asks-types.js'

export function expireAskRequests(
  db: Database,
  input: { askIds?: readonly string[] } = {},
  deps: { logger?: StructuralLogger } = {},
): { expiredCount: number } {
  const pending =
    input.askIds !== undefined
      ? input.askIds
          .map((askId) => asksRepository.findAskRequestById(db, askId))
          .filter((ask) => ask !== null && ask.status === 'pending')
      : asksRepository.listAllPendingAskRequests(db)

  const now = new Date()
  let expiredCount = 0
  withTransaction(db, (tx) => {
    for (const ask of pending) {
      if (!ask) continue
      asksRepository.updateAskRequest(tx, ask.id, { status: 'expired', resolvedAt: now })
      const payload: AskResolvedPayload = {
        askId: ask.id,
        userId: ask.userId,
        workspaceId: ask.workspaceId,
        status: 'expired',
        resolvedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: ASK_RESOLVED,
        payload,
        createdAt: now,
        processedAt: null,
      })
      expiredCount += 1
    }
  })

  if (expiredCount > 0) deps.logger?.info({ expiredCount }, 'pending asks expired')
  return { expiredCount }
}
