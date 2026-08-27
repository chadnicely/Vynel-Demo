import { computed, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUiStore, type ChatMainView, type ShellTab } from "../../stores/ui-store.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import { useVynel } from "../use-vynel.js";
import { useDisplayVoice } from "./use-display-voice.js";

// The title bar's Display switch, and the ONE answer to "is the room on
// screen right now" — the announcement to the dock and the room's own link
// need both read this computed, so they can never disagree.
//
// The switch opens the room of the TAB YOU ARE ON (the surface decides the
// scope): on the pinned Global tab that is the global board, on a workspace
// tab that workspace's own. It never switches tabs to do it — a switch that
// yanked you out of the room you were in would be a different control.
//
// The switch is the real VOICE on/off (Kafi, 2026-08-21): on starts the
// window's voice session and shows the room; off ends it from wherever you
// are, leaving the room too if that is where you were. In between, the session
// is the store's and outlives the screen — walking away from the Display keeps
// the conversation, and the dock mirrors it in the corner.

export interface DisplayToggle {
  readonly isDisplayActive: ComputedRef<boolean>;
  toggleDisplay(): void;
  /** Put the room on screen without touching the voice session — the wake
   *  path. A wake asks the user to LOOK at the room; answering it with the
   *  switch would turn the very conversation it announced off. */
  showDisplay(): void;
  /** Take the room off the canvas, restoring whatever the tab showed before,
   *  without touching the voice — the conversation is the window's and keeps
   *  running behind the view you return to (the dock mirrors it). */
  leaveDisplay(): void;
  /** The view switch's Display segment (Kafi, 2026-08-22): go to the room and
   *  take the microphone if nobody has it; a conversation already running
   *  is joined, never restarted. In the room already, the segment is the
   *  switch's OFF — the same close the old glyph did. */
  pickDisplay(): void;
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
  const displayVoice = useDisplayVoice();

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
  // The route cannot see a MINIMIZED window: without this, a window minimized
  // while on the Display kept announcing "the room is on screen", and the
  // dock's one-orb rule hid the corner row while speech played with zero
  // pixels anywhere. WebView2 fires `visibilitychange` on minimize/restore;
  // occlusion by other windows does not count — an unfocused-but-visible room
  // still draws its orb, and the announcement stays honest.
  const isDocumentVisible = ref(document.visibilityState === "visible");
  function readDocumentVisibility(): void {
    isDocumentVisible.value = document.visibilityState === "visible";
  }
  document.addEventListener("visibilitychange", readDocumentVisibility);
  onScopeDispose(() =>
    document.removeEventListener("visibilitychange", readDocumentVisibility),
  );
  const isDisplayOnScreen = computed(
    () => isDisplayActive.value && isDocumentVisible.value,
  );
  watch(isDisplayOnScreen, announceDisplayActive, { immediate: true });
  // An engine restart empties the hub's memo of this, and nothing about the
  // room changed to announce it again — so a reconnect says it over. Off the
  // socket coming back rather than a retry: the dock is on the other end of
  // that same socket and could not have heard anything while it was down.
  watch(
    () => live.status,
    (status) => {
      if (status === "open") announceDisplayActive(isDisplayOnScreen.value);
    },
  );
  // The window is going away and the room with it.
  onScopeDispose(() => announceDisplayActive(false));

  // The room needs the daemon link even with voice off — a wake has to be able
  // to land in it — so the store learns the same fact this switch reads.
  // SYNC, because the shell's `VoiceOverlay` v-if reads the store's answer in
  // the very render this change causes: a queued job would leave both holding
  // the channel for a tick.
  watch(isDisplayActive, (active) => displayVoice.setRoomOnScreen(active), {
    immediate: true,
    flush: "sync",
  });
  onScopeDispose(() => displayVoice.setRoomOnScreen(false));

  // A wake landed in the dock while the store held this window's link, and the
  // daemon asked the app to come forward. The store cannot open the room, so
  // it rings and this answers.
  watch(() => displayVoice.showDisplayRequestCount, showDisplay);

  /** Where each tab was before the Display took its canvas. Per tab, because
   *  every tab carries its own canvas state — restoring one tab's chat over
   *  another tab's open section is exactly the multitasking the strip sells. */
  const viewBeforeDisplay = new Map<string, ChatMainView>();

  function showDisplay(): void {
    if (isDisplayActive.value) return;
    const tab = ui.activeTab;
    // A tab already parked on the Display (switched away, never toggled off)
    // must not restore INTO the Display later — that is a switch that does
    // nothing.
    const current = tab.shell.mainView;
    viewBeforeDisplay.set(tab.id, current === "display" ? "chat" : current);
    tab.shell.mainView = "display";
    const canvasRoute = canvasRouteName(tab);
    if (route.name !== canvasRoute) void router.push({ name: canvasRoute });
  }

  function leaveDisplay(): void {
    if (!isDisplayActive.value) return;
    const tab = ui.activeTab;
    tab.shell.mainView = viewBeforeDisplay.get(tab.id) ?? "chat";
  }

  function toggleDisplay(): void {
    // OFF is whatever the glyph is lit for — the room on screen, a session
    // running somewhere behind another view, or both. A switch that read ON
    // and did anything other than turn it off would be a different control.
    if (displayVoice.ownsVoice) {
      displayVoice.end();
      // Only if that is where you are: ending a session from the workspace you
      // were working in must not drag you to the room to do it.
      leaveDisplay();
      return;
    }
    showDisplay();
    displayVoice.start();
  }

  function pickDisplay(): void {
    if (isDisplayActive.value) {
      toggleDisplay();
      return;
    }
    // Read BEFORE showing: putting the room on screen is itself one of the
    // ways the Display comes to own the voice, so reading after would never
    // start a microphone.
    const hadVoice = displayVoice.ownsVoice;
    showDisplay();
    if (!hadVoice) displayVoice.start();
  }

  return { isDisplayActive, toggleDisplay, showDisplay, leaveDisplay, pickDisplay };
}
