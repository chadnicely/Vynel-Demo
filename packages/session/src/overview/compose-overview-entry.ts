// Composing ONE folded chain into the `SessionsOverviewEntry` the app renders.
//
// Extracted from `get-sessions-overview.ts` (session-hardening D2) when the
// voice thread gained a status of its own: the Voice chat surface reads a
// SINGLE entry through its own door, and it must be the same entry — same
// status facts, same context numbers — as any conversation in the list. One
// composition, two callers.
//
// The per-user lookups (approval/ask queues, workspace names, live primaries)
// are gathered once into a context so a page of 50 entries costs one pass, not
// 50 (`get-sessions-overview.ts` composes only the page it is about to return).

import type { Database } from '@vynel/db'
import { resolveContextWindow } from '@vynel/contracts/chat/model-context-window'
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from '@vynel/contracts/chat/sessions-overview'
import type { SessionStatusFacts } from '@vynel/contracts/chat/session-status'
import { findSessionStatusMessageFacts } from '@vynel/chat/repositories'
import { listPendingApprovalsForUser } from '@vynel/approvals'
import { listPendingAsks } from '@vynel/asks'
import { findWorkspaceById } from '@vynel/workspaces'
import * as primarySessionsRepository from '../repositories/index.js'
import type { FoldedSessionChain } from './fold-session-chains.js'

/** The per-user reads every entry shares, gathered once. */
export type OverviewEntryContext = {
  /** Session ids a live primary currently points at — the `isCurrent` flag. */
  currentSdkSessionIds: Set<string>
  /** Head session id → the primary that points at it — the entry's identity
   *  on the wire, and how a live turn is matched before it resolves its own
   *  session id. */
  primaryIdByCurrentSessionId: Map<string, string>
  pendingApprovalCountBySessionId: Map<string, number>
  pendingAskCountBySessionId: Map<string, number>
  workspaceNameById: Map<string, string | null>
}

export function buildOverviewEntryContext(db: Database, userId: string): OverviewEntryContext {
  const primaries = primarySessionsRepository.listPrimarySessionsForUser(db, userId)
  const currentSdkSessionIds = new Set<string>()
  const primaryIdByCurrentSessionId = new Map<string, string>()
  for (const primary of primaries) {
    if (primary.currentSdkSessionId === null) continue
    currentSdkSessionIds.add(primary.currentSdkSessionId)
    primaryIdByCurrentSessionId.set(primary.currentSdkSessionId, primary.id)
  }

  // Pending approvals per SDK session id — ONE user-wide query (already how
  // the global queue reads), grouped here; an entry counts every pending card
  // across its chain's segments. Session ids on approval rows are always
  // correct (unlike their workspaceId — the recorded spawned-approvals gap),
  // which is exactly why the per-session status can ship before that fix.
  const pendingApprovalCountBySessionId = new Map<string, number>()
  for (const approval of listPendingApprovalsForUser(db, userId)) {
    pendingApprovalCountBySessionId.set(
      approval.sessionId,
      (pendingApprovalCountBySessionId.get(approval.sessionId) ?? 0) + 1,
    )
  }

  // Pending `ask_user` forms, read the same way. Both queues mean "waiting on
  // you", and a turn parked on either is still LIVE on the activity feed — so
  // without this the conversation rendered "working" while it sat on a form
  // nobody had told the user about. The row's session id is nullable (a
  // channel-driven global turn may have no watching conversation); those rows
  // simply never match a segment.
  const pendingAskCountBySessionId = new Map<string, number>()
  for (const ask of listPendingAsks(db, { userId })) {
    if (ask.sessionId === null) continue
    pendingAskCountBySessionId.set(
      ask.sessionId,
      (pendingAskCountBySessionId.get(ask.sessionId) ?? 0) + 1,
    )
  }

  return {
    currentSdkSessionIds,
    primaryIdByCurrentSessionId,
    pendingApprovalCountBySessionId,
    pendingAskCountBySessionId,
    workspaceNameById: new Map(),
  }
}

export function composeOverviewEntry(
  db: Database,
  context: OverviewEntryContext,
  folded: FoldedSessionChain,
): SessionsOverviewEntry {
  const { tail, chain, title, model } = folded
  // The durable status facts (Move 3), all CONVERSATION-scoped: the
  // assistant-set trio rides the tail (copy-forward keeps it there across
  // swaps), while the message facts and the approval count span the whole
  // chain. Asking the tail alone for messages was the swap bug — a fresh
  // segment has none, so "the user never spoke" resurrected every superseded
  // status and hid an error a mid-turn swap left behind. Derivation stays in
  // ONE home (`deriveSessionStatus`, contracts); liveness is the activity
  // feed's, married client-side.
  const segmentIds = chain.map((segment) => segment.id)
  const messageFacts = findSessionStatusMessageFacts(db, segmentIds)
  const statusFacts: SessionStatusFacts = {
    setStatus: tail.status,
    statusNote: tail.statusNote,
    statusSetAt: tail.statusSetAt?.toISOString() ?? null,
    lastError:
      messageFacts.lastAssistantError === null
        ? null
        : {
            code: messageFacts.lastAssistantError.code,
            message: messageFacts.lastAssistantError.message,
            at: messageFacts.lastAssistantError.at.toISOString(),
          },
    pendingApprovalCount: segmentIds.reduce(
      (count, segmentId) => count + (context.pendingApprovalCountBySessionId.get(segmentId) ?? 0),
      0,
    ),
    pendingAskCount: segmentIds.reduce(
      (count, segmentId) => count + (context.pendingAskCountBySessionId.get(segmentId) ?? 0),
      0,
    ),
    latestUserMessageAt: messageFacts.latestUserMessageAt?.toISOString() ?? null,
  }

  return {
    sessionId: tail.id,
    primarySessionId: context.primaryIdByCurrentSessionId.get(tail.id) ?? null,
    scope: tail.scope,
    workspaceId: tail.workspaceId,
    workspaceName: workspaceNameFor(db, context, tail.workspaceId),
    title,
    model,
    contextTokens: tail.lastContextTokens,
    contextWindow: resolveContextWindow(model),
    lastMessageAt: tail.lastMessageAt.toISOString(),
    statusFacts,
    segments: chain.map(
      (segment): SessionsOverviewSegment => ({
        sessionId: segment.id,
        title: segment.title,
        startedAt: segment.startedAt.toISOString(),
        lastMessageAt: segment.lastMessageAt.toISOString(),
        contextTokens: segment.lastContextTokens,
        continuedFromSessionId: segment.continuedFromSessionId,
        isCurrent: context.currentSdkSessionIds.has(segment.id),
      }),
    ),
  }
}

function workspaceNameFor(
  db: Database,
  context: OverviewEntryContext,
  workspaceId: string | null,
): string | null {
  if (workspaceId === null) return null
  if (!context.workspaceNameById.has(workspaceId)) {
    context.workspaceNameById.set(workspaceId, findWorkspaceById(db, workspaceId)?.name ?? null)
  }
  return context.workspaceNameById.get(workspaceId) ?? null
}
