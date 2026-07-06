// `recordPushedReportMessage` — pushes ONE attributed report onto the GLOBAL root's
// session (brain-tree Chapter 1, async core). When a background delegation completes,
// the workspace manager's report is pushed UP onto the global root's transcript so it
// surfaces in /global on reload, attributed 'workspace-manager' + the workspace name
// ("Acme: …") — the same source identity the routed turn's live rows carry (the
// shared pipeline's `messageAttribution`).
//
// Two differences from the workspace-side rows (which the shared pipeline persists
// live on the WORKSPACE root's session as the turn streams):
//   1. It writes the GLOBAL root's CURRENT session — re-resolved at push time by the
//      caller (the root may have compaction-swapped between enqueue and completion;
//      pushing onto the live segment keeps the report in chronological order).
//   2. That row may not exist (the user never opened /global, or a race), so we
//      FK-id-gate: insert ONLY if the session row is present, else return false. A
//      pushed report must NEVER mint a global-root session — the inverse of the
//      create-on-missing turn precedent.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import * as chatRepository from '../repositories/index.js'
import { composeManagerSourceLabel } from './compose-manager-source-label.js'

export type RecordPushedReportMessageInput = {
  /** The global root's CURRENT SDK session id (re-resolved at push time) — the FK target. */
  globalRootSessionId: string
  /** The workspace manager's report — the pushed message body. */
  body: string
  /** The workspace name — the message's `sourceLabel` base. */
  workspaceName: string
  /** The workspace manager's persona name (brain-tree Ch5) — composes the label
   *  "Mark · vynel". Absent → just the workspace name (the pre-persona behavior). */
  managerName?: string
  /** The delegation request's correlation key (brain-tree Chapter 2) — ties this
   *  pushed report to its workspace-side chain. Absent → null (additive). */
  partialSessionId?: string
}

/** Push one attributed `workspace-manager` report onto the global root's session.
 *  Returns false (no insert) when that session row is missing — the caller logs the
 *  skip; a pushed report never creates a global-root session. */
export function recordPushedReportMessage(
  db: Database,
  input: RecordPushedReportMessageInput,
): boolean {
  if (chatRepository.findChatSessionById(db, input.globalRootSessionId) === null) {
    return false
  }
  const now = new Date()
  chatRepository.insertChatMessage(db, {
    id: randomUUID(),
    sessionId: input.globalRootSessionId,
    role: 'assistant',
    body: input.body,
    sourceKind: 'workspace-manager',
    sourceLabel: composeManagerSourceLabel(input.workspaceName, input.managerName),
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
  return true
}
