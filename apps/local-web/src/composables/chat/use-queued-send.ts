import { computed, nextTick, onMounted, watch } from "vue";
import type { ShallowRef } from "vue";
import type { ActiveTurnView } from "./active-turn-view.js";
import type { TurnAttachmentInput } from "./turn-attachments.js";
import type { ComposerSettings } from "./use-session-settings.js";
import { useQueuedSendStore, type QueuedMessage } from "../../stores/queued-send-store.js";

export type { QueuedMessage };

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
//
// The queue itself lives in `useQueuedSendStore`, keyed by conversation, so it
// survives the chat view being destroyed by a tab switch.
export function useQueuedSend(
  turnView: Readonly<ShallowRef<ActiveTurnView | null>>,
  send: (
    text: string,
    attachments: TurnAttachmentInput[],
    settings: ComposerSettings,
  ) => void,
  /** Which conversation this queue belongs to — "global", `workspace:<id>`.
   *  Two composers on the same key share one queue, which is what a room
   *  re-mounting after a tab switch relies on. */
  queueKey = "global",
) {
  const store = useQueuedSendStore();
  const queued = computed<QueuedMessage[]>(() => store.queueFor(queueKey));

  function submit(
    text: string,
    attachments: TurnAttachmentInput[],
    settings: ComposerSettings,
  ) {
    if (turnView.value !== null) {
      store.setQueue(queueKey, [...queued.value, { text, attachments, settings }]);
      return;
    }
    send(text, attachments, settings);
  }

  function removeQueued(index: number) {
    store.setQueue(
      queueKey,
      queued.value.filter((_, i) => i !== index),
    );
  }

  function drainOne() {
    const next = queued.value[0];
    if (next === undefined) return;
    store.setQueue(queueKey, queued.value.slice(1));
    send(next.text, next.attachments, next.settings);
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
    drainOne();
  });

  // Coming BACK to a room whose turn finished while we were elsewhere. The
  // watch above only fires on a transition, and the transition happened with
  // no component mounted to hear it — so without this, a queue survives the
  // tab switch and then sits there forever, which reads exactly like the
  // disappearance it was meant to fix. One tick's grace lets a watched turn
  // that lands during mount say "still busy" before anything fires.
  onMounted(() => {
    void nextTick().then(() => {
      if (turnView.value === null) drainOne();
    });
  });

  return { queued, submit, removeQueued };
}
