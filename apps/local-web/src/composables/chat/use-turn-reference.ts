import { computed, ref } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import { composeTurnReferenceLine } from "@vynel/contracts/chat/turn-reference";
import { formatMessageTimestamp } from "@vynel/ui";

/** A turn the person marked to point at (Kafi, 2026-08-15): the chat icon on
 *  a card pins that exchange so the NEXT message can say "about this one"
 *  instead of re-describing what was already said. There is never a per-card
 *  reply box — one mark at a time, and sending spends it. */
export type MarkedTurn = {
  messageId: string;
  /** Who spoke it, for the composer's chip. */
  author: string;
  /** Its first line, trimmed — enough to recognise which turn is marked. */
  preview: string;
  /** The reference line the outgoing message carries. */
  quote: string;
};

const PREVIEW_LIMIT = 60;

function firstLineOf(body: string): string {
  const line = body.split("\n").find((candidate) => candidate.trim() !== "");
  return (line ?? "").replace(/[#*_`>]/g, "").trim();
}

function truncate(text: string): string {
  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT - 1).trimEnd()}…`
    : text;
}

// Module-level so the thread that marks and the composer that spends it read
// the same one — a mark is a property of the conversation, not of a component.
//
// KEYED BY SESSION, and that is the point: more than one composer is alive at
// a time (the sidebar drawer thread sits beside the main view), so a single
// shared mark let a workspace-chat mark ride out on a message to a different
// session, quoting a turn absent from that thread's history. One mark per
// conversation instead.
const marksBySession = ref(new Map<string, MarkedTurn>());

export function useTurnReference() {
  function mark(message: ChatMessageResponse, author: string) {
    const next = new Map(marksBySession.value);
    // Clicking the marked card again unmarks it — the icon is a toggle.
    if (next.get(message.sessionId)?.messageId === message.id) {
      next.delete(message.sessionId);
    } else {
      const preview = truncate(firstLineOf(message.body));
      const time = formatMessageTimestamp(message.createdAt);
      next.set(message.sessionId, {
        messageId: message.id,
        author,
        preview,
        quote: composeTurnReferenceLine(author, time, preview),
      });
    }
    marksBySession.value = next;
  }

  /** What THIS conversation points at; null in a thread with no mark. */
  function markedFor(sessionId: string | null | undefined) {
    return sessionId ? (marksBySession.value.get(sessionId) ?? null) : null;
  }

  function isMarked(message: ChatMessageResponse): boolean {
    return marksBySession.value.get(message.sessionId)?.messageId === message.id;
  }

  function clearFor(sessionId: string | null | undefined) {
    if (!sessionId || !marksBySession.value.has(sessionId)) return;
    const next = new Map(marksBySession.value);
    next.delete(sessionId);
    marksBySession.value = next;
  }

  /** The outgoing body with THIS conversation's reference line, and that mark
   *  spent. Text with no mark passes through untouched. */
  function applyTo(sessionId: string | null | undefined, text: string): string {
    const mark = markedFor(sessionId);
    if (mark === null) return text;
    clearFor(sessionId);
    return `${mark.quote}\n\n${text}`;
  }

  return {
    marks: computed(() => marksBySession.value),
    markedFor,
    isMarked,
    clearFor,
    mark,
    applyTo,
  };
}
