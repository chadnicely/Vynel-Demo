import { ref } from "vue";
import { defineStore } from "pinia";
import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";

// What each in-flight turn is doing RIGHT NOW — the Home dashboard's narration
// line ("reading march-statement.pdf") PLUS its recent-steps ring (B4: the
// inline persona cards show partial activity without opening a per-card SSE).
// Folds the feed's transient step events per turnId; the desktop-activity-fold
// pattern minus the desktop filter. The activity store deliberately drops
// steps (presence only) — this store is the step consumer for every turn.

export interface TurnNarrationStep {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  /** Running until its settle arrives; a settled step lingers as the narration
   *  line until the next one starts (no flicker between steps). */
  isRunning: boolean;
}

export interface TurnNarration {
  /** The current step — the coalesced one-liner. */
  current: TurnNarrationStep;
  /** The last few steps, oldest→newest, CURRENT INCLUDED as the tail — the
   *  card's partial-activity list (the desktop fold's RECENT_STEP_LIMIT
   *  pattern). */
  recentSteps: TurnNarrationStep[];
}

/** The card shows "the last few things it did" — small on purpose. */
export const RECENT_STEP_LIMIT = 5;

/** Fold one feed event into the per-turn narration map. Pure — returns the
 *  same reference when nothing changed (unit-testable, cheap re-renders). */
export function applyTurnNarrationEvent(
  narrations: Record<string, TurnNarration>,
  event: SessionActivityEvent,
): Record<string, TurnNarration> {
  switch (event.kind) {
    case "turn-tool-started": {
      const step: TurnNarrationStep = {
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        toolInput: "toolInput" in event ? event.toolInput : undefined,
        isRunning: true,
      };
      const previous = narrations[event.turnId];
      const recentSteps = [...(previous?.recentSteps ?? []), step].slice(
        -RECENT_STEP_LIMIT,
      );
      return { ...narrations, [event.turnId]: { current: step, recentSteps } };
    }
    case "turn-tool-settled": {
      const current = narrations[event.turnId];
      if (current === undefined) return narrations;
      const isCurrentStep = current.current.toolUseId === event.toolUseId;
      const hasRingMatch = current.recentSteps.some(
        (step) => step.toolUseId === event.toolUseId && step.isRunning,
      );
      // A settle for a SUPERSEDED step (parallel tool calls) still settles its
      // ring entry — a card must never show a finished step as running; only
      // the narration LINE keeps the newer step's linger semantics.
      if (!isCurrentStep && !hasRingMatch) return narrations;
      const settleInRing = (steps: TurnNarrationStep[]) =>
        steps.map((step) =>
          step.toolUseId === event.toolUseId
            ? { ...step, isRunning: false }
            : step,
        );
      return {
        ...narrations,
        [event.turnId]: {
          current: isCurrentStep
            ? { ...current.current, isRunning: false }
            : current.current,
          recentSteps: settleInRing(current.recentSteps),
        },
      };
    }
    case "turn-ended": {
      if (!(event.turnId in narrations)) return narrations;
      const next = { ...narrations };
      delete next[event.turnId];
      return next;
    }
    default:
      return narrations;
  }
}

export const useTurnNarrationStore = defineStore("turn-narration", () => {
  const narrationByTurnId = ref<Record<string, TurnNarration>>({});

  function apply(event: SessionActivityEvent) {
    narrationByTurnId.value = applyTurnNarrationEvent(
      narrationByTurnId.value,
      event,
    );
  }

  /** The feed dropped — narration is stale without a live subscription. */
  function reset() {
    narrationByTurnId.value = {};
  }

  return { narrationByTurnId, apply, reset };
});
