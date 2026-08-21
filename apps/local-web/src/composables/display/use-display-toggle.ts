import { computed, onScopeDispose, watch, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUiStore, type ChatMainView, type ShellTab } from "../../stores/ui-store.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import { useVynel } from "../use-vynel.js";

// The title bar's Display switch, and the ONE answer to "is the room on
// screen right now" — the glyph, the voice overlay's suppression and the
// command all read this computed, so they can never disagree.
//
// The switch opens the room of the TAB YOU ARE ON (the surface decides the
// scope): on the pinned Global tab that is the global board, on a workspace
// tab that workspace's own. It never switches tabs to do it — a switch that
// yanked you out of the room you were in would be a different control.
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

/** Where a tab's canvas is rendered: the pinned Global tab lives on the chat
 *  route, a workspace tab on the workspace route. */
function canvasRouteName(tab: ShellTab): "chat" | "workspace" {
  return tab.workspaceId === null ? "chat" : "workspace";
}

export function useDisplayToggle(): DisplayToggle {
  const ui = useUiStore();
  const route = useRoute();
  const router = useRouter();
  const live = useLiveChannelStore();

  // Exactly where the canvas renders the room: the active tab, on that tab's
  // own route, pointed at the Display. A looser reading (the tab's view alone)
  // would call the room active from Home — with the mic dead and the
  // wake-word overlay still suppressed behind it.
  const isDisplayActive = computed(
    () =>
      route.name === canvasRouteName(ui.activeTab) &&
      ui.activeTab.shell.mainView === "display",
  );

  // The display dock is the Display's OTHER form, in another window — it hides
  // while this one has the room, so one conversation never shows two orbs.
  // Announced off the computed above rather than from `toggleDisplay`, so
  // leaving by a menu row or Home counts exactly as much as the switch, and
  // `immediate` because a window can boot with the room already on screen (the
  // tab strip persists its view).
  const vynel = useVynel();
  function announceDisplayActive(active: boolean): void {
    // Presence, not state: a lost call costs the dock one wrong shape until
    // the next change, never the room. (The web app has no logger seam and the
    // house rule bans console output — `notifySessionEnd` is the precedent.)
    void vynel.voice.setDisplayActive({ active }).catch(() => {});
  }
  watch(isDisplayActive, announceDisplayActive, { immediate: true });
  // An engine restart empties the hub's memo of this, and nothing about the
  // room changed to announce it again — so a reconnect says it over. Off the
  // socket coming back rather than a retry: the dock is on the other end of
  // that same socket and could not have heard anything while it was down.
  watch(
    () => live.status,
    (status) => {
      if (status === "open") announceDisplayActive(isDisplayActive.value);
    },
  );
  // The window is going away and the room with it.
  onScopeDispose(() => announceDisplayActive(false));

  /** Where each tab was before the Display took its canvas. Per tab, because
   *  every tab carries its own canvas state — restoring one tab's chat over
   *  another tab's open section is exactly the multitasking the strip sells. */
  const viewBeforeDisplay = new Map<string, ChatMainView>();

  function toggleDisplay(): void {
    const tab = ui.activeTab;
    if (isDisplayActive.value) {
      tab.shell.mainView = viewBeforeDisplay.get(tab.id) ?? "chat";
      return;
    }
    // A tab already parked on the Display (switched away, never toggled off)
    // must not restore INTO the Display later — that is a switch that does
    // nothing.
    const current = tab.shell.mainView;
    viewBeforeDisplay.set(tab.id, current === "display" ? "chat" : current);
    tab.shell.mainView = "display";
    const canvasRoute = canvasRouteName(tab);
    if (route.name !== canvasRoute) void router.push({ name: canvasRoute });
  }

  return { isDisplayActive, toggleDisplay };
}
