import { SpokenSentenceBuffer } from "@vynel/voice";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { VoiceTurnEvent } from "./voice-command-session-types.js";

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
//
// A TEXT-BLOCK BOUNDARY is a sentence boundary. The buffer's own rule needs a
// period FOLLOWED BY WHITESPACE, and a block that ends right before a tool
// call ends on a bare period — on a tool-using turn ("I'll open YouTube."
// → tool → "Music is playing.") nothing ever closed, every segment piled into
// the buffer, and the whole reply spoke at once at the end, jammed together
// ("…YouTube.Let me…" — Kafi's 2026-08-28 smoke). So a tool call starting, or
// the next assistant message beginning, flushes what the model finished saying.

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
  let currentMessageId: string | null = null;
  function* flushSentences(): Generator<VoiceTurnEvent> {
    for (const text of sentences.flush()) yield { kind: "spoke", text };
  }
  function* flushThenComplete(): Generator<VoiceTurnEvent> {
    yield* flushSentences();
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
        // A new assistant message = the previous block is finished speech.
        if (currentMessageId !== null && event.messageId !== currentMessageId) {
          yield* flushSentences();
        }
        currentMessageId = event.messageId;
        for (const text of sentences.push(event.textDelta)) yield { kind: "spoke", text };
        break;
      case "tool-call-started": {
        // The text before ANY tool call is complete — speak it while the tool
        // runs, exactly the talk-first shape the voice prompt asks for.
        yield* flushSentences();
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
