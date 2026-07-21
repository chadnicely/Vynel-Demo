import {
  deriveSettledAgentActivity,
  type AgentActivityLike,
} from "@vynel/ui";
import type { LiveTraceEntry } from "../../composables/delegations/fold-trace-stream.js";

// The focused agent view-model: everything the panel's header + AgentFocusView
// need about ONE agent node, derived from the monitor's merged entries and the
// live activity map. The live fold's map wins while the stream is attached; a
// settled (or reloaded) run derives from the Agent call's persisted subagent
// fields — the focused view works after complete, like the trace itself.

export interface AgentFocus {
  /** The spawning Agent/Task call's row — null until the trace records it. */
  call: LiveTraceEntry["toolCalls"][number] | null;
  activity: AgentActivityLike | null;
  name: string;
  task: string | null;
  /** The agent's final report — the settled call's string output. */
  report: string | null;
}

function stringInputField(
  call: AgentFocus["call"],
  field: string,
): string | null {
  const input = call?.toolInput;
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

export function deriveAgentFocus(
  entries: LiveTraceEntry[],
  agentActivity: Record<string, AgentActivityLike>,
  toolUseId: string,
): AgentFocus {
  let call: AgentFocus["call"] = null;
  for (const entry of entries) {
    const match = entry.toolCalls.find(
      (candidate) => candidate.toolUseId === toolUseId,
    );
    if (match) {
      call = match;
      break;
    }
  }

  const activity =
    agentActivity[toolUseId] ??
    (call ? deriveSettledAgentActivity(call) : null);
  const output = call?.toolOutput;
  return {
    call,
    activity,
    name:
      stringInputField(call, "name") ??
      stringInputField(call, "subagent_type") ??
      "Agent",
    task: stringInputField(call, "description"),
    report: typeof output === "string" && output !== "" ? output : null,
  };
}
