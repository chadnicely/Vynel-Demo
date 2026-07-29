import { displayToolName } from "@vynel/ui";
import type { TurnNarrationStep } from "../../stores/turn-narration-store.js";

// The plain-words narration line for a live session card ("reading
// march-statement.pdf", "searching the web"). Sentences, never raw tool ids —
// the dashboard's vocabulary floor. One line, clamped: this screen may be
// visible during screen-shares, so arguments stay small.

const ARGUMENT_KEYS = [
  "file_path",
  "path",
  "command",
  "pattern",
  "query",
  "url",
  "title",
  "prompt",
  "description",
] as const;

const ARGUMENT_LIMIT = 64;

function firstArgument(toolInput: unknown): string | null {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const record = toolInput as Record<string, unknown>;
  for (const key of ARGUMENT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      const oneLine = value.split("\n")[0]!.trim();
      return oneLine.length > ARGUMENT_LIMIT
        ? `${oneLine.slice(0, ARGUMENT_LIMIT)}…`
        : oneLine;
    }
  }
  return null;
}

export function narrationLabelFor(
  step: TurnNarrationStep | undefined,
): string | null {
  if (step === undefined) return null;
  const verb = displayToolName(step.toolName);
  const argument = firstArgument(step.toolInput);
  return argument ? `${verb} · ${argument}` : verb;
}
