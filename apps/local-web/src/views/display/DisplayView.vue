<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { DisplayOrb, DisplayPanel, DisplayStrip } from "@vynel/ui";
import type { DisplayPanelRow } from "@vynel/ui";
import { useVoiceSession } from "../../composables/voice/use-voice-session.js";
import {
  voiceStageCaption,
  voiceStageIsListening,
} from "../../components/voice/voice-stage-view.js";
import { useDisplayStatus } from "../../composables/display/use-display-status.js";
import {
  displayOrbState,
  useSpokenClauseSpike,
} from "../../composables/display/display-orb-state.js";

// The Display — the room you talk to. The orb IS the assistant's presence, the
// panels are the app's own status read back at a glance, and the strip carries
// the two numbers that decide whether you get up from your chair.
//
// The voice session is the ROOM'S: it starts when the room opens and ends when
// it closes (`useVoiceSession` ends its session on unmount), so leaving by any
// route — the switch, a menu row, Home — hands the microphone back. That is
// also why the shell hides `VoiceOverlay` while this view is up: two live
// sessions would mean two orbs and two microphones.

const isMuted = ref(false);

// Idle silence ends the session and the room stays open — it is a place, not a
// modal. The pills flip to "Voice on" and invite you back in; nothing else to
// do here. (The daemon hand-back belongs to VoiceOverlay, which owns the wake
// link and is not mounted while this room is.)
//
// The emptiness is load-bearing: this also fires when the user MUTES, which
// ends the session on purpose — resetting `isMuted` here would immediately
// undo the mute the user just asked for.
function handleSessionEnded(): void {}

const voice = useVoiceSession({ onEnded: handleSessionEnded });
const { status, telemetry, clock } = useDisplayStatus();
const spikeKey = useSpokenClauseSpike();

onMounted(() => {
  voice.start();
});

const orb = computed(() =>
  displayOrbState(voice.view.value, status.value.orbEnergy, isMuted.value),
);
const caption = computed(() =>
  voiceStageCaption(voice.view.value, isMuted.value, voice.failure.value),
);
const isListening = computed(() => voiceStageIsListening(voice.view.value, isMuted.value));

// What the strip says under the wordmark — the room's own one-liner, not the
// caption (that one belongs under the orb, where the conversation is).
const subtitle = computed(() => {
  if (!status.value.linked) return "Engine unreachable — panels may be stale";
  if (status.value.needYou > 0) return "Something is waiting on you";
  return status.value.building > 0 ? "Working" : "Standing by";
});

function toggleMute(): void {
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

// P2 lands widgets (reports, tables, numbers Claude puts up while it talks) in
// the three slots below; P1 shows where they will go rather than pretending
// the room is finished.
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
      <button
        type="button"
        class="voice-pill"
        :class="{ on: isListening }"
        :aria-pressed="isListening"
        data-testid="display-listening-pill"
        @click="toggleMute"
      >
        {{ isListening ? "Listening" : "Muted" }}
      </button>
      <button
        type="button"
        class="voice-pill"
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
        <div class="widget-slot" data-testid="display-slot-left">{{ WIDGET_HINT }}</div>
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
        <div class="widget-slot" data-testid="display-slot-stage">{{ WIDGET_HINT }}</div>
      </section>

      <aside class="column" data-testid="display-column-right">
        <DisplayPanel title="Account" :rows="status.accountRows" />
        <DisplayPanel title="Legend" :rows="LEGEND_ROWS" />
        <div class="widget-slot" data-testid="display-slot-right">{{ WIDGET_HINT }}</div>
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

/* Deliberately faint: an empty slot is a promise, not furniture. */
.widget-slot {
  border: 1px dashed var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  padding: 10px;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

.voice-pill {
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

.voice-pill.on {
  border-color: var(--display-accent, #4fd8ff);
  color: var(--display-text, #cdf3ff);
}

.voice-pill:hover {
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
