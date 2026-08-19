import { ref } from "vue";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import { reauthorizeToolCallMessage } from "@vynel/contracts/chat/blocked-tool-call";

// The thread owner's half of the classifier-deny card. A BLOCKED tool card
// (the provider's own safety check refused the call before it ran) offers
// "Run it anyway"; the card only asks, the owner sends — and it sends through
// its OWN composer, so the re-issued intent leaves exactly like a typed
// message: the same session, the settings the chips show, the owner's send
// queue. Bind `composer` as the AppComposer's template ref and
// `reauthorizeToolCall` to the thread's `reauthorizeToolCall` emit.

/** What the owner's composer exposes for this (AppComposer's `defineExpose`). */
export interface ReauthorizingComposer {
  sendText: (text: string) => void;
}

export function useReauthorizeToolCall() {
  const composer = ref<ReauthorizingComposer | null>(null);

  function reauthorizeToolCall(toolCall: ChatToolCallResponse) {
    composer.value?.sendText(reauthorizeToolCallMessage(toolCall.toolName));
  }

  return { composer, reauthorizeToolCall };
}
