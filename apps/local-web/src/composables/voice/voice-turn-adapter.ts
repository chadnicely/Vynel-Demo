import { toSpokenGist } from "@vynel/voice";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { VoiceTurnEvent } from "./voice-command-session.js";

// Adapt a global-root chat-turn stream to voice-session events: surface each
// `speak` tool call (what the daemon is saying) + the terminal. The streamed
// TEXT is the on-screen record, never voice — EXCEPT as the safety net: a turn
// that ends without any `speak` call (the model slipped back to prose) speaks
// the gist of its text answer, so a voice question is never answered by
// silence. Pure over the event stream — unit-tested with scripted events.

// The brain-surface tool the model calls to talk (mcp__vynel__<name>).
export const SPEAK_TOOL_NAME = "mcp__vynel__speak";

/** Pull the spoken text out of a `speak` tool call's input ({ text }). */
function extractSpokenText(toolInput: unknown): string | null {
  if (typeof toolInput === "object" && toolInput !== null && "text" in toolInput) {
    const text = (toolInput as { text: unknown }).text;
    if (typeof text === "string" && text.trim() !== "") return text;
  }
  return null;
}

export async function* adaptChatTurnStreamToVoice(
  events: AsyncIterable<ChatTurnEvent>,
): AsyncIterable<VoiceTurnEvent> {
  let spoke = false;
  let textAnswer = "";
  function* fallbackThenComplete(): Generator<VoiceTurnEvent> {
    if (!spoke) {
      const gist = toSpokenGist(textAnswer);
      if (gist !== "") yield { kind: "spoke", text: gist };
    }
    yield { kind: "completed" };
  }

  for await (const event of events) {
    if (event.kind === "tool-call-started" && event.toolCall.toolName === SPEAK_TOOL_NAME) {
      const text = extractSpokenText(event.toolCall.toolInput);
      if (text !== null) {
        spoke = true;
        yield { kind: "spoke", text };
      }
    } else if (event.kind === "text-chunk") {
      textAnswer += event.textDelta;
    } else if (event.kind === "session-errored") {
      yield { kind: "failed", message: event.errorMessage };
      return;
    } else if (event.kind === "session-interrupted") {
      yield { kind: "failed", message: "the turn was interrupted" };
      return;
    } else if (event.kind === "turn-stream-ended") {
      yield* fallbackThenComplete();
      return;
    }
  }
  yield* fallbackThenComplete();
}
