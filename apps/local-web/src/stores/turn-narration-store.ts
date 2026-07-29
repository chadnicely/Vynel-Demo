import { ref } from "vue";
import { defineStore } from "pinia";
import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";

// What each in-flight turn is doing RIGHT NOW — the Home dashboard's narration
// line ("reading march-statement.pdf"). Folds the feed's transient step events
// per turnId; the desktop-activity-fold pattern minus the desktop filter. The
// activity store deliberately drops steps (presence only) — this store is the
// step consumer for every turn.

export interface TurnNarrationStep {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  /** Running until its settle arrives; a settled step lingers as the narration
   *  line until the next one starts (no flicker between steps). */
  isRunning: boolean;
}

/** Fold one feed event into the per-turn current-step map. Pure — returns the
 *  same reference when nothing changed (unit-testable, cheap re-renders). */
export function applyTurnNarrationEvent(
  steps: Record<string, TurnNarrationStep>,
  event: SessionActivityEvent,
): Record<string, TurnNarrationStep> {
  switch (event.kind) {
    case "turn-tool-started":
      return {
        ...steps,
        [event.turnId]: {
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          toolInput: "toolInput" in event ? event.toolInput : undefined,
          isRunning: true,
        },
      };
    case "turn-tool-settled": {
      const current = steps[event.turnId];
      if (current === undefined || current.toolUseId !== event.toolUseId) {
        return steps;
      }
      return { ...steps, [event.turnId]: { ...current, isRunning: false } };
    }
    case "turn-ended": {
      if (!(event.turnId in steps)) return steps;
      const next = { ...steps };
      delete next[event.turnId];
      return next;
    }
    default:
      return steps;
  }
}

export const useTurnNarrationStore = defineStore("turn-narration", () => {
  const stepByTurnId = ref<Record<string, TurnNarrationStep>>({});

  function apply(event: SessionActivityEvent) {
    stepByTurnId.value = applyTurnNarrationEvent(stepByTurnId.value, event);
  }

  /** The feed dropped — narration is stale without a live subscription. */
  function reset() {
    stepByTurnId.value = {};
  }

  return { stepByTurnId, apply, reset };
});
