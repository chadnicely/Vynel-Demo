import { ref } from "vue";
import { defineStore } from "pinia";
import type { TurnAttachmentInput } from "../composables/chat/turn-attachments.js";
import type { ComposerSettings } from "../composables/chat/use-session-settings.js";

export interface QueuedMessage {
  text: string;
  attachments: TurnAttachmentInput[];
  /** The composer settings at CLICK time — what the user saw is what the
   *  drained turn carries, even when it fires minutes later. */
  settings: ComposerSettings;
}

// THE QUEUE OUTLIVES THE COMPONENT (Chad, 2026-08-25: "whatever is added in
// the queue just disappears and the AI never gets it"). `AppShell` renders
// `<RouterView :key="ui.activeTabId">`, so changing tabs DESTROYS the chat
// view — and a queue held in the component's own `ref` went with it, unsent
// and unmourned. Keyed by conversation and kept here, switching rooms parks
// the queue instead of burning it. `useQueuedSend` is the only reader/writer.
export const useQueuedSendStore = defineStore("queued-send", () => {
  const queuesByKey = ref<Record<string, QueuedMessage[]>>({});

  function queueFor(queueKey: string): QueuedMessage[] {
    return queuesByKey.value[queueKey] ?? [];
  }

  function setQueue(queueKey: string, next: QueuedMessage[]) {
    queuesByKey.value = { ...queuesByKey.value, [queueKey]: next };
  }

  return { queuesByKey, queueFor, setQueue };
});
