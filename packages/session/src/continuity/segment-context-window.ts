// `resolveSegmentContextWindow` — the ONE reading of a segment's context-window
// DENOMINATOR (and of the model that grew it) for every continuity consumer:
// the boundary swap's pressure measurement and the fit guard's fallback. It
// answers from the row the consumer writes (`chat_sessions.lastContextWindow`,
// written beside `lastContextTokens` on every usage report — chosen model
// first, else the model that ran; see chat's `handle-usage-reported`), so a
// small-model visitor on a big-window chain never lowers what the chain is
// measured against; a row written before the column existed falls back to the
// window of the model that last ran it.
//
// A FRESH swap segment has neither (no usage yet, model NULL) — until its first
// report both readers used to fall to the 200k floor / the engine default. The
// fold already knew better (`overview/fold-session-chains.ts`: a chain's model
// is its newest KNOWN one); this replicates that rule for continuity without
// importing the overview: walk the segment's own predecessors (same owner,
// cycle-safe, capped) and take the newest segment that knows. Nothing known
// anywhere → the floor (`resolveContextWindow(null)`), model null.

import type { Database } from '@vynel/db'
import { findChatSessionById, type ChatSession } from '@vynel/chat/repositories'
import { resolveContextWindow } from '@vynel/contracts/chat/model-context-window'

export type SegmentContextWindow = {
  /** The denominator the segment's occupancy is measured against (tokens). */
  contextWindow: number
  /** The model that last ran on the segment — or, for a segment that has not
   *  run yet, on its chain. Null when no segment of the chain knows. */
  lastRanModel: string | null
}

// Defensive cap on the backward walk — a chain past this depth predates any
// readable window (the transcript resolver's own cap, in spirit).
const MAX_CHAIN_WALK = 200

function windowOf(row: ChatSession): number | null {
  if (row.lastContextWindow !== null) return row.lastContextWindow
  return row.model !== null ? resolveContextWindow(row.model) : null
}

export function resolveSegmentContextWindow(db: Database, sessionId: string): SegmentContextWindow {
  let contextWindow: number | null = null
  let lastRanModel: string | null = null
  const visited = new Set<string>()
  let row = findChatSessionById(db, sessionId)
  const owner = row?.userId ?? null
  // Newest first: the segment itself, then each predecessor — the first that
  // knows a value wins (the fold's newest-known rule).
  while (row !== null && row.userId === owner && !visited.has(row.id) && visited.size < MAX_CHAIN_WALK) {
    visited.add(row.id)
    contextWindow ??= windowOf(row)
    lastRanModel ??= row.model
    if (contextWindow !== null && lastRanModel !== null) break
    row = row.continuedFromSessionId !== null ? findChatSessionById(db, row.continuedFromSessionId) : null
  }
  return { contextWindow: contextWindow ?? resolveContextWindow(null), lastRanModel }
}
