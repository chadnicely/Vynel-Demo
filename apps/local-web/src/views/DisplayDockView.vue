<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useVynel } from "../composables/use-vynel.js";
import { useUserPreferences } from "../composables/users/use-user-preferences.js";
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
import { readDemoArmedFlag } from "../demo/demo-armed-flag.js";
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
const vynel = useVynel();
const isMuted = ref(false);

// The sidecar listens in MINUTES, not seconds (Kafi 2026-08-28): a wake
// conversation stays open through pauses, and the user ends it — Stop, the
// stop_listening tool, or this cap. The cap exists so a forgotten open mic
// (soon possibly a metered cloud one) closes itself; "hey vynel" re-wakes.
const DOCK_IDLE_TIMEOUT_MS = 300_000;

const voice = useVoiceSession({
  onEnded: handleSessionEnded,
  onStarted: handleSessionStarted,
  idleTimeoutMs: DOCK_IDLE_TIMEOUT_MS,
});
const daemon = useVoiceDaemonLink({
  surface: "dock",
  onWake: handleWake,
  onShowDock: handleShowDock,
  onVoiceStop: handleVoiceStop,
  ownLiveSessionId: voice.currentSessionId,
  speakThroughSession: voice.speakExternal,
});

// A spoken line was announced (`show-dock`) — the corner row appears for it
// and LINGERS a little past the announcement, because the audio may play in a
// different window than this one and this window cannot hear when it ends.
// A line played HERE holds the row for exactly as long as it sounds.
const SHOW_DOCK_LINGER_MS = 8_000;
const isSpokenLineLingering = ref(false);
// The announced line's opening — the row's caption when the audio plays in a
// DIFFERENT window (this one can neither hear it nor read its player).
const announcedLineText = ref<string | null>(null);
let spokenLineLingerTimer: ReturnType<typeof setTimeout> | null = null;
function handleShowDock(text: string | null): void {
  isSpokenLineLingering.value = true;
  announcedLineText.value = text;
  if (spokenLineLingerTimer !== null) clearTimeout(spokenLineLingerTimer);
  spokenLineLingerTimer = setTimeout(() => {
    isSpokenLineLingering.value = false;
    announcedLineText.value = null;
    spokenLineLingerTimer = null;
  }, SHOW_DOCK_LINGER_MS);
}
onScopeDispose(() => {
  if (spokenLineLingerTimer !== null) clearTimeout(spokenLineLingerTimer);
});

// The assistant is audible right now: a relayed line playing in this window,
// the daemon's own speaker running, or the announcement's linger window.
const isAssistantLineAudible = computed(
  () =>
    isSpokenLineLingering.value ||
    daemon.isPlayingRelayedLine.value ||
    daemon.daemonState.value === "speaking",
);

// The dock HAS the conversation from the moment a wake lands until it gives it
// back — not merely while the recognizer is open. A mute ends the session on
// purpose and the window stays, ready to resume; a failure stays up to be read;
// and a wake whose session never started still shows something rather than
// swallowing the words the user said.
const isConversationInHand = ref(false);
// The X means "go away" whatever the session was doing. The settle rule below
// is for a conversation that ended on its own.
let closedByUser = false;

const mirroredSession = computed(() => daemon.appDisplaySession.value);
const isMirrorAvailable = computed(() => mirroredSession.value?.live === true);

const dock = useDisplayDockMode({
  isConversationInHand,
  isAppDisplayActive: daemon.isAppDisplayActive,
  // No dismiss state (Kafi 2026-08-28): the row is visible exactly while a
  // session is live — Stop ENDS the session, so a hidden live microphone
  // cannot exist.
  isAppSessionLive: () => isMirrorAvailable.value,
  isAssistantLineAudible,
});
const mode = computed(() => dock.value.mode);
const isMirror = computed(() => dock.value.isMirror);

// The board Claude fills for the dock. Global: this window has no workspace to
// be in — the wake word answers the global conversation.
const { bySlot } = useDisplayWidgets("global");
const dockCards = computed(() => displayDockCards(bySlot.value.dock));

// The dock's recognizer owns the microphone — the daemon stops its native STT
// for the duration (a wake-started session is already handed off; this covers
// the dock's own starts and resumes).
function handleSessionStarted(): void {
  daemon.notifySessionStart();
}

function handleSessionEnded(): void {
  daemon.notifySessionEnd();
  if (closedByUser) return;
  isConversationInHand.value = isMuted.value || voice.failure.value !== null;
}

function handleWake(command: string, turnWatchdogMs?: number): void {
  // Demo Mode armed (the RAW flag — this webview's Pinia is not the app's):
  // the take belongs to the app window, which hears `show-display` and runs
  // the routine. Starting a session here would listen to, and answer, the film.
  if (readDemoArmedFlag()) return;
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

/** Put away the spoken-line row's local artifacts — the linger and its caption. */
function clearSpokenLineRow(): void {
  if (spokenLineLingerTimer !== null) {
    clearTimeout(spokenLineLingerTimer);
    spokenLineLingerTimer = null;
  }
  isSpokenLineLingering.value = false;
  announcedLineText.value = null;
}

/** The row's Stop: end the voice conversation, wherever it lives. Our own
 *  session ends right here; anything else — the app window's session, a line
 *  playing in another window, the daemon's own speaker — is reached through
 *  the stop door (the same one the `stop_listening` tool uses: one rulebook,
 *  and Stop always means SILENCE, never just "hide this row"). */
function stopListening(): void {
  clearSpokenLineRow();
  daemon.cancelRelayedLine();
  if (!isMirror.value) {
    close();
    return;
  }
  void vynel.voice.stopListening().catch(() => {});
}

/** A `voice-stop` frame (the tool, or another window's Stop): whatever THIS
 *  window is doing with its voice stops — its own conversation, a relayed
 *  line mid-play, the lingering spoken-line row. */
function handleVoiceStop(): void {
  clearSpokenLineRow();
  daemon.cancelRelayedLine();
  if (isConversationInHand.value) close();
}

// A MIRROR row waits a beat before revealing: opening the Display fires
// `display-session` and `display-active` as two independent frames, and the
// dock can hear "session live" before "the room is on screen" — revealing on
// that instant flashed the row for the beat until the second frame landed.
// The wake conversation stays immediate; only the bystander row is patient.
const MIRROR_REVEAL_GRACE_MS = 400;
let mirrorRevealTimer: ReturnType<typeof setTimeout> | null = null;
onScopeDispose(() => {
  if (mirrorRevealTimer !== null) clearTimeout(mirrorRevealTimer);
});

// The window follows the mode, and only the mode. Both sources are primitives,
// so nothing fires on the linger tick that changes neither.
watch([mode, () => dock.value.stackAboveDesktopControl], ([next], [previousMode]) => {
  if (mirrorRevealTimer !== null) {
    clearTimeout(mirrorRevealTimer);
    mirrorRevealTimer = null;
  }
  if (next !== "hidden") {
    const reveal = (): void => {
      overlayWindow.applyLayout(dock.value.layout);
      // The keyboard comes with the wake conversation and NEVER with the corner
      // row: mini appears while the user is typing in whatever it floats over
      // (and again each time it lifts over the desktop-control window).
      overlayWindow.reveal({ focus: mode.value === "wake" });
    };
    if (next === "mini" && isMirror.value && previousMode === "hidden") {
      mirrorRevealTimer = setTimeout(() => {
        mirrorRevealTimer = null;
        if (mode.value === "mini" && isMirror.value) reveal();
      }, MIRROR_REVEAL_GRACE_MS);
      return;
    }
    reveal();
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
const preferencesQuery = useUserPreferences();
const statusLine = computed(() => {
  if (!daemon.isDaemonConnected.value) return "Wake daemon offline";
  // The user's custom wake name when set (built-ins keep working beside it);
  // the assistant's display name otherwise — the matcher accepts both.
  const wakeName = preferencesQuery.data.value?.voiceWakeName ?? "Claude";
  return `Wake word active — “Hey ${wakeName}”`;
});

// The mini row's orb, off the same derivation the room uses. Its resting
// energy is the idle one: the dock is a conversation in a corner, not the
// status board — the fleet's own numbers live in the room. Mirrored, the
// room's phase is ALL this window has: no session view, no player, no mic.
const spikeKey = useSpokenClauseSpike();
// A mirror row without a live app session is the SPOKEN-LINE row (the
// `show-dock` path): there is no phase to mirror, and what is happening is
// that the assistant is talking — so the orb says exactly that.
const miniOrb = computed(() =>
  isMirror.value
    ? mirroredOrbState(
        mirroredSession.value?.live === true ? mirroredSession.value.phase : "speaking",
        activityEnergy("idle"),
      )
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
    // The spoken-line row has no microphone ANYWHERE to report — claiming
    // "Listening" beside a proactive line would promise an open mic.
    if (mirroredSession.value?.live !== true) return "Speaking";
    return mirroredSession.value.phase === "muted" ? "Muted" : "Listening";
  }
  if (isMuted.value) return "Muted";
  return voice.isActive.value ? "Listening" : "Resume";
});

// What the corner row says, and whether its pill reads as live — the mirror
// answers off the room's frame; a spoken-line row prefers the line PLAYING in
// this window (fresher, sentence by sentence) over the announced opening;
// everything else answers off this window's session.
const miniCaption = computed(() =>
  isMirror.value
    ? mirroredSession.value?.live === true
      ? mirroredSession.value.caption
      : (daemon.relayedLineText.value ?? announcedLineText.value ?? "")
    : caption.value,
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
      @stop="stopListening"
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
