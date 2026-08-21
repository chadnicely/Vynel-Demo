<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { DisplayOrb, DisplayPanel, DisplayStrip } from "@vynel/ui";
import type { DisplayPanelRow } from "@vynel/ui";
import type { DisplaySessionPhase } from "@vynel/contracts/voice/daemon-events";
import { useUiStore } from "../../stores/ui-store.js";
import { useVoiceSession } from "../../composables/voice/use-voice-session.js";
import { useVoiceDaemonLink } from "../../composables/voice/use-voice-daemon-link.js";
import {
  voiceStageCaption,
  voiceStageIsListening,
  voiceStageOrbState,
} from "../../components/voice/voice-stage-view.js";
import { useDisplaySessionAnnounce } from "../../composables/display/use-display-session-announce.js";
import { useDisplayStatus } from "../../composables/display/use-display-status.js";
import { useDisplayWidgets } from "../../composables/display/use-display-widgets.js";
import type { SessionScope } from "../../composables/chat/session-scope.js";
import {
  displayOrbState,
  useSpokenClauseSpike,
  type DisplayDaemonLeg,
} from "../../composables/display/display-orb-state.js";
import DisplayWidgetSlot from "../../components/display/DisplayWidgetSlot.vue";

// The Display — the room you talk to. The orb IS the assistant's presence, the
// panels are the app's own status read back at a glance, and the strip carries
// the two numbers that decide whether you get up from your chair.
//
// The voice session is the ROOM'S: it starts when the room opens and ends when
// it closes (`useVoiceSession` ends its session on unmount), so leaving by any
// route — the switch, a menu row, Home — hands the microphone back. That is
// also why the shell hides `VoiceOverlay` while this view is up: two live
// sessions would mean two orbs and two microphones.
//
// Taking the overlay's session means taking its DAEMON LINK too — the overlay
// is the window's only `voice:app` subscriber, so without this the wake word
// would have nowhere to land and a relayed `speak` (a schedule, the typed
// chat, another producer) would be dropped for as long as the room is up.
//
// The BOARD follows the surface (house rule: the surface decides the scope) —
// the global chat's room shows the global board, a workspace room shows that
// workspace's. The microphone does not: there is one, it belongs to whichever
// room is on screen, and the status panels stay app-wide because the app is.

const props = defineProps<{
  /** Whose board this room shows. Required on purpose: a defaulted 'global'
   *  would put a workspace conversation's cards where nobody is looking. */
  scope: SessionScope;
}>();

const ui = useUiStore();
const isMuted = ref(false);

// Hoisted handlers so the two composables can reference each other's owners —
// both callbacks only ever fire after setup completes.
const voice = useVoiceSession({ onEnded: handleSessionEnded });
const daemon = useVoiceDaemonLink({
  onWake: handleWake,
  ownLiveSessionId: voice.currentSessionId,
  speakThroughSession: voice.speakExternal,
});

// Idle silence ends the session and the room stays open — it is a place, not a
// modal. The pills invite you back in; the daemon takes the microphone back so
// the wake word works again from here. (This also fires when the user MUTES,
// which ends the session on purpose — resetting `isMuted` here would undo the
// mute they just asked for.)
function handleSessionEnded(): void {
  daemon.notifySessionEnd();
}

function handleWake(command: string, turnWatchdogMs?: number): void {
  isMuted.value = false;
  if (!voice.isActive.value) voice.start(command || undefined, turnWatchdogMs);
}

const { status, telemetry, clock, noteBoardChange } = useDisplayStatus();
const spikeKey = useSpokenClauseSpike();

// The board Claude puts things on, named the way the `display_*` tools name
// it: 'global', or the workspace's own id. A GETTER, so retargeting the tab
// this room sits in moves the board, the frames, the telemetry and Clear
// together.
const boardScope = computed<string>(() =>
  props.scope.kind === "global" ? "global" : props.scope.workspaceId,
);
// ONE `display` subscription for the whole room: the log narrates the board
// through this tap rather than opening a second one. (`bySlot.dock` stays
// typed and unread — the dock is P3.)
const { bySlot, widgets, clearOnServer } = useDisplayWidgets(boardScope, {
  onChange: noteBoardChange,
});

// Clearing is the user's own act, so a failure has to be visible where they
// clicked rather than swallowed — the pill says so until the next attempt.
const clearFailed = ref(false);
async function clearBoard(): Promise<void> {
  clearFailed.value = false;
  try {
    await clearOnServer();
  } catch {
    clearFailed.value = true;
  }
}

onMounted(() => {
  // The overlay's switch can be left ON behind the room — "Start voice" from
  // the palette, then the Display — and the overlay is unmounted here, so
  // nothing would ever turn it off again: the shell would keep dimming the
  // page for an overlay that isn't there.
  ui.isVoiceOverlayOpen = false;
  voice.start();
});

// "Start voice" while the room holds the canvas: the microphone is the room's,
// so the shell rings this counter instead of raising a second session behind
// the orb.
watch(
  () => ui.displayVoiceRequestCount,
  () => {
    if (voice.isActive.value) return;
    isMuted.value = false;
    voice.start();
  },
);

// The OTHER leg: a wake the daemon answered natively, or one it handed to the
// wake window while this room stayed open. The conversation is the assistant's
// either way, so the room's orb mirrors it — behind its own session, which
// always wins the microphone (see `displayOrbState`).
const daemonLeg = computed<DisplayDaemonLeg>(() => ({
  state: daemon.daemonState.value,
  isPlayingRelayedLine: daemon.isPlayingRelayedLine.value,
}));

const orb = computed(() =>
  displayOrbState(voice.view.value, status.value.orbEnergy, isMuted.value, daemonLeg.value),
);
const caption = computed(() =>
  voiceStageCaption(voice.view.value, isMuted.value, voice.failure.value),
);
const isListening = computed(() => voiceStageIsListening(voice.view.value, isMuted.value));

// The display dock is this room in another window. It cannot see this screen,
// and a Web Speech session cannot move between windows — so the room ANNOUNCES
// the conversation it holds and the dock mirrors it in the corner while the
// user works somewhere else. Muted counts as live: a muted room is a paused
// conversation, not an ended one, and the row says so.
//
// The stage's orb vocabulary is the wire's plus `wake`, which belongs to the
// daemon leg and never comes out of the room's own session — so the phase reads
// the one mapping rather than keeping a second copy of it.
const sessionPhase = computed<DisplaySessionPhase>(() => {
  const orb = voiceStageOrbState(voice.view.value, isMuted.value);
  return orb === "wake" ? "listening" : orb;
});
useDisplaySessionAnnounce(() => ({
  live: voice.isActive.value || isMuted.value,
  phase: sessionPhase.value,
  caption: caption.value,
}));

// Three honest states, not two: a session the idle timer ended is not "Muted"
// — nobody muted it — and the click that follows restarts it.
const micPillLabel = computed(() => {
  if (isMuted.value) return "Muted";
  return voice.isActive.value ? "Listening" : "Resume";
});

// What the strip says under the wordmark — the room's own one-liner, not the
// caption (that one belongs under the orb, where the conversation is).
const subtitle = computed(() => {
  if (!status.value.linked) return "Engine unreachable — panels may be stale";
  if (status.value.needYou > 0) return "Something is waiting on you";
  return status.value.building > 0 ? "Working" : "Standing by";
});

/** The microphone switch. Idle silence ends the session while the room stays
 *  open, so on a dead session the first click must bring the mic BACK — muting
 *  what is already silent would leave the two pills contradicting each other
 *  ("Muted" beside "Voice on") and cost the user a second click. */
function toggleMute(): void {
  if (!voice.isActive.value) {
    isMuted.value = false;
    voice.start();
    return;
  }
  isMuted.value = !isMuted.value;
  if (isMuted.value) voice.end();
  else voice.start();
}

/** The session switch itself — off gives the microphone back without leaving
 *  the room; on takes it again. */
function toggleVoice(): void {
  if (voice.isActive.value) {
    voice.end();
    return;
  }
  isMuted.value = false;
  voice.start();
}

// The status vocabulary, spelled out once where the user can read it — the
// panels' tones mean nothing on their own.
const LEGEND_ROWS: DisplayPanelRow[] = [
  { label: "Needs you", value: "waiting on an answer", tone: "attention" },
  { label: "Working", value: "running right now", tone: "live" },
  { label: "Idle", value: "nothing in hand", tone: "muted" },
];

/** The pills read the session, so the template needs it unwrapped. */
const isVoiceActive = voice.isActive;

// A machine without canvas 2D loses the orb, not the room: the panels carry
// the status either way, so the stage says so quietly and stays.
const hasOrb = ref(true);

// What an empty slot says — a promise of where reports, tables and numbers
// land, so the room reads as ready rather than broken.
const WIDGET_HINT = "Claude can put reports here";
</script>

<template>
  <div class="display-root display-view">
    <DisplayStrip
      brand="Vynel"
      :subtitle="subtitle"
      :linked="status.linked"
      :building="status.building"
      :need-you="status.needYou"
      :clock="clock"
    >
      <!-- Only when there is something to clear: a dead control on a board
           that is already empty is furniture. It stays through a FAILURE
           though — clearing blanks the board optimistically, so hiding the
           pill on an empty board would hide the news that it did not work. -->
      <button
        v-if="widgets.length > 0 || clearFailed"
        type="button"
        class="strip-pill"
        :class="{ attention: clearFailed }"
        data-testid="display-clear"
        @click="clearBoard"
      >
        {{ clearFailed ? "Clear failed" : "Clear" }}
      </button>
      <button
        type="button"
        class="strip-pill"
        :class="{ on: isListening }"
        :aria-pressed="isListening"
        data-testid="display-listening-pill"
        @click="toggleMute"
      >
        {{ micPillLabel }}
      </button>
      <button
        type="button"
        class="strip-pill"
        :class="{ on: isVoiceActive }"
        data-testid="display-voice-pill"
        @click="toggleVoice"
      >
        {{ isVoiceActive ? "Voice off" : "Voice on" }}
      </button>
    </DisplayStrip>

    <div class="display-body">
      <aside class="column" data-testid="display-column-left">
        <DisplayPanel title="System" :rows="status.systemRows" />
        <DisplayPanel title="Telemetry" :rows="telemetry">
          <p v-if="telemetry.length === 0" class="quiet">nothing yet</p>
        </DisplayPanel>
        <DisplayWidgetSlot name="left" :widgets="bySlot.left" :hint="WIDGET_HINT" />
      </aside>

      <section class="stage" data-testid="display-stage">
        <DisplayOrb
          class="orb"
          :energy="orb.energy"
          :listening="orb.listening"
          :speaking="orb.speaking"
          :spike-key="spikeKey"
          @renderer-failed="hasOrb = false"
        />
        <p v-if="!hasOrb" class="quiet">Orb unavailable — status panels still live</p>
        <p class="caption">{{ caption }}</p>
        <DisplayWidgetSlot
          class="stage-widgets"
          name="stage"
          :widgets="bySlot.stage"
          :hint="WIDGET_HINT"
        />
      </section>

      <aside class="column" data-testid="display-column-right">
        <DisplayPanel title="Account" :rows="status.accountRows" />
        <DisplayPanel title="Legend" :rows="LEGEND_ROWS" />
        <DisplayWidgetSlot name="right" :widgets="bySlot.right" :hint="WIDGET_HINT" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* The palette and the ground come from `.display-root` (@vynel/ui) — this
   file only lays the room out. */
.display-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px 18px;
  min-height: 0;
}

.display-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(190px, 232px) 1fr minmax(190px, 232px);
  gap: 14px;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 0;
}

.orb {
  flex: 1;
  width: 100%;
  min-height: 0;
}

.caption {
  margin: 0;
  max-width: 620px;
  text-align: center;
  font-size: 12px;
  line-height: 1.55;
  color: var(--display-text, #cdf3ff);
}

.quiet {
  margin: 2px 0 0;
  font-size: 10px;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

/* The stage's cards sit under the orb and scroll among THEMSELVES — the orb
   keeps its share of the stage however many reports are up. */
.stage-widgets {
  width: 100%;
  max-height: 46%;
  overflow-y: auto;
}

.strip-pill {
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  background: transparent;
  padding: 3px 10px;
  font: inherit;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}

.strip-pill.on {
  border-color: var(--display-accent, #4fd8ff);
  color: var(--display-text, #cdf3ff);
}

/* The room's one alert colour, on the one control that can fail here. */
.strip-pill.attention {
  border-color: var(--display-attention, #ffc46b);
  color: var(--display-attention, #ffc46b);
}

.strip-pill:hover {
  color: var(--display-text, #cdf3ff);
}

@media (max-width: 1040px) {
  .display-body {
    grid-template-columns: 1fr;
    grid-auto-rows: min-content;
    overflow-y: auto;
  }
}
</style>
