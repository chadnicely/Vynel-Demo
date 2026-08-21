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

const dock = useDisplayDockMode({
  isConversationInHand,
  isAppDisplayActive: daemon.isAppDisplayActive,
});
const mode = computed(() => dock.value.mode);

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
  if (voice.isActive.value) voice.end();
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
  // Still holding the conversation = the app's Display took the room: step
  // aside, never dismiss — outside Tauri that closes the window, and the live
  // session would go with it.
  if (isConversationInHand.value) overlayWindow.hide();
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
// status board — the fleet's own numbers live in the room.
const spikeKey = useSpokenClauseSpike();
const miniOrb = computed(() =>
  displayOrbState(voice.view.value, activityEnergy("idle"), isMuted.value, {
    state: daemon.daemonState.value,
    isPlayingRelayedLine: daemon.isPlayingRelayedLine.value,
  }),
);

// Three honest states, not two: a session the idle timer ended is not "Muted".
const micLabel = computed(() => {
  if (isMuted.value) return "Muted";
  return voice.isActive.value ? "Listening" : "Resume";
});
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
      :caption="caption"
      :cards="dockCards"
      :mic-label="micLabel"
      :is-listening="isListening"
      @toggle-mute="toggleMute"
    />

    <div v-else class="stage-card" data-testid="display-dock-stage" data-tauri-drag-region>
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
