// Seeds the live-turn overlay for a MID-TURN attach — the thread re-subscribing
// to its displayed session after a tab switch (use-watched-turn). The
// broadcaster deliberately keeps no replay (rows persist per chunk), so a late
// subscriber rebuilds "the turn so far" from the persisted rows and folds the
// streamed tail on top. Deltas emitted between the subscribe and the snapshot's
// DB read exist in BOTH sources; `dropOverlapPrefix` removes that doubled seam —
// the buffered deltas are the tail of the same append-only stream the row body
// is, so the overlap is exactly the streamed prefix already ending the body.

import type {
  ChatMessageResponse,
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import {
  applyChatTurnEvent,
  createActiveTurnView,
  type ActiveTurnView,
} from "./active-turn-view.js";

/** Drop the longest prefix of `streamed` that is already the tail of `seed`.
 *  Greedy-longest is correct for one append-only stream observed twice; a
 *  repeating-text ambiguity can only over-drop, and the turn-end settle swaps
 *  in the authoritative rows anyway. */
export function dropOverlapPrefix(seed: string, streamed: string): string {
  const max = Math.min(seed.length, streamed.length);
  for (let overlap = max; overlap > 0; overlap--) {
    if (seed.endsWith(streamed.slice(0, overlap))) return streamed.slice(overlap);
  }
  return streamed;
}

/** A turn-OPENING first event means the subscriber attached at turn start —
 *  nothing of this turn predates it, so there are no rows to absorb. */
export function isTurnOpeningEvent(event: ChatTurnEvent): boolean {
  return (
    event.kind === "user-message-persisted" || event.kind === "session-created"
  );
}

/** Build the overlay for a freshly attached watcher: absorb the running turn's
 *  persisted rows (everything after the last user row) as seeded segments,
 *  then fold the buffered stream tail on top, overlap-deduped per message. */
export function seedWatchedTurnView(input: {
  messages: ChatMessageResponse[];
  toolCallsByMessageId: Record<string, ChatToolCallResponse[]>;
  bufferedEvents: ChatTurnEvent[];
  startedAtMs: number;
  /** The running turn's start per the activity feed — bounds the absorb so a
   *  prior turn with no user row between (consecutive schedule fires, channel
   *  replies) never gets swept into the live overlay. Null = unknown; the
   *  last-user-row boundary alone applies. */
  turnStartedAtMs?: number | null;
}): ActiveTurnView {
  const { messages, toolCallsByMessageId, bufferedEvents, startedAtMs } = input;
  const turnStartedAtMs = input.turnStartedAtMs ?? null;
  let view: ActiveTurnView = { ...createActiveTurnView(), startedAtMs };

  const firstEvent = bufferedEvents[0];
  if (firstEvent === undefined || isTurnOpeningEvent(firstEvent)) {
    for (const event of bufferedEvents) view = applyChatTurnEvent(view, event);
    return view;
  }

  // The running turn = the last user row + every assistant row after it,
  // bounded by the turn's start when the feed knows it. The thread hides rows
  // the overlay owns (dedupe by id), so seeding the whole turn renders it
  // exactly like an origin-view turn — one live block with the status line.
  const isWithinTurn = (row: ChatMessageResponse): boolean =>
    turnStartedAtMs === null || Date.parse(row.createdAt) >= turnStartedAtMs;
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const row = messages[index]!;
    if (row.role === "user" && isWithinTurn(row)) {
      lastUserIndex = index;
      break;
    }
  }
  const turnRows = messages
    .slice(lastUserIndex + 1)
    .filter((row) => row.role === "assistant" && isWithinTurn(row));
  view = {
    ...view,
    userMessage: lastUserIndex === -1 ? null : messages[lastUserIndex]!,
    segments: turnRows.map((row) => ({
      messageId: row.id,
      text: row.body,
      thinking: row.thinkingBody ?? "",
      toolCalls: toolCallsByMessageId[row.id] ?? [],
    })),
  };
  const seededIds = new Set(turnRows.map((row) => row.id));

  // Buffered deltas for SEEDED messages fold as one overlap-deduped remainder;
  // everything else folds normally (tool-call events carry full rows and
  // upsert by id, so a call already seeded from the snapshot just updates).
  const streamedText = new Map<string, string>();
  const streamedThinking = new Map<string, string>();
  let lastDeltaWasThinking = false;
  for (const event of bufferedEvents) {
    // Mirrors applyChatTurnEvent's isThinkingLive transitions — text AND tool
    // activity both mean "no longer thinking" (the final override below must
    // not clobber a tool event's reset).
    if (
      event.kind === "text-chunk" ||
      event.kind === "tool-call-started" ||
      event.kind === "tool-call-completed"
    )
      lastDeltaWasThinking = false;
    if (event.kind === "thinking-chunk") lastDeltaWasThinking = true;
    if (event.kind === "text-chunk" && seededIds.has(event.messageId)) {
      streamedText.set(
        event.messageId,
        (streamedText.get(event.messageId) ?? "") + event.textDelta,
      );
      continue;
    }
    if (event.kind === "thinking-chunk" && seededIds.has(event.messageId)) {
      streamedThinking.set(
        event.messageId,
        (streamedThinking.get(event.messageId) ?? "") + event.thinkingDelta,
      );
      continue;
    }
    view = applyChatTurnEvent(view, event);
  }
  return {
    ...view,
    isThinkingLive: lastDeltaWasThinking,
    segments: view.segments.map((segment) => {
      const text = streamedText.get(segment.messageId);
      const thinking = streamedThinking.get(segment.messageId);
      if (text === undefined && thinking === undefined) return segment;
      return {
        ...segment,
        text:
          text === undefined
            ? segment.text
            : segment.text + dropOverlapPrefix(segment.text, text),
        thinking:
          thinking === undefined
            ? segment.thinking
            : segment.thinking + dropOverlapPrefix(segment.thinking, thinking),
      };
    }),
  };
}
