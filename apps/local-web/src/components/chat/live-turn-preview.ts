import { presentToolCall } from "@vynel/ui";
import type { ActiveTurnView } from "../../composables/chat/active-turn-view.js";
import { isAgentSpawnToolCall } from "./thread-pointers.js";

// The one line a FOLDED live turn shows — the current activity, newest first,
// rewriting itself as the turn moves (Chad, 2026-08-25). In order: the newest
// tool call as a short sentence ("Read package.json"), else the first line of
// the answer typing in, else the first line of thinking, else the bare
// "Thinking…" / "Working…". The fold only engages while a turn streams, so
// this is only ever read mid-turn.

/** Strip the markdown that would read as noise on one line. */
function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((raw) => raw.trim())
    .find((raw) => raw.length > 0);
  if (line === undefined) return "";
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/[*_`]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

export function deriveLivePreview(view: ActiveTurnView): string {
  const segment = view.segments.at(-1);
  if (segment !== undefined) {
    const call = segment.toolCalls
      .filter((toolCall) => !isAgentSpawnToolCall(toolCall.toolName))
      .at(-1);
    if (call !== undefined) {
      const { verb, argument } = presentToolCall(call);
      return argument ? `${verb} ${argument}` : verb;
    }
    const text = firstLine(segment.text);
    if (text.length > 0) return text;
    const thinking = firstLine(segment.thinking);
    if (thinking.length > 0) return thinking;
  }
  return view.isThinkingLive ? "Thinking…" : "Working…";
}
