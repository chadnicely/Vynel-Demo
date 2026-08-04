// Pure selector: the chat fold's `ActiveTurnView` → the Watch panel's overlay
// entries (persona-sessions B2 — ONE fold vocabulary). The panel used to fold
// with its own 10-kind reducer that silently dropped thinking, session
// lifecycle, errors, and usage; now every watch surface folds with
// `applyChatTurnEvent` (the full 18-kind reducer) and this selector projects
// the view into the entry list `mergeTraceEntries` already merges.

import type { ActiveTurnView } from "../chat/active-turn-view.js";
import type { LiveTraceEntry } from "../delegations/fold-trace-stream.js";

export function liveEntriesFromTurnView(view: ActiveTurnView): LiveTraceEntry[] {
  const entries: LiveTraceEntry[] = [];
  if (view.userMessage !== null) {
    entries.push({
      id: view.userMessage.id,
      role: view.userMessage.role,
      sourceKind: view.userMessage.sourceKind ?? null,
      sourceLabel: view.userMessage.sourceLabel ?? null,
      body: view.userMessage.body,
      toolCalls: [],
    });
  }
  for (const segment of view.segments) {
    entries.push({
      id: segment.messageId,
      role: "assistant",
      sourceKind: null,
      sourceLabel: null,
      body: segment.text,
      // The old fold DROPPED thinking — the panel now renders it like the
      // chat thread does.
      ...(segment.thinking !== "" ? { thinking: segment.thinking } : {}),
      toolCalls: segment.toolCalls,
    });
  }
  return entries;
}

/** The carded tool currently awaiting the user — the panel's pill. Derived
 *  from the view's approvals (the old fold tracked it as its own field). */
export function pendingApprovalToolNameOf(view: ActiveTurnView): string | null {
  const pending = view.approvals.find((approval) => !approval.isResolved);
  return pending?.toolName ?? null;
}
