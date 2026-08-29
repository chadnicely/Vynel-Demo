import { computed, type ComputedRef } from "vue";
import { useRoute } from "vue-router";

/** What the window is showing, as the title-bar switch reads it: the Nodes
 *  screen, the Display, or the normal canvas (chat, sections, Home — all of
 *  today's chrome). */
export type ViewMode = "normal" | "nodes" | "display";

export interface ViewModeReading {
  readonly viewMode: ComputedRef<ViewMode>;
  /** The view fills the window — chrome gone, corner cluster only. Nodes and
   *  the Display ARE full views (Kafi, 2026-08-22: picking one opens it full,
   *  no separate expander); the normal view never is. */
  readonly isFullView: ComputedRef<boolean>;
  /** Admin: no workspace navigation, but the menu row stays. */
  readonly isAdminView: ComputedRef<boolean>;
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

  const viewMode = computed<ViewMode>(() => {
    if (route.name === "nodes") return "nodes";
    if (isDisplayActive.value) return "display";
    return "normal";
  });

  // FULL means chrome-less — the room with the title bar floating in the
  // corner. Only the switch's own modes go there.
  const isFullView = computed(() => viewMode.value !== "normal");

  // Admin (the film kit) is an ORDINARY page — same chrome as every other
  // screen (Chad, 2026-08-28, reversing the earlier "no sidebar"). This flag
  // exists only so the title bar's Admin link can read as the current page.
  const isAdminView = computed(() => route.name === "demo-scripts");

  return { viewMode, isFullView, isAdminView };
}
