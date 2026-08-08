// Resolves an opened session id against the sessions overview to the chain's
// CURRENT head (persona-sessions B6): a continuing conversation moves onto a
// fresh segment at a compaction swap, and a view opened on the old segment
// follows it live — the overview entry's own `sessionId` IS the newest
// segment, so resolution is one lookup, re-run whenever the overview refetches.

import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";

export interface ResolvedChainHead {
  entry: SessionsOverviewEntry;
  /** The chain's open target — the entry's newest segment. */
  headId: string;
  /** The looked-up id is an EARLIER part — the conversation moved on. */
  isSuperseded: boolean;
}

/** Null when no entry carries the id (overview not loaded yet, or a session
 *  outside the caller's list) — callers fall back to the id they hold. */
export function resolveChainHead(
  entries: SessionsOverviewEntry[],
  sessionId: string,
): ResolvedChainHead | null {
  for (const entry of entries) {
    if (entry.sessionId === sessionId) {
      return { entry, headId: entry.sessionId, isSuperseded: false };
    }
    if (entry.segments.some((segment) => segment.sessionId === sessionId)) {
      return { entry, headId: entry.sessionId, isSuperseded: true };
    }
  }
  return null;
}
