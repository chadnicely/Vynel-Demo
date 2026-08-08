// The thread pointer (live-tracking redesign, Case 1): the tracker IS a
// pointer — a compact "task → target" line under the hand-off row. Pointers
// PERSIST (Chad, 2026-08-09, revising D6's in-flight-only): running shows the
// live state, and a settled task keeps its pointer in a completed/failed
// state — the door to where the work happened stays in the history. One home
// for the model + both builders every chat host uses: the in-flight poll
// feeds the live map, the dispatch tool call's served delegation payload is
// the persistent base.

export type ThreadPointerModel = {
  /** The hop's trace key — the anchor: rows carrying it are where the task
   *  started on the target's side (the redesign's whole tracking mechanic). */
  partialSessionId: string;
  taskLabel: string;
  /** Persona-first target: "July run · Invoices" / "Noah · Invoices" /
   *  "Invoices". */
  targetLabel: string;
  status: "queued" | "working" | "completed" | "failed";
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

/** The delegation payload slice a dispatch TOOL CALL carries (serve-time
 *  enrichment) — structural, decoupled from the SDK response type. */
type ToolCallPointerSource = {
  partialSessionId: string | null;
  status: string;
  taskLabel?: string | null;
  deliveredTo?: string | null;
  targetSessionId?: string | null;
  workspaceId?: string | null;
};

/** The PERSISTENT pointer: built from the dispatch call's served delegation,
 *  so it outlives the in-flight poll — a settled task keeps its pointer in
 *  its terminal state. Null for a delivery hop (a report points at nothing;
 *  its taskLabel is null by construction) and for pre-tracing rows. */
export function buildToolCallPointer(
  delegation: ToolCallPointerSource,
): ThreadPointerModel | null {
  if (delegation.partialSessionId == null || delegation.taskLabel == null) return null;
  return {
    partialSessionId: delegation.partialSessionId,
    taskLabel: delegation.taskLabel.trim() || "Task",
    targetLabel: delegation.deliveredTo?.trim() || "Session",
    status:
      delegation.status === "claimed"
        ? "working"
        : delegation.status === "pending"
          ? "queued"
          : delegation.status === "failed"
            ? "failed"
            : "completed",
    targetSessionId: delegation.targetSessionId ?? null,
    workspaceId: delegation.workspaceId ?? null,
  };
}
