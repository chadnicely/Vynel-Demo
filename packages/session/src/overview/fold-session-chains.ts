// Folding continuity chains into the entries the app calls "conversations".
//
// Extracted from `get-sessions-overview.ts` when the library gained paging
// (2026-08-17): the paged read and the menu's count must agree on what ONE
// conversation is, and a chain is why no `chat_sessions` row count can ever
// answer that. Cheap and in-memory — the expensive per-entry composition
// (status facts, approval/ask counts, workspace names) stays in the caller,
// which runs it only for the page it is about to return.

import type { Database } from '@vynel/db'
import { listAllChatSessionsForUser, type ChatSession } from '@vynel/chat/repositories'

// Fork B: the global brain's rows are all `hidden` with fixed internal titles
// ("Global brain" / "Continued conversation") — the entry the USER sees is the
// assistant itself.
const ASSISTANT_ENTRY_TITLE = 'Assistant'
// The swap segment's stock title — never a useful ENTRY title; chains prefer
// their newest listed segment's real title over it.
const SWAP_SEGMENT_TITLE = 'Continued conversation'

/** One conversation: its newest segment, the whole chain behind it, and the
 *  two fields the fold has to reach back through the chain to answer. */
export type FoldedSessionChain = {
  tail: ChatSession
  chain: ChatSession[]
  title: string
  /** The identity segment's curated icon — resolved from the SAME segment the
   *  title comes from, so name and face can never disagree across a swap. */
  icon: string | null
  model: string | null
}

/** Every conversation the user owns, newest-spoken first. The sort lives here
 *  so a caller can page or count without re-deciding the order. */
export function foldSessionChains(db: Database, userId: string): FoldedSessionChain[] {
  const rows = listAllChatSessionsForUser(db, { userId })

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
    (row) => row.continuedFromSessionId === null || !rowIds.has(row.continuedFromSessionId),
  )

  const folded: FoldedSessionChain[] = []
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
    // doorway. Global is the deliberate exception (fork B); VOICE joined it
    // (session-hardening D2) — its segments are born hidden too, and while
    // the fold dropped them the spoken thread had no status facts at all, so
    // a FAILED voice turn lit `problem` nowhere in the app. Admitting the
    // chain gives it facts; who may SEE it is `isSessionInScope`'s job.
    const hasListedSegment = chain.some((segment) => segment.visibility === 'listed')
    if (tail.scope !== 'global' && tail.scope !== 'voice' && !hasListedSegment) continue

    // The identity segment: the newest listed segment still wearing a real
    // title. It answers BOTH name questions — swap segments are born with the
    // stock title and no icon, so the fold reaches back once for the pair.
    const namedSegment =
      tail.scope === 'global'
        ? undefined
        : [...chain]
            .reverse()
            .find(
              (segment) =>
                segment.visibility === 'listed' && segment.title !== SWAP_SEGMENT_TITLE,
            )
    const title =
      tail.scope === 'global' ? ASSISTANT_ENTRY_TITLE : (namedSegment?.title ?? tail.title)
    const icon =
      tail.scope === 'global' ? null : namedSegment !== undefined ? namedSegment.icon : tail.icon

    // A fresh swap segment reports no model until its first turn — the chain's
    // last-known model keeps the meter's denominator honest across the swap.
    const model =
      tail.model ?? [...chain].reverse().find((segment) => segment.model !== null)?.model ?? null

    folded.push({ tail, chain, title, icon, model })
  }

  return folded.sort((a, b) => (a.tail.lastMessageAt < b.tail.lastMessageAt ? 1 : -1))
}
