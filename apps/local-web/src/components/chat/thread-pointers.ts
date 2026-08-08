// The thread pointer (live-tracking redesign, Case 1): the tracker IS a
// pointer — a compact "task → target" line under the hand-off row while the
// task is in flight. One home for the model + the builder both chat hosts use;
// trackers are in-flight-only by nature (Case 3, D6), so the map simply mirrors
// the poll and pointers vanish as tasks settle.

export type ThreadPointerModel = {
  /** The hop's trace key — the anchor: rows carrying it are where the task
   *  started on the target's side (the redesign's whole tracking mechanic). */
  partialSessionId: string;
  taskLabel: string;
  /** Persona-first target: "July run · Invoices" / "Noah · Invoices" /
   *  "Invoices". */
  targetLabel: string;
  status: "queued" | "working";
  /** The target's current segment id — the sidebar opens the conversation by
   *  it (session-target jobs; serve-time enrichment). */
  targetSessionId: string | null;
  /** The target workspace — the sidebar's fallback destination when no
   *  session segment resolves. */
  workspaceId: string | null;
};

/** The slice of the in-flight DTO the builder reads — structural, so the
 *  builder stays decoupled from the SDK response type. */
type InFlightPointerSource = {
  partialSessionId: string | null;
  status: string;
  taskLabel?: string | null;
  workspaceName?: string | null;
  sessionName?: string | null;
  targetSessionId?: string | null;
  workspaceId?: string | null;
};

export function buildThreadPointers(
  delegations: readonly InFlightPointerSource[],
): Map<string, ThreadPointerModel> {
  const pointers = new Map<string, ThreadPointerModel>();
  for (const delegation of delegations) {
    // A keyless job has no anchor to point at (Ch2-precluded, defensive).
    if (delegation.partialSessionId == null) continue;
    const persona = delegation.sessionName ?? delegation.workspaceName ?? "Session";
    const targetLabel =
      delegation.sessionName != null &&
      delegation.workspaceName != null &&
      delegation.sessionName !== delegation.workspaceName
        ? `${delegation.sessionName} · ${delegation.workspaceName}`
        : persona;
    pointers.set(delegation.partialSessionId, {
      partialSessionId: delegation.partialSessionId,
      taskLabel: delegation.taskLabel?.trim() || "Task",
      targetLabel,
      status: delegation.status === "claimed" ? "working" : "queued",
      targetSessionId: delegation.targetSessionId ?? null,
      workspaceId: delegation.workspaceId ?? null,
    });
  }
  return pointers;
}
