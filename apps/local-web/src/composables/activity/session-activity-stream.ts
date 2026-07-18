import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";
import { readSseFrames } from "../chat/chat-turn-stream.js";
import type { SseFrame } from "../chat/sse-frames.js";

// SSE → SessionActivityEvent decode for the /activity/stream feed. Rides the
// shared frame reader; only the vocabulary mapping lives here.

/** Decode one frame, or null for the server's `:ping` heartbeat comments
 *  (they parse to an empty frame — nothing to fold). */
export function frameToSessionActivityEvent(
  frame: SseFrame,
): SessionActivityEvent | null {
  if (frame.event === "" && frame.data === "") return null;
  const payload = JSON.parse(frame.data || "{}") as Record<string, unknown>;
  if (typeof payload.kind !== "string") payload.kind = frame.event;
  // The transport boundary cast — the server produces these against the
  // shared contract (the frameToChatTurnEvent precedent).
  return payload as unknown as SessionActivityEvent;
}

/** Yield the feed's activity events until the stream ends (or aborts). */
export async function* readSessionActivityEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SessionActivityEvent> {
  for await (const frame of readSseFrames(stream)) {
    const event = frameToSessionActivityEvent(frame);
    if (event !== null) yield event;
  }
}
