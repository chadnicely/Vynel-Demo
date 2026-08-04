// The ONE home for pairing an in-flight delegation with its feed turn and
// naming who speaks — shared by the thread's persona cards (B5) and the
// Background roster (B7). The match key is the per-hop trace key the A8
// enrichment stamps; if that key ever evolves (the A5 threadId work), it
// changes HERE, not in two builders.

import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";

/** The delegation slice pairing needs (structural over the DTO). */
export interface PairableDelegation {
  partialSessionId: string | null;
  sessionName: string | null;
  status: "pending" | "claimed";
}

export function findTurnForDelegation(
  turns: SessionTurnActivity[],
  delegation: PairableDelegation,
): SessionTurnActivity | undefined {
  if (delegation.partialSessionId === null) return undefined;
  return turns.find(
    (candidate) => candidate.partialSessionId === delegation.partialSessionId,
  );
}

/** The persona chain's HEAD — the target session's own name, else the turn's
 *  enriched speaker. Callers append their surface-specific tail (the cards
 *  fall to the row's workspaceName; the roster prefers the workspace manager
 *  when it has the list at hand). */
export function delegationPersonaName(
  delegation: PairableDelegation,
  turn: SessionTurnActivity | undefined,
): string | null {
  return delegation.sessionName ?? turn?.personaName ?? null;
}

export function delegationTaskState(
  status: PairableDelegation["status"],
): "queued" | "working" {
  return status === "pending" ? "queued" : "working";
}

/** Card/row identity: the trace key, else a stable positional fallback (a
 *  keyless job is Ch2-precluded but still counted as live work). */
export function delegationRowKey(
  delegation: PairableDelegation,
  index: number,
): string {
  return delegation.partialSessionId ?? `in-flight-${index}`;
}
