import { SpokenSentenceBuffer } from "@vynel/voice";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { VoiceTurnEvent } from "./voice-command-session.js";

// Adapt a voice-thread chat-turn stream to voice-session events. The thread's
// streamed TEXT is its voice (voice-realtime VR1): every `text-chunk` delta
// runs through the shared sentence buffer and each sentence is yielded as
// `spoke` the moment it closes — the first sentence speaks before the reply is
// finished, and the remainder flushes at the end. A `speak` TOOL call still
// surfaces as `spoke` (voice-thread turns carry no speak tool, but another
// producer relaying through it must still be heard). The turn's session id is
// surfaced as soon as the stream names it, so the session can interrupt BY
// IDENTITY on a barge-in (never the global head). Pure over the event stream —
// unit-tested with scripted events.

// The brain-surface tool a producer calls to talk (mcp__vynel__<name>).
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
  const sentences = new SpokenSentenceBuffer();
  function* flushThenComplete(): Generator<VoiceTurnEvent> {
    for (const text of sentences.flush()) yield { kind: "spoke", text };
    yield { kind: "completed" };
  }

  for await (const event of events) {
    switch (event.kind) {
      // `user-message-persisted` fires on new AND resumed turns; `session-created`
      // only on a fresh segment — tap both so every turn names its session.
      case "session-created":
        yield { kind: "session", sessionId: event.session.id };
        break;
      case "user-message-persisted":
        yield { kind: "session", sessionId: event.message.sessionId };
        break;
      case "text-chunk":
        for (const text of sentences.push(event.textDelta)) yield { kind: "spoke", text };
        break;
      case "tool-call-started": {
        if (event.toolCall.toolName !== SPEAK_TOOL_NAME) break;
        const text = extractSpokenText(event.toolCall.toolInput);
        if (text !== null) yield { kind: "spoke", text };
        break;
      }
      case "session-errored":
        yield { kind: "failed", message: event.errorMessage };
        return;
      // Stopped from elsewhere (the Voice chat panel's Stop, the daemon's
      // abort) — our own barge-in aborts the read before this frame could
      // arrive. Not a failure: the session goes quiet, no apology.
      case "session-interrupted":
        yield { kind: "interrupted" };
        return;
      case "turn-stream-ended":
        yield* flushThenComplete();
        return;
      default:
        break;
    }
  }
  yield* flushThenComplete();
}
