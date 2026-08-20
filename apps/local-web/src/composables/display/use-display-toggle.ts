import { computed, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GLOBAL_TAB_ID, useUiStore, type ChatMainView } from "../../stores/ui-store.js";

// The title bar's Display switch, and the ONE answer to "is the room on
// screen right now" — the glyph, the voice overlay's suppression and the
// command all read this computed, so they can never disagree.
//
// The voice session itself is NOT started here: it belongs to the room
// (DisplayView starts it on mount, ends it on unmount). Leaving the Display by
// ANY route — this toggle, a menu row, Home — therefore gives the microphone
// back, which a toggle-owned session could only promise with a watcher to keep
// honest. The Display owns the orb; the orb owns the mic.

export interface DisplayToggle {
  readonly isDisplayActive: ComputedRef<boolean>;
  toggleDisplay(): void;
}

export function useDisplayToggle(): DisplayToggle {
  const ui = useUiStore();
  const route = useRoute();
  const router = useRouter();

  // Exactly where GlobalChatView renders the room: the pinned Global tab, on
  // the chat route, pointed at the Display. A looser reading (the tab's view
  // alone) would call the room active from Home — with the mic dead and the
  // wake-word overlay still suppressed behind it.
  const isDisplayActive = computed(
    () =>
      route.name === "chat" &&
      ui.activeTab.id === GLOBAL_TAB_ID &&
      ui.globalTab.shell.mainView === "display",
  );

  /** Where the global tab was before the Display took the canvas. */
  let viewBeforeDisplay: ChatMainView = "chat";

  function toggleDisplay(): void {
    if (isDisplayActive.value) {
      ui.globalTab.shell.mainView = viewBeforeDisplay;
      return;
    }
    // A tab already parked on the Display (switched away, never toggled off)
    // must not restore INTO the Display later — that is a switch that does
    // nothing.
    const current = ui.globalTab.shell.mainView;
    viewBeforeDisplay = current === "display" ? "chat" : current;
    ui.activateTab(GLOBAL_TAB_ID);
    ui.globalTab.shell.mainView = "display";
    if (route.name !== "chat") void router.push({ name: "chat" });
  }

  return { isDisplayActive, toggleDisplay };
}
