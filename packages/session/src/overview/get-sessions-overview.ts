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
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from '@vynel/contracts/chat/sessions-overview'
import type { SessionStatusFacts } from '@vynel/contracts/chat/session-status'
import {
  listAllChatSessionsForUser,
  findSessionStatusMessageFacts,
  type ChatSession,
} from '@vynel/chat/repositories'
import { listPendingApprovalsForUser } from '@vynel/approvals'
import { findWorkspaceById } from '@vynel/workspaces'
import * as primarySessionsRepository from '../repositories/index.js'

export type GetSessionsOverviewInput = {
  userId: string
  limit?: number
}

const DEFAULT_ENTRY_LIMIT = 50
const MAX_ENTRY_LIMIT = 100

// Fork B: the global brain's rows are all `hidden` with fixed internal titles
// ("Global brain" / "Continued conversation") — the entry the USER sees is the
// assistant itself.
const ASSISTANT_ENTRY_TITLE = 'Assistant'
// The swap segment's stock title — never a useful ENTRY title; chains prefer
// their newest listed segment's real title over it.
const SWAP_SEGMENT_TITLE = 'Continued conversation'

export function getSessionsOverview(
  db: Database,
  input: GetSessionsOverviewInput,
): SessionsOverviewEntry[] {
  const rows = listAllChatSessionsForUser(db, { userId: input.userId })
  const primaries = primarySessionsRepository.listPrimarySessionsForUser(db, input.userId)
  const currentSdkSessionIds = new Set(
    primaries
      .map((primary) => primary.currentSdkSessionId)
      .filter((sessionId): sessionId is string => sessionId !== null),
  )

  // Chain fold: child-of links → walk each head to its tail. A parent outside
  // the fetched window (pruned/purged predecessor) makes its child a head —
  // the chain renders from what still exists.
  const rowIds = new Set(rows.map((row) => row.id))
  const childByParentId = new Map<string, ChatSession>()
  for (const row of rows) {
    if (row.continuedFromSessionId !== null && rowIds.has(row.continuedFromSessionId)) {
      // Rows iterate newest-first, so first-write-wins keeps the NEWEST child
      // when corruption gives one parent two claimants (a crashed double
      // swap) — the newer child is the live segment; the older one drops.
      if (!childByParentId.has(row.continuedFromSessionId)) {
        childByParentId.set(row.continuedFromSessionId, row)
      }
    }
  }
  const heads = rows.filter(
    (row) =>
      row.continuedFromSessionId === null || !rowIds.has(row.continuedFromSessionId),
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

  const workspaceNameById = new Map<string, string | null>()
  function workspaceNameFor(workspaceId: string | null): string | null {
    if (workspaceId === null) return null
    if (!workspaceNameById.has(workspaceId)) {
      workspaceNameById.set(workspaceId, findWorkspaceById(db, workspaceId)?.name ?? null)
    }
    return workspaceNameById.get(workspaceId) ?? null
  }

  // Fold every chain first (cheap, in-memory), then cap, then compose the
  // per-entry status facts for the survivors only (see the slice below).
  const folded: Array<{
    tail: ChatSession
    chain: ChatSession[]
    title: string
    model: string | null
  }> = []
  for (const head of heads) {
    const chain: ChatSession[] = []
    for (
      let segment: ChatSession | undefined = head;
      segment !== undefined;
      segment = childByParentId.get(segment.id)
    ) {
      chain.push(segment)
    }
    const tail = chain[chain.length - 1]!

    // A workspace/agent chain that is hidden END TO END has no user-facing
    // doorway (the global brain is the deliberate exception — fork B).
    const hasListedSegment = chain.some((segment) => segment.visibility === 'listed')
    if (tail.scope !== 'global' && !hasListedSegment) continue

    const title =
      tail.scope === 'global'
        ? ASSISTANT_ENTRY_TITLE
        : ([...chain]
            .reverse()
            .find(
              (segment) => segment.visibility === 'listed' && segment.title !== SWAP_SEGMENT_TITLE,
            )?.title ??
          tail.title)

    // A fresh swap segment reports no model until its first turn — the chain's
    // last-known model keeps the meter's denominator honest across the swap.
    const model =
      tail.model ?? [...chain].reverse().find((segment) => segment.model !== null)?.model ?? null

    folded.push({ tail, chain, title, model })
  }

  // Sort + CAP before composing per-entry status facts: the row fetch spans up
  // to 500 chains while the answer is 50, so composing first meant ~950
  // discarded statements on a read the whole app now polls (AppShell holds it
  // open; every turn boundary invalidates it).
  const cap = Math.min(input.limit ?? DEFAULT_ENTRY_LIMIT, MAX_ENTRY_LIMIT)
  const visible = folded
    .sort((a, b) => (a.tail.lastMessageAt < b.tail.lastMessageAt ? 1 : -1))
    .slice(0, cap)

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
