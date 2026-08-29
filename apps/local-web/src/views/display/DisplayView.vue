<script setup lang="ts">
import { computed, ref } from "vue";
import {
  DisplayBackdrop,
  DisplayPanel,
  DisplayPresence,
  DisplayStrip,
  DisplayThemeMenu,
  resolveDisplayShape,
  resolveDisplayColour,
} from "@vynel/ui";
import type { DisplayPanelRow } from "@vynel/ui";
import { useUiStore } from "../../stores/ui-store.js";
import { useDisplayVoice } from "../../composables/display/use-display-voice.js";
import { useDisplayStatus } from "../../composables/display/use-display-status.js";
import { TELEMETRY_CAP } from "../../composables/display/display-status-rows.js";
import { useDisplayWidgets } from "../../composables/display/use-display-widgets.js";
import type { SessionScope } from "../../composables/chat/session-scope.js";
import {
  displayOrbState,
  useSpokenClauseSpike,
} from "../../composables/display/display-orb-state.js";
import DisplayWidgetSlot from "../../components/display/DisplayWidgetSlot.vue";
import { useDemoStore } from "../../stores/demo-store.js";

// The Display — the room you talk to. The orb IS the assistant's presence, the
// panels are the app's own status read back at a glance, and the strip carries
// the two numbers that decide whether you get up from your chair.
//
// The voice session is NOT the room's: it belongs to the window
// (`use-display-voice`), starts with the title-bar switch and outlives this
// screen, so walking away keeps the conversation and coming back re-attaches
// to the same one. The room RENDERS whatever that session is doing — including
// nothing at all, which is the orb idle and a "Start" pill. The daemon link
// rides the same store, which is also why the shell keeps `VoiceOverlay`
// unmounted while the Display owns the window's voice: two links would mean
// two players and two microphones.
//
// The BOARD follows the surface (house rule: the surface decides the scope) —
// the global chat's room shows the global board, a workspace room shows that
// workspace's. The microphone does not: there is one, it belongs to the
// window, and the status panels stay app-wide because the app is.

const props = defineProps<{
  /** Whose board this room shows. Required on purpose: a defaulted 'global'
   *  would put a workspace conversation's cards where nobody is looking. */
  scope: SessionScope;
}>();

const voice = useDisplayVoice();

const { status, telemetry, clock, noteBoardChange } = useDisplayStatus();
const spikeKey = useSpokenClauseSpike();

// The room's own theme — a palette AND a shape. It rides the shell store so it
// survives leaving the room, and it is applied as an attribute on this view's
// root, which is where `display-themes.css` hangs every override. Nothing
// outside `.display-root` can see it.
const ui = useUiStore();
const shape = computed(() => resolveDisplayShape(ui.displayShape));
const colour = computed(() => resolveDisplayColour(ui.displayColour));

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

// The filmed demo has no voice session of its own — it plays pre-recorded
// lines — so it drives the orb through the same daemon leg a relayed line
// uses: the assistant IS talking, and the room must burn and mouth for it
// (Chad, 2026-08-28: "no wave form"). Off-camera this reads exactly as before.
const demo = useDemoStore();
const orb = computed(() =>
  displayOrbState(voice.view, status.value.orbEnergy, voice.isMuted, {
    state: demo.isRoutineRunning ? "speaking" : voice.daemonLeg.state,
    isPlayingRelayedLine: demo.isSpeakingLine || voice.daemonLeg.isPlayingRelayedLine,
  }),
);

// Five honest states, not two. The first is the one the room does not own: the
// OTHER leg is holding the conversation — a wake the display dock took, or one
// the daemon answered natively — and that session cannot move into this window,
// so the pill reports rather than offers a microphone the click cannot get.
// Voice off is its own state too — nothing to mute and nothing to resume, so
// the pill offers to start one. And a session the idle timer ended is not
// "Muted": nobody muted it, and the click that follows restarts it.
const micPillLabel = computed(() => {
  if (voice.isVoiceHeldElsewhere) return "Dock is listening";
  if (!voice.isLive) return "Start";
  if (voice.isMuted) return "Muted";
  return voice.isActive ? "Listening" : "Resume";
});

// What the strip says under the wordmark — the room's own one-liner, not the
// caption (that one belongs under the orb, where the conversation is).
const subtitle = computed(() => {
  if (!status.value.linked) return "Engine unreachable — panels may be stale";
  if (status.value.needYou > 0) return "Something is waiting on you";
  return status.value.building > 0 ? "Working" : "Standing by";
});

/** The session switch itself — off gives the microphone back without leaving
 *  the room; on takes it again, and the room stays whichever way it goes. */
function toggleVoice(): void {
  if (voice.isLive) voice.end();
  else voice.start();
}

// The status vocabulary, spelled out once where the user can read it — the
// panels' tones mean nothing on their own.
const LEGEND_ROWS: DisplayPanelRow[] = [
  { label: "Needs you", value: "waiting on an answer", tone: "attention" },
  { label: "Working", value: "running right now", tone: "live" },
  { label: "Idle", value: "nothing in hand", tone: "muted" },
];

// A machine without canvas 2D loses the orb, not the room: the panels carry
// the status either way, so the stage says so quietly and stays.
const hasOrb = ref(true);

// What an empty slot says — a promise of where reports, tables and numbers
// land, so the room reads as ready rather than broken.
const WIDGET_HINT = "Claude can put reports here";
</script>

<template>
  <div
    class="display-root display-view"
    :data-display-shape="shape.id"
    :data-display-colour="colour.id"
    :data-display-chrome="ui.displayPanels ? 'panels' : 'bare'"
  >
    <!-- The moving ground, behind everything and inert. Keyed on the theme so
         a switch restarts every loop together rather than dropping the new
         palette into the old animation's mid-cycle. -->
    <DisplayBackdrop :key="colour.id" />

    <!-- The room is always a FULL view: this strip IS the window's top row, so
         it drags the window (the title bar is gone) and leaves the shell's
         corner cluster its room on the right. -->
    <DisplayStrip
      class="strip"
      data-tauri-drag-region
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
        :class="{ on: voice.isListening }"
        :aria-pressed="voice.isListening"
        data-testid="display-listening-pill"
        @click="voice.toggleMute()"
      >
        {{ micPillLabel }}
      </button>
      <button
        type="button"
        class="strip-pill"
        :class="{ on: voice.isLive }"
        data-testid="display-voice-pill"
        @click="toggleVoice"
      >
        {{ voice.isLive ? "Voice off" : "Voice on" }}
      </button>
      <!-- The panels switch. A THIRD axis beside shape and colour: every shape
           reads with the readouts up or down, so this is a toggle rather than
           two entries per shape in the roster. -->
      <button
        type="button"
        class="strip-pill"
        :class="{ on: ui.displayPanels }"
        :aria-pressed="ui.displayPanels"
        data-testid="display-panels-pill"
        @click="ui.toggleDisplayPanels()"
      >
        Panels
      </button>
      <!-- Last in the strip, so the room's own controls keep their order and
           the panel drops clear of the window's corner cluster. -->
      <DisplayThemeMenu
        :shape="shape.id"
        :colour="colour.id"
        @update:shape="ui.setDisplayShape($event)"
        @update:colour="ui.setDisplayColour($event)"
      />
    </DisplayStrip>

    <div class="display-body">
      <aside class="column" data-testid="display-column-left">
        <DisplayPanel title="System" :rows="status.systemRows" />
        <DisplayPanel
          title="Telemetry"
          :rows="telemetry"
          :lines="TELEMETRY_CAP"
        >
          <p v-if="telemetry.length === 0" class="quiet">nothing yet</p>
        </DisplayPanel>
        <DisplayWidgetSlot
          name="left"
          :widgets="bySlot.left"
          :hint="WIDGET_HINT"
        />
      </aside>

      <section class="stage" data-testid="display-stage">
        <!-- Whatever presence THIS theme asked for: the canvas orb, a
             breathing ring, bars, a dial, or nothing at all. -->
        <DisplayPresence
          class="orb"
          :kind="shape.stage"
          :energy="orb.energy"
          :listening="orb.listening"
          :speaking="orb.speaking"
          :spike-key="spikeKey"
          :palette="colour.orb"
          :form="shape.form"
          @renderer-failed="hasOrb = false"
        />
        <!-- Only the canvas stage can fail; the others are CSS. -->
        <p v-if="!hasOrb && shape.stage === 'orb'" class="quiet">
          Orb unavailable — status panels still live
        </p>
        <p class="caption">{{ voice.caption }}</p>
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
        <DisplayWidgetSlot
          name="right"
          :widgets="bySlot.right"
          :hint="WIDGET_HINT"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* The palette and the ground come from `.display-root` (@vynel/ui) — this
   file only lays the room out. */
.display-view {
  height: 100%;
  /* FILL the canvas, don't shrink to fit it. The shell lays the canvas out as
   * a row flex container, so a flex item with no width sizes to its content —
   * and the room's widest child is a canvas/grid that is itself `100%`, which
   * contributes nothing to that intrinsic measure. The room therefore settled
   * at whatever the status panels happened to need and left the rest of the
   * window empty. It is a full-surface room; it takes the whole surface. */
  width: 100%;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px 18px;
  min-height: 0;
}

/* The shell sets the inset only in full view — the width of the corner
   cluster it floats over the strip's right end. */
.strip {
  padding-right: var(--chrome-inset-right, 0px);
  /* Above the body, not merely alongside it. `display-root.css` puts every
   * direct child on `z-index: 1`, so the strip and the body TIE and the body —
   * later in the DOM — paints over it. Anything the strip hangs downward (the
   * theme menu's panel) then lands UNDER the status panels and swallows the
   * clicks meant for it, however high its own z-index is: that z-index is
   * trapped inside the strip's own stacking context. The strip is chrome, so
   * it belongs above the content it labels. */
  z-index: 2;
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
  transition:
    color 120ms ease,
    border-color 120ms ease;
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
