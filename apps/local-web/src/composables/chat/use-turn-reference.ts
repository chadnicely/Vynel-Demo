import { computed, ref } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
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
const marked = ref<MarkedTurn | null>(null);

export function useTurnReference() {
  function mark(message: ChatMessageResponse, author: string) {
    // Clicking the marked card again unmarks it — the icon is a toggle.
    if (marked.value?.messageId === message.id) {
      marked.value = null;
      return;
    }
    const preview = truncate(firstLineOf(message.body));
    const time = formatMessageTimestamp(message.createdAt);
    marked.value = {
      messageId: message.id,
      author,
      preview,
      quote: `> Re: ${author}${time ? ` · ${time}` : ""} — "${preview}"`,
    };
  }

  function clear() {
    marked.value = null;
  }

  /** The outgoing body with its reference line, and the mark spent. Text with
   *  no mark passes through untouched. */
  function applyTo(text: string): string {
    if (marked.value === null) return text;
    const quote = marked.value.quote;
    marked.value = null;
    return `${quote}\n\n${text}`;
  }

  return {
    marked: computed(() => marked.value),
    markedMessageId: computed(() => marked.value?.messageId ?? null),
    mark,
    clear,
    applyTo,
  };
}
