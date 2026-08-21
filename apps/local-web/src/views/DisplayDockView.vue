<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useVoiceSession } from "../composables/voice/use-voice-session.js";
import { useVoiceDaemonLink } from "../composables/voice/use-voice-daemon-link.js";
import { createOverlayWindowControls } from "../composables/voice/tauri-overlay-window.js";
import {
  voiceStageCaption,
  voiceStageIsListening,
  voiceStageOrbState,
} from "../components/voice/voice-stage-view.js";
import VoiceStage from "../components/voice/VoiceStage.vue";
import DisplayDockMiniRow from "../components/display/DisplayDockMiniRow.vue";
import { useDisplayWidgets } from "../composables/display/use-display-widgets.js";
import { displayDockCards } from "../composables/display/display-dock-cards.js";
import { useDisplayDockMode } from "../composables/display/use-display-dock-mode.js";
import {
  activityEnergy,
  displayOrbState,
  mirroredOrbState,
  useSpokenClauseSpike,
} from "../composables/display/display-orb-state.js";

// The display dock — the Display's mini form. This view fills either the Tauri
// desktop shell's transparent always-on-top window (apps/desktop) or a chromeless
// Chrome app-window the daemon launches (`chrome --app=/display-dock`). Same
// composables as the in-app overlay; the whole window is the stage. It
// identifies itself as the 'dock' surface so the daemon prefers it for wake
// delivery over any regular app tabs. Closing it mid-reply ends the session,
// which stops the running turn by its own session id (round-2 R2-E) — never
// the global head.
//
// TWO SHAPES, one window (`use-display-dock-mode` decides which): the wake
// conversation in the middle of the screen, and a mini row in the corner once
// the app's Display has taken the conversation over and been left again. The
// mode owns the window itself — where it parks, how big it is, and whether it
// is on screen at all — so visibility can never disagree with what is drawn.
//
// The mini row has TWO owners. Usually it is this window's own conversation.
// But most conversations start in the ROOM, and a Web Speech session cannot
// move between windows — so when this window holds nothing and the app
// announces a live session, the row MIRRORS it: same corner, the room's phase
// and caption, and a mic pill that reports rather than switches.

// The daemon focuses the Chrome variant by title (AppActivate) — keep in sync
// with apps/voice `display-dock-window.ts`.
const WINDOW_TITLE = "Vynel Display";

const overlayWindow = createOverlayWindowControls();
const isMuted = ref(false);

const voice = useVoiceSession({ onEnded: handleSessionEnded });
const daemon = useVoiceDaemonLink({
  surface: "dock",
  onWake: handleWake,
  ownLiveSessionId: voice.currentSessionId,
  speakThroughSession: voice.speakExternal,
});

// The dock HAS the conversation from the moment a wake lands until it gives it
// back — not merely while the recognizer is open. A mute ends the session on
// purpose and the window stays, ready to resume; a failure stays up to be read;
// and a wake whose session never started still shows something rather than
// swallowing the words the user said.
const isConversationInHand = ref(false);
// The X means "go away" whatever the session was doing. The settle rule below
// is for a conversation that ended on its own.
let closedByUser = false;

// The mirror is somebody else's conversation, so dismissing it can only ever be
// "not this one" — it comes back with the NEXT session rather than needing to
// be turned on again.
const isMirrorDismissed = ref(false);
const mirroredSession = computed(() => daemon.appDisplaySession.value);
const isMirrorAvailable = computed(() => mirroredSession.value?.live === true);
watch(isMirrorAvailable, (available, wasAvailable) => {
  if (available && !wasAvailable) isMirrorDismissed.value = false;
});

const dock = useDisplayDockMode({
  isConversationInHand,
  isAppDisplayActive: daemon.isAppDisplayActive,
  isAppSessionLive: () => isMirrorAvailable.value && !isMirrorDismissed.value,
});
const mode = computed(() => dock.value.mode);
const isMirror = computed(() => dock.value.isMirror);

// The board Claude fills for the dock. Global: this window has no workspace to
// be in — the wake word answers the global conversation.
const { bySlot } = useDisplayWidgets("global");
const dockCards = computed(() => displayDockCards(bySlot.value.dock));

function handleSessionEnded(): void {
  daemon.notifySessionEnd();
  if (closedByUser) return;
  isConversationInHand.value = isMuted.value || voice.failure.value !== null;
}

function handleWake(command: string, turnWatchdogMs?: number): void {
  isMuted.value = false;
  closedByUser = false;
  isConversationInHand.value = true;
  if (!voice.isActive.value) voice.start(command || undefined, turnWatchdogMs);
}

function toggleMute(): void {
  // A session that ended on its own is not muted — nobody muted it — so the
  // first click has to bring the microphone BACK. Muting what is already
  // silent would leave the pill saying "Resume" and then mute instead.
  if (!voice.isActive.value) {
    isMuted.value = false;
    voice.start();
    return;
  }
  isMuted.value = !isMuted.value;
  if (isMuted.value) voice.end();
  else voice.start();
}

function close(): void {
  closedByUser = true;
  isConversationInHand.value = false;
  // Whatever the X was pointed at, the user asked for the window to go away —
  // letting a mirror slide into the vacancy would answer the opposite.
  isMirrorDismissed.value = true;
  if (voice.isActive.value) voice.end();
}

/** The mini row's X. A conversation this window owns ends; a mirror is only
 *  put away — the room keeps talking, and the next session brings it back. */
function closeMiniRow(): void {
  if (isMirror.value) {
    isMirrorDismissed.value = true;
    return;
  }
  close();
}

// The window follows the mode, and only the mode. Both sources are primitives,
// so nothing fires on the linger tick that changes neither.
watch([mode, () => dock.value.stackAboveDesktopControl], ([next]) => {
  if (next !== "hidden") {
    overlayWindow.applyLayout(dock.value.layout);
    // The keyboard comes with the wake conversation and NEVER with the corner
    // row: mini appears while the user is typing in whatever it floats over
    // (and again each time it lifts over the desktop-control window).
    overlayWindow.reveal({ focus: next === "wake" });
    return;
  }
  // Something can still bring the row back — our own conversation (the app's
  // Display took the room) or the app's, which we only mirror. Step aside
  // rather than dismiss: outside Tauri dismiss() CLOSES the window, taking a
  // live session with it, and closing on every trip into the Display would
  // leave nothing to mirror with on the way out.
  if (isConversationInHand.value || isMirrorAvailable.value) overlayWindow.hide();
  else overlayWindow.dismiss();
});

onMounted(() => {
  document.title = WINDOW_TITLE;
  overlayWindow.park();
  if (overlayWindow.isTauri) {
    // The Tauri window is transparent — the page background must be too, so
    // only the rounded stage card is visible as the overlay.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }
});

const orbState = computed(() => voiceStageOrbState(voice.view.value, isMuted.value));
const isListening = computed(() =>
  voiceStageIsListening(voice.view.value, isMuted.value),
);
const caption = computed(() =>
  voiceStageCaption(voice.view.value, isMuted.value, voice.failure.value),
);
const statusLine = computed(() =>
  daemon.isDaemonConnected.value
    ? "Wake word active — “Hey Claude”"
    : "Wake daemon offline",
);

// The mini row's orb, off the same derivation the room uses. Its resting
// energy is the idle one: the dock is a conversation in a corner, not the
// status board — the fleet's own numbers live in the room. Mirrored, the
// room's phase is ALL this window has: no session view, no player, no mic.
const spikeKey = useSpokenClauseSpike();
const miniOrb = computed(() =>
  isMirror.value
    ? mirroredOrbState(mirroredSession.value?.phase ?? "idle", activityEnergy("idle"))
    : displayOrbState(voice.view.value, activityEnergy("idle"), isMuted.value, {
        state: daemon.daemonState.value,
        isPlayingRelayedLine: daemon.isPlayingRelayedLine.value,
      }),
);

// Three honest states, not two: a session the idle timer ended is not "Muted".
// A mirror has only two — "Resume" would offer a microphone this window cannot
// open, since the session it reports lives in the app.
const micLabel = computed(() => {
  if (isMirror.value) {
    return mirroredSession.value?.phase === "muted" ? "Muted" : "Listening";
  }
  if (isMuted.value) return "Muted";
  return voice.isActive.value ? "Listening" : "Resume";
});

// What the corner row says, and whether its pill reads as live — the mirror
// answers off the room's frame, everything else off this window's session.
const miniCaption = computed(() =>
  isMirror.value ? (mirroredSession.value?.caption ?? "") : caption.value,
);
const isMiniListening = computed(() =>
  isMirror.value ? miniOrb.value.listening : isListening.value,
);
</script>

<template>
  <div
    class="display-dock-window"
    :class="{ 'is-tauri': overlayWindow.isTauri, 'is-mini': mode === 'mini' }"
  >
    <DisplayDockMiniRow
      v-if="mode === 'mini'"
      :orb="miniOrb"
      :spike-key="spikeKey"
      :caption="miniCaption"
      :cards="dockCards"
      :mic-label="micLabel"
      :is-listening="isMiniListening"
      :is-mirror="isMirror"
      @toggle-mute="toggleMute"
      @close="closeMiniRow"
    />

    <!-- `hidden` draws NOTHING. The mode owns the window, but `hide()` is a
         no-op outside Tauri (a browser dock stays on screen), so falling
         through to the full stage put a second orb beside the room's for a
         conversation the room already owns. -->
    <div
      v-else-if="mode === 'wake'"
      class="stage-card"
      data-testid="display-dock-stage"
      data-tauri-drag-region
    >
      <VoiceStage
        :orb-state="orbState"
        :caption="caption"
        :status-line="statusLine"
        :is-muted="isMuted"
        :is-listening="isListening"
        @toggle-mute="toggleMute"
        @close="close"
      />
    </div>
  </div>
</template>

<style scoped>
.display-dock-window {
  height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg-shell);
}

/* Inside the Tauri shell the window itself is transparent — the card IS the
   overlay: rounded, softly bordered, draggable, and translucent so the
   desktop shows through. (backdrop-filter can't frost what's BEHIND a
   transparent Tauri window — the webview can only blur its own content — so
   translucency without blur is the honest look.) */
.display-dock-window.is-tauri {
  background: transparent;
}

/* A translucent glass card behind the stage (reopened 2026-07-21 — the earlier
   free-floating look was unreadable over busy screens). Translucency without
   blur is the honest look: backdrop-filter can't frost what's BEHIND a
   transparent Tauri window. The card stays the drag region. */
.is-tauri .stage-card {
  background: rgb(8 11 16 / 0.78);
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 24px;
  box-shadow: 0 12px 48px rgb(0 0 0 / 0.5);
}

/* Belt over the glass — a bright desktop can still glow through 22% translucency. */
.is-tauri :deep(.caption) {
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
}

/* The mini row: a slice of the Display room in a corner — its own ground and
   palette (`.display-root`) rather than the glass card, so the two shapes read
   as the same surface at two sizes.

   Top-anchored, and self-stretching rather than filling the window, because a
   shell that REFUSES the resize (the window is built non-resizable) leaves
   420×560 of window around a row parked for 380×150: anchored here the row
   still lands where the user is looking, with empty space below it, instead of
   sitting centred halfway off the screen. */
.display-dock-window.is-mini {
  place-items: start stretch;
}
</style>
