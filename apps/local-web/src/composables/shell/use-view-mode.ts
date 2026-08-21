import { computed, type ComputedRef } from "vue";
import { useRoute } from "vue-router";
import { useUiStore } from "../../stores/ui-store.js";

/** What the window is showing, as the title-bar switch reads it: the Nodes
 *  screen, the Display, or the normal canvas (chat, sections, Home — all of
 *  today's chrome). */
export type ViewMode = "normal" | "nodes" | "display";

export interface ViewModeReading {
  readonly viewMode: ComputedRef<ViewMode>;
  /** The view on screen fills the window — chrome gone, corner cluster only.
   *  False on the normal view whatever the store's flag says: full view is a
   *  property of the Nodes screen and the Display, never of the canvas. */
  readonly isFullView: ComputedRef<boolean>;
}

// ONE derivation of the view mode, from state that already exists — the route
// says Nodes, the Display toggle says Display, everything else is normal. No
// second flag to drift: picking a segment drives the same route + tab state
// the menus always did, and the switch simply reads it back.
//
// `isDisplayActive` is handed in rather than taken from `useDisplayToggle`
// here: that composable announces to the dock and owns the room's link, so
// the shell calls it exactly once and shares the reading.
export function useViewMode(isDisplayActive: ComputedRef<boolean>): ViewModeReading {
  const route = useRoute();
  const ui = useUiStore();

  const viewMode = computed<ViewMode>(() => {
    if (route.name === "nodes") return "nodes";
    if (isDisplayActive.value) return "display";
    return "normal";
  });

  const isFullView = computed(() => ui.isFullView && viewMode.value !== "normal");

  return { viewMode, isFullView };
}
