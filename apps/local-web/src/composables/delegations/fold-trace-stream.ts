// The Watch panel's entry shape + the settled/overlay merge (persona-sessions
// B2: the panel's own 10-kind fold is GONE — watch surfaces fold with
// `applyChatTurnEvent` and project via `liveEntriesFromTurnView`, so thinking,
// lifecycle, errors, and usage are no longer dropped).

import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";

/** The overlay's entry — the structural subset the panel renders (assignable
 *  from the trace read's wire entries too). */
export interface LiveTraceEntry {
  id: string;
  role: string;
  sourceKind: string | null;
  sourceLabel: string | null;
  body: string;
  /** The segment's live thinking (the chat fold carries it; settled wire
   *  entries omit it). */
  thinking?: string;
  toolCalls: ChatToolCallResponse[];
}

/** Merge the SETTLED trace (authoritative) with the live overlay: a server row
 *  wins by id; overlay-only rows (still streaming) append in arrival order. */
export function mergeTraceEntries<T extends LiveTraceEntry>(
  settled: T[],
  overlay: LiveTraceEntry[],
): LiveTraceEntry[] {
  const settledIds = new Set(settled.map((entry) => entry.id));
  return [...settled, ...overlay.filter((entry) => !settledIds.has(entry.id))];
}
