// The SETTLED source for the nested agent-activity pane: derives an
// AgentActivityLike from the fields persisted on a spawning Agent/Task call's
// row (subagentNarrative + subagentToolCalls). The live fold's map wins while
// the turn streams; this covers everyone who arrives after — reloads, settled
// threads, the reopened Watch panel — the same after-complete parity the
// delegation trace's persisted rows give a task.

import type {
  AgentActivityLike,
  AgentActivityToolCallLike,
} from "../components/AgentActivityPane.vue";
import { displayToolName } from "./tool-presenters.js";

/** "Read pricing.md" — the tool's display name plus its most telling string
 *  argument, kept to one line per call. Shared by the full pane and the
 *  in-thread live ticker. */
export function describeAgentActivityCall(call: {
  toolName: string;
  toolInput?: unknown;
}): string {
  const verb = displayToolName(call.toolName);
  const input = call.toolInput;
  if (typeof input === "object" && input !== null) {
    const fields = input as Record<string, unknown>;
    const argument =
      fields["file_path"] ??
      fields["command"] ??
      fields["pattern"] ??
      fields["description"];
    if (typeof argument === "string" && argument !== "") {
      const short = argument.length > 80 ? `${argument.slice(0, 79)}…` : argument;
      return `${verb} ${short}`;
    }
  }
  return verb;
}

/** The structural subset of a tool-call row this derivation reads. */
export interface SubagentActivitySource {
  status: string;
  subagentNarrative?: string | null | undefined;
  subagentToolCalls?:
    | Array<{
        toolUseId: string;
        toolName: string;
        toolInput?: unknown;
        status: "started" | "completed" | "failed";
      }>
    | null
    | undefined;
}

/** Null when the call carries no persisted subagent activity (ordinary calls,
 *  or agent runs recorded before persistence existed). */
export function deriveSettledAgentActivity(
  toolCall: SubagentActivitySource,
): AgentActivityLike | null {
  const narrative = toolCall.subagentNarrative ?? "";
  const persistedCalls = toolCall.subagentToolCalls ?? [];
  if (narrative === "" && persistedCalls.length === 0) return null;

  // A child stuck 'started' under a settled parent never finished — the run
  // was interrupted or failed before the completion event. Show it settled
  // (failed), never breathing: only a live parent has live children.
  const parentIsSettled = toolCall.status !== "started";
  const toolCalls: AgentActivityToolCallLike[] = persistedCalls.map((call) => ({
    toolUseId: call.toolUseId,
    toolName: call.toolName,
    toolInput: call.toolInput,
    status:
      parentIsSettled && call.status === "started" ? "failed" : call.status,
  }));

  return { text: narrative, toolCalls };
}
