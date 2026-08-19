// `getSessionsOverview` — the unified cross-scope session list (session-library
// Slice ③). Composes chat's rows with the primaries' liveness pointers, folds
// continuity chains (segments linked by `continuedFromSessionId`) into single
// entries, and surfaces the deliberately-hidden global brain as the "Assistant"
// entry (Chad's fork B: the root's own chain is the best demo of continuity).
// Session-tier composition — the one home both the Sessions panel route and
// the Slice-④ `list_sessions` tool read, so the user and the planning root
// always see the SAME numbers.
//
// THE VOICE WALL: because `list_sessions` is this exact answer, the spoken
// thread never rides it — not even unscoped. The fold admits the voice chain
// so it HAS status facts (session-hardening D2), and this read drops it again
// before anything agent-visible sees it; the Voice chat surface reads its own
// entry through `getVoiceChatOverviewEntry`.

import type { Database } from '@vynel/db'
import {
  isSessionInScope,
  type SessionsOverviewEntry,
} from '@vynel/contracts/chat/sessions-overview'
import { foldSessionChains, type FoldedSessionChain } from './fold-session-chains.js'
import { buildOverviewEntryContext, composeOverviewEntry } from './compose-overview-entry.js'

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

/** Every chain this surface may show — the voice thread removed. */
function listableChains(db: Database, userId: string): FoldedSessionChain[] {
  return foldSessionChains(db, userId).filter((chain) => chain.tail.scope !== 'voice')
}

export function getSessionsOverview(
  db: Database,
  input: GetSessionsOverviewInput,
): SessionsOverviewEntry[] {
  // Fold every chain first (cheap, in-memory, newest-first), then curate, then
  // page, then compose the per-entry status facts for the survivors only.
  const folded = listableChains(db, input.userId)

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

  const context = buildOverviewEntryContext(db, input.userId)
  return visible.map((chain) => composeOverviewEntry(db, context, chain))
}

/**
 * The spoken thread as ONE overview entry — the Voice chat surface's own
 * status read (session-hardening D2). Its own door because the shared list is
 * `list_sessions`: the voice conversation stays behind the cross-session wall
 * while still wearing the same status mark every other conversation wears.
 *
 * Null until the first spoken turn creates the chain.
 */
export function getVoiceChatOverviewEntry(
  db: Database,
  input: { userId: string },
): SessionsOverviewEntry | null {
  const voiceChain = foldSessionChains(db, input.userId).find(
    (chain) => chain.tail.scope === 'voice',
  )
  if (voiceChain === undefined) return null
  return composeOverviewEntry(db, buildOverviewEntryContext(db, input.userId), voiceChain)
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
  const folded = listableChains(db, input.userId)
  return input.scope === undefined
    ? folded.length
    : folded.filter((chain) => isSessionInScope(chain.tail, input.scope!.workspaceId)).length
}
