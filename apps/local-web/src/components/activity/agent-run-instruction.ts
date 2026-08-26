// What an agent run was ASKED to do, and what it answered — read off the
// spawning Agent/Task call's row (its input is the instruction; its output,
// once settled, is the agent's final report). Pure, so the sidebar pane and
// its test share one reading; the activity list in between stays
// `AgentActivityPane`'s.

export interface AgentRunInstruction {
  /** The short label the assistant gave the run ("Whoami check"). */
  description: string | null;
  /** The agent kind it spawned ("Explore", "general-purpose"). */
  agentType: string | null;
  /** The full brief the agent received. */
  prompt: string | null;
}

function stringField(input: Record<string, unknown>, field: string): string | null {
  const value = input[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Null when the call carries no readable input (a row recorded before the
 *  input persisted, or a malformed one). */
export function agentRunInstruction(toolInput: unknown): AgentRunInstruction | null {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const fields = toolInput as Record<string, unknown>;
  const instruction = {
    description: stringField(fields, "description"),
    agentType: stringField(fields, "subagent_type") ?? stringField(fields, "name"),
    prompt: stringField(fields, "prompt"),
  };
  return instruction.description === null &&
    instruction.agentType === null &&
    instruction.prompt === null
    ? null
    : instruction;
}

/** The agent's final report as text — a plain string, the SDK's content
 *  blocks (`[{type:'text', text}]`), or anything else serialized. Null when
 *  the call produced nothing readable. */
export function agentRunResultText(toolOutput: unknown): string | null {
  if (toolOutput === null || toolOutput === undefined) return null;
  if (typeof toolOutput === "string") return toolOutput.trim() === "" ? null : toolOutput;
  if (Array.isArray(toolOutput)) {
    const texts = toolOutput
      .map((block) =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>)["type"] === "text" &&
        typeof (block as Record<string, unknown>)["text"] === "string"
          ? ((block as Record<string, unknown>)["text"] as string)
          : null,
      )
      .filter((text): text is string => text !== null);
    if (texts.length > 0) return texts.join("\n\n");
  }
  try {
    return JSON.stringify(toolOutput, null, 2);
  } catch {
    return null;
  }
}
