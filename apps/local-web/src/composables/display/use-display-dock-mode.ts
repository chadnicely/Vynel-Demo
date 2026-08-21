import {
  computed,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from "vue";
import { useSessionActivityFeed } from "../activity/use-session-activity-feed.js";
import { useDesktopActivityStore } from "../../stores/desktop-activity-store.js";
import { isDesktopOverlayVisible } from "../../stores/desktop-activity-fold.js";
import {
  DESKTOP_CONTROL_OVERLAY_SIZE,
  type OverlayLayout,
  type OverlayPark,
} from "../voice/tauri-overlay-window.js";

// WHERE THE DOCK IS, in one place. The display dock is the Display's mini form
// — the same always-on-top window in two shapes:
//
//   wake   the wake conversation, in the middle of the screen (the shape the
//          dock has always had): the assistant is HERE, talking to you.
//   mini   a corner status widget while the conversation carries on and you
//          are looking at something else.
//   hidden the app's Display has the room — the orb belongs to ONE surface at
//          a time — or there is no conversation to show.
//
// The room taking over is LATCHED for the life of the conversation: once the
// app's Display has shown this conversation, the dock never jumps back to the
// middle of the screen behind it. That latch is the only thing separating
// `wake` from `mini`, both of which are otherwise "a conversation in hand with
// the room off screen".
//
// A mini row has TWO possible owners, and that is the other axis. Usually the
// dock's own session is what it draws. But most conversations start in the
// ROOM, not on a wake — and a Web Speech session cannot migrate across windows
// — so when the dock holds nothing and the app announces a live session, the
// dock shows that one as a MIRROR: same corner, same size, same stacking, but
// the mic lives in the app and this row only reports it. The dock's own
// session always wins; a mirror never competes with a conversation in hand.

export type DisplayDockMode = "hidden" | "wake" | "mini";

/** The dock's footprint on wake — mirrors the `display-dock` inner_size in
 *  `apps/desktop/src-tauri/src/windows.rs`, which is the size the window is
 *  BORN at; every other shape is set at runtime from here. */
export const DISPLAY_DOCK_WAKE_SIZE = { width: 420, height: 560 } as const;

/** One row: a small orb, the last caption line, the mic pill, and whatever
 *  Claude put in the `dock` slot. Wide enough for a sentence, short enough to
 *  live over a corner of someone's work. */
export const DISPLAY_DOCK_MINI_SIZE = { width: 380, height: 150 } as const;

export interface DisplayDockPresence {
  /** The dock is holding a conversation: its own voice session is live, or is
   *  waiting muted / on a failure the user has not read yet. */
  readonly isConversationInHand: boolean;
  /** The MAIN window's Display room is on screen right now. */
  readonly isAppDisplayActive: boolean;
  /** The room has already had this conversation once — the dock is a corner
   *  widget for the rest of it. */
  readonly wasTakenOverByTheRoom: boolean;
  /** The APP window's own voice session is live (its `display-session` frame),
   *  and the user has not dismissed the mirror of it. */
  readonly isAppSessionLive: boolean;
  /** The desktop-control attention overlay is on screen, in the same corner. */
  readonly isDesktopOverlayVisible: boolean;
}

export interface DisplayDockLayoutState {
  readonly mode: DisplayDockMode;
  /** The row on screen belongs to the APP window: it reports that session and
   *  never drives it. Only ever true alongside `mini`. */
  readonly isMirror: boolean;
  readonly park: OverlayPark;
  /** The mini dock sits above the desktop-control overlay rather than on it. */
  readonly stackAboveDesktopControl: boolean;
  /** What the window API takes — size and spot together. While `hidden` this
   *  is where the dock WOULD be; nothing applies it until it shows again. */
  readonly layout: OverlayLayout;
}

/** The whole rule, pure. */
export function displayDockLayout(presence: DisplayDockPresence): DisplayDockLayoutState {
  const { mode, isMirror } = dockShape(presence);
  const stackAboveDesktopControl = mode === "mini" && presence.isDesktopOverlayVisible;
  const park: OverlayPark = mode === "mini" ? "bottom-right" : "center";
  const size = mode === "mini" ? DISPLAY_DOCK_MINI_SIZE : DISPLAY_DOCK_WAKE_SIZE;
  return {
    mode,
    isMirror,
    park,
    stackAboveDesktopControl,
    layout: {
      park,
      width: size.width,
      height: size.height,
      ...(stackAboveDesktopControl
        ? { stackAbove: { heightPx: DESKTOP_CONTROL_OVERLAY_SIZE.height } }
        : {}),
    },
  };
}

function dockShape(presence: DisplayDockPresence): {
  mode: DisplayDockMode;
  isMirror: boolean;
} {
  // The dock's OWN conversation comes first — it has a microphone in this
  // window, and a mirror of somebody else's session must never displace it.
  if (presence.isConversationInHand) {
    // The room owns the orb whenever it is on screen: two orbs for one
    // conversation would read as two assistants.
    if (presence.isAppDisplayActive) return { mode: "hidden", isMirror: false };
    return {
      mode: presence.wasTakenOverByTheRoom ? "mini" : "wake",
      isMirror: false,
    };
  }
  // Nothing of our own, and the app is talking off screen: mirror it. The same
  // one-orb rule applies — while the room is up, the room draws it.
  if (presence.isAppSessionLive && !presence.isAppDisplayActive) {
    return { mode: "mini", isMirror: true };
  }
  return { mode: "hidden", isMirror: false };
}

/** How often the desktop overlay's linger rule is re-read. It hides a fixed
 *  time after the last desktop step, which no event announces. */
const OVERLAY_LINGER_TICK_MS = 1_000;

export interface DisplayDockModeInputs {
  /** The dock's own conversation — live, muted, or failed. */
  isConversationInHand: MaybeRefOrGetter<boolean>;
  /** The main window's Display is active (the daemon link's `display-active`). */
  isAppDisplayActive: MaybeRefOrGetter<boolean>;
  /** There is a session in the app window worth mirroring (the daemon link's
   *  `display-session`, minus any dismissal the user made of it). */
  isAppSessionLive: MaybeRefOrGetter<boolean>;
}

/** The dock's mode as it changes. Mounts the window's own `activity`
 *  subscription so the desktop-control overlay's visibility is read through
 *  the SAME rule that window applies to itself (`isDesktopOverlayVisible`) —
 *  the alternative, a second idea of when that window is up, is how two
 *  always-on-top windows end up in the same corner. */
export function useDisplayDockMode(
  inputs: DisplayDockModeInputs,
): ComputedRef<DisplayDockLayoutState> {
  useSessionActivityFeed();
  const desktopActivity = useDesktopActivityStore();

  const nowMs = ref(Date.now());
  const tick = setInterval(() => {
    nowMs.value = Date.now();
  }, OVERLAY_LINGER_TICK_MS);
  onScopeDispose(() => clearInterval(tick));

  const wasTakenOverByTheRoom = ref(false);
  watch(
    [
      () => toValue(inputs.isConversationInHand),
      () => toValue(inputs.isAppDisplayActive),
    ],
    ([isConversationInHand, isAppDisplayActive]) => {
      // A new conversation starts in the middle of the screen again — the
      // latch belongs to the conversation, not to the window.
      if (!isConversationInHand) {
        wasTakenOverByTheRoom.value = false;
        return;
      }
      if (isAppDisplayActive) wasTakenOverByTheRoom.value = true;
    },
    { immediate: true },
  );

  return computed(() =>
    displayDockLayout({
      isConversationInHand: toValue(inputs.isConversationInHand),
      isAppDisplayActive: toValue(inputs.isAppDisplayActive),
      wasTakenOverByTheRoom: wasTakenOverByTheRoom.value,
      isAppSessionLive: toValue(inputs.isAppSessionLive),
      isDesktopOverlayVisible: isDesktopOverlayVisible(desktopActivity.state, nowMs.value),
    }),
  );
}
