import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { resolveContextWindow } from "@vynel/contracts/chat/model-context-window";
import { useUiStore } from "../../stores/ui-store.js";
import { useSessionsOverview } from "../sessions/use-sessions-overview.js";
import {
  findSessionOccupancy,
  formatContextTooltip,
  occupancyTokens,
} from "./context-occupancy.js";
import type { ActiveTurnView } from "./active-turn-view.js";

// The composer ring's data: the active session's context occupancy. Settled
// value = the sessions overview (refetched on every turn-end invalidation, so
// the ring RESETS after a continuity swap — that's the feature). Live value =
// the in-flight turn's `usage-reported` events, so the ring ticks up during a
// reply, Claude-desktop style.
export function useContextOccupancy(
  activeSessionId: MaybeRefOrGetter<string | null>,
  activeTurn: MaybeRefOrGetter<ActiveTurnView | null>,
) {
  const ui = useUiStore();
  const overviewQuery = useSessionsOverview(true);

  const settled = computed(() =>
    findSessionOccupancy(
      overviewQuery.data.value ?? [],
      toValue(activeSessionId),
    ),
  );

  const contextWindow = computed(
    () =>
      settled.value?.contextWindow ?? resolveContextWindow(ui.composerModelId),
  );

  const tokens = computed(() => {
    const usage = toValue(activeTurn)?.usage;
    if (usage) return occupancyTokens(usage);
    return settled.value?.contextTokens ?? null;
  });

  const fraction = computed(() =>
    tokens.value === null
      ? null
      : Math.min(1, tokens.value / contextWindow.value),
  );

  const tooltip = computed(() =>
    tokens.value === null
      ? null
      : formatContextTooltip(tokens.value, contextWindow.value),
  );

  return { fraction, tooltip };
}
