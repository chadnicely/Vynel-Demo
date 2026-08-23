// The sessions-overview wire vocabulary (`GET /sessions/overview`) — the
// unified cross-scope session list the Sessions panel renders and the
// session-library `list_sessions` tool re-exposes (Slice ④ of the arc). One
// entry per CONVERSATION: a continuity chain (segments linked by
// `continuedFromSessionId`) collapses into a single entry whose identity is
// its newest segment — the user's mental model is one ongoing conversation,
// not a stack of "Continued conversation" rows. Dates are ISO strings on the
// wire. Live "working" status is deliberately NOT here — the activity feed is
// the one source of live truth; the UI marries the two.

import type { SessionStatusFacts } from './session-status.js'

export interface SessionsOverviewSegment {
  sessionId: string
  title: string
  startedAt: string
  lastMessageAt: string
  /** The segment's context occupancy when last active (null = never
   *  reported). For a superseded segment: the occupancy it forked at. */
  contextTokens: number | null
  continuedFromSessionId: string | null
  /** True for the segment a live primary conversation currently points at. */
  isCurrent: boolean
}

export interface SessionsOverviewEntry {
  /** The entry's open target — its newest segment's id. */
  sessionId: string
  /** The CONTINUING identity behind the chain (`primary_sessions.id`) — the
   *  same value the activity feed stamps as `primarySessionId`. It is how a
   *  live turn is matched to this entry BEFORE the turn resolves its session
   *  id: no reader has to infer identity from a null. Null when no live
   *  primary points at this chain's head (a superseded or orphaned chain). */
  primarySessionId: string | null
  scope: 'global' | 'workspace' | 'agent' | 'spawned' | 'voice'
  workspaceId: string | null
  workspaceName: string | null
  title: string
  /** The conversation's curated icon name (`session-icons.ts`) — resolved from
   *  the same segment the title comes from. Null (or a name a surface doesn't
   *  know) renders the monogram fallback. */
  icon: string | null
  model: string | null
  /** The newest segment's occupancy — the meter's numerator. */
  contextTokens: number | null
  /** `resolveContextWindow(model)` — the meter's denominator. */
  contextWindow: number
  lastMessageAt: string
  /** The durable status facts (Move 3) — feed `deriveSessionStatus` together
   *  with the activity feed's liveness for the conversation's status light. */
  statusFacts: SessionStatusFacts
  /** Ordered oldest → newest; length 1 for an unswapped conversation. */
  segments: SessionsOverviewSegment[]
}

/**
 * Which entries the Sessions library shows for a scope — the ONE definition,
 * shared by the view that renders the rows and the count that advertises them
 * in the menu. It lived only in `SessionsView.vue` until the menu's
 * `Sessions N` was derived separately and disagreed with it.
 *
 * A workspace shows its own conversations (its primary chain and the sessions
 * spawned in it — both carry the workspace id). Global shows only the root's
 * own children: the Assistant thread is the Chat nav, and a workspace's
 * conversations belong to its room.
 *
 * Entries, not rows: a continuity chain collapses into one entry, so this can
 * never be answered by counting `chat_sessions`.
 */
export function selectSessionsForScope(
  entries: SessionsOverviewEntry[],
  workspaceId: string | null,
): SessionsOverviewEntry[] {
  return entries.filter((entry) => isSessionInScope(entry, workspaceId))
}

/** The membership half of `selectSessionsForScope`, on the two fields that
 *  decide it — so the SERVER can page a scope densely (filter, then cap)
 *  without importing the whole composed entry. One predicate, three callers:
 *  the view's filter, the menu's count, and the paged read. */
export function isSessionInScope(
  entry: Pick<SessionsOverviewEntry, 'scope' | 'workspaceId'>,
  workspaceId: string | null,
): boolean {
  // The spoken thread belongs to ONE surface (the Voice chat area) and to no
  // list — it was excluded by accident before (the fold dropped it, so it
  // never reached this predicate), which is exactly why a failed voice turn
  // lit nothing anywhere. Now the fold admits it, the exclusion has to be
  // said out loud (session-hardening D2).
  if (entry.scope === 'voice') return false
  return workspaceId !== null
    ? entry.workspaceId === workspaceId
    : entry.scope === 'spawned' && entry.workspaceId === null
}
