import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";

// Pure SSE-frame decoding for the chat-turn stream. The server writes frames as
// `stream.writeSSE({ event: <kind>, data: JSON.stringify(event) })` (see
// apps/local-api/src/streams/chat-turn.ts) — standard `event:`/`data:` lines,
// one JSON event per frame, frames separated by a blank line. This module owns
// ONLY the wire→event decode so it can be unit-tested without a network; the
// streamer drives a real ReadableStream through it.

/** One decoded SSE frame: the `event:` name and the joined `data:` payload. */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Split accumulated stream text into complete SSE frames, returning the leftover
 * partial (a frame not yet terminated by a blank line). Frames are delimited by
 * a blank line; the server writes `\n`, but we tolerate `\r\n` too.
 */
export function splitSseFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  // The last part is always the not-yet-terminated remainder (empty when the
  // buffer ended exactly on a boundary).
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((frame) => frame.trim() !== ""), rest };
}

/** Decode one frame block into its `event`/`data` fields (SSE line grammar). */
export function parseSseFrame(frame: string): SseFrame {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // SSE comment
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:"))
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
  }
  return { event, data: dataLines.join("\n") };
}

/**
 * Turn one decoded frame into a ChatTurnEvent. The `data` JSON already carries
 * `kind` for every real event; the terminal frame is `data: '{}'`, so we fall
 * back to the `event:` name to recover its `kind`. The cast is the transport
 * boundary — the server produces these against the shared contract.
 */
export function frameToChatTurnEvent(frame: SseFrame): ChatTurnEvent {
  const payload = JSON.parse(frame.data || "{}") as Record<string, unknown>;
  if (typeof payload.kind !== "string") payload.kind = frame.event;
  return payload as unknown as ChatTurnEvent;
}
