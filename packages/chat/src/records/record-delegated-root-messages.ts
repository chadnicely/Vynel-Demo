// `recordDelegatedRootMessages` — persists a WORKSPACE-ROOT delegation turn's two
// messages to `chat_messages` (brain-tree Phase 1). When the global root routes a
// task into a workspace's brain (`delegateToWorkspaceRoot`), the turn is drained
// synchronously (no live stream to feed the streaming persister), so the task +
// result are persisted here AFTER the drain — keyed by the workspace root's session
// id, attributed by source identity:
//   - the TASK is attributed 'global-root' (the head delegated it — it appears in
//     the workspace transcript as an incoming request, distinct from the user's own
//     `sourceKind:'user'` messages),
//   - the RESULT is attributed 'workspace-manager' with `sourceLabel` = the
//     workspace name, so the bubbled report reads "Acme: …" wherever it surfaces.
//
// The chat side of the delegation: `chat` owns `chat_messages`, so the INSERT lives
// here (apps/api orchestrates; it never writes chat's tables). The session row (FK
// target) is recorded by the composition before this runs (the swap-segment row, or
// an already-recorded resumed session).

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import * as chatRepository from '../repositories/index.js'
import { composeManagerSourceLabel } from './compose-manager-source-label.js'

export type RecordDelegatedRootMessagesInput = {
  /** The workspace root's SDK session id — the FK target (already recorded). */
  sessionId: string
  /** The task the global root delegated — persisted as the 'global-root' request. */
  taskText: string
  /** The workspace root's answer — persisted as the 'workspace-manager' reply. */
  resultText: string
  /** The workspace name — the reply's `sourceLabel` base. */
  workspaceName: string
  /** The workspace manager's persona name (brain-tree Ch5) — composes the reply label
   *  "Mark · vynel". Absent → just the workspace name (the pre-persona behavior). */
  managerName?: string
  /** The delegation request's correlation key (brain-tree Chapter 2) — stamped on
   *  both rows so the chain is queryable as one trace. Absent → null (additive). */
  partialSessionId?: string
}

export function recordDelegatedRootMessages(
  db: Database,
  input: RecordDelegatedRootMessagesInput,
): void {
  const now = new Date()
  // The reply is ordered 1ms after the task so the co-committed pair sorts
  // deterministically by `startedAt` in BOTH dialects (SQLite ties-break by rowid, but
  // Phase-2 Postgres would not guarantee task-before-reply on an identical instant). 1ms
  // is the `timestamp_ms` resolution floor — the smallest distinguishable step — and keeps
  // the trace read (`listChatMessagesByPartialSessionId`, ordered by `startedAt` only) free
  // of an id-tiebreak that a random-UUID `id` would scramble.
  const replyTime = new Date(now.getTime() + 1)

  // Co-commit the pair (the recordSwapSegmentSession convention) so a failure on the
  // reply never leaves an orphaned task row in the transcript.
  withTransaction(db, (tx) => {
    // The delegated task — an incoming request from the global root (the head), NOT
    // the workspace user's own typing. role 'user' (it IS the turn's prompt) but
    // sourceKind 'global-root' attributes the origin.
    chatRepository.insertChatMessage(tx, {
      id: randomUUID(),
      sessionId: input.sessionId,
      role: 'user',
      body: input.taskText,
      sourceKind: 'global-root',
      sourceLabel: null,
      partialSessionId: input.partialSessionId ?? null,
      thinkingBody: null,
      inputTokens: null,
      outputTokens: null,
      attachedImagesMetadata: null,
      errorCode: null,
      errorMessage: null,
      startedAt: now,
      completedAt: now,
      createdAt: now,
    })

    // The workspace root's reply — attributed as the workspace manager so the bubbled
    // report surfaces as "Acme: …". Skip an empty result (a read that produced no text).
    if (input.resultText !== '') {
      chatRepository.insertChatMessage(tx, {
        id: randomUUID(),
        sessionId: input.sessionId,
        role: 'assistant',
        body: input.resultText,
        sourceKind: 'workspace-manager',
        sourceLabel: composeManagerSourceLabel(input.workspaceName, input.managerName),
        partialSessionId: input.partialSessionId ?? null,
        thinkingBody: null,
        inputTokens: null,
        outputTokens: null,
        attachedImagesMetadata: null,
        errorCode: null,
        errorMessage: null,
        startedAt: replyTime,
        completedAt: replyTime,
        createdAt: now,
      })
    }
  })
}
