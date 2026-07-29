// Decides whether the in-flight turn's live overlay belongs on the thread the
// user is looking at. Keyed on the turn's ORIGIN (where the user sent it from)
// plus the user's explicit navigation target — NEVER on a live query value:
// comparing against `currentSdkSessionId` unmounted the overlay for a beat
// whenever a mid-turn refetch changed it (a delegation's turn-started
// invalidation, a segment swap) — the vanishing working-indicator flicker.

import type { ActiveTurnView } from "./active-turn-view.js";

/** The shell's thread target — mirrors `ChatShellState.target`. */
export type ThreadTarget = "continuous" | "fresh" | { sessionId: string };

export function resolveVisibleActiveTurn(input: {
  view: ActiveTurnView | null;
  /** The turn's session — known up front for a resume/continue, learned from
   *  `session-created` for a fresh conversation, null before that arrives. */
  turnSessionId: string | null;
  /** True when the turn was sent from the continuous thread. */
  startedContinuous: boolean;
  target: ThreadTarget;
}): ActiveTurnView | null {
  const { view, turnSessionId, startedContinuous, target } = input;
  if (view === null) return null;
  // The continuous thread owns every turn it started, whatever ids resolve to
  // mid-turn — but never a turn started from a history-picked session (a
  // non-continuous resume updates that session's own row, not the primary).
  if (target === "continuous") return startedContinuous ? view : null;
  // A fresh view owns only a fresh-started turn whose id hasn't arrived yet;
  // `session-created` retargets the shell to the picked-session case below.
  if (target === "fresh") {
    return turnSessionId === null && !startedContinuous ? view : null;
  }
  return turnSessionId !== null && target.sessionId === turnSessionId
    ? view
    : null;
}
