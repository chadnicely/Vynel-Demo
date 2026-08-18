import { describeAgentActivityCall } from "@vynel/ui";

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
   *  started on the target's side (the redesign's whole tracking mechanic).
   *  An agent-run pointer anchors on its spawning call's toolUseId instead. */
  partialSessionId: string;
  taskLabel: string;
  /** Persona-first target: "July run · Invoices" / "Noah · Invoices" /
   *  "Invoices". */
  targetLabel: string;
  /** `needs_input` = the run is paused on an approval/ask (the ONE status
   *  rule's vocabulary) — live pointers only; settled rows never wear it. */
  status: "queued" | "working" | "needs_input" | "completed" | "failed";
  /** The target's current segment id — the sidebar opens the conversation by
   *  it (session-target jobs; serve-time enrichment). */
  targetSessionId: string | null;
  /** The target workspace — the sidebar's fallback destination when no
   *  session segment resolves. */
  workspaceId: string | null;
  /** The run's latest visible act ("Read pricing.md") — the live line under
   *  the card; a settled pointer keeps its last one. Absent on delegation
   *  pointers (their live state lives in the target's own thread). */
  activityLine?: string | null;
  /** An agent-run pointer's door: the nested activity pane, keyed by the
   *  spawning call inside its host session. Absent on delegation pointers. */
  agentRun?: { hostSessionId: string | null; toolUseId: string } | null;
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

/** The system spawn tools — the SDK's subagent door. Everything else is an
 *  ordinary tool card, never a pointer. */
export function isAgentSpawnToolCall(toolName: string): boolean {
  return toolName === "Agent" || toolName === "Task";
}

/** The slice of a spawning Agent/Task call the builder reads — structural, so
 *  it accepts both the settled row and the live overlay's tool call. */
type AgentRunPointerSource = {
  toolUseId: string;
  toolName: string;
  toolInput?: unknown;
  status: string;
  isErrorResult?: boolean;
};

/** The slice of the run's activity the line reads — the live fold's map entry
 *  and the settled derivation both fit. */
type AgentRunActivitySource = {
  text: string;
  toolCalls: Array<{ toolUseId: string; toolName: string; toolInput?: unknown }>;
};

/** "Read pricing.md" / the narrative's last line — what the run is visibly
 *  doing right now, or last did. Null when the run has produced nothing. */
function agentActivityLine(activity: AgentRunActivitySource | null): string | null {
  const latestCall = activity?.toolCalls.at(-1);
  if (latestCall !== undefined) return describeAgentActivityCall(latestCall);
  const narrativeTail = (activity?.text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
  if (narrativeTail === undefined) return null;
  return narrativeTail.length > 100 ? `${narrativeTail.slice(0, 99)}…` : narrativeTail;
}

/** The AGENT-SPAWN pointer (2026-08-18): the same pointer card a delegated
 *  task wears, for the system Agent/Task tool — anchored on the spawning
 *  call's toolUseId, its door the nested activity pane instead of a target
 *  conversation. Built from the live fold's map while the turn streams and
 *  from the call's persisted subagent fields after settle, so it persists in
 *  its terminal state exactly like a delegation pointer. */
export function buildAgentRunPointer(
  call: AgentRunPointerSource,
  activity: AgentRunActivitySource | null,
  hostSessionId: string | null,
): ThreadPointerModel | null {
  if (!isAgentSpawnToolCall(call.toolName)) return null;
  const fields =
    typeof call.toolInput === "object" && call.toolInput !== null
      ? (call.toolInput as Record<string, unknown>)
      : {};
  const description = typeof fields["description"] === "string" ? fields["description"].trim() : "";
  const promptLead =
    typeof fields["prompt"] === "string"
      ? (fields["prompt"].split("\n").find((line) => line.trim() !== "") ?? "").trim()
      : "";
  const taskLabel =
    description ||
    (promptLead.length > 80 ? `${promptLead.slice(0, 79)}…` : promptLead) ||
    "Agent task";
  const agentType = typeof fields["subagent_type"] === "string" ? fields["subagent_type"].trim() : "";
  const status =
    call.status === "started"
      ? "working"
      : call.status === "completed" && call.isErrorResult !== true
        ? "completed"
        : "failed";
  return {
    partialSessionId: call.toolUseId,
    taskLabel,
    targetLabel: agentType || "Agent",
    status,
    targetSessionId: null,
    workspaceId: null,
    activityLine: agentActivityLine(activity) ?? (status === "working" ? "Working…" : null),
    agentRun: { hostSessionId, toolUseId: call.toolUseId },
  };
}
