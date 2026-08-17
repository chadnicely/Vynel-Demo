// `getSessionsOverview` — the unified cross-scope session list (session-library
// Slice ③). Composes chat's rows with the primaries' liveness pointers, folds
// continuity chains (segments linked by `continuedFromSessionId`) into single
// entries, and surfaces the deliberately-hidden global brain as the "Assistant"
// entry (Chad's fork B: the root's own chain is the best demo of continuity).
// Session-tier composition — the one home both the Sessions panel route and
// the Slice-④ `list_sessions` tool read, so the user and the planning root
// always see the SAME numbers.

import type { Database } from '@vynel/db'
import { resolveContextWindow } from '@vynel/contracts/chat/model-context-window'
import {
  isSessionInScope,
  type SessionsOverviewEntry,
  type SessionsOverviewSegment,
} from '@vynel/contracts/chat/sessions-overview'
import type { SessionStatusFacts } from '@vynel/contracts/chat/session-status'
import { findSessionStatusMessageFacts } from '@vynel/chat/repositories'
import { listPendingApprovalsForUser } from '@vynel/approvals'
import { listPendingAsks } from '@vynel/asks'
import { findWorkspaceById } from '@vynel/workspaces'
import * as primarySessionsRepository from '../repositories/index.js'
import { foldSessionChains } from './fold-session-chains.js'

export type GetSessionsOverviewInput = {
  userId: string
  limit?: number
  /** How many entries to skip — the infinite-scroll cursor. The sort is
   *  stable (`lastMessageAt` desc), so offset paging is safe here; a
   *  conversation that speaks mid-scroll can shift one row across a page
   *  boundary, which is the accepted cost of not carrying a cursor. */
  offset?: number
  /** Curate to ONE scope before capping, so a page is dense: a workspace id
   *  for that room's conversations, `null` for the global library (the root's
   *  own spawned children). Omit for every scope — what the app-wide status
   *  read wants. Shares its predicate with the view and the menu count. */
  scope?: { workspaceId: string | null }
}

const DEFAULT_ENTRY_LIMIT = 50
// Raised from 100 with paging (2026-08-17): the library scrolls, so a caller
// that wants a big first page can ask for one instead of being silently cut.
const MAX_ENTRY_LIMIT = 200

export function getSessionsOverview(
  db: Database,
  input: GetSessionsOverviewInput,
): SessionsOverviewEntry[] {
  const primaries = primarySessionsRepository.listPrimarySessionsForUser(db, input.userId)
  const currentSdkSessionIds = new Set(
    primaries
      .map((primary) => primary.currentSdkSessionId)
      .filter((sessionId): sessionId is string => sessionId !== null),
  )

  // Pending approvals per SDK session id — ONE user-wide query (already how
  // the global queue reads), grouped here; an entry counts every pending card
  // across its chain's segments. Session ids on approval rows are always
  // correct (unlike their workspaceId — the recorded spawned-approvals gap),
  // which is exactly why the per-session status can ship before that fix.
  const pendingApprovalCountBySessionId = new Map<string, number>()
  for (const approval of listPendingApprovalsForUser(db, input.userId)) {
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
  for (const ask of listPendingAsks(db, { userId: input.userId })) {
    if (ask.sessionId === null) continue
    pendingAskCountBySessionId.set(
      ask.sessionId,
      (pendingAskCountBySessionId.get(ask.sessionId) ?? 0) + 1,
    )
  }

  const workspaceNameById = new Map<string, string | null>()
  function workspaceNameFor(workspaceId: string | null): string | null {
    if (workspaceId === null) return null
    if (!workspaceNameById.has(workspaceId)) {
      workspaceNameById.set(workspaceId, findWorkspaceById(db, workspaceId)?.name ?? null)
    }
    return workspaceNameById.get(workspaceId) ?? null
  }

  // Fold every chain first (cheap, in-memory, newest-first), then curate, then
  // page, then compose the per-entry status facts for the survivors only.
  const folded = foldSessionChains(db, input.userId)

  // Curate FIRST when a scope was asked for, so a page is dense: filtering
  // after the cap would hand back a page of 50 that yields three rows for the
  // drilled room, and infinite scroll would look broken.
  const inScope =
    input.scope === undefined
      ? folded
      : folded.filter((chain) => isSessionInScope(chain.tail, input.scope!.workspaceId))

  // Sort + CAP before composing per-entry status facts: the row fetch spans up
  // to 500 chains while the answer is one page, so composing first meant ~950
  // discarded statements on a read the whole app polls (AppShell holds it
  // open; every turn boundary invalidates it).
  const cap = Math.min(input.limit ?? DEFAULT_ENTRY_LIMIT, MAX_ENTRY_LIMIT)
  const offset = Math.max(input.offset ?? 0, 0)
  const visible = inScope.slice(offset, offset + cap)

  const entries: SessionsOverviewEntry[] = []
  for (const { tail, chain, title, model } of visible) {
    // The durable status facts (Move 3), all CONVERSATION-scoped: the
    // assistant-set trio rides the tail (copy-forward keeps it there across
    // swaps), while the message facts and the approval count span the whole
    // chain. Asking the tail alone for messages was the swap bug — a fresh
    // segment has none, so "the user never spoke" resurrected every
    // superseded status and hid an error a mid-turn swap left behind.
    // Derivation stays in ONE home (`deriveSessionStatus`, contracts);
    // liveness is the activity feed's, married client-side.
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
        (count, segmentId) => count + (pendingApprovalCountBySessionId.get(segmentId) ?? 0),
        0,
      ),
      pendingAskCount: segmentIds.reduce(
        (count, segmentId) => count + (pendingAskCountBySessionId.get(segmentId) ?? 0),
        0,
      ),
      latestUserMessageAt: messageFacts.latestUserMessageAt?.toISOString() ?? null,
    }

    entries.push({
      sessionId: tail.id,
      scope: tail.scope,
      workspaceId: tail.workspaceId,
      workspaceName: workspaceNameFor(tail.workspaceId),
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
          isCurrent: currentSdkSessionIds.has(segment.id),
        }),
      ),
    })
  }

  return entries
}

/**
 * How many conversations a scope holds — the menu badge's read, and the number
 * the library's "showing N of M" would use.
 *
 * A real total, not a page length: the badge used to be
 * `getSessionsOverview(...).length`, which meant it inherited the list's cap
 * and quietly stopped counting at 50 alongside a list that stopped showing at
 * 50. Now that the list scrolls, that would have been a badge frozen at the
 * first page.
 *
 * Shares `foldSessionChains` and `isSessionInScope` with the list, so the two
 * still agree on what one conversation is — the invariant the whole
 * section-counts arc rests on. Deliberately skips the per-entry composition
 * (status facts, approval/ask counts, workspace names): a count needs
 * membership, not contents.
 */
export function countSessionsOverview(
  db: Database,
  input: { userId: string; scope?: { workspaceId: string | null } },
): number {
  const folded = foldSessionChains(db, input.userId)
  return input.scope === undefined
    ? folded.length
    : folded.filter((chain) => isSessionInScope(chain.tail, input.scope!.workspaceId)).length
}
