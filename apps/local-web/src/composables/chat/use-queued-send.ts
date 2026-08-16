import { ref, watch } from "vue";
import type { ShallowRef } from "vue";
import type { ActiveTurnView } from "./active-turn-view.js";
import type { TurnAttachmentInput } from "./turn-attachments.js";
import type { ComposerSettings } from "./use-session-settings.js";

export interface QueuedMessage {
  text: string;
  attachments: TurnAttachmentInput[];
  /** The composer settings at CLICK time — what the user saw is what the
   *  drained turn carries, even when it fires minutes later. */
  settings: ComposerSettings;
}

// While a turn is in flight, sends QUEUE instead of silently dropping (the
// old composer just refused them); when the turn fully settles, the queue
// drains in order. Two deliberate choices:
//  - Busy = `view !== null`, NOT `isStreaming`: the status flips off at
//    `session-completed` while startTurn is still settling (invalidations,
//    teardown) — draining on that early flip would race the old turn's
//    `view = null` against the new turn's fresh view and blank it.
//  - Each dequeue calls the view's OWN send at drain time, so the target
//    re-derives from current state (a fresh conversation's first turn creates
//    the session; its queued follow-up must continue it, not fork a new one).
export function useQueuedSend(
  turnView: Readonly<ShallowRef<ActiveTurnView | null>>,
  send: (
    text: string,
    attachments: TurnAttachmentInput[],
    settings: ComposerSettings,
  ) => void,
) {
  const queued = ref<QueuedMessage[]>([]);

  function submit(
    text: string,
    attachments: TurnAttachmentInput[],
    settings: ComposerSettings,
  ) {
    if (turnView.value !== null) {
      queued.value = [...queued.value, { text, attachments, settings }];
      return;
    }
    send(text, attachments, settings);
  }

  function removeQueued(index: number) {
    queued.value = queued.value.filter((_, i) => i !== index);
  }

  watch(turnView, (view, previous) => {
    if (view !== null) return; // still settling — wait for the real end
    // An interrupted or errored settle PARKS the queue: after a Stop,
    // auto-firing would restart work the user just halted; after an error it
    // would burn the whole queue into failed turns. The chips stay visible
    // (removable), and the next completed turn resumes the drain.
    if (
      previous !== null &&
      (previous.status === "interrupted" || previous.status === "errored")
    ) {
      return;
    }
    const next = queued.value[0];
    if (next === undefined) return;
    queued.value = queued.value.slice(1);
    send(next.text, next.attachments, next.settings);
  });

  return { queued, submit, removeQueued };
}
